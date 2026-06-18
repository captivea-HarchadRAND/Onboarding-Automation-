const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const { scrypt, randomBytes, timingSafeEqual } = require('crypto');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

// ─── Env loading (doit être avant tout accès à process.env) ──────────────────
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) return;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  });
}

const { getDB, saveDB } = require('./db');

const SETTINGS_MAP = {
  azure_tenant_id:       'AZURE_TENANT_ID',
  azure_client_id:       'AZURE_CLIENT_ID',
  // azure_client_secret intentionally excluded — env-only, never stored in DB
  default_domain:        'DEFAULT_DOMAIN',
  usage_location:        'USAGE_LOCATION',
  force_change_password:        'FORCE_CHANGE_PASSWORD',
  sharepoint_global_groups:  'SP_GLOBAL_GROUPS',
  sharepoint_country_groups: 'SP_COUNTRY_GROUPS',
  communication_groups:      'SP_COMMUNICATION_GROUPS',
  pointage_assignments:      'SP_POINTAGE_ASSIGNMENTS',
  pointage_comm_assignments: 'SP_POINTAGE_COMM_ASSIGNMENTS',
  pointage_departments:      'SP_POINTAGE_DEPARTMENTS',
  department_assignments:    'SP_DEPARTMENT_ASSIGNMENTS',
  locations:                 'ORG_LOCATIONS',
  onboarding_domains:        'ONBOARDING_DOMAINS',
};

const MOCK_GRAPH = process.env.MOCK_GRAPH === 'true';

// Mot de passe généré en mémoire uniquement — jamais stocké en DB
// Retourné une seule fois au poll de complétion, puis effacé
const tempPasswordStore = new Map();
const graphLib = MOCK_GRAPH ? require('./lib/mock') : {
  ...require('./lib/group'),
  ...require('./lib/license'),
  ...require('./lib/user'),
};
const { listGroups, addMemberToGroup, getGroupById, listAvailableLicenses, assignLicense, createUser, deleteUser } = graphLib;

const scryptAsync = promisify(scrypt);
const app = express();
const PORT = process.env.PORT || 8081;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174';
const SESSION_TTL_DAYS = 14;
const INVITE_TTL_DAYS = 7;
const MIN_PASSWORD_LEN = 12;
const LOG_FILE = path.join(__dirname, 'onboarding.log');
const DIST = path.join(__dirname, '../frontend/dist');

const ALLOWED_ORIGINS = [
  ...FRONTEND_URL.split(',').map(u => u.trim()),
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:8081']
    : []),
];

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '512kb' }));
app.use(cookieParser());

if (fs.existsSync(DIST)) app.use(express.static(DIST));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function logAction(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
}

async function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const buf = await scryptAsync(pw, salt, 64);
  return `${buf.toString('hex')}.${salt}`;
}

async function verifyPassword(pw, stored) {
  if (typeof stored !== 'string' || !stored.includes('.')) return false;
  const [hashed, salt] = stored.split('.');
  if (!hashed || !salt) return false;
  const expected = Buffer.from(hashed, 'hex');
  const buf = await scryptAsync(pw, salt, 64);
  if (expected.length !== buf.length) return false;
  return timingSafeEqual(buf, expected);
}

function validatePassword(pw) {
  if (!pw || pw.length < MIN_PASSWORD_LEN) return `Minimum ${MIN_PASSWORD_LEN} caractères requis.`;
  if (!/[A-Z]/.test(pw)) return 'Au moins une majuscule requise.';
  if (!/[a-z]/.test(pw)) return 'Au moins une minuscule requise.';
  if (!/[0-9]/.test(pw)) return 'Au moins un chiffre requis.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Au moins un caractère spécial requis.';
  return null;
}

function dbRows(db, sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

function dbRow(db, sql, params = []) {
  return dbRows(db, sql, params)[0] || null;
}

function isValidUUID(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function sessionCookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_DAYS * 86400000,
  };
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

async function auth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  const db = await getDB();
  const session = dbRow(db, `SELECT user_id FROM sessions WHERE token=? AND expires_at > datetime('now')`, [token]);
  if (!session) return res.status(401).json({ error: 'Session expirée' });
  const user = dbRow(db, `SELECT id, name, email, role, status FROM users WHERE id=?`, [session.user_id]);
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'Compte désactivé' });
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Accès refusé' });
    next();
  };
}

const ASSIGNABLE_ROLES = ['operator', 'admin'];

function canAssignRole(actorRole, targetRole) {
  if (!ASSIGNABLE_ROLES.includes(targetRole)) return false;
  if (targetRole === 'admin') return actorRole === 'admin';
  return actorRole === 'admin';
}

function countActiveAdmins(db, exceptId = null) {
  const row = dbRow(db,
    `SELECT COUNT(*) as c FROM users WHERE role='admin' AND status='active'${exceptId ? ' AND id!=?' : ''}`,
    exceptId ? [exceptId] : []);
  return row?.c ?? 0;
}

// ─── Auth routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const db = await getDB();
  const user = dbRow(db, `SELECT * FROM users WHERE email=? AND status='active'`, [email.toLowerCase().trim()]);
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Identifiants invalides' });
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });

  const token = uuidv4();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString();
  db.run(`INSERT INTO sessions VALUES (?,?,?,?,?)`, [token, user.id, user.name, user.role, expires]);
  saveDB();

  res.cookie('session', token, sessionCookieOpts());
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies?.session;
  if (token) {
    const db = await getDB();
    db.run(`DELETE FROM sessions WHERE token=?`, [token]);
    saveDB();
  }
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, async (req, res) => {
  res.json({ user: req.user, mock: MOCK_GRAPH });
});

app.post('/api/auth/verify-password', auth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
  const db = await getDB();
  const user = dbRow(db, `SELECT password_hash FROM users WHERE id=?`, [req.user.id]);
  if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect' });
  res.json({ ok: true });
});

// Vérification du mot de passe de lancement IT (uniquement via .env — non modifiable via UI)
app.post('/api/auth/verify-launch-password', auth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
  const launchPassword = process.env.LAUNCH_PASSWORD;
  if (!launchPassword) return res.status(500).json({ error: 'Code de confirmation IT non configuré (variable LAUNCH_PASSWORD dans .env)' });
  if (password !== launchPassword) return res.status(401).json({ error: 'Code de confirmation incorrect' });
  res.json({ ok: true });
});

app.get('/api/auth/invite/:token', async (req, res) => {
  const db = await getDB();
  const user = dbRow(db,
    `SELECT id, name, email FROM users WHERE invite_token=? AND (invite_expires IS NULL OR invite_expires > datetime('now'))`,
    [req.params.token]);
  if (!user) return res.status(404).json({ error: 'Invitation invalide ou expirée' });
  res.json({ user });
});

app.post('/api/auth/invite/:token', async (req, res) => {
  const { password } = req.body;
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const db = await getDB();
  const user = dbRow(db,
    `SELECT id, name, email, role FROM users WHERE invite_token=? AND (invite_expires IS NULL OR invite_expires > datetime('now'))`,
    [req.params.token]);
  if (!user) return res.status(404).json({ error: 'Invitation invalide ou expirée' });
  const hash = await hashPassword(password);
  db.run(`UPDATE users SET password_hash=?, invite_token=NULL, invite_expires=NULL, status='active' WHERE id=?`, [hash, user.id]);
  saveDB();
  const sessionToken = uuidv4();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString();
  db.run(`INSERT INTO sessions VALUES (?,?,?,?,?)`, [sessionToken, user.id, user.name, user.role, expires]);
  saveDB();
  res.cookie('session', sessionToken, sessionCookieOpts());
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// ─── Graph proxy routes ────────────────────────────────────────────────────────

app.get('/api/graph/groups', auth, async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const groups = await listGroups(search);
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/graph/groups/:id', auth, async (req, res) => {
  try {
    const group = await getGroupById(req.params.id);
    res.json(group);
  } catch (err) {
    res.status(err.graphStatus === 404 ? 404 : 500).json({ error: err.message });
  }
});

app.get('/api/graph/licenses', auth, async (req, res) => {
  try {
    const licenses = await listAvailableLicenses();
    res.json(licenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Onboarding execution ─────────────────────────────────────────────────────

function updateStep(db, onboardingId, stepNumber, status, errorMessage = null) {
  const now = new Date().toISOString();
  if (status === 'running') {
    db.run(
      `UPDATE onboarding_steps SET status=?, started_at=? WHERE onboarding_id=? AND step_number=?`,
      [status, now, onboardingId, stepNumber]
    );
  } else {
    db.run(
      `UPDATE onboarding_steps SET status=?, completed_at=?, error_message=? WHERE onboarding_id=? AND step_number=?`,
      [status, now, errorMessage, onboardingId, stepNumber]
    );
  }
  saveDB();
}

async function executeOnboarding(id) {
  const db = await getDB();
  const onb = dbRow(db, `SELECT * FROM onboardings WHERE id=?`, [id]);
  if (!onb) return;

  db.run(`UPDATE onboardings SET status='running' WHERE id=?`, [id]);
  saveDB();

  let adUserId = null;

  try {
    // Étape 1 — Création du compte Azure AD
    updateStep(db, id, 1, 'running');
    logAction(`[${id}] [1/3] Création du compte pour ${onb.employee_email}...`);

    const adUser = await createUser({
      firstName: onb.employee_firstname,
      lastName:  onb.employee_lastname,
      email:     onb.employee_email,
      location:  onb.location,
    });
    adUserId = adUser.id;

    if (adUser.temporaryPassword) {
      tempPasswordStore.set(id, adUser.temporaryPassword);
      setTimeout(() => tempPasswordStore.delete(id), 10 * 60 * 1000);
    }
    db.run(`UPDATE onboardings SET employee_ad_id=? WHERE id=?`, [adUserId, id]);
    saveDB();
    updateStep(db, id, 1, 'done');
    logAction(`[${id}] [1/3] ✅ Compte créé : ${adUser.userPrincipalName}`);

    // Étape 2 — Ajout au groupe
    updateStep(db, id, 2, 'running');
    logAction(`[${id}] [2/3] Ajout au groupe "${onb.group_name}"...`);

    await addMemberToGroup(onb.group_id, adUserId);
    updateStep(db, id, 2, 'done');
    logAction(`[${id}] [2/3] ✅ Ajouté au groupe "${onb.group_name}"`);

    // Étape 3 — Assignation de la licence
    updateStep(db, id, 3, 'running');
    logAction(`[${id}] [3/3] Assignation de la licence "${onb.license_name}"...`);

    await assignLicense(adUserId, onb.sku_id);
    updateStep(db, id, 3, 'done');
    logAction(`[${id}] [3/3] ✅ Licence "${onb.license_name}" assignée`);

    // Étape 4 — Groupes SharePoint
    updateStep(db, id, 4, 'running');
    const globalGroups    = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='sharepoint_global_groups'`)?.value  || '[]');
    const countryGroups   = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='sharepoint_country_groups'`)?.value || '[]');
    const pointageGroups  = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='pointage_assignments'`)?.value      || '[]');
    const deptAssignments      = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='department_assignments'`)?.value       || '[]');
    const pointageCommAssign   = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='pointage_comm_assignments'`)?.value    || '[]');
    const location             = onb.location || '';
    const jobRole              = onb.job_role || '';
    // Groupes de communication — fusion des deux sources avec déduplication par id
    const commGroups = [
      ...deptAssignments.filter(g => {
        const depts = g.departments || [];
        return g.id &&
          (depts.length === 0 || depts.includes(jobRole)) &&
          (g.location === 'ALL' || (g.countries || []).includes(location));
      }).map(g => ({ id: g.id, label: g.name || g.id })),
      ...pointageCommAssign.filter(g =>
        g.id && g.department === jobRole && g.location === location
      ).map(g => ({ id: g.id, label: g.label || g.id })),
    ].filter((g, i, arr) => arr.findIndex(x => x.id === g.id) === i);

    const spGroups = [
      ...globalGroups.filter(g => g.id),
      ...countryGroups.filter(g => g.id && g.location === location),
      ...pointageGroups.filter(g => g.id && g.location === location),
      ...commGroups,
    ];
    if (spGroups.length === 0) {
      logAction(`[${id}] [4/4] Aucun groupe SharePoint configuré — étape ignorée`);
    } else {
      for (const g of spGroups) {
        await addMemberToGroup(g.id, adUserId);
        logAction(`[${id}] [4/4] ✅ Ajouté au groupe SharePoint "${g.label}"`);
      }
    }
    updateStep(db, id, 4, 'done');

    db.run(`UPDATE onboardings SET status='done', completed_at=datetime('now') WHERE id=?`, [id]);
    saveDB();
    logAction(`[${id}] 🎉 Onboarding terminé pour ${onb.employee_email}`);

  } catch (err) {
    logAction(`[${id}] ❌ Erreur : ${err.message}`);

    if (adUserId) {
      try {
        logAction(`[${id}] 🔄 Rollback : suppression du compte Azure AD ${adUserId}...`);
        await deleteUser(adUserId);
        logAction(`[${id}] ✅ Rollback effectué`);
        db.run(`UPDATE onboardings SET rolled_back=1 WHERE id=?`, [id]);
        saveDB();
      } catch (rbErr) {
        logAction(`[${id}] ❌ Rollback échoué : ${rbErr.message} — suppression manuelle requise pour ${adUserId}`);
      }
    }

    db.run(
      `UPDATE onboarding_steps SET status='failed', error_message=?, completed_at=datetime('now')
       WHERE onboarding_id=? AND status='running'`,
      [err.message, id]
    );
    db.run(
      `UPDATE onboardings SET status='failed', error_message=? WHERE id=?`,
      [err.message, id]
    );
    saveDB();
  }
}

// ─── Onboarding routes ────────────────────────────────────────────────────────

app.get('/api/onboardings', auth, async (req, res) => {
  const db = await getDB();
  const { status, limit } = req.query;
  let sql = `SELECT * FROM onboardings WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND status=?`; params.push(status); }
  sql += ` ORDER BY created_at DESC`;
  if (limit) {
    const n = parseInt(limit, 10);
    if (Number.isInteger(n) && n > 0) { sql += ` LIMIT ?`; params.push(Math.min(n, 200)); }
  }
  res.json(dbRows(db, sql, params));
});

app.get('/api/onboardings/:id', auth, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
  const db = await getDB();
  const onb = dbRow(db, `SELECT * FROM onboardings WHERE id=?`, [req.params.id]);
  if (!onb) return res.status(404).json({ error: 'Onboarding introuvable' });
  const steps = dbRows(db,
    `SELECT * FROM onboarding_steps WHERE onboarding_id=? ORDER BY step_number`,
    [req.params.id]);
  // Mot de passe retourné une seule fois depuis la mémoire, puis effacé définitivement
  const temp_password = tempPasswordStore.get(req.params.id) || null;
  if (temp_password) tempPasswordStore.delete(req.params.id);
  res.json({ ...onb, temp_password, steps });
});

app.post('/api/onboardings', auth, async (req, res) => {
  const { firstName, lastName, email, jobRole, location, groupId, groupName, skuId, licenseName } = req.body;
  if (!firstName?.trim() || !lastName?.trim())
    return res.status(400).json({ error: 'Prénom et nom requis' });
  if (!groupId || !groupName)
    return res.status(400).json({ error: 'Groupe requis' });
  if (!skuId || !licenseName)
    return res.status(400).json({ error: 'Licence requise' });

  const domain = process.env.DEFAULT_DOMAIN || 'monentreprise.com';
  const slug = `${firstName}.${lastName}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.]/g, '');
  const employeeEmail = email?.trim() || `${slug}@${domain}`;

  const db = await getDB();
  const id = uuidv4();

  db.run(
    `INSERT INTO onboardings
      (id, employee_firstname, employee_lastname, employee_email,
       job_role, location,
       group_id, group_name, sku_id, license_name,
       status, created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, firstName.trim(), lastName.trim(), employeeEmail,
     jobRole?.trim() || null, location?.trim() || null,
     groupId, groupName, skuId, licenseName,
     'pending', req.user.id, req.user.name]
  );

  const STEP_NAMES = [
    'Création du compte Azure AD',
    'Ajout au groupe',
    'Assignation de la licence',
    'Ajout aux groupes SharePoint',
  ];
  STEP_NAMES.forEach((stepName, i) => {
    db.run(
      `INSERT INTO onboarding_steps (id, onboarding_id, step_number, step_name, status)
       VALUES (?,?,?,?,?)`,
      [uuidv4(), id, i + 1, stepName, 'pending']
    );
  });
  saveDB();

  // Lancement asynchrone — on ne bloque pas la réponse HTTP
  executeOnboarding(id).catch(err => console.error('[executeOnboarding]', err));

  res.status(201).json({ id });
});

// ─── Stats (dashboard) ────────────────────────────────────────────────────────

app.get('/api/stats', auth, async (req, res) => {
  const db = await getDB();
  const month = new Date().toISOString().slice(0, 7);

  const total = dbRow(db, `SELECT COUNT(*) as c FROM onboardings`)?.c ?? 0;
  const thisMonth = dbRow(db,
    `SELECT COUNT(*) as c FROM onboardings WHERE strftime('%Y-%m', created_at)=?`, [month])?.c ?? 0;
  const done = dbRow(db,
    `SELECT COUNT(*) as c FROM onboardings WHERE status='done' AND strftime('%Y-%m', created_at)=?`, [month])?.c ?? 0;
  const failed = dbRow(db,
    `SELECT COUNT(*) as c FROM onboardings WHERE status='failed' AND strftime('%Y-%m', created_at)=?`, [month])?.c ?? 0;
  const running = dbRow(db, `SELECT COUNT(*) as c FROM onboardings WHERE status='running'`)?.c ?? 0;

  const recent = dbRows(db,
    `SELECT id, employee_firstname, employee_lastname, employee_email,
            job_role, location, status, created_at, created_by_name
     FROM onboardings ORDER BY created_at DESC LIMIT 5`);

  res.json({ total, thisMonth, done, failed, running, recent });
});

// ─── Admin: Organisation settings ────────────────────────────────────────────

app.get('/api/admin/settings', auth, requireRole('admin'), async (req, res) => {
  const db = await getDB();
  const rows = dbRows(db, `SELECT key, value FROM settings WHERE key IN (${Object.keys(SETTINGS_MAP).map(() => '?').join(',')})`, Object.keys(SETTINGS_MAP));
  const dbMap = Object.fromEntries(rows.map(r => [r.key, r.value]));

  res.json({
    azure_tenant_id:        dbMap.azure_tenant_id        || process.env.AZURE_TENANT_ID      || '',
    azure_client_id:        dbMap.azure_client_id        || process.env.AZURE_CLIENT_ID      || '',
    azure_client_secret_set: !!process.env.AZURE_CLIENT_SECRET,
    default_domain:         dbMap.default_domain         || process.env.DEFAULT_DOMAIN       || '',
    usage_location:         dbMap.usage_location         || process.env.USAGE_LOCATION       || 'FR',
    launch_password_set:           !!process.env.LAUNCH_PASSWORD,
    force_change_password:         dbMap.force_change_password         || process.env.FORCE_CHANGE_PASSWORD || 'false',
    sharepoint_global_groups:  JSON.parse(dbMap.sharepoint_global_groups  || process.env.SP_GLOBAL_GROUPS              || '[]'),
    sharepoint_country_groups: JSON.parse(dbMap.sharepoint_country_groups || process.env.SP_COUNTRY_GROUPS             || '[]'),
    communication_groups:      JSON.parse(dbMap.communication_groups      || process.env.SP_COMMUNICATION_GROUPS       || '[]'),
    pointage_assignments:      JSON.parse(dbMap.pointage_assignments      || process.env.SP_POINTAGE_ASSIGNMENTS            || '[]'),
    pointage_comm_assignments: JSON.parse(dbMap.pointage_comm_assignments || process.env.SP_POINTAGE_COMM_ASSIGNMENTS  || '[]'),
    pointage_departments:      JSON.parse(dbMap.pointage_departments      || process.env.SP_POINTAGE_DEPARTMENTS        || '[]'),
    department_assignments:    JSON.parse(dbMap.department_assignments    || process.env.SP_DEPARTMENT_ASSIGNMENTS      || '[]'),
    locations:                 JSON.parse(dbMap.locations                 || process.env.ORG_LOCATIONS                || '[{"code":"FR","name":"France","flag":"🇫🇷"},{"code":"MDG","name":"Madagascar","flag":"🇲🇬"},{"code":"US","name":"United States","flag":"🇺🇸"},{"code":"SG","name":"Singapore","flag":"🇸🇬"},{"code":"LUX","name":"Luxembourg","flag":"🇱🇺"},{"code":"IND","name":"India","flag":"🇮🇳"}]'),
    onboarding_domains:        JSON.parse(dbMap.onboarding_domains        || process.env.ONBOARDING_DOMAINS            || '[{"domain":"captivea.com","active":true}]'),
  });
});

app.put('/api/admin/settings', auth, requireRole('admin'), async (req, res) => {
  const db = await getDB();
  Object.entries(req.body).forEach(([k, v]) => {
    if (!Object.keys(SETTINGS_MAP).includes(k)) return;
    const val = Array.isArray(v) ? JSON.stringify(v) : (typeof v === 'string' ? v.trim() : String(v));
    if (val === '' || val === 'null' || val === 'undefined') {
      db.run(`DELETE FROM settings WHERE key=?`, [k]);
    } else {
      db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)`, [k, val]);
      process.env[SETTINGS_MAP[k]] = val;
    }
  });
  saveDB();

  if (!MOCK_GRAPH) {
    const { resetCredential } = require('./lib/graph');
    if (req.body.azure_tenant_id || req.body.azure_client_id) {
      resetCredential();
    }
  }

  res.json({ ok: true });
});

// ─── Admin: Users ─────────────────────────────────────────────────────────────

app.get('/api/admin/users', auth, requireRole('admin'), async (req, res) => {
  const db = await getDB();
  res.json(dbRows(db, `SELECT id, name, email, role, status, created_at FROM users ORDER BY name`));
});

app.post('/api/admin/users', auth, requireRole('admin'), async (req, res) => {
  const { name, email, role, password } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Nom et email requis' });
  const wantRole = role || 'operator';
  if (!canAssignRole(req.user.role, wantRole))
    return res.status(403).json({ error: 'Vous ne pouvez pas attribuer ce rôle' });

  const db = await getDB();
  const existing = dbRow(db, `SELECT id FROM users WHERE email=?`, [email.toLowerCase()]);
  if (existing) return res.status(400).json({ error: 'Email déjà utilisé' });

  const id = uuidv4();
  let hash = null;
  let inviteToken = null;
  let inviteExpires = null;

  if (password) {
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    hash = await hashPassword(password);
  } else {
    inviteToken = uuidv4();
    inviteExpires = new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString();
  }

  db.run(
    `INSERT INTO users (id, name, email, role, password_hash, invite_token, invite_expires, status) VALUES (?,?,?,?,?,?,?,?)`,
    [id, name, email.toLowerCase(), wantRole, hash, inviteToken, inviteExpires, hash ? 'active' : 'pending']
  );
  saveDB();

  const user = dbRow(db, `SELECT id, name, email, role, status FROM users WHERE id=?`, [id]);
  res.status(201).json({ user, invite_token: inviteToken });
});

app.put('/api/admin/users/:id', auth, requireRole('admin'), async (req, res) => {
  const { name, email, role, status } = req.body;
  const db = await getDB();
  const current = dbRow(db, `SELECT status, role FROM users WHERE id=?`, [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Utilisateur introuvable' });

  if (status != null && !['active', 'pending', 'disabled'].includes(status))
    return res.status(400).json({ error: 'Statut invalide' });

  if (role != null && role !== current.role && !canAssignRole(req.user.role, role))
    return res.status(403).json({ error: 'Rôle non autorisé' });

  const demoting = current.role === 'admin' && ((role != null && role !== 'admin') || status === 'disabled');
  if (demoting && countActiveAdmins(db, req.params.id) === 0)
    return res.status(400).json({ error: 'Impossible : dernier administrateur actif' });

  if (email) {
    const dup = dbRow(db, `SELECT id FROM users WHERE email=? AND id!=?`, [email.toLowerCase(), req.params.id]);
    if (dup) return res.status(400).json({ error: 'Email déjà utilisé' });
  }

  db.run(
    `UPDATE users SET name=COALESCE(?,name), email=COALESCE(?,email), role=COALESCE(?,role), status=COALESCE(?,status) WHERE id=?`,
    [name ?? null, email?.toLowerCase() ?? null, role ?? null, status ?? null, req.params.id]
  );
  saveDB();
  res.json(dbRow(db, `SELECT id, name, email, role, status FROM users WHERE id=?`, [req.params.id]));
});

app.delete('/api/admin/users/:id', auth, requireRole('admin'), async (req, res) => {
  if (req.params.id === req.user.id)
    return res.status(400).json({ error: 'Impossible de supprimer son propre compte' });
  const db = await getDB();
  const user = dbRow(db, `SELECT status FROM users WHERE id=?`, [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (user.status !== 'disabled')
    return res.status(400).json({ error: 'Désactivez d\'abord l\'utilisateur' });
  db.run(`DELETE FROM users WHERE id=?`, [req.params.id]);
  saveDB();
  res.json({ ok: true });
});

app.put('/api/admin/users/:id/reset-password', auth, requireRole('admin'), async (req, res) => {
  const { password } = req.body;
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const db = await getDB();
  const hash = await hashPassword(password);
  db.run(`UPDATE users SET password_hash=? WHERE id=?`, [hash, req.params.id]);
  db.run(`DELETE FROM sessions WHERE user_id=?`, [req.params.id]);
  saveDB();
  res.json({ ok: true });
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('[EXPRESS ERROR]', err);
  res.status(500).json({ error: 'Erreur serveur' });
});

if (fs.existsSync(DIST)) {
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

// ─── Démarrage ────────────────────────────────────────────────────────────────

async function ensureDefaultAdmin() {
  const db = await getDB();
  const exists = dbRow(db, `SELECT id FROM users WHERE role='admin' LIMIT 1`);
  if (exists) return;

  const email = (process.env.ADMIN_INITIAL_EMAIL || 'admin@monentreprise.com').toLowerCase().trim();
  const provided = process.env.ADMIN_INITIAL_PASSWORD;
  const password = provided || randomBytes(18).toString('base64url');
  const hash = await hashPassword(password);
  const id = uuidv4();
  db.run(
    `INSERT INTO users (id, name, email, role, password_hash, status) VALUES (?,?,?,?,?,?)`,
    [id, 'Admin', email, 'admin', hash, 'active']
  );
  saveDB();
  if (!provided) {
    console.log('═'.repeat(60));
    console.log('  ADMIN CRÉÉ — notez ce mot de passe (affiché une seule fois) :');
    console.log(`    email    : ${email}`);
    console.log(`    password : ${password}`);
    console.log('═'.repeat(60));
  }
}

async function recoverStaleOnboardings() {
  const db = await getDB();
  const stale = dbRows(db, `SELECT id FROM onboardings WHERE status='running'`);
  if (!stale.length) return;
  stale.forEach(({ id }) => {
    db.run(`UPDATE onboardings SET status='failed', error_message='Interrompu (redémarrage serveur)' WHERE id=?`, [id]);
    db.run(
      `UPDATE onboarding_steps SET status='failed', error_message='Interrompu' WHERE onboarding_id=? AND status='running'`,
      [id]
    );
  });
  saveDB();
  console.log(`[startup] ${stale.length} onboarding(s) interrompu(s) marqué(s) comme échoués`);
}

async function loadSettingsFromDB() {
  const db = await getDB();
  const rows = dbRows(db, `SELECT key, value FROM settings WHERE key IN (${Object.keys(SETTINGS_MAP).map(() => '?').join(',')})`, Object.keys(SETTINGS_MAP));
  rows.forEach(({ key, value }) => {
    const envKey = SETTINGS_MAP[key];
    if (envKey && value) process.env[envKey] = value;
  });
}

getDB().then(async () => {
  await loadSettingsFromDB();
  await recoverStaleOnboardings();
  await ensureDefaultAdmin();
  app.listen(PORT, () => {
    console.log(`Onboarding M365 — backend sur http://localhost:${PORT}${MOCK_GRAPH ? ' [MOCK]' : ''}`);
  });
});
