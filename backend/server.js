// ═══════════════════════════════════════════════════════════════════════════════
// [EN-TÊTE] backend/server.js — point d'entrée unique du backend (Express + sql.js)
// ═══════════════════════════════════════════════════════════════════════════════
// Portail interne Captivea : modules ONBOARDING (comptes Microsoft 365) et MONITORING (licences IA).
// Doc détaillée : docs/portail-et-connexion.md, docs/onboarding.md, docs/monitoring.md. Vue d'ensemble : CLAUDE.md.
//
// PLAN DU FICHIER (bandeaux « // ─── … » ci-dessous, dans cet ordre) :
//   Env loading ............ lecture de backend/.env (PAS de commentaire en fin de ligne dans .env !)
//   2FA OTP store .......... codes email de la connexion de secours (mémoire)
//   Helpers ................ dbRow/dbRows, logAction, validations, hash scrypt
//   Auth middleware ........ auth (session cookie), requireRole, requireModule, requireSuperAdmin, modulesFor
//   Auth routes ............ /api/auth/login (secours, ADMIN seulement), 2FA, me, logout, mot de passe de lancement
//   Connexion Microsoft .... SSO OpenID Connect : /api/auth/microsoft/login et /callback (lib/microsoftSso.js)
//   Graph proxy routes ..... groupes, licences (lecture pour l'assistant d'onboarding)
//   Onboarding execution ... executeOnboarding (phase 1) puis executeOnboardingBackground (phase 2, +60 s)
//   Manual onboarding ...... compte M365 déjà créé : groupes + GitHub
//   Mutation ............... changement de poste/pays (retire les groupes gérés par l'app, ajoute les nouveaux)
//   Onboarding routes ...... liste, détail, création
//   Stats .................. chiffres du Dashboard
//   Admin: Organisation .... réglages (groupes, pays, domaines…) stockés en base, validateSettingValue
//   Monitoring ............. ingestion n8n, tableau de bord, prix, emplacement SharePoint, synchro
//   Admin: Users ........... utilisateurs + accès aux modules (SUPER ADMIN seulement)
//   Security events ........ journal de sécurité lu dans onboarding.log (SECURITY_PATTERNS)
//   Exchange PowerShell .... runExchangeScript → /opt/scripts/exchange.ps1 (hors dépôt, sur le VPS)
//   Offboarding ............ 8 étapes, état gardé en mémoire (offboardingJobs)
//   Boîtes partagées ....... accès à la demande
//   Admin: Schema .......... activer/désactiver les étapes du pipeline, délais de nouvel essai licence
//   Error handler / Démarrage (migrations, recoverStaleOnboardings, rappels GitHub, synchro SharePoint auto)
//
// CONVENTIONS
//   - Messages et journaux en FRANÇAIS. logAction(...) écrit dans backend/onboarding.log (lu par la page Sécurité).
//   - Toute écriture en base est suivie de saveDB() (sql.js est en mémoire ; écriture atomique sur disque).
//   - Une route protégée s'écrit : app.get(chemin, auth, [requireRole('admin')], [requireModule('x')], handler).
//   - Réglages métier : table settings (clé/valeur). SETTINGS_MAP relie une clé à une variable d'environnement ;
//     au démarrage la base REMPLACE la valeur du .env (loadSettingsFromDB).
//   - MOCK_GRAPH=true (dev) : tous les appels Microsoft sont simulés (lib/mock.js), SSO simulé, synchro SharePoint coupée.
//
// ÉTAT EN MÉMOIRE (perdu au redémarrage, c'est voulu ou connu)
//   otpStore (codes 2FA), tempPasswordStore (mot de passe temporaire d'un nouvel employé, 10 min, lu UNE fois),
//   offboardingJobs (suivi des offboardings), états SSO en cours (lib/microsoftSso.js).
//
// À SAVOIR
//   - Un push sur la branche main déploie automatiquement sur le VPS (.github/workflows/deploy.yml). Le .env du VPS n'est jamais touché.
//   - Rôles : operator, admin ; « super admin » = adresse listée dans SUPER_ADMIN_EMAILS (gestion du portail, suppression d'historique).
//   - Les administrateurs ont tous les modules par défaut ; users.modules (JSON) restreint (lib/modules.js).
//   - Le mot de passe n'est qu'un accès de SECOURS réservé aux admins (/login/backup) ; la connexion normale est Microsoft.
// ═══════════════════════════════════════════════════════════════════════════════

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

// Filet de sécurité : depuis Node 15+, une promesse rejetée non interceptée tue le process
// par défaut. Un bug isolé dans une tâche en arrière-plan (ex. executeOnboardingBackground)
// ne doit pas faire tomber tout le serveur et interrompre les onboardings en cours.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

const { getDB, saveDB } = require('./db');
const { MODULES, effectiveModules, parseModules } = require('./lib/modules');
const sso = require('./lib/microsoftSso');

const SETTINGS_MAP = {
  // AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET : .env UNIQUEMENT, jamais modifiables depuis l'interface ni stockés en base
  // (ils servent aussi à vérifier les jetons de connexion Microsoft : les laisser modifiables permettrait de changer l'autorité de confiance).
  default_domain:        'DEFAULT_DOMAIN',
  usage_location:        'USAGE_LOCATION',
  force_change_password:        'FORCE_CHANGE_PASSWORD',
  sharepoint_global_groups:  'SP_GLOBAL_GROUPS',
  global_shared_mailboxes:   'GLOBAL_SHARED_MAILBOXES',
  department_shared_mailboxes: 'DEPARTMENT_SHARED_MAILBOXES',
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
// Le mode simulé ouvre une connexion administrateur sans authentification (/api/auth/microsoft/callback?mock=1) :
// on refuse de démarrer en production plutôt que de l'exposer par erreur.
if (MOCK_GRAPH && process.env.NODE_ENV === 'production') {
  throw new Error('MOCK_GRAPH=true est interdit en production (connexion administrateur sans authentification).');
}

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
  const row = dbRow(db, `SELECT id, name, email, role, status, modules FROM users WHERE id=?`, [session.user_id]);
  if (!row || row.status !== 'active') return res.status(401).json({ error: 'Compte désactivé' });
  const { modules, ...user } = row;
  req.user = { ...user, modules: modulesFor(row) };
  next();
}

// Accès à un module du portail (les administrateurs ont accès à tous).
function requireModule(id) {
  return (req, res, next) => {
    if (!req.user?.modules?.includes(id)) return res.status(403).json({ error: 'Accès au module refusé' });
    next();
  };
}

// Modules accessibles : un super administrateur a toujours tout, les autres selon leur réglage.
function modulesFor(u) {
  return isSuperAdmin(u) ? Object.keys(MODULES) : effectiveModules(u);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Accès refusé' });
    next();
  };
}

// Super-admin : identité fixe (liste d'emails), distincte du rôle 'admin' — pour des actions
// irréversibles (ex. suppression définitive de l'historique) qu'on ne veut réserver qu'à une
// poignée de personnes de confiance, même parmi les admins.
function isSuperAdmin(user) {
  // Uniquement la variable du .env : plus d'adresse de repli écrite en dur (audit, constat n° 8). Sans variable, personne n'est super admin.
  const allowed = (process.env.SUPER_ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return !!user?.email && allowed.includes(user.email.toLowerCase());
}

function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ error: 'Réservé au super-admin' });
  next();
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

// Un seul rate-limiter partagé par IP entre login/2FA/mot de passe de lancement avait
// un effet de bord grave : le LAUNCH_PASSWORD est un secret PARTAGÉ entre tous les opérateurs
// IT, donc plusieurs personnes au bureau passent par la même IP publique (NAT). Une seule
// personne qui se trompe plusieurs fois en tapant ce mot de passe épuisait le quota partagé
// de l'IP et bloquait la connexion/2FA de TOUT LE MONDE derrière cette IP pendant 15 min.
// Chaque action a maintenant son propre compteur, et les actions déjà authentifiées sont
// limitées par utilisateur (req.user.id) plutôt que par IP.
function makeLimiter(max, extra = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
    ...extra,
  });
}

const authLimiter          = makeLimiter(10); // login (pré-auth, par IP — inchangé)
const twoFaLimiter         = makeLimiter(10); // vérification 2FA (pré-auth, par IP)
const launchPasswordLimiter = makeLimiter(10, { keyGenerator: (req) => req.user.id }); // par utilisateur

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
        return res.json({ user: { id: adminUser.id, name: adminUser.name, email: adminUser.email, role: adminUser.role, modules: modulesFor(adminUser) } });
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
  // Connexion par mot de passe (accès de secours) : réservée aux administrateurs. Les autres passent par Microsoft.
  if (user.role !== 'admin') {
    logAction(`[AUTH] Mot de passe refusé — connexion Microsoft obligatoire : ${user.email}`);
    return res.status(403).json({ error: 'Connexion par Microsoft obligatoire pour ce compte' });
  }

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
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, modules: modulesFor(user) } });
});

// ─── Connexion Microsoft (SSO) ────────────────────────────────────────────────
// Seule voie de connexion normale. L'identité vient de Microsoft (MFA et accès conditionnel du tenant
// inclus) ; le compte doit déjà exister dans l'app (Gestion du portail) et ne pas être désactivé.
const ssoLimiter = makeLimiter(30);

app.get('/api/auth/microsoft/login', ssoLimiter, (req, res) => {
  // Développement (Graph simulé) : pas de Microsoft réel, on rejoue le retour avec le premier admin.
  if (MOCK_GRAPH) return res.redirect('/api/auth/microsoft/callback?mock=1');
  let started;
  try {
    started = sso.startAuth();
  } catch (e) {
    logAction(`[AUTH] SSO Microsoft non configuré : ${e.message}`);
    return res.redirect('/login?error=config');
  }
  // État lié à ce navigateur : le retour de Microsoft n'est accepté que s'il correspond
  res.cookie('ms_state', started.state, {
    httpOnly: true, sameSite: 'lax', path: '/api/auth/microsoft', maxAge: 10 * 60 * 1000,
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  });
  res.redirect(started.url);
});

app.get('/api/auth/microsoft/callback', ssoLimiter, async (req, res) => {
  const fail = code => res.redirect(`/login?error=${code}`);
  res.clearCookie('ms_state', { path: '/api/auth/microsoft' });
  const db = await getDB();
  let identity;

  if (MOCK_GRAPH && req.query.mock === '1') {
    const admin = dbRow(db, `SELECT email, name FROM users WHERE role='admin' AND status='active' ORDER BY created_at LIMIT 1`);
    if (!admin) return fail('unauthorized');
    identity = { email: admin.email, name: admin.name };
  } else {
    const { code, state, error } = req.query;
    if (error) { logAction(`[AUTH] SSO Microsoft refusé : ${String(error).slice(0, 60)}`); return fail('refused'); }
    if (typeof code !== 'string' || typeof state !== 'string' || req.cookies?.ms_state !== state) return fail('invalid');
    try {
      identity = await sso.finishAuth({ code, state });
    } catch (e) {
      logAction(`[AUTH] SSO Microsoft échec : ${e.message}`);
      return fail(e.code === 'guest' ? 'guest' : 'failed');
    }
  }

  // Rattachement : d'abord par identifiant Entra (oid, immuable) ; à défaut par email, uniquement si le compte de l'app
  // n'est pas encore relié à un autre compte Microsoft (sinon : même adresse, autre personne → refus).
  let user = identity.oid ? dbRow(db, `SELECT * FROM users WHERE entra_oid=?`, [identity.oid]) : null;
  if (!user) {
    user = dbRow(db, `SELECT * FROM users WHERE email=?`, [normalizeEmail(identity.email)]);
    if (user && user.entra_oid && user.entra_oid !== identity.oid) {
      logAction(`[AUTH] SSO Microsoft — compte ${user.email} déjà relié à un autre compte Microsoft : connexion refusée`);
      return fail('mismatch');
    }
  }
  if (!user) { logAction(`[AUTH] SSO Microsoft — compte inconnu : ${identity.email}`); return fail('unauthorized'); }
  if (user.status === 'disabled') { logAction(`[AUTH] SSO Microsoft — compte désactivé : ${user.email}`); return fail('disabled'); }
  if (identity.oid && !user.entra_oid) {
    db.run(`UPDATE users SET entra_oid=? WHERE id=?`, [identity.oid, user.id]);
    logAction(`[AUTH] SSO Microsoft — compte ${user.email} relié à son identifiant Entra`);
  }
  if (user.status === 'pending') {
    // Invitation jamais acceptée : Microsoft vient de prouver l'identité, le compte peut être activé
    db.run(`UPDATE users SET status='active', invite_token=NULL, invite_expires=NULL WHERE id=?`, [user.id]);
  }

  const token = uuidv4();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString();
  db.run(`INSERT INTO sessions VALUES (?,?,?,?,?)`, [token, user.id, user.name, user.role, expires]);
  saveDB();
  logAction(`[AUTH] Connexion Microsoft réussie — ${user.email}`);
  res.cookie('session', token, sessionCookieOpts());
  res.redirect('/');
});

app.post('/api/auth/verify-2fa', twoFaLimiter, async (req, res) => {
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
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, modules: modulesFor(user) } });
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
  res.json({ user: req.user, mock: MOCK_GRAPH, isSuperAdmin: isSuperAdmin(req.user) });
});

// Vérification du mot de passe de lancement IT (uniquement via .env — non modifiable via UI)
app.post('/api/auth/verify-launch-password', auth, launchPasswordLimiter, async (req, res) => {
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

// ─── Graph proxy routes ────────────────────────────────────────────────────────

app.get('/api/graph/groups', auth, requireModule('onboarding'), async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const groups = await listGroups(search);
    res.json(groups);
  } catch (err) {
    console.error('[Graph] listGroups:', err.message);
    res.status(500).json({ error: 'Erreur lors de la récupération des groupes' });
  }
});

// Aperçu des groupes SharePoint/communication qui seront ajoutés pour un poste/pays/ville
// donné — sans rien exécuter. Utilisé pour confirmer avant une mutation ou un onboarding manuel.
// Réservé aux admins (audit, constat n° 9) : seule la page Mutation (admin) l'utilise ; ouverte aux opérateurs, elle
// permettait de dresser la carte complète poste × pays → groupes (noms et identifiants).
app.get('/api/onboardings/resolve-groups', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
  const { jobRole, location, city, excludeGroupId } = req.query;
  const tooLong = (s, n) => typeof s === 'string' && s.length > n;
  if (tooLong(jobRole, 128) || tooLong(location, 64) || tooLong(city, 128))
    return res.status(400).json({ error: 'Champ trop long' });
  try {
    const db = await getDB();
    const groups = await resolveSharePointCommGroups(db, {
      jobRole: jobRole?.trim() || '',
      location: location?.trim() || '',
      city: city?.trim() || '',
      excludeGroupId: excludeGroupId?.trim() || null,
    });
    res.json(groups.map(g => ({ id: g.id, label: g.label })));
  } catch (err) {
    console.error('[resolve-groups]', err.message);
    res.status(500).json({ error: 'Erreur lors du calcul des groupes' });
  }
});

app.get('/api/graph/groups/:id', auth, requireModule('onboarding'), async (req, res) => {
  try {
    const group = await getGroupById(req.params.id);
    res.json(group);
  } catch (err) {
    console.error('[Graph] getGroupById:', err.message);
    res.status(err.graphStatus === 404 ? 404 : 500).json({ error: err.graphStatus === 404 ? 'Groupe introuvable' : 'Erreur lors de la récupération du groupe' });
  }
});

app.get('/api/graph/licenses', auth, requireModule('onboarding'), async (req, res) => {
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

// Calcule les groupes SharePoint globaux/pays/ville + communication applicables à un
// employé (poste/localisation/ville), en excluant le groupe de sécurité principal.
async function resolveSharePointCommGroups(db, { location, jobRole, city, excludeGroupId }) {
  const globalGroups        = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='sharepoint_global_groups'`)?.value  || '[]');
  const countryGroups       = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='sharepoint_country_groups'`)?.value || '[]');
  const deptAssignments     = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='department_assignments'`)?.value     || '[]');
  const pointageCommAssign  = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='pointage_comm_assignments'`)?.value  || '[]');
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
    }).map(g => ({ id: g.id, label: g.name || g.id, exchangeEmail: g.exchangeEmail })),
    ...pointageCommAssign.filter(g =>
      g.id && g.department === jobRole && g.location === location
    ).map(g => ({ id: g.id, label: g.label || g.id })),
  ].filter((g, i, arr) => arr.findIndex(x => x.id === g.id) === i);

  return [
    ...globalGroups.filter(g => g.id),
    ...countryGroups.filter(g => g.id && g.location === location),
    ...cityGroups,
    ...commGroups,
  ]
    .filter(g => g.id && g.id !== excludeGroupId)
    .filter((g, i, arr) => arr.findIndex(x => x.id === g.id) === i);
}

// Ajoute l'utilisateur à chaque groupe SharePoint/communication résolu, avec fallback
// Exchange PowerShell si Graph refuse (listes mail-enabled/distribution). `logPrefix` est
// préfixé à chaque ligne de log pour distinguer l'appelant (onboarding auto vs manuel).
// Renvoie la liste des groupes qui n'ont pas pu être ajoutés ([{ name, error }]), pour que l'appelant puisse l'afficher.
async function applySharePointCommGroups(spGroups, adUserId, userPrincipalName, logPrefix) {
  const failed = [];
  let bgToken = null;
  // Jamais de vrai jeton en MOCK_GRAPH : sinon de vrais groupes (autoSubscribe) et Teams seraient modifiés en mode simulé.
  if (!MOCK_GRAPH) { try { bgToken = await getOffboardToken(); } catch (_) {} }

  if (spGroups.length === 0) {
    logAction(`${logPrefix} Aucun groupe SharePoint configuré — étape ignorée`);
    return failed;
  }
  for (const g of spGroups) {
    try {
      await addMemberToGroup(g.id, adUserId);
      logAction(`${logPrefix} ✅ Ajouté au groupe "${g.label}"`);
      if (bgToken) {
        try {
          await graphOp(bgToken, 'PATCH', `/groups/${encodeURIComponent(g.id)}`, { autoSubscribeNewMembers: true });
        } catch (_) { /* non bloquant */ }
      }
    } catch (e) {
      if (/mail-enabled security/i.test(e.message) || /distribution list/i.test(e.message) || /Cannot Update/i.test(e.message)) {
        logAction(`${logPrefix} ⚠️ Graph API refusé pour "${g.label}" — tentative via Exchange PowerShell…`);
        try {
          await runExchangeScript({ Action: 'AddDistributionMember', Identity: g.exchangeEmail || g.id, Member: userPrincipalName });
          logAction(`${logPrefix} ✅ Ajouté via Exchange PowerShell au groupe "${g.label}"`);
        } catch (psErr) {
          logAction(`${logPrefix} ❌ Exchange PowerShell échoué pour "${g.label}" : ${psErr.message}`);
          failed.push({ name: g.label, error: String(psErr.message || '').slice(0, 200) });
        }
      } else {
        logAction(`${logPrefix} ❌ Groupe "${g.label}" : ${e.message}`);
        failed.push({ name: g.label, error: String(e.message || '').slice(0, 200) });
      }
    }
  }
  return failed;
}

// Groupes principaux : convention « SP - {clé du poste} {code pays} » (ou « SP - {clé} » pour un poste global),
// définie dans lib/jobRoles.js (copie de frontend/src/jobRoles.js). Les codes pays viennent du réglage « locations ».
const { groupNameKey, expectedPrimaryGroupName, primaryGroupNames } = require('./lib/jobRoles');
const DEFAULT_ORG_LOCATIONS = '[{"code":"FR","name":"France","flag":"🇫🇷"},{"code":"MDG","name":"Madagascar","flag":"🇲🇬"},{"code":"US","name":"United States","flag":"🇺🇸"},{"code":"SG","name":"Singapore","flag":"🇸🇬"},{"code":"LUX","name":"Luxembourg","flag":"🇱🇺"},{"code":"IND","name":"India","flag":"🇮🇳"}]';
function orgLocationCodes(db) {
  try {
    const arr = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='locations'`)?.value || process.env.ORG_LOCATIONS || DEFAULT_ORG_LOCATIONS);
    return (Array.isArray(arr) ? arr : []).map(l => String(l?.code || '').trim()).filter(Boolean);
  } catch (_) { return []; }
}
// Vrai si le nom est EXACTEMENT celui d'un groupe principal que l'app peut fabriquer (poste connu + pays configuré).
// Remplace l'ancienne règle « le nom commence par SP », qui attrapait aussi des groupes d'un autre usage (audit, constat n° 4).
function isPrimaryGroupName(db, displayName) {
  return primaryGroupNames(orgLocationCodes(db)).has(groupNameKey(displayName));
}

// Anti-escalade (opérateurs) : un opérateur ne peut utiliser que le groupe proposé pour le poste et le pays déclarés,
// ou un groupe « pointage » configuré par un admin pour ce même pays (liste du « Changer de groupe » de l'assistant).
// Tout autre groupe, même « SP - … » valide, est réservé aux administrateurs. Renvoie null si autorisé, sinon le message.
async function operatorGroupError(db, { groupId, jobRole, location }) {
  const loc = String(location || '').trim();
  let pointage = [];
  try { pointage = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='pointage_assignments'`)?.value || '[]'); } catch (_) {}
  if (Array.isArray(pointage) && pointage.some(g => g && g.id === groupId && g.location === loc)) return null;
  const expected = expectedPrimaryGroupName(jobRole, loc);
  const grp = await getGroupById(groupId);
  if (expected && grp && groupNameKey(grp.displayName) === groupNameKey(expected)) return null;
  return 'Seul un administrateur peut choisir un autre groupe que celui prévu pour ce poste et ce pays';
}

// Anti-escalade de privilèges : un groupId doit soit figurer parmi les groupes déjà
// configurés par un admin (settings), soit être un vrai groupe de sécurité portant exactement le nom
// d'un groupe principal « SP - {poste} {pays} ». Empêche un appelant de forger un groupId arbitraire
// (ex. un groupe à privilèges) via l'onboarding manuel ou une mutation. Ignoré en mode mock.
async function validateProvisioningGroup(groupId) {
  if (MOCK_GRAPH) return;
  try {
    const cfgDb = await getDB();
    const configuredIds = new Set();
    for (const k of ['pointage_assignments', 'sharepoint_global_groups', 'sharepoint_country_groups']) {
      const raw = dbRow(cfgDb, `SELECT value FROM settings WHERE key=?`, [k])?.value;
      if (raw) { try { JSON.parse(raw).forEach(g => g && g.id && configuredIds.add(g.id)); } catch (_) {} }
    }
    if (configuredIds.has(groupId)) return;
    const grp = await getGroupById(groupId);
    const okSecurity   = grp && grp.securityEnabled === true && grp.mailEnabled === false;
    const okConvention = grp && isPrimaryGroupName(cfgDb, grp.displayName);
    if (!okSecurity || !okConvention) {
      const err = new Error('Groupe non autorisé (groupe principal « SP - {poste} {pays} » ou groupe configuré requis)');
      err.httpStatus = 400;
      throw err;
    }
  } catch (e) {
    if (e.httpStatus) throw e;
    if (e.graphStatus === 404) { const err = new Error('Groupe introuvable dans l\'organisation'); err.httpStatus = 400; throw err; }
    console.error('[validateProvisioningGroup]', e.message);
    const err = new Error('Validation impossible (Microsoft Graph indisponible)');
    err.httpStatus = 502;
    throw err;
  }
}

// Groupes « gérés par l'app » éligibles à un retrait automatique lors d'une mutation
// (changement de poste/pays) : pays/villes, départements, communication, pointage. Les groupes
// clients/métier (ex. accès à un dossier client) ne sont jamais dans ce pool et ne seront
// donc jamais touchés par une mutation.
// Les groupes GLOBAUX (sharepoint_global_groups) n'y sont pas : donnés à tout le monde, quel que soit le
// poste ou le pays, ils restent valables après une mutation. Les retirer puis les remettre n'apportait
// rien et pouvait faire perdre l'accès sans alerte si la remise échouait (audit, constat n° 3).
async function getGlobalGroupIds(db) {
  try {
    const arr = JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key='sharepoint_global_groups'`)?.value || '[]');
    return new Set((Array.isArray(arr) ? arr : []).map(g => g?.id).filter(Boolean));
  } catch (_) { return new Set(); }
}

async function getRemovableGroupPool(db) {
  const ids = new Set();
  for (const k of ['sharepoint_country_groups', 'department_assignments', 'pointage_comm_assignments', 'pointage_assignments']) {
    const raw = dbRow(db, `SELECT value FROM settings WHERE key=?`, [k])?.value;
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw);
      arr.forEach(g => {
        if (g?.id) ids.add(g.id);
        (g.cities || []).forEach(c => { if (c?.id) ids.add(c.id); });
      });
    } catch (_) {}
  }
  return ids;
}

// Accès Microsoft Graph de la mutation et de l'onboarding manuel (employé, appartenances, ajout/retrait d'un membre).
// En MOCK_GRAPH, tout est simulé par lib/mock.js : AUCUN appel à Microsoft (avant, ces routes appelaient le vrai Graph
// même en mode simulé). Les groupes de départ simulés d'un employé couvrent tous les cas de l'aperçu (audit, constat n° 11).
async function mockStartingGroups() {
  const db = await getDB();
  const read = k => { try { return JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key=?`, [k])?.value || '[]'); } catch (_) { return []; } };
  const globals = read('sharepoint_global_groups').filter(g => g?.id);
  const country = read('sharepoint_country_groups').find(g => g?.id && g.location === 'FR');
  // noms lisibles pour tous les groupes configurés (sinon un groupe ajouté pendant la simulation s'afficherait par son identifiant)
  for (const k of ['sharepoint_global_groups', 'sharepoint_country_groups', 'department_assignments', 'pointage_comm_assignments', 'pointage_assignments']) {
    const arr = read(k);
    graphLib.rememberGroupNames(arr);
    graphLib.rememberGroupNames(arr.flatMap(g => (g?.cities || []).map(c => ({ id: c.id, label: c.label || c.name }))));
  }
  const asGroup = (g, sec) => ({ id: g.id, displayName: g.label || g.displayName, securityEnabled: sec, mailEnabled: !sec });
  return [
    { id: 'mock-hr-fr', displayName: 'SP - HR FR', securityEnabled: true, mailEnabled: false },        // groupe principal → retiré
    ...globals.map(g => asGroup(g, false)),                                                             // globaux → conservés
    ...(country ? [asGroup(country, false)] : []),                                                      // pays → retiré si le pays change
    { id: 'mock-sp-legal-archive', displayName: 'SP Legal Archive', securityEnabled: true, mailEnabled: false },   // autre usage → conservé
    { id: 'mock-client-acme', displayName: 'Client ACME (accès dossier)', securityEnabled: true, mailEnabled: false }, // hors app → conservé
  ];
}
const memberGraph = MOCK_GRAPH ? {
  lookupUser: async email => graphLib.mockUserFor(email),
  listMemberships: userId => graphLib.mockMemberships(userId, mockStartingGroups),
  removeMember: (groupId, userId) => graphLib.mockRemoveMember(groupId, userId),
  addMember: (groupId, userId, groupName) => graphLib.mockAddMember(groupId, userId, groupName),
} : {
  lookupUser: (email, select = 'id,displayName,userPrincipalName') =>
    require('./lib/graph').graphFetch(`/users/${encodeURIComponent(email)}?$select=${select}`),
  // Microsoft renvoie les appartenances par pages (100 par défaut) : on suit @odata.nextLink jusqu'à la dernière,
  // sinon les groupes au-delà de la première page seraient ignorés (ni affichés, ni retirés). Limite de sécurité : 50 pages.
  listMemberships: async userId => {
    const { graphFetch } = require('./lib/graph');
    const items = [];
    let next = `/users/${encodeURIComponent(userId)}/memberOf?$select=id,displayName,securityEnabled,mailEnabled&$top=999`;
    for (let page = 0; next && page < 50; page++) {
      const r = await graphFetch(next);
      items.push(...(r?.value || []));
      const link = r?.['@odata.nextLink'];
      next = typeof link === 'string' && link.startsWith('https://graph.microsoft.com/') ? link : null;
    }
    return items;
  },
  removeMember: (groupId, userId) => require('./lib/graph').graphFetch(
    `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/$ref`, { method: 'DELETE' }),
  addMember: (groupId, userId) => require('./lib/graph').graphFetch(`/groups/${encodeURIComponent(groupId)}/members/$ref`, {
    method: 'POST', body: { '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${userId}` },
  }),
};

// Liste les groupes M365 actuels d'un utilisateur, avec un indicateur "removable" : vrai si
// le groupe fait partie du pool ci-dessus, OU s'il porte exactement le nom d'un groupe principal
// « SP - {poste} {pays} » (isPrimaryGroupName). Les groupes hors de ce périmètre (accès client, etc.) sont
// listés mais jamais retirés. Utilisé pour l'aperçu et l'exécution d'une mutation.
async function getUserGroups(userId) {
  const groups = (await memberGraph.listMemberships(userId)).filter(g => g['@odata.type'] === '#microsoft.graph.group');
  const db = await getDB();
  const pool = await getRemovableGroupPool(db);
  const globals = await getGlobalGroupIds(db);
  return groups.map(g => ({
    id: g.id,
    displayName: g.displayName,
    // un groupe global n'est jamais retiré ; un groupe « SP … » ne l'est que s'il porte exactement le nom d'un groupe principal
    removable: !globals.has(g.id) && (pool.has(g.id) || (g.securityEnabled === true && g.mailEnabled === false && isPrimaryGroupName(db, g.displayName))),
  }));
}

// Ajoute l'utilisateur au groupe de rôle principal (groupId) puis aux groupes SharePoint/
// communication résolus pour son nouveau poste/pays/ville. Partagé entre l'onboarding manuel
// et la mutation de poste/pays.
// Donne à l'utilisateur l'accès à chaque boîte partagée globale configurée (Administration →
// Groupes → Boîtes partagées). Ce n'est pas un ajout de membre Graph mais une permission posée
// sur la boîte elle-même, via l'action Exchange AddMailboxPermission. `retry` : à l'onboarding,
// la boîte du nouvel employé peut mettre quelques minutes à exister côté Exchange.
// Donne l'accès (permission Exchange AddMailboxPermission) d'un utilisateur à une boîte partagée.
// `delays` : pauses (en s) avant de réessayer quand Exchange ne connaît pas encore le compte.
// Retourne { status: 'granted' | 'already' | 'error', error? }.
async function grantMailboxAccess(userPrincipalName, mailboxEmail, name, logPrefix, delays = []) {
  const notReady = /couldn'?t be found|could not find|not found|recipient/i;
  for (let attempt = 0; ; attempt++) {
    try {
      await runExchangeScript({ Action: 'AddMailboxPermission', Identity: mailboxEmail, User: userPrincipalName });
      logAction(`${logPrefix} ✅ Accès à la boîte partagée "${name}"`);
      return { status: 'granted' };
    } catch (e) {
      if (/already/i.test(e.message || '')) {
        logAction(`${logPrefix} ⏭️ Accès déjà présent sur la boîte partagée "${name}"`);
        return { status: 'already' };
      }
      if (attempt < delays.length && notReady.test(e.message || '')) {
        logAction(`${logPrefix} ⏳ Exchange pas encore prêt pour "${name}" — retry ${attempt + 1}/${delays.length} dans ${delays[attempt]}s...`);
        await sleep(delays[attempt] * 1000);
        continue;
      }
      logAction(`${logPrefix} ❌ Boîte partagée "${name}" : ${e.message}`);
      return { status: 'error', error: e.message };
    }
  }
}

// Boîtes de l'employé = boîtes globales (tout le monde) + boîtes par département dont le filtre
// (poste, pays) correspond — même règle que les groupes de communication.
async function applySharedMailboxes(userPrincipalName, logPrefix, { retry = false, jobRole = '', location = '' } = {}) {
  const db = await getDB();
  const read = key => { try { return JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key=?`, [key])?.value || '[]'); } catch (_) { return []; } };
  // Global = tout le monde sans exception. Sinon : le pays doit correspondre, puis, si des
  // départements sont précisés, le poste aussi (sans département : tout le pays).
  const deptMatch = m => {
    if (m.location === 'ALL') return true;
    if (!(m.countries || []).includes(location)) return false;
    const depts = m.departments || [];
    return depts.length === 0 || depts.includes(jobRole);
  };
  const byEmail = new Map();
  for (const m of [...read('global_shared_mailboxes'), ...read('department_shared_mailboxes').filter(deptMatch)]) {
    if (m && typeof m.email === 'string' && m.email && !byEmail.has(m.email.toLowerCase())) byEmail.set(m.email.toLowerCase(), m);
  }
  const mailboxes = [...byEmail.values()];
  if (!mailboxes.length) return 0;
  if (MOCK_GRAPH) {
    logAction(`${logPrefix} ⏭️ Boîtes partagées — ignorées en mode mock`);
    return 0;
  }

  const delays = retry ? [30, 60, 120] : [];
  let granted = 0;
  for (const m of mailboxes) {
    const r = await grantMailboxAccess(userPrincipalName, m.email, m.label || m.name || m.email, logPrefix, delays);
    if (r.status === 'granted') granted++;
  }
  return granted;
}

// Invite un email à l'org GitHub + l'ajoute au team par défaut. Partagé entre l'invitation
// initiale (à la création du compte) et le rappel automatique envoyé 7 jours plus tard.
async function sendGithubInvite(email, logPrefix) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_ORG   = process.env.GITHUB_ORG || 'Riss-Group';
  if (!GITHUB_TOKEN) return { invited: false };
  // Mode simulé : jamais de vraie invitation GitHub (le jeton du .env local est réel)
  if (MOCK_GRAPH) { logAction(`${logPrefix} ⏭️ Invitation GitHub — ignorée en mode mock`); return { invited: false }; }

  try {
    const ghRes = await fetch(`https://api.github.com/orgs/${encodeURIComponent(GITHUB_ORG)}/invitations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, role: 'direct_member', team_ids: [] }),
    });
    if (!ghRes.ok) {
      const ghErr = await ghRes.json().catch(() => ({}));
      logAction(`${logPrefix} ⚠️ GitHub : ${ghErr.message || ghRes.status}`);
      return { invited: false };
    }
    logAction(`${logPrefix} ✅ Invitation GitHub envoyée à ${email}`);
    const GITHUB_TEAM = process.env.GITHUB_TEAM_SLUG || 'all';
    const teamRes = await fetch(`https://api.github.com/orgs/${encodeURIComponent(GITHUB_ORG)}/teams/${encodeURIComponent(GITHUB_TEAM)}/memberships/${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'member' }),
    });
    if (teamRes.ok) {
      logAction(`${logPrefix} ✅ Ajouté au team GitHub "${GITHUB_TEAM}"`);
    } else {
      const teamErr = await teamRes.json().catch(() => ({}));
      logAction(`${logPrefix} ⚠️ Team GitHub : ${teamErr.message || teamRes.status}`);
    }
    return { invited: true };
  } catch (ghEx) {
    logAction(`${logPrefix} ⚠️ GitHub inaccessible : ${ghEx.message}`);
    return { invited: false };
  }
}

// Ajoute l'utilisateur à son groupe principal. Renvoie true s'il en était déjà membre ; lève une erreur (httpStatus 500) sinon.
async function addPrimaryGroup({ adUser, groupId, groupName, logPrefix }) {
  try {
    await memberGraph.addMember(groupId, adUser.id, groupName);
    logAction(`${logPrefix} ✅ ${adUser.displayName} ajouté au groupe "${groupName}"`);
    return false;
  } catch (e) {
    if (e.graphStatus === 400 && /already exist/i.test(e.message || '')) {
      logAction(`${logPrefix} ⏭️ ${adUser.displayName} déjà membre de "${groupName}"`);
      return true;
    }
    const err = new Error(e.message);
    err.httpStatus = 500;
    throw err;
  }
}

// Groupes SharePoint/communication du poste/pays/ville (globaux, pays, villes, départements, pointage).
async function resolveRoleCommGroups({ groupId, jobRole, location, city }) {
  return resolveSharePointCommGroups(await getDB(), {
    location: location?.trim() || '',
    jobRole: jobRole?.trim() || '',
    city: city?.trim() || '',
    excludeGroupId: groupId,
  });
}

// Ajoute ces groupes ; renvoie { spGroupCount, failedAdditions } (les échecs ne bloquent pas : ils sont renvoyés pour affichage).
async function applyRoleCommGroups({ adUser, spGroups, logPrefix }) {
  try {
    const failedAdditions = await applySharePointCommGroups(spGroups, adUser.id, adUser.userPrincipalName || adUser.mail || adUser.displayName, logPrefix);
    return { spGroupCount: spGroups.length, failedAdditions };
  } catch (e) {
    logAction(`${logPrefix} ❌ Groupes SharePoint/communication : ${e.message}`);
    return { spGroupCount: spGroups.length, failedAdditions: [{ name: 'Groupes SharePoint/communication', error: String(e.message || '').slice(0, 200) }] };
  }
}

async function assignPrimaryGroupAndSpComm({ adUser, groupId, groupName, jobRole, location, city, logPrefix }) {
  const skipped = await addPrimaryGroup({ adUser, groupId, groupName, logPrefix });
  let spGroups = [];
  try {
    spGroups = await resolveRoleCommGroups({ groupId, jobRole, location, city });
  } catch (e) {
    logAction(`${logPrefix} ❌ Groupes SharePoint/communication : ${e.message}`);
    return { skipped, spGroupCount: 0, failedAdditions: [{ name: 'Groupes SharePoint/communication', error: String(e.message || '').slice(0, 200) }] };
  }
  return { skipped, ...(await applyRoleCommGroups({ adUser, spGroups, logPrefix })) };
}

// Si la phase 2 (groupes/GitHub/Teams) plante, la ligne resterait en 'partial' pour toujours :
// on la passe en échec avec la marche à suivre (le compte et la licence, eux, sont bien créés).
async function markBackgroundFailed(id, err) {
  logAction(`[${id}] ❌ Background error : ${err.message}`);
  try {
    const db = await getDB();
    // Message générique : le détail technique reste dans les logs, pas dans l'UI.
    db.run(
      `UPDATE onboardings SET status='failed', error_message=? WHERE id=? AND status='partial'`,
      ['Phase groupes/GitHub en erreur — compte et licence créés ; compléter via « Onboarding manuel »', id]
    );
    db.run(`UPDATE onboarding_steps SET status='failed', error_message='Interrompu' WHERE onboarding_id=? AND status='running'`, [id]);
    saveDB();
  } catch (e) {
    console.error('[markBackgroundFailed]', e);
  }
}

async function executeOnboardingBackground(id, adUserId, userPrincipalName, step4Enabled) {
  const db = await getDB();
  const onb = dbRow(db, `SELECT * FROM onboardings WHERE id=?`, [id]);
  if (!onb) return;

  logAction(`[${id}] [BG] Démarrage de l'intégration groupes/Teams/GitHub pour ${onb.employee_email}`);

  let bgToken = null;
  // Jamais de vrai jeton en MOCK_GRAPH : sinon de vrais groupes (autoSubscribe) et Teams seraient modifiés en mode simulé.
  if (!MOCK_GRAPH) { try { bgToken = await getOffboardToken(); } catch (_) {} }

  // Étape 4 — Groupes SharePoint & Communication
  if (step4Enabled) {
    updateStep(db, id, 4, 'running');
    const spGroups = await resolveSharePointCommGroups(db, {
      location: onb.location || '',
      jobRole: onb.job_role || '',
      city: onb.city || '',
      excludeGroupId: onb.group_id,
    });
    await applySharePointCommGroups(spGroups, adUserId, userPrincipalName, `[${id}] [BG]`);
    await applySharedMailboxes(userPrincipalName, `[${id}] [BG]`, { retry: true, jobRole: onb.job_role || '', location: onb.location || '' });
    updateStep(db, id, 4, 'done');
    saveDB();
  } else {
    updateStep(db, id, 4, 'skipped');
    logAction(`[${id}] [BG] ⏭️ Groupes SP/Comm — étape désactivée dans le schéma`);
  }

  // Étape 5 — Invitation GitHub (+ rappel automatique programmé 7 jours plus tard si succès)
  if (process.env.GITHUB_TOKEN) {
    logAction(`[${id}] [BG] Invitation GitHub pour ${onb.employee_email}...`);
    const { invited } = await sendGithubInvite(onb.employee_email, `[${id}] [BG]`);
    if (invited) {
      db.run(`UPDATE onboardings SET github_invited=1 WHERE id=?`, [id]);
      saveDB();
    }
  } else {
    logAction(`[${id}] [BG] ⏭️ GITHUB_TOKEN non configuré — étape ignorée`);
  }

  // Étape 6 — Ajout au canal Teams
  if (!MOCK_GRAPH && adUserId) {
    const countryGroupsRaw = dbRow(db, `SELECT value FROM settings WHERE key='sharepoint_country_groups'`)?.value || '[]';
    const countryGroupsCfg = (() => { try { return JSON.parse(countryGroupsRaw); } catch (_) { return []; } })();
    const locationEntry = countryGroupsCfg.find(g => g.location === onb.location);
    const teamsId   = locationEntry?.id?.trim();
    const cityEntry = (locationEntry?.cities || []).find(c => c.name === onb.city);
    const channelId = cityEntry?.channelId?.trim();
    if (teamsId && channelId && bgToken) {
      logAction(`[${id}] [BG] Ajout au canal Teams pour ${onb.city}...`);
      try {
        await graphOp(bgToken, 'POST',
          `/teams/${encodeURIComponent(teamsId)}/channels/${encodeURIComponent(channelId)}/members`,
          { '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: [], 'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${adUserId}')` }
        );
        logAction(`[${id}] [BG] ✅ Ajouté au canal Teams "${onb.city}"`);
      } catch (teamsErr) {
        logAction(`[${id}] [BG] ⚠️ Teams : ${teamsErr.message}`);
      }
    } else if (!teamsId || !channelId) {
      logAction(`[${id}] [BG] ⏭️ Teams Channel — teamsId ou channelId non configuré pour "${onb.location}/${onb.city}"`);
    }
  }

  db.run(`UPDATE onboardings SET status='done', completed_at=datetime('now') WHERE id=?`, [id]);
  saveDB();
  logAction(`[${id}] 🎉 Intégration complète terminée pour ${onb.employee_email}`);
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

    // Résoudre le code ISO depuis la config des locations (champ iso ou fallback LOCATION_TO_ISO)
    const locationsRaw = dbRow(db, `SELECT value FROM settings WHERE key='locations'`)?.value || process.env.ORG_LOCATIONS || '[]';
    const locationsCfg = (() => { try { return JSON.parse(locationsRaw); } catch (_) { return []; } })();
    const locationEntry = locationsCfg.find(l => l.code === onb.location);
    const isoCode = locationEntry?.iso || null;

    const adUser = await createUser({
      firstName: onb.employee_firstname,
      lastName:  onb.employee_lastname,
      email:     onb.employee_email,
      location:  onb.location,
      isoCode,
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

    // Phase 1 terminée — compte + licence prêts
    // Marquer comme partial pour que le frontend affiche immédiatement les credentials
    db.run(`UPDATE onboardings SET status='partial' WHERE id=?`, [id]);
    saveDB();
    logAction(`[${id}] ✅ Compte + licence prêts — intégration groupes/Teams/GitHub dans 60s en background`);

    // Lancer la phase 2 (groupes, GitHub, Teams) en background après 60s
    const _bgUserId = adUserId;
    const _bgUpn    = adUser.userPrincipalName;
    const _bgStep4  = step4Enabled;
    setTimeout(() => {
      executeOnboardingBackground(id, _bgUserId, _bgUpn, _bgStep4).catch(err => markBackgroundFailed(id, err));
    }, 60 * 1000);

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

// ─── Manual onboarding (compte M365 existant) ────────────────────────────────

app.post('/api/onboardings/manual', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
  const { email, groupId, groupName, jobRole, location, city } = req.body;

  if (!isValidEmail(email?.trim()))
    return res.status(400).json({ error: 'Email invalide' });
  const tooLong = (s, n) => typeof s === 'string' && s.length > n;
  if (tooLong(groupName, 256))
    return res.status(400).json({ error: 'Nom de groupe trop long' });
  if (tooLong(jobRole, 128) || tooLong(location, 64) || tooLong(city, 128))
    return res.status(400).json({ error: 'Champ trop long' });
  const idOk = (v) => isValidUUID(v) || (MOCK_GRAPH && /^mock-[\w-]+$/.test(v));
  if (!idOk(groupId))
    return res.status(400).json({ error: 'Identifiant de groupe invalide' });

  try {
    await validateProvisioningGroup(groupId);
  } catch (e) {
    return res.status(e.httpStatus || 500).json({ error: e.message });
  }

  // 1. Look up user in Azure AD (simulé en MOCK_GRAPH)
  let adUser;
  try {
    adUser = await memberGraph.lookupUser(email.trim(), 'id,displayName');
  } catch (e) {
    if (e.graphStatus === 404) return res.status(404).json({ error: 'Utilisateur introuvable dans Azure AD' });
    logAction(`[manual] ❌ Lookup AD ${email} : ${e.message}`);
    return res.status(500).json({ error: e.message });
  }

  // 2 & 3. Groupe principal + groupes SharePoint/communication (mêmes règles que l'étape 4
  // du flow automatique). Toujours exécuté pour les groupes SP/comm, indépendamment du poste.
  let skipped, spGroupCount;
  try {
    ({ skipped, spGroupCount } = await assignPrimaryGroupAndSpComm({
      adUser: { ...adUser, userPrincipalName: email.trim() },
      groupId, groupName, jobRole, location, city,
      logPrefix: '[manual]',
    }));
  } catch (e) {
    return res.status(e.httpStatus || 500).json({ error: e.message });
  }

  // 3b. Boîtes partagées globales + par département (permission Exchange)
  await applySharedMailboxes(email.trim(), '[manual]', { jobRole: jobRole?.trim() || '', location: location?.trim() || '' });

  // 4. GitHub invitation
  const { invited: githubInvited } = await sendGithubInvite(email.trim(), '[manual]');

  return res.json({ ok: true, skipped, githubInvited, spGroupCount, displayName: adUser.displayName, groupName });
});

// ─── Mutation (changement de poste / pays) ────────────────────────────────────
// Pour un employé déjà onboardé : retire les groupes liés à son ancien poste/pays (détectés
// automatiquement via ses groupes actuels — jamais les groupes globaux, valables pour tout le
// monde) et l'ajoute aux groupes de son nouveau poste/pays, comme un onboarding normal.

app.get('/api/onboardings/transfer/groups', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
  const email = req.query.email?.trim();
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Email invalide' });
  let adUser;
  try {
    adUser = await memberGraph.lookupUser(email, 'id,displayName');
  } catch (e) {
    if (e.graphStatus === 404) return res.status(404).json({ error: 'Utilisateur introuvable dans Azure AD' });
    return res.status(500).json({ error: e.message });
  }
  try {
    const groups = await getUserGroups(adUser.id); // simulés en MOCK_GRAPH
    res.json({ displayName: adUser.displayName, groups });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/onboardings/transfer', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
  const { email, groupId, groupName, jobRole, location, city } = req.body;

  if (!isValidEmail(email?.trim()))
    return res.status(400).json({ error: 'Email invalide' });
  const tooLong = (s, n) => typeof s === 'string' && s.length > n;
  if (tooLong(groupName, 256))
    return res.status(400).json({ error: 'Nom de groupe trop long' });
  if (tooLong(jobRole, 128) || tooLong(location, 64) || tooLong(city, 128))
    return res.status(400).json({ error: 'Champ trop long' });
  const idOk = (v) => isValidUUID(v) || (MOCK_GRAPH && /^mock-[\w-]+$/.test(v));
  if (!idOk(groupId))
    return res.status(400).json({ error: 'Identifiant de groupe invalide' });

  try {
    await validateProvisioningGroup(groupId);
  } catch (e) {
    return res.status(e.httpStatus || 500).json({ error: e.message });
  }

  let adUser;
  try {
    adUser = await memberGraph.lookupUser(email.trim(), 'id,displayName,userPrincipalName');
  } catch (e) {
    if (e.graphStatus === 404) return res.status(404).json({ error: 'Utilisateur introuvable dans Azure AD' });
    logAction(`[transfer] ❌ Lookup AD ${email} : ${e.message}`);
    return res.status(500).json({ error: e.message });
  }

  // Ordre sûr (audit, constat n° 6) : le NOUVEAU groupe principal est ajouté AVANT tout retrait. S'il échoue, on s'arrête :
  // la personne garde ses anciens accès, rien n'est cassé. Pendant quelques secondes elle a l'ancien et le nouveau groupe.
  const userForGroups = { ...adUser, userPrincipalName: adUser.userPrincipalName || email.trim() };

  // 1. Nouveau groupe principal
  let skipped;
  try {
    skipped = await addPrimaryGroup({ adUser: userForGroups, groupId, groupName, logPrefix: '[transfer]' });
  } catch (e) {
    logAction(`[transfer] ❌ Ajout au nouveau groupe "${groupName}" impossible — mutation arrêtée, aucun groupe retiré : ${e.message}`);
    return res.status(e.httpStatus || 500).json({ error: `Impossible d'ajouter la personne au nouveau groupe « ${groupName} » : ${e.message}. Rien n'a été retiré : ses anciens accès sont intacts, tu peux réessayer.` });
  }

  // 2. Groupes SharePoint/communication du nouveau poste/pays, calculés AVANT le retrait : un ancien groupe qui reste
  // valable (ex. groupe pays quand seul le poste change) est conservé au lieu d'être retiré puis remis.
  // Si ce calcul échoue, on ne retire rien (on ne saurait pas quels accès remettre).
  let spGroups;
  try {
    spGroups = await resolveRoleCommGroups({ groupId, jobRole, location, city });
  } catch (e) {
    logAction(`[transfer] ❌ Calcul des groupes du nouveau poste/pays : ${e.message} — aucun ancien groupe retiré`);
    return res.json({
      ok: true, skipped, spGroupCount: 0, removedGroups: [],
      failedRemovals: [{ name: 'Anciens groupes (non retirés)', error: 'Groupes du nouveau poste/pays incalculables : rien n\'a été retiré' }],
      failedAdditions: [{ name: 'Groupes SharePoint/communication', error: String(e.message || '').slice(0, 200) }],
      displayName: adUser.displayName, groupName,
    });
  }
  const keepIds = new Set(spGroups.map(g => g.id));

  // 3. Retrait des groupes gérés par l'app uniquement (pays/villes/départements/communication/
  // pointage + groupe principal « SP - poste pays ») — jamais les groupes globaux, ni ceux du nouveau poste/pays,
  // ni ceux hors de ce périmètre (accès client, etc.). Le compte et sa licence ne sont jamais touchés.
  // Un retrait refusé par Microsoft est renvoyé dans failedRemovals pour être affiché à l'admin (audit, constat n° 5).
  let removedGroups = [];
  const failedRemovals = [];
  { // (exécuté aussi en MOCK_GRAPH : memberGraph simule alors les retraits)
    try {
      const currentGroups = await getUserGroups(adUser.id);
      for (const g of currentGroups.filter(g => g.removable && g.id !== groupId && !keepIds.has(g.id))) {
        try {
          await memberGraph.removeMember(g.id, adUser.id);
          removedGroups.push(g.displayName);
          logAction(`[transfer] ✅ ${adUser.displayName} retiré du groupe "${g.displayName}"`);
        } catch (e) {
          if (e.graphStatus === 404) { // déjà plus membre (retiré entre l'aperçu et l'exécution) : le résultat voulu est atteint
            removedGroups.push(g.displayName);
            continue;
          }
          logAction(`[transfer] ❌ Retrait groupe "${g.displayName}" : ${e.message}`);
          failedRemovals.push({ name: g.displayName, error: String(e.message || '').slice(0, 200) });
        }
      }
    } catch (e) {
      // Lecture impossible : rien n'a été retiré ; la personne a déjà le nouveau groupe principal (étape 1).
      logAction(`[transfer] ❌ Lecture des groupes actuels : ${e.message}`);
      return res.status(502).json({ error: `Impossible de lire les groupes actuels : ${e.message}. La personne a été ajoutée au nouveau groupe « ${groupName} », mais aucun ancien groupe n'a été retiré : relance la mutation.` });
    }
  }

  // 4. Groupes SharePoint/communication du nouveau poste/pays (déjà membre = sans effet)
  const { spGroupCount, failedAdditions } = await applyRoleCommGroups({ adUser: userForGroups, spGroups, logPrefix: '[transfer]' });

  const incomplete = failedRemovals.length + failedAdditions.length > 0;
  logAction(`[transfer] ${incomplete ? '⚠️ Mutation incomplète' : '🎉 Mutation terminée'} pour ${adUser.displayName} — ${removedGroups.length} groupe(s) retiré(s), nouveau groupe "${groupName}"`
    + (incomplete ? ` — échecs : ${failedRemovals.length} retrait(s), ${failedAdditions.length} ajout(s)` : ''));
  res.json({ ok: true, skipped, spGroupCount, removedGroups, failedRemovals, failedAdditions, displayName: adUser.displayName, groupName });
});

// ─── Onboarding routes ────────────────────────────────────────────────────────

app.get('/api/onboardings', auth, requireModule('onboarding'), async (req, res) => {
  const db = await getDB();
  const { status, limit } = req.query;
  const isAdmin = req.user.role === 'admin';
  let sql = `SELECT * FROM onboardings WHERE is_mock=?`;
  const params = [MOCK_GRAPH ? 1 : 0];
  if (!isAdmin) { sql += ` AND created_by=?`; params.push(req.user.id); }
  if (status) { sql += ` AND status=?`; params.push(status); }
  sql += ` ORDER BY created_at DESC`;
  if (limit) {
    const n = parseInt(limit, 10);
    if (Number.isInteger(n) && n > 0) { sql += ` LIMIT ?`; params.push(Math.min(n, 200)); }
  }
  const rows = dbRows(db, sql, params);
  rows.forEach(r => delete r.temp_password);
  res.json(rows);
});

app.get('/api/onboardings/:id', auth, requireModule('onboarding'), async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
  const db = await getDB();
  const onb = dbRow(db, `SELECT * FROM onboardings WHERE id=?`, [req.params.id]);
  if (!onb) return res.status(404).json({ error: 'Onboarding introuvable' });
  if (req.user.role !== 'admin' && onb.created_by !== req.user.id)
    return res.status(403).json({ error: 'Accès refusé' });
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

// Suppression définitive d'une entrée d'historique — réservée au super-admin (pas aux admins
// classiques) car irréversible : ne supprime que la ligne applicative, jamais le compte M365
// réel côté Azure AD (à faire séparément si besoin, cf. Offboarding).
app.delete('/api/onboardings/:id', auth, requireSuperAdmin, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
  const db = await getDB();
  const onb = dbRow(db, `SELECT id, employee_email FROM onboardings WHERE id=?`, [req.params.id]);
  if (!onb) return res.status(404).json({ error: 'Onboarding introuvable' });
  db.run(`DELETE FROM onboarding_steps WHERE onboarding_id=?`, [req.params.id]);
  db.run(`DELETE FROM onboardings WHERE id=?`, [req.params.id]);
  saveDB();
  logAction(`[${req.params.id}] 🗑️ Historique supprimé par ${req.user.email} (${onb.employee_email})`);
  res.json({ ok: true });
});

app.post('/api/onboardings', auth, requireModule('onboarding'), async (req, res) => {
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
        const okConvention = grp && isPrimaryGroupName(cfgDb, grp.displayName);
        if (!okSecurity || !okConvention)
          return res.status(400).json({ error: 'Groupe non autorisé (groupe principal « SP - {poste} {pays} » ou groupe configuré requis)' });
      }
      if (req.user.role !== 'admin') {
        const refusal = await operatorGroupError(cfgDb, { groupId, jobRole, location });
        if (refusal) {
          logAction(`[onboarding] Groupe refusé pour l'opérateur ${req.user.email} : ${groupName} (poste « ${String(jobRole || '').slice(0, 64)} », pays « ${String(location || '').slice(0, 64)} »)`);
          return res.status(403).json({ error: refusal });
        }
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

app.get('/api/stats', auth, requireModule('onboarding'), async (req, res) => {
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

app.get('/api/admin/settings', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
  const db = await getDB();
  const rows = dbRows(db, `SELECT key, value FROM settings WHERE key IN (${Object.keys(SETTINGS_MAP).map(() => '?').join(',')})`, Object.keys(SETTINGS_MAP));
  const dbMap = Object.fromEntries(rows.map(r => [r.key, r.value]));

  res.json({
    azure_tenant_id:        process.env.AZURE_TENANT_ID || '', // lecture seule (.env)
    azure_client_id:        process.env.AZURE_CLIENT_ID || '', // lecture seule (.env)
    azure_client_secret_set: !!process.env.AZURE_CLIENT_SECRET,
    default_domain:         dbMap.default_domain         || process.env.DEFAULT_DOMAIN       || '',
    usage_location:         dbMap.usage_location         || process.env.USAGE_LOCATION       || 'FR',
    launch_password_set:           !!process.env.LAUNCH_PASSWORD,
    force_change_password:         dbMap.force_change_password         || process.env.FORCE_CHANGE_PASSWORD || 'true',
    sharepoint_global_groups:  JSON.parse(dbMap.sharepoint_global_groups  || process.env.SP_GLOBAL_GROUPS              || '[]'),
    global_shared_mailboxes:   JSON.parse(dbMap.global_shared_mailboxes   || process.env.GLOBAL_SHARED_MAILBOXES       || '[]'),
    department_shared_mailboxes: JSON.parse(dbMap.department_shared_mailboxes || process.env.DEPARTMENT_SHARED_MAILBOXES || '[]'),
    sharepoint_country_groups: JSON.parse(dbMap.sharepoint_country_groups || process.env.SP_COUNTRY_GROUPS             || '[]'),
    communication_groups:      JSON.parse(dbMap.communication_groups      || process.env.SP_COMMUNICATION_GROUPS       || '[]'),
    pointage_assignments:      JSON.parse(dbMap.pointage_assignments      || process.env.SP_POINTAGE_ASSIGNMENTS            || '[]'),
    pointage_comm_assignments: JSON.parse(dbMap.pointage_comm_assignments || process.env.SP_POINTAGE_COMM_ASSIGNMENTS  || '[]'),
    pointage_departments:      JSON.parse(dbMap.pointage_departments      || process.env.SP_POINTAGE_DEPARTMENTS        || '[]'),
    department_assignments:    JSON.parse(dbMap.department_assignments    || process.env.SP_DEPARTMENT_ASSIGNMENTS      || '[]'),
    locations:                 JSON.parse(dbMap.locations                 || process.env.ORG_LOCATIONS                || DEFAULT_ORG_LOCATIONS),
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
    if (key === 'global_shared_mailboxes' || key === 'department_shared_mailboxes') {
      for (const m of v) {
        if (!m || typeof m.email !== 'string' || m.email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email))
          return `adresse de boîte partagée invalide : ${String(m && m.email).slice(0, 60)}`;
        for (const f of ['label', 'name']) {
          if (typeof m[f] === 'string' && m[f].length > 256) return `champ "${f}" trop long`;
        }
        for (const f of ['countries', 'departments']) {
          if (m[f] != null && (!Array.isArray(m[f]) || m[f].length > 50 || m[f].some(x => typeof x !== 'string' || x.length > 128)))
            return `champ "${f}" invalide`;
        }
        if (m.location != null && m.location !== 'ALL' && m.location !== 'DEFAULT') return 'champ "location" invalide';
        if (key === 'department_shared_mailboxes' && m.location === 'DEFAULT' && !(Array.isArray(m.countries) && m.countries.length > 0))
          return 'une boîte non globale doit avoir au moins un pays';
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

app.put('/api/admin/settings', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
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
  res.json({ ok: true });
});

// ─── Monitoring : usage des outils IA ─────────────────────────────────────────
// Le workflow n8n « superviser les IA » pousse chaque mois ses résultats (Claude, ChatGPT,
// Fireflies) ; l'app les stocke et les classe (statut, niveau d'alerte, pays) pour l'affichage.

const aiUsage = require('./lib/aiUsage');
const spSync = require('./lib/sharepointSync');

function monitoringIngestConfigured() {
  const t = process.env.MONITORING_INGEST_TOKEN;
  return !!t && t.length >= 24;
}

// Appel machine-à-machine (pas de cookie de session) : authentifié par un jeton partagé défini
// uniquement dans .env. Désactivé tant que le jeton n'est pas configuré (24 caractères minimum).
// Pas de limiteur par IP volontairement : derrière un reverse proxy toutes les requêtes partagent
// la même IP, et un anonyme pourrait alors épuiser le quota et bloquer l'envoi légitime de n8n.
// Un jeton de 24+ caractères rend le brute-force irréaliste.
app.post('/api/monitoring/ai-usage/ingest', async (req, res) => {
  if (!monitoringIngestConfigured()) return res.status(503).json({ error: 'Ingestion non configurée' });
  const bearer = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  const digest = s => createHash('sha256').update(String(s)).digest();
  if (!bearer || !timingSafeEqual(digest(bearer[1]), digest(process.env.MONITORING_INGEST_TOKEN))) {
    logAction(`[monitoring] Ingestion refusée — jeton invalide`);
    return res.status(401).json({ error: 'Non autorisé' });
  }
  let parsed;
  try {
    parsed = aiUsage.parsePayload(req.body);
  } catch (e) {
    return res.status(e.httpStatus || 400).json({ error: e.message });
  }
  const db = await getDB();
  aiUsage.ingest(db, parsed, { isMock: MOCK_GRAPH });
  saveDB();
  logAction(`[monitoring] ${parsed.tool} ${parsed.month} : ${parsed.rows.length} ligne(s) reçue(s)`);
  res.json({ ok: true, tool: parsed.tool, month: parsed.month, rows: parsed.rows.length });
});

app.get('/api/monitoring/ai-usage', auth, requireModule('monitoring'), async (req, res) => {
  const db = await getDB();
  const data = aiUsage.dashboard(db, { isMock: MOCK_GRAPH });
  // Configuration technique (jeton, SharePoint, démo) : réservée aux administrateurs.
  if (req.user.role !== 'admin') return res.json({ ...data, readOnly: true });
  res.json({
    ...data,
    ingestConfigured: monitoringIngestConfigured(),
    sharepoint: { ...spSync.status(), settings: spSync.settingsView() },
    demoAvailable: MOCK_GRAPH,
  });
});

// Relit les rapports Excel dans SharePoint (lecture seule, app Entra dédiée) et met à jour le monitoring.
async function syncMonitoringFromSharePoint(trigger) {
  const db = await getDB();
  const out = await spSync.syncAll(db, { isMock: MOCK_GRAPH, trigger });
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('monitoring_sync_history', ?)", [JSON.stringify(spSync.status().history)]);
  saveDB();
  for (const r of out.results) {
    logAction(r.ok ? `[monitoring] SharePoint (${trigger}) ${r.tool} : ${r.months.length} mois synchronisé(s)` : `[monitoring] SharePoint (${trigger}) ${r.tool} : échec — ${r.error}`);
  }
  return out;
}

app.put('/api/monitoring/ai-usage/sharepoint-settings', auth, requireRole('admin'), requireModule('monitoring'), async (req, res) => {
  let parsed;
  try {
    parsed = spSync.parseSettings(req.body);
  } catch (e) {
    return res.status(e.httpStatus || 400).json({ error: e.message });
  }
  const db = await getDB();
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('monitoring_sharepoint', ?)", [JSON.stringify(parsed)]);
  saveDB();
  spSync.setOverride(parsed);
  logAction(`[monitoring] Emplacement SharePoint modifié par ${req.user.email}`);
  res.json({ ok: true, settings: spSync.settingsView() });
});

const monitoringSyncLimiter = makeLimiter(10, { keyGenerator: (req) => req.user.id });
app.post('/api/monitoring/ai-usage/sync', auth, requireRole('admin'), requireModule('monitoring'), monitoringSyncLimiter, async (req, res) => {
  if (MOCK_GRAPH) return res.status(403).json({ error: 'Indisponible en mode développement (Graph simulé)' });
  try {
    res.json(await syncMonitoringFromSharePoint(req.user.email));
  } catch (e) {
    res.status(e.httpStatus || 500).json({ error: e.httpStatus ? e.message : 'Synchronisation impossible' });
  }
});

// Historique des synchronisations (page Notifications) : supprimer une entrée (par sa date) ou tout effacer.
async function saveSyncHistory() {
  const db = await getDB();
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('monitoring_sync_history', ?)", [JSON.stringify(spSync.status().history)]);
  saveDB();
}
app.delete('/api/monitoring/ai-usage/sync-history', auth, requireRole('admin'), requireModule('monitoring'), async (req, res) => {
  const n = spSync.removeHistory();
  await saveSyncHistory();
  logAction(`[monitoring] Historique des synchronisations effacé par ${req.user.email} (${n} entrée(s))`);
  res.json({ ok: true, removed: n });
});
app.delete('/api/monitoring/ai-usage/sync-history/:at', auth, requireRole('admin'), requireModule('monitoring'), async (req, res) => {
  const n = spSync.removeHistory(String(req.params.at));
  if (!n) return res.status(404).json({ error: 'Entrée introuvable (déjà supprimée ?)' });
  await saveSyncHistory();
  logAction(`[monitoring] Entrée de l'historique des synchronisations supprimée par ${req.user.email}`);
  res.json({ ok: true, removed: n });
});

app.put('/api/monitoring/ai-usage/prices',auth, requireRole('admin'), requireModule('monitoring'), async (req, res) => {
  const db = await getDB();
  let prices;
  try {
    prices = aiUsage.savePrices(db, req.body);
  } catch (e) {
    return res.status(e.httpStatus || 400).json({ error: e.message });
  }
  saveDB();
  logAction(`[monitoring] Prix des licences mis à jour par ${req.user.email}`);
  res.json({ ok: true, prices });
});

// Pays proposés dans le filtre du tableau de bord (libellé + autres écritures trouvées dans la colonne « Pays » des rapports).
app.put('/api/monitoring/ai-usage/countries', auth, requireRole('admin'), requireModule('monitoring'), async (req, res) => {
  const db = await getDB();
  let countries;
  try {
    countries = aiUsage.saveCountries(db, req.body);
  } catch (e) {
    return res.status(e.httpStatus || 400).json({ error: e.message });
  }
  saveDB();
  logAction(`[monitoring] Liste des pays mise à jour par ${req.user.email} : ${countries.map(c => c.name).join(', ')}`);
  res.json({ ok: true, countries });
});

app.get('/api/monitoring/ai-usage/summary', auth, requireModule('monitoring'), async (req, res) => {
  const db = await getDB();
  res.json(aiUsage.summary(db, { isMock: MOCK_GRAPH }));
});

// Données fictives, uniquement en mode développement (MOCK_GRAPH) — jamais sur la prod.
app.post('/api/monitoring/ai-usage/demo', auth, requireRole('admin'), requireModule('monitoring'), async (req, res) => {
  if (!MOCK_GRAPH) return res.status(403).json({ error: 'Disponible uniquement en mode développement' });
  const db = await getDB();
  const rows = aiUsage.seedDemo(db);
  saveDB();
  res.json({ ok: true, rows });
});

// ─── Admin: Users ─────────────────────────────────────────────────────────────

app.get('/api/admin/users', auth, requireRole('admin'), requireSuperAdmin, async (req, res) => {
  const db = await getDB();
  const users = dbRows(db, `SELECT id, name, email, role, status, created_at, modules, entra_oid FROM users ORDER BY name`);
  res.json(users.map(({ modules, entra_oid, ...u }) => ({
    ...u,
    microsoftLinked: !!entra_oid, // l'identifiant lui-même n'est jamais renvoyé
    modules: modulesFor({ role: u.role, email: u.email, modules }),
    superAdmin: isSuperAdmin(u),
  })));
});

// Accès aux modules du portail, utilisateur par utilisateur (les administrateurs ont accès à tout).
app.put('/api/admin/users/:id/modules', auth, requireRole('admin'), requireSuperAdmin, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
  let modules;
  try {
    modules = parseModules(req.body?.modules);
  } catch (e) {
    return res.status(e.httpStatus || 400).json({ error: e.message });
  }
  const db = await getDB();
  const target = dbRow(db, `SELECT id, email, role FROM users WHERE id=?`, [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (isSuperAdmin(target)) return res.status(400).json({ error: 'Un super administrateur a toujours accès à tous les modules' });
  db.run(`UPDATE users SET modules=? WHERE id=?`, [JSON.stringify(modules), target.id]);
  saveDB();
  logAction(`[portail] Accès de ${target.email} : ${modules.join(', ') || 'aucun module'} (par ${req.user.email})`);
  res.json({ id: target.id, modules });
});

app.post('/api/admin/users', auth, requireRole('admin'), requireSuperAdmin, async (req, res) => {
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

  // Modules du portail accordés dès la création (absent = accès par défaut ; ignoré pour un admin)
  let modulesJson = null;
  if (req.body.modules !== undefined && wantRole !== 'admin') {
    try { modulesJson = JSON.stringify(parseModules(req.body.modules)); }
    catch (e) { return res.status(e.httpStatus || 400).json({ error: e.message }); }
  }

  const id = uuidv4();
  let hash = null;

  if (password) {
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    hash = await hashPassword(password);
  }
  // Sans mot de passe : compte actif, la personne se connecte par Microsoft.

  db.run(
    `INSERT INTO users (id, name, email, role, password_hash, status, modules) VALUES (?,?,?,?,?,?,?)`,
    [id, name, normalizeEmail(email), wantRole, hash, 'active', modulesJson]
  );
  saveDB();

  const user = dbRow(db, `SELECT id, name, email, role, status FROM users WHERE id=?`, [id]);

  res.status(201).json({ user });
});

app.put('/api/admin/users/:id', auth, requireRole('admin'), requireSuperAdmin, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
  const { name, email, role, status } = req.body;
  if (email != null && !isValidEmail(normalizeEmail(email)))
    return res.status(400).json({ error: 'Adresse email invalide' });
  const db = await getDB();
  const current = dbRow(db, `SELECT status, role, email FROM users WHERE id=?`, [req.params.id]);
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
  // Nouvelle adresse = peut-être une autre personne : le lien avec le compte Microsoft est remis à zéro
  // (il sera refait à la prochaine connexion SSO avec la nouvelle adresse).
  if (email && normalizeEmail(email) !== current.email)
    db.run(`UPDATE users SET entra_oid=NULL WHERE id=?`, [req.params.id]);
  // Invalider les sessions actives si rôle ou statut modifié
  if (role != null || status != null)
    db.run(`DELETE FROM sessions WHERE user_id=?`, [req.params.id]);
  saveDB();
  res.json(dbRow(db, `SELECT id, name, email, role, status FROM users WHERE id=?`, [req.params.id]));
});

// Délie le compte Microsoft (oid) : la prochaine connexion SSO avec l'adresse du compte le reliera de nouveau.
// Utile si le compte Entra de la personne a été recréé (nouvel oid).
app.delete('/api/admin/users/:id/microsoft-link', auth, requireRole('admin'), requireSuperAdmin, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
  const db = await getDB();
  const target = dbRow(db, `SELECT id, email FROM users WHERE id=?`, [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  db.run(`UPDATE users SET entra_oid=NULL WHERE id=?`, [target.id]);
  db.run(`DELETE FROM sessions WHERE user_id=?`, [target.id]);
  saveDB();
  logAction(`[AUTH] Compte Microsoft délié de ${target.email} par ${req.user.email}`);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', auth, requireRole('admin'), requireSuperAdmin, async (req, res) => {
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

app.put('/api/admin/users/:id/reset-password', auth, requireRole('admin'), requireSuperAdmin, async (req, res) => {
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
  { re: /\[monitoring\] Ingestion refusée/,           type: 'danger',  label: 'Ingestion monitoring refusée' },
  { re: /\[AUTH\] SSO Microsoft (échec|refusé|non configuré|— compte)/, type: 'danger', label: 'Échec connexion Microsoft' },
  { re: /\[AUTH\] Mot de passe refusé — connexion Microsoft obligatoire/, type: 'warning', label: 'Mot de passe refusé (SSO obligatoire)' },
  { re: /\[portail\] Accès de /,                      type: 'info',    label: 'Accès aux modules modifié' },
];

app.get('/api/admin/security-events', auth, requireRole('admin'), requireModule('onboarding'), (req, res) => {
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

app.get('/api/admin/security-events/archive', auth, requireRole('admin'), requireModule('onboarding'), (req, res) => {
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

// Effacer tout ou partie du journal de sécurité : réservé au super admin (comme la suppression d'historique), pour qu'un
// admin ordinaire ne puisse pas effacer les traces de sa propre activité (audit, constat n° 7). L'archivage reste ouvert aux admins.
app.delete('/api/admin/security-events', auth, requireRole('admin'), requireSuperAdmin, requireModule('onboarding'), (req, res) => {
  try {
    fs.writeFileSync(LOG_FILE, '');
    logAction(`Journal de sécurité effacé par ${req.user.email}`);
    res.json({ ok: true });
  } catch (_) {
    res.status(500).json({ error: "Impossible d'effacer le journal" });
  }
});

app.delete('/api/admin/security-events/selection', auth, requireRole('admin'), requireSuperAdmin, requireModule('onboarding'), (req, res) => {
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

// ─── Exchange PowerShell helper ───────────────────────────────────────────────

const { spawn } = require('child_process');

function runExchangeScript(params) {
  return new Promise((resolve, reject) => {
    const EXCHANGE_APP_ID       = process.env.EXCHANGE_APP_ID;
    const EXCHANGE_CERT_PASSWORD = process.env.EXCHANGE_CERT_PASSWORD;

    if (!EXCHANGE_APP_ID || !EXCHANGE_CERT_PASSWORD) {
      return reject(new Error('EXCHANGE_APP_ID ou EXCHANGE_CERT_PASSWORD non configuré'));
    }

    const isValidEmail = v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
    const isValidGuid  = v => /^[0-9a-f-]{36}$/i.test(v);

    if (!['AddDistributionMember','SetSharedMailbox','AddMailboxPermission'].includes(params.Action)) {
      return reject(new Error(`Action Exchange invalide : ${params.Action}`));
    }
    if (params.Identity && !isValidEmail(params.Identity) && !isValidGuid(params.Identity)) return reject(new Error('Identity invalide'));
    if (params.Member   && !isValidEmail(params.Member))   return reject(new Error('Member invalide'));
    if (params.User     && !isValidEmail(params.User))     return reject(new Error('User invalide'));

    const args = [
      '/opt/scripts/exchange.ps1',
      '-Action',   params.Action,
      '-Identity', params.Identity,
    ];
    if (params.Member) args.push('-Member', params.Member);
    if (params.User)   args.push('-User',   params.User);

    const env = {
      ...process.env,
      EXCHANGE_APP_ID,
      EXCHANGE_CERT_PASSWORD,
    };

    const proc = spawn('pwsh', args, { env });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `pwsh exit ${code}`));
    });
    proc.on('error', reject);
  });
}

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
    'Conversion en boîte partagée',
    'Accès à la boîte partagée',
    "Configuration du transfert d'emails",
    'Révocation de la licence',
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

    // 5 ── Conversion en Shared Mailbox (avant révocation licence !)
    offboardStep(job, 'Conversion en boîte partagée', 'running');
    if (MOCK_GRAPH) {
      await sleep(MOCK_DELAY * 0.8);
      offboardStep(job, 'Conversion en boîte partagée', 'done', 'Boîte convertie en shared mailbox (mock)');
    } else {
      try {
        await runExchangeScript({ Action: 'SetSharedMailbox', Identity: job.targetEmail });
        offboardStep(job, 'Conversion en boîte partagée', 'done', 'Boîte convertie en shared mailbox');
        logAction(`[OFFBOARD][${jobId}] ✅ Boîte convertie en shared mailbox`);
      } catch (e) {
        offboardStep(job, 'Conversion en boîte partagée', 'failed', e.message);
        logAction(`[OFFBOARD][${jobId}] ❌ Conversion shared mailbox : ${e.message}`);
        throw e;
      }
    }

    // 6 ── Accès à la boîte partagée (avant révocation licence !)
    offboardStep(job, 'Accès à la boîte partagée', 'running');
    if (MOCK_GRAPH) {
      await sleep(MOCK_DELAY * 0.5);
      offboardStep(job, 'Accès à la boîte partagée', job.accessTo ? 'done' : 'skipped', job.accessTo ? `Accès accordé à ${job.accessTo} (mock)` : 'Aucun accès supplémentaire configuré');
    } else if (job.accessTo) {
      try {
        await runExchangeScript({ Action: 'AddMailboxPermission', Identity: job.targetEmail, User: job.accessTo });
        offboardStep(job, 'Accès à la boîte partagée', 'done', `Accès complet accordé à ${job.accessTo}`);
        logAction(`[OFFBOARD][${jobId}] ✅ Accès boîte accordé à ${job.accessTo}`);
      } catch (e) {
        offboardStep(job, 'Accès à la boîte partagée', 'failed', e.message);
        logAction(`[OFFBOARD][${jobId}] ❌ Accès boîte : ${e.message}`);
        throw e;
      }
    } else {
      offboardStep(job, 'Accès à la boîte partagée', 'skipped', 'Aucun accès supplémentaire configuré');
    }

    // 7 ── Transfert d'emails (règle inbox, copie conservée — optionnel)
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

    // 8 ── Révocation de la licence (en dernier — après conversion boîte partagée)
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

app.post('/api/offboarding', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
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
  await saveOffboardingRecord(offboardingJobs.get(jobId), req.user.name); // visible dans l'historique dès le lancement
  executeOffboarding(jobId).catch(err => {
    logAction(`[OFFBOARD][${jobId}] Fatal : ${err.message}`);
    const job = offboardingJobs.get(jobId);
    if (job) { job.status = 'failed'; job.error = err.message; }
  }).finally(() => saveOffboardingRecord(offboardingJobs.get(jobId), req.user.name)); // résultat final (étapes, groupes retirés, erreur)
  res.json({ id: jobId });
});

// Historique des offboardings : l'état d'un job vit en mémoire pendant son exécution ; cette ligne en garde une trace durable
// (qui, quand, quelles étapes, quels groupes retirés, quelle erreur). Écrite au lancement puis mise à jour à la fin.
async function saveOffboardingRecord(job, initiatedByName) {
  if (!job) return;
  try {
    const db = await getDB();
    const finished = job.status === 'done' || job.status === 'failed';
    db.run(`INSERT OR IGNORE INTO offboardings
      (id, target_email, access_to, transfer_emails, status, initiated_by, initiated_by_name, is_mock, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [job.id, job.targetEmail, job.accessTo || null, job.transferEmails ? 1 : 0, job.status, job.initiatedBy || null,
       initiatedByName || null, MOCK_GRAPH ? 1 : 0, String(job.createdAt || new Date().toISOString()).replace('T', ' ').slice(0, 19)]);
    db.run(`UPDATE offboardings SET target_name=?, status=?, error=?, steps=?, removed_groups=?, completed_at=? WHERE id=?`,
      [job.displayName || null, job.status, job.error ? String(job.error).slice(0, 500) : null,
       JSON.stringify(job.steps || []), JSON.stringify(job.removedGroups || []),
       finished ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null, job.id]);
    saveDB();
  } catch (e) {
    console.error("[offboarding] enregistrement de l'historique impossible :", e.message); // ne bloque jamais l'offboarding
  }
}

// Liste pour la page Historique (admins). Même séparation simulé / réel que les onboardings.
app.get('/api/offboardings', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
  const db = await getDB();
  const { status, limit } = req.query;
  let sql = `SELECT * FROM offboardings WHERE is_mock=?`;
  const params = [MOCK_GRAPH ? 1 : 0];
  if (status) { sql += ` AND status=?`; params.push(String(status)); }
  sql += ` ORDER BY created_at DESC`;
  const n = parseInt(limit, 10);
  sql += ` LIMIT ?`; params.push(Number.isInteger(n) && n > 0 ? Math.min(n, 500) : 200);
  const parse = (v, fallback) => { try { return JSON.parse(v); } catch (_) { return fallback; } };
  res.json(dbRows(db, sql, params).map(r => ({
    ...r, transfer_emails: !!r.transfer_emails, steps: parse(r.steps, []), removed_groups: parse(r.removed_groups, []),
  })));
});

// Suppression d'une ligne d'historique : super administrateur uniquement (comme pour les onboardings).
app.delete('/api/offboardings/:id', auth, requireSuperAdmin, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
  const db = await getDB();
  const row = dbRow(db, `SELECT id, target_email FROM offboardings WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Offboarding introuvable' });
  db.run(`DELETE FROM offboardings WHERE id=?`, [req.params.id]);
  saveDB();
  logAction(`[OFFBOARD][${req.params.id}] 🗑️ Historique supprimé par ${req.user.email} (${row.target_email})`);
  res.json({ ok: true });
});

app.get('/api/offboarding/:id', auth, requireRole('admin'), requireModule('onboarding'), (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'ID invalide' });
  const job = offboardingJobs.get(id);
  if (!job) return res.status(404).json({ error: 'Job introuvable' });
  res.json(job);
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

app.get('/api/users/graph-search', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
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
    const safe = [...String(q)].filter(c => /[\p{L}\p{N} .\-@]/u.test(c)).join('').slice(0, 128).trim();
    if (safe.length < 2) return res.json([]);
    const encoded = encodeURIComponent(safe);
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

// ─── Accès aux boîtes partagées (à la demande, pour un employé existant) ─────

// Boîtes configurées (Administration → Groupes → Boîtes partagées), dédoublonnées par adresse.
async function configuredMailboxes() {
  const db = await getDB();
  const read = key => { try { return JSON.parse(dbRow(db, `SELECT value FROM settings WHERE key=?`, [key])?.value || '[]'); } catch (_) { return []; } };
  const byEmail = new Map();
  for (const m of [...read('global_shared_mailboxes').map(x => ({ ...x, location: 'ALL' })), ...read('department_shared_mailboxes')]) {
    if (!m || typeof m.email !== 'string' || !m.email) continue;
    const key = m.email.toLowerCase();
    if (byEmail.has(key)) continue;
    const scope = m.location === 'ALL'
      ? 'Tous les employés'
      : [(m.countries || []).join(', '), (m.departments || []).join(', ')].filter(Boolean).join(' · ');
    byEmail.set(key, { email: key, name: m.name || m.label || m.email, scope });
  }
  return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
}

app.get('/api/shared-mailboxes', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
  res.json(await configuredMailboxes());
});

app.post('/api/shared-mailboxes/grant', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
  const { email, mailboxes } = req.body || {};
  if (!isValidEmail(typeof email === 'string' ? email.trim() : ''))
    return res.status(400).json({ error: 'Email de la personne invalide' });
  if (!Array.isArray(mailboxes) || mailboxes.length === 0 || mailboxes.length > 50 || mailboxes.some(m => typeof m !== 'string'))
    return res.status(400).json({ error: 'Sélectionne au moins une boîte partagée' });

  // Seules les boîtes configurées par un admin peuvent être attribuées (jamais une adresse libre).
  const allowed = new Map((await configuredMailboxes()).map(m => [m.email, m]));
  const wanted = [...new Set(mailboxes.map(m => m.trim().toLowerCase()))];
  const unknown = wanted.filter(m => !allowed.has(m));
  if (unknown.length) return res.status(400).json({ error: `Boîte(s) non configurée(s) : ${unknown.slice(0, 3).join(', ')}` });

  let displayName = email.trim();
  let upn = email.trim();
  if (!MOCK_GRAPH) {
    try {
      const { graphFetch } = require('./lib/graph');
      const u = await graphFetch(`/users/${encodeURIComponent(email.trim())}?$select=id,displayName,userPrincipalName`);
      displayName = u.displayName || displayName;
      upn = u.userPrincipalName || upn;
    } catch (e) {
      if (e.graphStatus === 404) return res.status(404).json({ error: 'Utilisateur introuvable dans Azure AD' });
      logAction(`[mailbox-access] ❌ Lookup AD ${email} : ${e.message}`);
      return res.status(502).json({ error: 'Microsoft Graph indisponible' });
    }
  }

  const results = [];
  for (const mb of wanted) {
    const meta = allowed.get(mb);
    if (MOCK_GRAPH) { results.push({ email: mb, name: meta.name, status: 'mock' }); continue; }
    const r = await grantMailboxAccess(upn, mb, meta.name, `[mailbox-access] ${req.user.email} →`);
    // Le détail technique reste dans les logs : on ne renvoie pas le message brut d'Exchange.
    results.push({ email: mb, name: meta.name, status: r.status, ...(r.status === 'error' ? { error: 'Échec Exchange (voir les logs serveur)' } : {}) });
  }
  res.json({ ok: results.every(r => r.status !== 'error'), displayName, results });
});

// ─── Admin: Onboarding schema ─────────────────────────────────────────────────

const SCHEMA_DEFAULTS = {
  step2_group:     { enabled: true },
  step3_license:   { enabled: true, retry_delays: [15, 30, 45, 60, 90] },
  step4_sp_groups: { enabled: true },
};

app.get('/api/admin/schema', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
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

app.put('/api/admin/schema', auth, requireRole('admin'), requireModule('onboarding'), async (req, res) => {
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
  // Erreurs du parseur de corps : c'est la faute de l'appelant, pas du serveur (utile à n8n).
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Corps de requête trop volumineux' });
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

  // Onboardings interrompus en plein traitement (redémarrage serveur pendant l'exécution) :
  // on ne peut pas savoir où ça s'est arrêté côté Graph, donc on marque en échec plutôt que
  // de risquer un double traitement (création de compte en double, etc.).
  const stale = dbRows(db, `SELECT id FROM onboardings WHERE status='running'`);
  stale.forEach(({ id }) => {
    db.run(`UPDATE onboardings SET status='failed', error_message='Interrompu (redémarrage serveur)' WHERE id=?`, [id]);
    db.run(
      `UPDATE onboarding_steps SET status='failed', error_message='Interrompu' WHERE onboarding_id=? AND status='running'`,
      [id]
    );
  });
  if (stale.length) saveDB();
  if (stale.length) console.log(`[startup] ${stale.length} onboarding(s) interrompu(s) marqué(s) comme échoués`);

  // Offboardings interrompus par un redémarrage : l'état en mémoire est perdu, on ne sait pas jusqu'où ils sont allés.
  const staleOff = dbRows(db, `SELECT id FROM offboardings WHERE status='running'`);
  staleOff.forEach(({ id }) => db.run(`UPDATE offboardings SET status='failed', error='Interrompu (redémarrage serveur) : vérifier l''état du compte dans Microsoft 365', completed_at=datetime('now') WHERE id=?`, [id]));
  if (staleOff.length) { saveDB(); console.log(`[startup] ${staleOff.length} offboarding(s) interrompu(s) marqué(s) comme échoués`); }

  // Reprise uniquement des onboardings récents (< 24 h) : relancer des semaines plus tard
  // créerait des comptes ou enverrait des invitations que personne n'attend. Les plus anciens
  // sont marqués en échec, de façon visible, avec la marche à suivre.
  const RESUME_MAX_DAYS = 1;

  // Onboardings créés juste avant un redémarrage, jamais démarrés (statut 'pending' — la
  // première étape n'a encore rien touché côté Graph) : sans danger de doublon, on relance
  // simplement leur traitement.
  // Filtré sur is_mock : un process réel ne doit jamais reprendre des lignes de démo, ni l'inverse.
  const mock = MOCK_GRAPH ? 1 : 0;
  const orphaned = dbRows(db, `SELECT id, julianday('now') - julianday(created_at) AS age_days FROM onboardings WHERE status='pending' AND is_mock=?`, [mock]);
  let resumed = 0;
  for (const { id, age_days } of orphaned) {
    if (age_days < RESUME_MAX_DAYS) {
      logAction(`[${id}] [startup] Reprise d'un onboarding resté en attente (redémarrage serveur)`);
      executeOnboarding(id).catch(err => console.error('[executeOnboarding][resume]', err));
      resumed++;
    } else {
      db.run(`UPDATE onboardings SET status='failed', error_message=? WHERE id=?`,
        ["Jamais démarré (redémarrage serveur) — à relancer manuellement si besoin", id]);
      db.run(`UPDATE onboarding_steps SET status='failed', error_message='Interrompu' WHERE onboarding_id=? AND status='running'`, [id]);
    }
  }
  if (orphaned.length) { saveDB(); console.log(`[startup] ${resumed}/${orphaned.length} onboarding(s) en attente relancé(s)`); }

  // Onboardings en 'partial' : compte et licence sont prêts, mais la phase groupes/GitHub/Teams,
  // lancée 60 s plus tard par un minuteur en mémoire, n'a pas abouti (redémarrage ou crash du
  // serveur entre-temps). Le frontend les affichait à tort « En attente ».
  const partial = dbRows(db, `SELECT id, employee_ad_id, employee_email, julianday('now') - julianday(created_at) AS age_days FROM onboardings WHERE status='partial' AND is_mock=?`, [mock]);
  if (partial.length) {
    const schemaRow = dbRow(db, `SELECT value FROM settings WHERE key='onboarding_schema'`);
    const schema = (() => { try { return schemaRow ? JSON.parse(schemaRow.value) : {}; } catch (_) { return {}; } })();
    const step4Enabled = schema.step4_sp_groups?.enabled !== false;
    let resumedBg = 0;
    for (const p of partial) {
      if (p.employee_ad_id && p.age_days < RESUME_MAX_DAYS) {
        logAction(`[${p.id}] [startup] Reprise de la phase groupes/GitHub interrompue (redémarrage serveur)`);
        executeOnboardingBackground(p.id, p.employee_ad_id, p.employee_email, step4Enabled)
          .catch(err => markBackgroundFailed(p.id, err));
        resumedBg++;
      } else {
        db.run(`UPDATE onboardings SET status='failed', error_message=? WHERE id=?`,
          ["Phase groupes/GitHub interrompue (redémarrage serveur) — compte et licence créés ; compléter via « Onboarding manuel »", p.id]);
        db.run(`UPDATE onboarding_steps SET status='failed', error_message='Interrompu' WHERE onboarding_id=? AND status='running'`, [p.id]);
      }
    }
    saveDB();
    console.log(`[startup] ${resumedBg}/${partial.length} onboarding(s) partiel(s) repris`);
  }
}

// Rappel d'invitation GitHub : renvoie une invitation 7 jours après la création, pour les
// onboardings dont la première invitation a réussi mais qui n'ont pas encore reçu de rappel.
// Basé sur la date en base (pas un setTimeout) pour survivre aux redémarrages du serveur.
async function sendDueGithubReminders() {
  if (MOCK_GRAPH || !process.env.GITHUB_TOKEN) return;
  const db = await getDB();
  const due = dbRows(db, `
    SELECT id, employee_email FROM onboardings
    WHERE github_invited=1 AND github_reminder_sent_at IS NULL AND is_mock=0
      AND datetime(created_at, '+7 days') <= datetime('now')
  `);
  if (!due.length) return;
  for (const { id, employee_email } of due) {
    logAction(`[${id}] [github-reminder] Rappel d'invitation GitHub pour ${employee_email}...`);
    await sendGithubInvite(employee_email, `[${id}] [github-reminder]`);
    db.run(`UPDATE onboardings SET github_reminder_sent_at=datetime('now') WHERE id=?`, [id]);
    saveDB();
  }
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
  sendDueGithubReminders().catch(err => console.error('[github-reminder]', err));
  setInterval(() => sendDueGithubReminders().catch(err => console.error('[github-reminder]', err)), 6 * 60 * 60 * 1000);
  try {
    const db = await getDB();
    const row = dbRows(db, "SELECT value FROM settings WHERE key='monitoring_sharepoint'")[0];
    if (row) spSync.setOverride(JSON.parse(row.value));
    const hist = dbRows(db, "SELECT value FROM settings WHERE key='monitoring_sync_history'")[0];
    if (hist) spSync.setHistory(JSON.parse(hist.value));
  } catch (err) { console.error('[monitoring-sync] réglage illisible, valeurs .env utilisées'); }
  if (!MOCK_GRAPH) {
    // Se déclenche seulement si l'emplacement est configuré (.env ou Paramètres), sans redémarrage nécessaire.
    const auto = () => (spSync.isConfigured() ? syncMonitoringFromSharePoint('auto').catch(err => console.error('[monitoring-sync]', err.message)) : null);
    setTimeout(auto, 30 * 1000);
    setInterval(auto, 6 * 60 * 60 * 1000);
  }
  app.listen(PORT, () => {
    console.log(`Onboarding M365 — backend sur http://localhost:${PORT}${MOCK_GRAPH ? ' [MOCK]' : ''}`);
    if (!String(process.env.SUPER_ADMIN_EMAILS || '').trim()) {
      const msg = 'SUPER_ADMIN_EMAILS absent du .env : aucun super administrateur (Gestion du portail inaccessible)';
      console.warn(`⚠️  ${msg}`);
      logAction(`[AUTH] ⚠️ ${msg}`);
    }
  });
});
