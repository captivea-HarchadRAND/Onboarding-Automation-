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
const nodemailer = require('nodemailer');

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

// ─── 2FA OTP store ────────────────────────────────────────────────────────────
// { email → { code, expires, attempts } }  — jamais persisté en DB
const otpStore = new Map();
const OTP_TTL_MS   = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_TRIES = 5;

function generate2FACode() {
  // 6 chiffres via CSPRNG (pas Math.random)
  const buf = randomBytes(4);
  return String(buf.readUInt32BE(0) % 1000000).padStart(6, '0');
}

// 2FA activée si SMTP_USER est défini
function get2FASender() {
  return process.env.SMTP_FROM || process.env.SMTP_USER || null;
}

let _smtpTransport = null;
function getSmtpTransport() {
  if (!_smtpTransport) {
    _smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.office365.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: false,
      pool: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return _smtpTransport;
}

async function send2FACode(toEmail, code) {
  const sender = get2FASender();
  if (!sender) return;
  await getSmtpTransport().sendMail({
    from: sender,
    to: toEmail,
    subject: 'Code de vérification — Onboarding M365',
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:48px 16px">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.07)">
      <tr><td style="background:linear-gradient(135deg,#4f46e5 0%,#6366f1 100%);padding:36px 40px 28px;text-align:center">
        <div style="display:inline-block;background:rgba(255,255,255,.15);border-radius:12px;padding:10px 18px;margin-bottom:16px">
          <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-.5px">Captivea</span>
        </div>
        <p style="margin:0;color:rgba(255,255,255,.85);font-size:13px;letter-spacing:.5px;text-transform:uppercase">Onboarding M365</p>
      </td></tr>
      <tr><td style="padding:40px 40px 32px">
        <p style="margin:0 0 24px;color:#1e293b;font-size:18px;font-weight:600">Vérification en deux étapes</p>
        <p style="margin:0 0 20px;color:#64748b;font-size:14px;line-height:1.6">Entrez le code ci-dessous pour finaliser votre connexion.</p>
        <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:28px 20px;text-align:center;margin:0 0 24px">
          <table cellpadding="0" cellspacing="0" style="margin:0 auto">
            <tr>
              ${code.split('').map(d => `<td style="padding:0 5px"><div style="width:42px;height:52px;background:#ffffff;border:1.5px solid #c7d2fe;border-radius:8px;text-align:center;line-height:52px;font-size:28px;font-weight:700;color:#4f46e5;font-family:'Courier New',monospace">${d}</div></td>`).join('')}
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Valable <strong style="color:#64748b">10 minutes</strong></p>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.7;border-top:1px solid #f1f5f9;padding-top:20px">Si vous n'avez pas demandé ce code, ignorez cet email et ne le partagez avec personne.</p>
      </td></tr>
      <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 40px;text-align:center">
        <p style="margin:0;color:#cbd5e1;font-size:11px">Captivea · Message automatique — ne pas répondre</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`,
  });
}
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

// Hash scrypt mis en cache du mot de passe de récupération (calculé une seule fois au premier login)
let _recoveryHash = null;
async function getRecoveryHash() {
  const recPwd = process.env.RECOVERY_ADMIN_PASSWORD;
  if (!recPwd) return null;
  if (!_recoveryHash) _recoveryHash = await hashPassword(recPwd);
  return _recoveryHash;
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

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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
  if (recEmail && normalizeEmail(email) === normalizeEmail(recEmail)) {
    const recHash = await getRecoveryHash();
    if (recHash && await verifyPassword(password, recHash)) {
      const adminUser = dbRow(db, `SELECT * FROM users WHERE email=? AND role='admin' AND status='active'`, [normalizeEmail(recEmail)])
                     || dbRow(db, `SELECT * FROM users WHERE role='admin' AND status='active' ORDER BY created_at LIMIT 1`);
      if (adminUser) {
        logAction(`Connexion de SECOURS (.env) utilisée — accès admin accordé`);
        // Le chemin de secours passe aussi par la 2FA si elle est configurée
        if (get2FASender()) {
          const code = generate2FACode();
          otpStore.set(normalizeEmail(recEmail), { code, expires: Date.now() + OTP_TTL_MS, attempts: 0, userId: adminUser.id });
          try {
            await send2FACode(adminUser.email, code);
          } catch (e) {
            logAction(`[2FA] Échec SMTP (secours) : ${e.message}`);
            return res.status(500).json({ error: `Échec SMTP : ${e.message}` });
          }
          return res.json({ requires2fa: true });
        }
        const token = uuidv4();
        const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString();
        db.run(`INSERT INTO sessions VALUES (?,?,?,?,?)`, [token, adminUser.id, adminUser.name, adminUser.role, expires]);
        saveDB();
        res.cookie('session', token, sessionCookieOpts());
        return res.json({ user: { id: adminUser.id, name: adminUser.name, email: adminUser.email, role: adminUser.role } });
      }
    }
    // Email de secours mais mot de passe incorrect → on continue vers le flux normal (renverra 401)
  }

  const user = dbRow(db, `SELECT * FROM users WHERE email=? AND status='active'`, [normalizeEmail(email)]);
  if (!user || !user.password_hash) {
    await verifyPassword(password, await getDummyHash()); // temps de réponse constant (anti-énumération)
    logAction(`[AUTH] Échec connexion — compte inconnu`);
    return res.status(401).json({ error: 'Identifiants invalides' });
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    logAction(`[AUTH] Échec connexion — mot de passe incorrect : ${user.email}`);
    return res.status(401).json({ error: 'Identifiants invalides' });
  }

  // ─── 2FA ─────────────────────────────────────────────────────────────────
  if (get2FASender()) {
    const code = generate2FACode();
    otpStore.set(normalizeEmail(email), { code, expires: Date.now() + OTP_TTL_MS, attempts: 0, userId: user.id });
    try {
      await send2FACode(user.email, code);
    } catch (e) {
      logAction(`[2FA] Échec SMTP : ${e.message}`);
      return res.status(500).json({ error: `Échec SMTP : ${e.message}` });
    }
    logAction(`[AUTH] Code 2FA envoyé à ${user.email}`);
    return res.json({ requires2fa: true });
  }

  const token = uuidv4();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString();
  db.run(`INSERT INTO sessions VALUES (?,?,?,?,?)`, [token, user.id, user.name, user.role, expires]);
  saveDB();

  res.cookie('session', token, sessionCookieOpts());
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post('/api/auth/verify-2fa', authLimiter, async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email et code requis' });
  const key = normalizeEmail(email);
  const entry = otpStore.get(key);
  if (!entry) return res.status(401).json({ error: 'Code expiré ou invalide' });
  if (Date.now() > entry.expires) { otpStore.delete(key); return res.status(401).json({ error: 'Code expiré' }); }
  entry.attempts += 1;
  if (entry.attempts > OTP_MAX_TRIES) { otpStore.delete(key); return res.status(401).json({ error: 'Trop de tentatives — recommencez la connexion' }); }
  if (String(code).trim() !== entry.code) return res.status(401).json({ error: 'Code incorrect' });
  otpStore.delete(key);

  const db = await getDB();
  const user = dbRow(db, `SELECT * FROM users WHERE id=? AND status='active'`, [entry.userId]);
  if (!user) return res.status(401).json({ error: 'Compte introuvable' });

  const token = uuidv4();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString();
  db.run(`INSERT INTO sessions VALUES (?,?,?,?,?)`, [token, user.id, user.name, user.role, expires]);
  saveDB();
  logAction(`[AUTH] Connexion 2FA réussie — ${user.email}`);
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

  // Lire le schéma configuré (no-code pipeline)
  const schemaRow = dbRow(db, `SELECT value FROM settings WHERE key='onboarding_schema'`);
  const schema = (() => { try { return schemaRow ? JSON.parse(schemaRow.value) : {}; } catch (_) { return {}; } })();
  const step2Enabled  = schema.step2_group?.enabled     !== false;
  const step3Enabled  = schema.step3_license?.enabled   !== false;
  const step4Enabled  = schema.step4_sp_groups?.enabled !== false;
  const retryDelays   = (Array.isArray(schema.step3_license?.retry_delays) && schema.step3_license.retry_delays.length)
    ? schema.step3_license.retry_delays
    : [15, 30, 45, 60, 90];

  db.run(`UPDATE onboardings SET status='running' WHERE id=?`, [id]);
  saveDB();

  let adUserId = null;

  try {
    // Étape 1 — Création du compte Azure AD (toujours exécutée)
    updateStep(db, id, 1, 'running');
    logAction(`[${id}] [1/4] Création du compte pour ${onb.employee_email}...`);

    const dbForce = dbRow(db, `SELECT value FROM settings WHERE key='force_change_password'`);
    const forceChangePassword = dbForce ? dbForce.value !== 'false' : process.env.FORCE_CHANGE_PASSWORD !== 'false';

    const adUser = await createUser({
      firstName: onb.employee_firstname,
      lastName:  onb.employee_lastname,
      email:     onb.employee_email,
      location:  onb.location,
      forceChangePassword,
    });
    adUserId = adUser.id;

    if (adUser.temporaryPassword) {
      tempPasswordStore.set(id, adUser.temporaryPassword);
      setTimeout(() => tempPasswordStore.delete(id), 10 * 60 * 1000);
    }
    db.run(`UPDATE onboardings SET employee_ad_id=? WHERE id=?`, [adUserId, id]);
    saveDB();
    updateStep(db, id, 1, 'done');
    logAction(`[${id}] [1/4] ✅ Compte créé : ${adUser.userPrincipalName}`);

    // Étape 2 — Ajout au groupe
    if (step2Enabled) {
      updateStep(db, id, 2, 'running');
      logAction(`[${id}] [2/4] Ajout au groupe "${onb.group_name}"...`);
      await addMemberToGroup(onb.group_id, adUserId);
      updateStep(db, id, 2, 'done');
      logAction(`[${id}] [2/4] ✅ Ajouté au groupe "${onb.group_name}"`);
    } else {
      updateStep(db, id, 2, 'skipped');
      logAction(`[${id}] [2/4] ⏭️ Groupe principal — étape désactivée dans le schéma`);
    }

    // Étape 3 — Assignation de la licence
    // Exchange peut prendre 1-5 min à provisionner après la création du compte AD.
    if (step3Enabled) {
      updateStep(db, id, 3, 'running');
      logAction(`[${id}] [3/4] Assignation de la licence "${onb.license_name}"...`);
      for (let attempt = 0; ; attempt++) {
        try {
          await assignLicense(adUserId, onb.sku_id);
          break;
        } catch (e) {
          const isExchangeNotReady =
            (e.code === 'InternalServerError' || e.graphStatus === 500) &&
            (/Exchange/i.test(e.message || '')         ||
             /recipient/i.test(e.message || '')        ||
             /recipient/i.test(e.innerMessage || '')   ||
             /Active Directory/i.test(e.innerMessage || '') ||
             /not.*found/i.test(e.innerMessage || '')  ||
             /Exchange/i.test(e.innerType || '')       ||
             /Cmdlet/i.test(e.innerType || ''));
          if (isExchangeNotReady && attempt < retryDelays.length) {
            const wait = retryDelays[attempt];
            logAction(`[${id}] [3/4] ⏳ Exchange pas encore prêt — retry ${attempt + 1}/${retryDelays.length} dans ${wait}s...`);
            await sleep(wait * 1000);
          } else {
            throw e;
          }
        }
      }
      updateStep(db, id, 3, 'done');
      logAction(`[${id}] [3/4] ✅ Licence "${onb.license_name}" assignée`);
    } else {
      updateStep(db, id, 3, 'skipped');
      logAction(`[${id}] [3/4] ⏭️ Licence — étape désactivée dans le schéma`);
    }

    // Étape 4 — Groupes SharePoint
    if (step4Enabled) {
      updateStep(db, id, 4, 'running');
      const globalGroups    = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='sharepoint_global_groups'`)?.value  || '[]');
      const countryGroups   = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='sharepoint_country_groups'`)?.value || '[]');
      const pointageGroups  = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='pointage_assignments'`)?.value      || '[]');
      const deptAssignments      = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='department_assignments'`)?.value       || '[]');
      const pointageCommAssign   = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='pointage_comm_assignments'`)?.value    || '[]');
      const location             = onb.location || '';
      const jobRole              = onb.job_role || '';
      const city                 = onb.city || '';
      const cityGroups = countryGroups
        .filter(g => g.location === location)
        .flatMap(g => g.cities || [])
        .filter(c => c.id && c.name === city)
        .map(c => ({ id: c.id, label: c.name }));
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
        ...cityGroups,
        ...pointageGroups.filter(g => g.id && g.location === location),
        ...commGroups,
      ]
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
    } else {
      updateStep(db, id, 4, 'skipped');
      logAction(`[${id}] [4/4] ⏭️ Groupes SP/Comm — étape désactivée dans le schéma`);
    }

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
  let sql = `SELECT * FROM onboardings WHERE is_mock=?`;
  const params = [MOCK_GRAPH ? 1 : 0];
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
  const { firstName, lastName, email, jobRole, location, city, groupId, groupName, skuId, licenseName } = req.body;
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

  // Ville : si le pays sélectionné a des villes configurées, une ville valide est requise
  const countryGroupsCfg = JSON.parse(dbRow(await getDB(), `SELECT value FROM settings WHERE key='sharepoint_country_groups'`)?.value || process.env.SP_COUNTRY_GROUPS || '[]');
  const citiesForLocation = (Array.isArray(countryGroupsCfg) ? countryGroupsCfg : [])
    .filter(g => g.location === (location || '').trim())
    .flatMap(g => g.cities || [])
    .filter(c => c && c.name && c.id);
  const cityTrim = (city || '').trim();
  if (citiesForLocation.length > 0) {
    if (!cityTrim) return res.status(400).json({ error: 'Ville requise pour cette localisation' });
    if (!citiesForLocation.some(c => c.name === cityTrim)) return res.status(400).json({ error: 'Ville non autorisée' });
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
       job_role, location, city,
       group_id, group_name, sku_id, license_name,
       status, created_by, created_by_name, is_mock)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, firstName.trim(), lastName.trim(), employeeEmail,
     jobRole?.trim() || null, location?.trim() || null, cityTrim || null,
     groupId, groupName, skuId, licenseName,
     'pending', req.user.id, req.user.name, MOCK_GRAPH ? 1 : 0]
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

  const isMock = MOCK_GRAPH ? 1 : 0;
  const total = dbRow(db, `SELECT COUNT(*) as c FROM onboardings WHERE is_mock=?`, [isMock])?.c ?? 0;
  const thisMonth = dbRow(db,
    `SELECT COUNT(*) as c FROM onboardings WHERE is_mock=? AND strftime('%Y-%m', created_at)=?`, [isMock, month])?.c ?? 0;
  const done = dbRow(db,
    `SELECT COUNT(*) as c FROM onboardings WHERE is_mock=? AND status='done' AND strftime('%Y-%m', created_at)=?`, [isMock, month])?.c ?? 0;
  const failed = dbRow(db,
    `SELECT COUNT(*) as c FROM onboardings WHERE is_mock=? AND status='failed' AND strftime('%Y-%m', created_at)=?`, [isMock, month])?.c ?? 0;
  const running = dbRow(db, `SELECT COUNT(*) as c FROM onboardings WHERE is_mock=? AND status='running'`, [isMock])?.c ?? 0;

  const recent = dbRows(db,
    `SELECT id, employee_firstname, employee_lastname, employee_email,
            job_role, location, status, created_at, created_by_name
     FROM onboardings WHERE is_mock=? ORDER BY created_at DESC LIMIT 5`, [isMock]);

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

  if (req.body.azure_tenant_id || req.body.azure_client_id) {
    const { resetCredential } = require('./lib/graph');
    resetCredential();
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

// ─── Security events ─────────────────────────────────────────────────────────

const SECURITY_PATTERNS = [
  { re: /\[AUTH\] Échec connexion/,                   type: 'danger',  label: 'Échec connexion' },
  { re: /Connexion de SECOURS/,                       type: 'warning', label: 'Accès de secours' },
  { re: /Invitation acceptée/,                        type: 'success', label: 'Invitation acceptée' },
  { re: /Invitation déjà consommée/,                  type: 'danger',  label: 'Replay invitation' },
  { re: /Tentative d'acceptation d'invitation avec token invalide/, type: 'danger', label: 'Token invalide' },
  { re: /Mot de passe réinitialisé/,                  type: 'info',    label: 'Reset mot de passe' },
];

app.get('/api/admin/security-events', auth, requireRole('admin'), (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) return res.json([]);
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    const events = [];
    for (const line of lines) {
      const match = line.match(/^\[(.+?)\] (.+)$/);
      if (!match) continue;
      const [, ts, msg] = match;
      const pattern = SECURITY_PATTERNS.find(p => p.re.test(msg));
      if (!pattern) continue;
      events.push({ ts, msg, type: pattern.type, label: pattern.label });
    }
    res.json(events.slice(-50).reverse());
  } catch (_) {
    res.json([]);
  }
});

app.get('/api/admin/security-events/archive', auth, requireRole('admin'), (req, res) => {
  try {
    const content = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '';
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="security-${date}.log"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    logAction(`Journal archivé par ${req.user.email}`);
    res.send(content);
  } catch (_) {
    res.status(500).json({ error: 'Impossible de lire le journal' });
  }
});

app.delete('/api/admin/security-events', auth, requireRole('admin'), (req, res) => {
  try {
    fs.writeFileSync(LOG_FILE, '');
    logAction(`Journal de sécurité effacé par ${req.user.email}`);
    res.json({ ok: true });
  } catch (_) {
    res.status(500).json({ error: "Impossible d'effacer le journal" });
  }
});

app.delete('/api/admin/security-events/selection', auth, requireRole('admin'), (req, res) => {
  const { timestamps } = req.body || {};
  if (!Array.isArray(timestamps) || timestamps.length === 0)
    return res.status(400).json({ error: 'Aucune sélection' });
  try {
    if (!fs.existsSync(LOG_FILE)) return res.json({ ok: true, removed: 0 });
    const tsSet = new Set(timestamps);
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    const kept  = lines.filter(line => {
      const m = line.match(/^\[(.+?)\]/);
      return !m || !tsSet.has(m[1]);
    });
    fs.writeFileSync(LOG_FILE, kept.join('\n'));
    logAction(`${timestamps.length} entrée(s) supprimée(s) du journal par ${req.user.email}`);
    res.json({ ok: true, removed: timestamps.length });
  } catch (_) {
    res.status(500).json({ error: "Impossible de modifier le journal" });
  }
});

// ─── Offboarding ──────────────────────────────────────────────────────────────

const offboardingJobs = new Map();

async function getOffboardToken() {
  const tid = process.env.AZURE_TENANT_ID;
  const cid = process.env.AZURE_CLIENT_ID;
  const sec = process.env.AZURE_CLIENT_SECRET;
  if (!tid || !cid || !sec) throw new Error('Configuration Azure AD incomplète');
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tid)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: cid, client_secret: sec,
        scope: 'https://graph.microsoft.com/.default',
      }).toString(),
    }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error(data?.error_description || 'Token Graph indisponible');
  return data.access_token;
}

async function graphOp(token, method, path, body = null, extraHeaders = {}) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204 || res.status === 202) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errObj = json?.error || {};
    const inner  = errObj.innererror || {};
    const innerEx = inner.internalexception || {};
    const msg = errObj.message || errObj.code || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.graphStatus  = res.status;
    err.code         = errObj.code || '';
    err.innerMessage = innerEx.message || inner.message || '';
    err.innerType    = innerEx.type    || inner.type    || '';
    throw err;
  }
  return json;
}

function offboardStep(job, name, status, detail = '') {
  const step = job.steps.find(st => st.name === name);
  if (step) { step.status = status; if (detail) step.detail = detail; }
}

async function executeOffboarding(jobId) {
  const job = offboardingJobs.get(jobId);
  if (!job) return;

  const MOCK_DELAY = parseInt(process.env.MOCK_DELAY_MS || '1200', 10);

  const baseSteps = [
    'Récupération des informations',
    'Blocage du compte',
    'Révocation des sessions',
    'Suppression des groupes',
    'Révocation de la licence',
    "Configuration du transfert d'emails",
    'Conversion en boîte partagée',
    'Accès à la boîte partagée',
  ];
  job.steps = baseSteps.map(name => ({ name, status: 'pending', detail: '' }));

  try {
    let token = null;
    if (!MOCK_GRAPH) token = await getOffboardToken();

    // 1 ── Récupération des informations
    offboardStep(job, 'Récupération des informations', 'running');
    let userId, displayName;

    if (MOCK_GRAPH) {
      await sleep(MOCK_DELAY * 0.7);
      userId = `mock-ob-${Date.now()}`;
      const parts = job.targetEmail.split('@')[0].split('.');
      displayName = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    } else {
      const user = await graphOp(token, 'GET', `/users/${encodeURIComponent(job.targetEmail)}?$select=id,displayName`);
      userId = user.id; displayName = user.displayName;
    }
    job.displayName = displayName;
    offboardStep(job, 'Récupération des informations', 'done', displayName);
    logAction(`[OFFBOARD][${jobId}] Utilisateur : ${displayName} <${job.targetEmail}>`);

    // 2 ── Blocage du compte
    offboardStep(job, 'Blocage du compte', 'running');
    if (MOCK_GRAPH) await sleep(MOCK_DELAY * 0.5);
    else await graphOp(token, 'PATCH', `/users/${userId}`, { accountEnabled: false });
    offboardStep(job, 'Blocage du compte', 'done', 'Connexion Azure AD désactivée');
    logAction(`[OFFBOARD][${jobId}] Compte bloqué`);

    // 3 ── Révocation des sessions
    offboardStep(job, 'Révocation des sessions', 'running');
    if (MOCK_GRAPH) await sleep(MOCK_DELAY * 0.4);
    else await graphOp(token, 'POST', `/users/${userId}/revokeSignInSessions`);
    offboardStep(job, 'Révocation des sessions', 'done', 'Toutes les sessions actives fermées');
    logAction(`[OFFBOARD][${jobId}] Sessions révoquées`);

    // 4 ── Suppression des groupes
    offboardStep(job, 'Suppression des groupes', 'running');
    let removed = 0;
    const removedGroupNames = [];
    if (MOCK_GRAPH) {
      await sleep(MOCK_DELAY);
      const mockNames = ['Équipe Marketing', 'SharePoint - Intranet', 'Teams - Direction', 'Licence M365 E3', 'VPN Users'];
      removed = mockNames.length;
      removedGroupNames.push(...mockNames);
    } else {
      const memberOf = await graphOp(token, 'GET', `/users/${userId}/memberOf?$select=id,displayName`);
      const groups = (memberOf?.value || []).filter(g => g['@odata.type'] === '#microsoft.graph.group');
      for (const grp of groups) {
        try {
          await graphOp(token, 'DELETE', `/groups/${grp.id}/members/${userId}/$ref`);
          removed++;
          removedGroupNames.push(grp.displayName || grp.id);
          offboardStep(job, 'Suppression des groupes', 'running', `${removed} groupe(s) retiré(s)…`);
        } catch (_) { /* groupes dynamiques ou système : ignorés */ }
      }
    }
    job.removedGroups = removedGroupNames;
    offboardStep(job, 'Suppression des groupes', 'done', `${removed} groupe(s) retiré(s)`);
    logAction(`[OFFBOARD][${jobId}] Retiré de ${removed} groupes : ${removedGroupNames.join(', ')}`);

    // 5 ── Révocation de la licence
    offboardStep(job, 'Révocation de la licence', 'running');
    if (MOCK_GRAPH) {
      await sleep(MOCK_DELAY * 0.5);
      offboardStep(job, 'Révocation de la licence', 'done', '1 licence révoquée');
    } else {
      try {
        const userWithLic = await graphOp(token, 'GET', `/users/${userId}?$select=assignedLicenses`);
        const skuIds = (userWithLic?.assignedLicenses || []).map(l => l.skuId).filter(Boolean);
        if (skuIds.length > 0) {
          await graphOp(token, 'POST', `/users/${userId}/assignLicense`, { addLicenses: [], removeLicenses: skuIds });
          offboardStep(job, 'Révocation de la licence', 'done', `${skuIds.length} licence(s) révoquée(s)`);
          logAction(`[OFFBOARD][${jobId}] ${skuIds.length} licence(s) révoquée(s)`);
        } else {
          offboardStep(job, 'Révocation de la licence', 'skipped', 'Aucune licence assignée directement');
          logAction(`[OFFBOARD][${jobId}] Aucune licence directe à révoquer`);
        }
      } catch (e) {
        offboardStep(job, 'Révocation de la licence', 'skipped', `Non applicable (${e.message})`);
        logAction(`[OFFBOARD][${jobId}] Révocation licence : ${e.message}`);
      }
    }

    // 6 ── Transfert d'emails (règle inbox, copie conservée — optionnel)
    offboardStep(job, "Configuration du transfert d'emails", 'running');
    if (MOCK_GRAPH) {
      await sleep(MOCK_DELAY * 0.6);
    } else if (job.transferEmails && job.accessTo) {
      try {
        await graphOp(token, 'POST', `/users/${userId}/mailFolders/inbox/messageRules`, {
          displayName: 'Offboarding — transfert automatique',
          sequence: 1, isEnabled: true,
          conditions: {},
          actions: {
            forwardTo: [{ emailAddress: { address: job.accessTo } }],
            stopProcessingRules: false,
          },
        });
      } catch (e) { logAction(`[OFFBOARD][${jobId}] Règle transfert : ${e.message}`); }
    }
    const fwdDetail = (job.transferEmails && job.accessTo)
      ? `Emails transférés vers ${job.accessTo} — copie conservée dans la boîte partagée`
      : 'Pas de transfert automatique configuré';
    offboardStep(job, "Configuration du transfert d'emails", 'done', fwdDetail);
    logAction(`[OFFBOARD][${jobId}] ${fwdDetail}`);

    // 6 ── Conversion en Shared Mailbox
    offboardStep(job, 'Conversion en boîte partagée', 'running');
    if (MOCK_GRAPH) await sleep(MOCK_DELAY * 0.8);
    const psCmd6 = `Set-Mailbox -Identity '${escapePsSQ(job.targetEmail)}' -Type Shared`;
    offboardStep(job, 'Conversion en boîte partagée', 'manual', psCmd6);
    logAction(`[OFFBOARD][${jobId}] Exchange Online requis : ${psCmd6}`);

    // 7 ── Accès à la boîte partagée
    offboardStep(job, 'Accès à la boîte partagée', 'running');
    if (MOCK_GRAPH) await sleep(MOCK_DELAY * 0.5);
    if (job.accessTo) {
      const psCmd7 = `Add-MailboxPermission -Identity '${escapePsSQ(job.targetEmail)}' -User '${escapePsSQ(job.accessTo)}' -AccessRights FullAccess -AutoMapping $true`;
      offboardStep(job, 'Accès à la boîte partagée', 'manual', psCmd7);
      logAction(`[OFFBOARD][${jobId}] Exchange Online requis : ${psCmd7}`);
    } else {
      offboardStep(job, 'Accès à la boîte partagée', 'skipped', 'Aucun accès supplémentaire configuré');
    }

    job.status = 'done';
    logAction(`[OFFBOARD][${jobId}] ✅ Offboarding terminé pour ${job.targetEmail} par ${job.initiatedBy}`);

  } catch (err) {
    logAction(`[OFFBOARD][${jobId}] ❌ ${err.message}`);
    const running = job.steps.find(s => s.status === 'running');
    if (running) { running.status = 'failed'; running.detail = err.message; }
    job.status = 'failed';
    job.error = err.message;
  }
}

app.post('/api/offboarding', auth, requireRole('admin'), async (req, res) => {
  const { targetEmail, accessTo, transferEmails } = req.body || {};
  if (!isValidEmail(targetEmail)) return res.status(400).json({ error: 'Email invalide' });
  if (accessTo && !isValidEmail(accessTo)) return res.status(400).json({ error: 'Email "Donner accès à" invalide' });
  if (accessTo && targetEmail === accessTo) return res.status(400).json({ error: "L'utilisateur ne peut pas être son propre successeur" });

  const jobId = uuidv4();
  offboardingJobs.set(jobId, {
    id: jobId, targetEmail, displayName: null,
    accessTo: accessTo || null,
    transferEmails: !!(transferEmails && accessTo),
    status: 'running', steps: [], error: null,
    initiatedBy: req.user.email,
    createdAt: new Date().toISOString(),
  });
  logAction(`Offboarding lancé pour ${targetEmail} par ${req.user.email}`);
  executeOffboarding(jobId).catch(err => {
    logAction(`[OFFBOARD][${jobId}] Fatal : ${err.message}`);
    const job = offboardingJobs.get(jobId);
    if (job) { job.status = 'failed'; job.error = err.message; }
  });
  res.json({ id: jobId });
});

app.get('/api/offboarding/:id', auth, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'ID invalide' });
  const job = offboardingJobs.get(id);
  if (!job) return res.status(404).json({ error: 'Job introuvable' });
  res.json(job);
});

// Échappe les métacaractères PowerShell pour les chaînes double-quotées : ` $ "
function escapePsDQ(s) {
  return String(s ?? '').replace(/`/g, '``').replace(/\$/g, '`$').replace(/"/g, '`"').replace(/\r?\n/g, ' ');
}
// Échappe pour les chaînes single-quotées PowerShell : ' → ''
function escapePsSQ(s) {
  return String(s ?? '').replace(/'/g, "''");
}

app.get('/api/offboarding/:id/script', auth, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'ID invalide' });
  const job = offboardingJobs.get(id);
  if (!job) return res.status(404).json({ error: 'Job introuvable' });

  const manualSteps = (job.steps || []).filter(s => s.status === 'manual');
  if (!manualSteps.length) return res.status(400).json({ error: 'Aucune action manuelle pour ce job' });

  const name = (job.displayName || job.targetEmail).replace(/[^a-zA-Z0-9_-]/g, '_');
  const date = new Date().toISOString().slice(0, 10);

  // ── Script PowerShell embarqué ──────────────────────────────────────────────
  const psLines = [
    `$ErrorActionPreference = 'Continue'`,
    `$ProgressPreference = 'SilentlyContinue'`,
    ``,
    `Write-Host "=============================================" -ForegroundColor Cyan`,
    `Write-Host "  Offboarding Exchange Online" -ForegroundColor Cyan`,
    `Write-Host "  ${escapePsDQ(job.displayName || job.targetEmail)}" -ForegroundColor White`,
    `Write-Host "  Généré le ${date} par ${escapePsDQ(job.initiatedBy)}" -ForegroundColor Gray`,
    `Write-Host "=============================================" -ForegroundColor Cyan`,
    `Write-Host ""`,
    ``,
    `# 1. Vérification / installation du module`,
    `Write-Host "Vérification du module ExchangeOnlineManagement..." -ForegroundColor Cyan`,
    `if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {`,
    `    Write-Host "  Module absent — installation en cours..." -ForegroundColor Yellow`,
    `    Install-Module ExchangeOnlineManagement -Force -Scope CurrentUser -AllowClobber`,
    `    Write-Host "  Module installé avec succès." -ForegroundColor Green`,
    `} else {`,
    `    Write-Host "  Module déjà installé." -ForegroundColor Green`,
    `}`,
    `Write-Host ""`,
    ``,
    `# 2. Connexion interactive`,
    `Write-Host "Connexion à Exchange Online..." -ForegroundColor Cyan`,
    `Connect-ExchangeOnline -UserPrincipalName "${escapePsDQ(job.initiatedBy)}"`,
    `Write-Host ""`,
    `Write-Host "Exécution des actions pour : ${escapePsDQ(job.targetEmail)}" -ForegroundColor White`,
    `Write-Host "---------------------------------------------"`,
    `Write-Host ""`,
  ];

  for (const step of manualSteps) {
    psLines.push(`# ${step.name}`);
    psLines.push(`Write-Host ">>> ${step.name}..." -ForegroundColor Yellow`);
    psLines.push(`try {`);
    psLines.push(`    ${step.detail}`);
    psLines.push(`    Write-Host "    [OK]" -ForegroundColor Green`);
    psLines.push(`} catch {`);
    psLines.push(`    Write-Host "    [ERREUR] $_" -ForegroundColor Red`);
    psLines.push(`}`);
    psLines.push(`Write-Host ""`);
  }

  psLines.push(`Write-Host "---------------------------------------------"`);
  psLines.push(`Write-Host "Terminé. Déconnexion..." -ForegroundColor Green`);
  psLines.push(`Disconnect-ExchangeOnline -Confirm:$false`);
  psLines.push(`Write-Host ""`);
  psLines.push(`Write-Host "Appuyez sur une touche pour fermer..." -ForegroundColor Gray`);
  psLines.push(`$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')`);

  const psContent = psLines.join('\r\n');
  const psBase64 = Buffer.from(psContent, 'utf8').toString('base64');
  const tmpName = `offboarding_${id.slice(0, 8)}`;

  // ── Fichier .bat ────────────────────────────────────────────────────────────
  const bat = [
    `@echo off`,
    `chcp 65001 >nul`,
    `title Offboarding Exchange Online - ${name}`,
    ``,
    `:: Écrire le script PowerShell dans un fichier temporaire`,
    `set "PSFILE=%TEMP%\\${tmpName}.ps1"`,
    ``,
    `powershell -Command "$b64='${psBase64}'; $bytes=[System.Convert]::FromBase64String($b64); $txt=[System.Text.Encoding]::UTF8.GetString($bytes); [System.IO.File]::WriteAllText('%PSFILE%',$txt,[System.Text.Encoding]::UTF8)"`,
    ``,
    `if not exist "%PSFILE%" (`,
    `    echo Erreur : impossible de créer le script temporaire.`,
    `    pause`,
    `    exit /b 1`,
    `)`,
    ``,
    `:: Lancer PowerShell avec le script`,
    `powershell -ExecutionPolicy Bypass -File "%PSFILE%"`,
    ``,
    `:: Nettoyage`,
    `del "%PSFILE%" >nul 2>&1`,
  ].join('\r\n');

  const filename = `offboarding_${name}_${date}.bat`;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(bat);
});

const MOCK_SEARCH_USERS = [
  { id: 'ms-1',  displayName: 'Alice Bernard',    mail: 'alice.bernard@captivea.com' },
  { id: 'ms-2',  displayName: 'Baptiste Dupont',  mail: 'baptiste.dupont@captivea.com' },
  { id: 'ms-3',  displayName: 'Camille Fontaine', mail: 'camille.fontaine@captivea.com' },
  { id: 'ms-4',  displayName: 'David Laurent',    mail: 'david.laurent@captivea.com' },
  { id: 'ms-5',  displayName: 'Emma Petit',       mail: 'emma.petit@captivea.com' },
  { id: 'ms-6',  displayName: 'François Girard',  mail: 'francois.girard@captivea.com' },
  { id: 'ms-7',  displayName: 'Gabriel Moreau',   mail: 'gabriel.moreau@captivea.com' },
  { id: 'ms-8',  displayName: 'Hélène Leblanc',   mail: 'helene.leblanc@captivea.com' },
  { id: 'ms-9',  displayName: 'Ivan Simon',       mail: 'ivan.simon@captivea.com' },
  { id: 'ms-10', displayName: 'Julie Rousseau',   mail: 'julie.rousseau@captivea.com' },
  { id: 'ms-11', displayName: 'Kevin Thomas',     mail: 'kevin.thomas@captivea.com' },
  { id: 'ms-12', displayName: 'Laura Martinez',   mail: 'laura.martinez@captivea.com' },
  { id: 'ms-13', displayName: 'Marc Leroy',       mail: 'marc.leroy@captivea.com' },
  { id: 'ms-14', displayName: 'Nathalie Picard',  mail: 'nathalie.picard@captivea.com' },
  { id: 'ms-15', displayName: 'Olivier Roux',     mail: 'olivier.roux@captivea.com' },
];

app.get('/api/users/graph-search', auth, requireRole('admin'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);

  if (MOCK_GRAPH) {
    const lower = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const results = MOCK_SEARCH_USERS.filter(u => {
      const name = u.displayName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return name.includes(lower) || u.mail.toLowerCase().includes(lower);
    }).slice(0, 6);
    return res.json(results);
  }

  try {
    const token = await getOffboardToken();
    const encoded = encodeURIComponent(q);
    const data = await graphOp(
      token, 'GET',
      `/users?$search="displayName:${encoded}" OR "mail:${encoded}"&$select=id,displayName,mail,userPrincipalName&$top=8&$orderby=displayName`,
      null,
      { ConsistencyLevel: 'eventual' }
    );
    const users = (data?.value || []).map(u => ({
      id: u.id,
      displayName: u.displayName || u.userPrincipalName,
      mail: u.mail || u.userPrincipalName,
    }));
    res.json(users);
  } catch (_) {
    res.json([]);
  }
});

// ─── Admin: Onboarding schema ─────────────────────────────────────────────────

const SCHEMA_DEFAULTS = {
  step2_group:     { enabled: true },
  step3_license:   { enabled: true, retry_delays: [15, 30, 45, 60, 90] },
  step4_sp_groups: { enabled: true },
};

app.get('/api/admin/schema', auth, requireRole('admin'), async (req, res) => {
  const db = await getDB();
  const row = dbRow(db, `SELECT value FROM settings WHERE key='onboarding_schema'`);
  try {
    const saved = row ? JSON.parse(row.value) : {};
    res.json({
      step2_group:     { ...SCHEMA_DEFAULTS.step2_group,     ...(saved.step2_group     || {}) },
      step3_license:   { ...SCHEMA_DEFAULTS.step3_license,   ...(saved.step3_license   || {}) },
      step4_sp_groups: { ...SCHEMA_DEFAULTS.step4_sp_groups, ...(saved.step4_sp_groups || {}) },
    });
  } catch (_) {
    res.json(SCHEMA_DEFAULTS);
  }
});

app.put('/api/admin/schema', auth, requireRole('admin'), async (req, res) => {
  const s = req.body;
  if (typeof s !== 'object' || s === null) return res.status(400).json({ error: 'Payload invalide' });
  const allowed = new Set(['step2_group', 'step3_license', 'step4_sp_groups']);
  for (const k of Object.keys(s)) {
    if (!allowed.has(k)) return res.status(400).json({ error: `Clé inconnue : ${k}` });
  }
  if (s.step3_license?.retry_delays !== undefined) {
    const rd = s.step3_license.retry_delays;
    if (!Array.isArray(rd) || rd.length === 0 || rd.length > 10 ||
        rd.some(x => typeof x !== 'number' || !Number.isInteger(x) || x < 1 || x > 600)) {
      return res.status(400).json({ error: 'retry_delays : 1–10 entiers entre 1 et 600 secondes' });
    }
  }
  const db = await getDB();
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_schema', ?)`, [JSON.stringify(s)]);
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
