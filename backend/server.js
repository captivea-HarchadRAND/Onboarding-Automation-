const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const { scrypt, randomBytes, timingSafeEqual, createHash } = require('crypto');
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
// En production, FRONTEND_URL doit être explicite — sinon le repli localhost serait une origine de confiance CORS
if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  throw new Error('FRONTEND_URL doit être défini explicitement en production (origine CORS de confiance).');
}
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174';
const SESSION_TTL_DAYS = 14;
const INVITE_TTL_DAYS = 7;
const MIN_PASSWORD_LEN = 12;
const LOG_FILE = path.join(__dirname, 'onboarding.log');
const DIST = path.join(__dirname, '../frontend/dist');

const ALLOWED_ORIGINS = [
  ...FRONTEND_URL.split(',').map(u => u.trim()),
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:8081']
    : []),
];

// Ne faire confiance au proxy QUE si explicitement activé : sinon X-Forwarded-For est
// forgeable par le client, ce qui contournerait le rate-limiter (clé = req.ip).
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'"],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
    },
  },
}));
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '512kb' }));
app.use(cookieParser());

if (fs.existsSync(DIST)) app.use(express.static(DIST));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function logAction(msg) {
  const ts = new Date().toISOString();
  // Neutraliser tous les caractères de contrôle (CRLF + séquences ANSI) pour empêcher
  // la falsification d'entrées de log (log injection)
  const clean = String(msg).replace(/[\x00-\x1f\x7f]+/g, ' ');
  const line = `[${ts}] ${clean}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
}

// Paramètre de coût scrypt durci (Node défaut = 2^14). Stocké dans le hash pour
// permettre la vérification rétro-compatible des anciens hash (format sans coût).
const SCRYPT_N = 2 ** 15;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

async function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const buf = await scryptAsync(pw, salt, 64, { N: SCRYPT_N, maxmem: SCRYPT_MAXMEM });
  return `${buf.toString('hex')}.${salt}.${SCRYPT_N}`;
}

async function verifyPassword(pw, stored) {
  if (typeof stored !== 'string' || !stored.includes('.')) return false;
  const parts = stored.split('.');
  const [hashed, salt] = parts;
  if (!hashed || !salt) return false;
  // Coût encodé dans le hash (3e segment) ; absent ou corrompu → ancien format au défaut Node (2^14)
  const parsedN = parseInt(parts[2], 10);
  const N = Number.isInteger(parsedN) && parsedN > 1 ? parsedN : 16384;
  const expected = Buffer.from(hashed, 'hex');
  const buf = await scryptAsync(pw, salt, 64, { N, maxmem: SCRYPT_MAXMEM });
  if (expected.length !== buf.length) return false;
  return timingSafeEqual(buf, expected);
}

// Normalisation d'email unique (création, édition, login, test de doublon)
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

// Hash factice pour égaliser le temps de réponse du login quand l'email n'existe pas
// (empêche l'énumération de comptes par mesure de timing)
let _dummyHash = null;
async function getDummyHash() {
  if (!_dummyHash) _dummyHash = await hashPassword(randomBytes(16).toString('hex'));
  return _dummyHash;
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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const db = await getDB();

  // ─── Accès de secours (break-glass) ───────────────────────────────────────
  // Identifiants définis UNIQUEMENT dans .env. Toujours valables, même si le mot de
  // passe admin en base est perdu. La session est rattachée à un compte admin réel.
  const recEmail = process.env.RECOVERY_ADMIN_EMAIL;
  const recPwd   = process.env.RECOVERY_ADMIN_PASSWORD;
  if (recEmail && recPwd && normalizeEmail(email) === normalizeEmail(recEmail)) {
    const sha = (s) => createHash('sha256').update(String(s)).digest();
    if (timingSafeEqual(sha(password), sha(recPwd))) {
      const adminUser = dbRow(db, `SELECT * FROM users WHERE email=? AND role='admin' AND status='active'`, [normalizeEmail(recEmail)])
                     || dbRow(db, `SELECT * FROM users WHERE role='admin' AND status='active' ORDER BY created_at LIMIT 1`);
      if (adminUser) {
        const token = uuidv4();
        const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString();
        db.run(`INSERT INTO sessions VALUES (?,?,?,?,?)`, [token, adminUser.id, adminUser.name, adminUser.role, expires]);
        saveDB();
        logAction(`Connexion de SECOURS (.env) utilisée — accès admin accordé`);
        res.cookie('session', token, sessionCookieOpts());
        return res.json({ user: { id: adminUser.id, name: adminUser.name, email: adminUser.email, role: adminUser.role } });
      }
    }
    // Email de secours mais mot de passe incorrect → on continue vers le flux normal (renverra 401)
  }

  const user = dbRow(db, `SELECT * FROM users WHERE email=? AND status='active'`, [normalizeEmail(email)]);
  if (!user || !user.password_hash) {
    await verifyPassword(password, await getDummyHash()); // temps de réponse constant (anti-énumération)
    return res.status(401).json({ error: 'Identifiants invalides' });
  }
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

app.post('/api/auth/verify-password', auth, authLimiter, async (req, res) => {
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
app.post('/api/auth/verify-launch-password', auth, authLimiter, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
  const launchPassword = process.env.LAUNCH_PASSWORD;
  if (!launchPassword) return res.status(500).json({ error: 'Code de confirmation IT non configuré' });
  // Comparaison sur empreintes SHA-256 de taille fixe : ni la longueur ni le contenu ne fuient via le timing
  const digest = (s) => createHash('sha256').update(String(s)).digest();
  if (!timingSafeEqual(digest(password), digest(launchPassword)))
    return res.status(401).json({ error: 'Code de confirmation incorrect' });
  res.json({ ok: true });
});

app.get('/api/auth/invite/:token', authLimiter, async (req, res) => {
  if (!isValidUUID(req.params.token)) return res.status(404).json({ error: 'Invitation invalide ou expirée' });
  const db = await getDB();
  const user = dbRow(db,
    `SELECT id, name, email FROM users WHERE invite_token=? AND (invite_expires IS NULL OR invite_expires > datetime('now'))`,
    [req.params.token]);
  if (!user) return res.status(404).json({ error: 'Invitation invalide ou expirée' });
  res.json({ user });
});

app.post('/api/auth/invite/:token', authLimiter, async (req, res) => {
  if (!isValidUUID(req.params.token)) return res.status(404).json({ error: 'Invitation invalide ou expirée' });
  const { password } = req.body;
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const db = await getDB();
  const user = dbRow(db,
    `SELECT id, name, email, role FROM users WHERE invite_token=? AND (invite_expires IS NULL OR invite_expires > datetime('now'))`,
    [req.params.token]);
  if (!user) {
    logAction(`Tentative d'acceptation d'invitation avec token invalide/expiré`);
    return res.status(404).json({ error: 'Invitation invalide ou expirée' });
  }
  const hash = await hashPassword(password);
  // Consommation ATOMIQUE du token : la condition `invite_token=?` garantit l'usage unique même si
  // deux requêtes concurrentes passent le SELECT ci-dessus (la 2e modifiera 0 ligne → rejetée).
  db.run(`UPDATE users SET password_hash=?, invite_token=NULL, invite_expires=NULL, status='active' WHERE id=? AND invite_token=?`, [hash, user.id, req.params.token]);
  if (db.getRowsModified() === 0) {
    logAction(`Invitation déjà consommée — requête concurrente rejetée`);
    return res.status(409).json({ error: 'Invitation déjà utilisée' });
  }
  saveDB();
  logAction(`Invitation acceptée par ${user.email} (activation de compte)`);
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
    console.error('[Graph] listGroups:', err.message);
    res.status(500).json({ error: 'Erreur lors de la récupération des groupes' });
  }
});

app.get('/api/graph/groups/:id', auth, async (req, res) => {
  try {
    const group = await getGroupById(req.params.id);
    res.json(group);
  } catch (err) {
    console.error('[Graph] getGroupById:', err.message);
    res.status(err.graphStatus === 404 ? 404 : 500).json({ error: err.graphStatus === 404 ? 'Groupe introuvable' : 'Erreur lors de la récupération du groupe' });
  }
});

app.get('/api/graph/licenses', auth, async (req, res) => {
  try {
    const licenses = await listAvailableLicenses();
    res.json(licenses);
  } catch (err) {
    console.error('[Graph] listLicenses:', err.message);
    res.status(500).json({ error: 'Erreur lors de la récupération des licences' });
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
    ]
      // Exclure le groupe principal (déjà ajouté à l'étape 2) et dédupliquer par id
      .filter(g => g.id && g.id !== onb.group_id)
      .filter((g, i, arr) => arr.findIndex(x => x.id === g.id) === i);
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
    // Message générique stocké/affiché — le détail Graph (peut contenir des IDs internes) reste dans les logs serveur
    const safeMsg = "Échec de l'opération Microsoft 365 — voir les logs serveur pour le détail technique.";

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
      [safeMsg, id]
    );
    db.run(
      `UPDATE onboardings SET status='failed', error_message=? WHERE id=?`,
      [safeMsg, id]
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
  // Défense en profondeur : la colonne DB temp_password doit toujours être NULL (cf. db.js).
  // On la retire explicitement pour ne pas dépendre de l'ordre du spread ci-dessous.
  delete onb.temp_password;
  // Mot de passe retourné une seule fois — UNIQUEMENT au créateur de l'onboarding
  // (empêche un autre opérateur de capter le mot de passe M365 via l'ID exposé dans la liste)
  let temp_password = null;
  if (onb.created_by === req.user.id) {
    temp_password = tempPasswordStore.get(req.params.id) || null;
    if (temp_password) tempPasswordStore.delete(req.params.id);
  }
  res.json({ ...onb, temp_password, steps });
});

app.post('/api/onboardings', auth, async (req, res) => {
  const { firstName, lastName, email, jobRole, location, groupId, groupName, skuId, licenseName } = req.body;
  if (!firstName?.trim() || !lastName?.trim())
    return res.status(400).json({ error: 'Prénom et nom requis' });
  // Limites de longueur (anti-DoS mémoire sql.js + cohérence Graph)
  const tooLong = (s, n) => typeof s === 'string' && s.length > n;
  if (tooLong(firstName, 64) || tooLong(lastName, 64) || tooLong(jobRole, 64) || tooLong(location, 64))
    return res.status(400).json({ error: 'Champ trop long (max 64 caractères)' });
  if (tooLong(groupName, 256) || tooLong(licenseName, 256))
    return res.status(400).json({ error: 'Nom de groupe/licence trop long' });
  if (!groupId || !groupName)
    return res.status(400).json({ error: 'Groupe requis' });
  if (!skuId || !licenseName)
    return res.status(400).json({ error: 'Licence requise' });
  // En production, groupId/skuId sont des GUID Azure ; en mode mock les IDs sont préfixés "mock-"
  const idOk = (v) => isValidUUID(v) || (MOCK_GRAPH && /^mock-[\w-]+$/.test(v));
  if (!idOk(groupId))
    return res.status(400).json({ error: 'Identifiant de groupe invalide' });
  if (!idOk(skuId))
    return res.status(400).json({ error: 'Identifiant de licence invalide' });

  const domain = process.env.DEFAULT_DOMAIN || 'monentreprise.com';
  const slug = `${firstName}.${lastName}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.]/g, '');
  if (!slug || slug === '.')
    return res.status(400).json({ error: 'Prénom/nom invalides (au moins un caractère alphanumérique requis)' });
  const employeeEmail = normalizeEmail(email) || `${slug}@${domain}`;
  if (!isValidEmail(employeeEmail))
    return res.status(400).json({ error: 'Adresse email invalide' });
  // Restreindre au(x) domaine(s) d'onboarding actif(s) si configuré(s)
  const parsedDomains = JSON.parse(dbRow(await getDB(), `SELECT value FROM settings WHERE key='onboarding_domains'`)?.value || process.env.ONBOARDING_DOMAINS || '[]');
  const activeDomains = (Array.isArray(parsedDomains) ? parsedDomains : [])
    .filter(d => d && d.active && d.domain).map(d => d.domain.toLowerCase());
  if (activeDomains.length > 0 && !activeDomains.includes(employeeEmail.split('@')[1])) {
    return res.status(400).json({ error: 'Domaine email non autorisé' });
  }

  // Anti-escalade de privilèges : vérifier côté serveur que la licence est réellement disponible
  // et que le groupe ciblé est bien un groupe de sécurité (empêche un operator de forger un groupId
  // arbitraire — ex. un groupe à privilèges). Ignoré en mode mock (données fictives).
  if (!MOCK_GRAPH) {
    try {
      const licenses = await listAvailableLicenses();
      if (!licenses.some(l => l.skuId === skuId))
        return res.status(400).json({ error: 'Licence non disponible ou non autorisée' });
      // Groupes déjà configurés par un admin (réglages) = approuvés → pas de rejet possible (anti-régression).
      const cfgDb = await getDB();
      const configuredIds = new Set();
      for (const k of ['pointage_assignments', 'sharepoint_global_groups', 'sharepoint_country_groups']) {
        const raw = dbRow(cfgDb, `SELECT value FROM settings WHERE key=?`, [k])?.value;
        if (raw) { try { JSON.parse(raw).forEach(g => g && g.id && configuredIds.add(g.id)); } catch (_) {} }
      }
      // Sinon (groupe auto-matché via recherche) : exiger un groupe de sécurité ET le respect de la
      // convention de provisioning « SP … » (celle de l'auto-match). Bloque l'ajout à un groupe de
      // sécurité à privilèges (ex. "Domain Admins") via une requête forgée hors UI.
      if (!configuredIds.has(groupId)) {
        const grp = await getGroupById(groupId);
        const okSecurity   = grp && grp.securityEnabled === true && grp.mailEnabled === false;
        const okConvention = grp && /^(2024_)?\s*SP\b/i.test(grp.displayName || '');
        if (!okSecurity || !okConvention)
          return res.status(400).json({ error: 'Groupe non autorisé (groupe de provisioning « SP - … » requis)' });
      }
    } catch (e) {
      if (e.graphStatus === 404) return res.status(400).json({ error: "Groupe introuvable dans l'organisation" });
      console.error('[onboarding] validation Graph:', e.message);
      return res.status(502).json({ error: 'Validation impossible (Microsoft Graph indisponible)' });
    }
  }

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
    force_change_password:         dbMap.force_change_password         || process.env.FORCE_CHANGE_PASSWORD || 'true',
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

// Validation par clé : listes blanches pour les scalaires, bornes pour les tableaux
const GROUP_ARRAY_KEYS = new Set([
  'sharepoint_global_groups', 'sharepoint_country_groups', 'communication_groups',
  'pointage_assignments', 'pointage_comm_assignments', 'department_assignments',
]);
const SCALAR_RULES = {
  force_change_password: v => v === 'true' || v === 'false',
  usage_location:        v => /^[A-Za-z]{2}$/.test(v),
  default_domain:        v => v.length <= 253 && /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v),
  azure_tenant_id:       v => v === '' || isValidUUID(v),
  azure_client_id:       v => v === '' || isValidUUID(v),
};
function validateSettingValue(key, v) {
  if (Array.isArray(v)) {
    if (v.length > 500) return 'trop d\'éléments (max 500)';
    if (GROUP_ARRAY_KEYS.has(key)) {
      for (const g of v) {
        if (g && g.id && !(isValidUUID(g.id) || (MOCK_GRAPH && /^mock-[\w-]+$/.test(g.id))))
          return `identifiant de groupe invalide : ${String(g.id).slice(0, 40)}`;
        for (const f of ['name', 'label', 'location']) {
          if (g && typeof g[f] === 'string' && g[f].length > 256) return `champ "${f}" trop long`;
        }
      }
    }
    if (JSON.stringify(v).length > 256 * 1024) return 'payload trop volumineux';
    return null;
  }
  if (typeof v === 'string' && v.length > 4096) return 'valeur trop longue';
  const rule = SCALAR_RULES[key];
  if (rule && v !== '' && !rule(typeof v === 'string' ? v.trim() : String(v))) return 'valeur non autorisée';
  return null;
}

app.put('/api/admin/settings', auth, requireRole('admin'), async (req, res) => {
  const db = await getDB();
  // Valider AVANT toute écriture (rejet atomique)
  for (const [k, v] of Object.entries(req.body)) {
    if (!Object.keys(SETTINGS_MAP).includes(k)) continue;
    const err = validateSettingValue(k, v);
    if (err) return res.status(400).json({ error: `Paramètre "${k}" : ${err}` });
  }
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
  if (!isValidEmail(normalizeEmail(email)))
    return res.status(400).json({ error: 'Adresse email invalide' });
  const existing = dbRow(db, `SELECT id FROM users WHERE email=?`, [normalizeEmail(email)]);
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
    [id, name, normalizeEmail(email), wantRole, hash, inviteToken, inviteExpires, hash ? 'active' : 'pending']
  );
  saveDB();

  const user = dbRow(db, `SELECT id, name, email, role, status FROM users WHERE id=?`, [id]);
  res.status(201).json({ user, invite_token: inviteToken });
});

app.put('/api/admin/users/:id', auth, requireRole('admin'), async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
  const { name, email, role, status } = req.body;
  if (email != null && !isValidEmail(normalizeEmail(email)))
    return res.status(400).json({ error: 'Adresse email invalide' });
  const db = await getDB();
  const current = dbRow(db, `SELECT status, role FROM users WHERE id=?`, [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Utilisateur introuvable' });

  if (status != null && !['active', 'pending', 'disabled'].includes(status))
    return res.status(400).json({ error: 'Statut invalide' });

  if (role != null && role !== current.role && !canAssignRole(req.user.role, role))
    return res.status(403).json({ error: 'Rôle non autorisé' });

  // Tout statut ≠ 'active' (disabled ET pending) prive d'accès → compte comme rétrogradation
  const demoting = current.role === 'admin' && ((role != null && role !== 'admin') || (status != null && status !== 'active'));
  if (demoting && countActiveAdmins(db, req.params.id) === 0)
    return res.status(400).json({ error: 'Impossible : dernier administrateur actif' });

  if (email) {
    const dup = dbRow(db, `SELECT id FROM users WHERE email=? AND id!=?`, [normalizeEmail(email), req.params.id]);
    if (dup) return res.status(400).json({ error: 'Email déjà utilisé' });
  }

  db.run(
    `UPDATE users SET name=COALESCE(?,name), email=COALESCE(?,email), role=COALESCE(?,role), status=COALESCE(?,status) WHERE id=?`,
    [name ?? null, email ? normalizeEmail(email) : null, role ?? null, status ?? null, req.params.id]
  );
  // Invalider les sessions actives si rôle ou statut modifié
  if (role != null || status != null)
    db.run(`DELETE FROM sessions WHERE user_id=?`, [req.params.id]);
  saveDB();
  res.json(dbRow(db, `SELECT id, name, email, role, status FROM users WHERE id=?`, [req.params.id]));
});

app.delete('/api/admin/users/:id', auth, requireRole('admin'), async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
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
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
  const { password } = req.body;
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const db = await getDB();
  const target = dbRow(db, `SELECT id, email FROM users WHERE id=?`, [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const hash = await hashPassword(password);
  db.run(`UPDATE users SET password_hash=? WHERE id=?`, [hash, req.params.id]);
  db.run(`DELETE FROM sessions WHERE user_id=?`, [req.params.id]);
  saveDB();
  logAction(`Mot de passe réinitialisé pour ${target.email} par ${req.user.email}`);
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
