// Synchronisation du monitoring depuis les rapports Excel du workflow n8n, stockés dans SharePoint.
// Lecture seule : l'app télécharge `Report.xlsx` de chaque outil via Microsoft Graph et réutilise
// la même validation / le même stockage que l'ingestion n8n (aiUsage.parsePayload / ingest).
//
// Moindre privilège : utiliser une app Entra dédiée avec la seule permission d'application
// `Sites.Selected` (accordée en « read » sur le site concerné, pas sur tout le tenant).
//   MONITORING_SP_DRIVE_ID       identifiant du lecteur (drive) du site — active la fonctionnalité
//   MONITORING_SP_TENANT_ID / MONITORING_SP_CLIENT_ID / MONITORING_SP_CLIENT_SECRET
//                                app dédiée ; à défaut, AZURE_* (déconseillé : app trop privilégiée)
//   MONITORING_SP_PATH_CLAUDE / _CHATGPT / _FIREFLIES   chemin du rapport dans le lecteur
// Les chemins des rapports peuvent aussi être saisis dans Monitoring > Administration ; la valeur saisie
// dans l'app l'emporte sur le .env, qui l'emporte sur les chemins par défaut.
const { ClientSecretCredential } = require('@azure/identity');
const aiUsage = require('./aiUsage');
const { readWorkbook } = require('./xlsx');
const { retryFetch } = require('./netFetch');

const BASE = 'Knowledge/IT knowledge/Management/SI/AI/Captivea France';
const DEFAULT_PATHS = {
  claude:    `${BASE}/Claude/Report/Report.xlsx`,
  chatgpt:   `${BASE}/ChatGPT/Report/Report.xlsx`,
  fireflies: `${BASE}/Fireflies/Report/Rapport Supervision Fireflies.xlsx`,
};
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SHEETS = 12; // les 12 mois les plus récents suffisent (le tableau de bord en affiche 7)

const env = k => (process.env[k] || '').trim();

// Emplacement saisi dans l'app (Monitoring > Paramètres), chargé depuis la base.
let override = { paths: {} };

function setOverride(o) {
  override = { paths: { ...(o?.paths || {}) } };
}

function driveId() {
  return env('MONITORING_SP_DRIVE_ID'); // la bibliothèque se définit uniquement dans le .env
}

function isConfigured() {
  return !!driveId();
}

function invalid(message) {
  return Object.assign(new Error(message), { httpStatus: 400 });
}

// Valide la saisie de l'admin : un chemin vide = retour à la valeur .env / par défaut.
function parseSettings(input) {
  if (!input || typeof input !== 'object') throw invalid('Corps JSON requis');
  const out = { paths: {} };
  for (const tool of Object.keys(aiUsage.TOOLS)) {
    const p = String(input.paths?.[tool] ?? '').trim();
    if (!p) continue;
    const forbiddenChar = [...p].some(c => c.charCodeAt(0) < 32 || c === '\\');
    const badSegment = p.split('/').some(seg => seg === '' || seg === '.' || seg === '..');
    if (p.length > 300 || forbiddenChar || badSegment || !p.toLowerCase().endsWith('.xlsx')) {
      throw invalid(`Chemin invalide pour ${aiUsage.TOOLS[tool].label} : attendu dossier/sous-dossier/fichier.xlsx (pas de « .. », de « \\ » ni de « / » au début)`);
    }
    out.paths[tool] = p;
  }
  return out;
}

// Ce que l'admin a saisi, et ce qui est réellement utilisé (avec son origine).
function settingsView() {
  const paths = {}, sources = { paths: {} };
  for (const tool of Object.keys(aiUsage.TOOLS)) {
    paths[tool] = reportPath(tool);
    sources.paths[tool] = override.paths[tool] ? 'app' : env(`MONITORING_SP_PATH_${tool.toUpperCase()}`) ? 'env' : 'default';
  }
  return { saved: { paths: { ...override.paths } }, effective: { paths }, sources, driveConfigured: isConfigured() };
}

let credential = null;
let credentialKey = '';
function getCredential() {
  const tenant = env('MONITORING_SP_TENANT_ID') || env('AZURE_TENANT_ID');
  const client = env('MONITORING_SP_CLIENT_ID') || env('AZURE_CLIENT_ID');
  const secret = env('MONITORING_SP_CLIENT_SECRET') || env('AZURE_CLIENT_SECRET');
  if (!tenant || !client || !secret) throw new Error('Identifiants Entra manquants pour la lecture SharePoint');
  const key = `${tenant}|${client}|${secret}`;
  if (!credential || key !== credentialKey) { credential = new ClientSecretCredential(tenant, client, secret); credentialKey = key; }
  return credential;
}

function reportPath(tool) {
  const p = override.paths[tool] || env(`MONITORING_SP_PATH_${tool.toUpperCase()}`) || DEFAULT_PATHS[tool];
  if (p.split('/').some(seg => seg === '..' || seg === '.')) throw new Error('Chemin de rapport invalide');
  return p;
}

async function download(tool) {
  const { token } = await getCredential().getToken('https://graph.microsoft.com/.default');
  const drive = encodeURIComponent(driveId());
  const path = reportPath(tool).split('/').map(encodeURIComponent).join('/');
  const res = await retryFetch(`https://graph.microsoft.com/v1.0/drives/${drive}/root:/${path}:/content`, {
    headers: { Authorization: `Bearer ${token}` },
  }, { attemptTimeoutMs: 20000, label: 'SharePoint' });
  if (res.status === 404) throw new Error('Rapport introuvable dans SharePoint (chemin à vérifier)');
  if (res.status === 401 || res.status === 403) throw new Error('Accès SharePoint refusé (permission Sites.Selected à accorder sur le site)');
  if (!res.ok) throw new Error(`Lecture SharePoint impossible (HTTP ${res.status})`);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error('Rapport trop volumineux');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('Rapport trop volumineux');
  return buf;
}

// Les onglets mensuels (« Septembre 2026 ») deviennent un relevé chacun ; les autres sont ignorés.
function monthlyPayloads(tool, workbook) {
  const sheets = workbook
    .map(s => ({ month: aiUsage.parseMonth(s.name), rows: s.rows }))
    .filter(s => s.month)
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, MAX_SHEETS);
  const parsed = [], skipped = [];
  for (const s of sheets) {
    try {
      const p = aiUsage.parsePayload({ tool, month: s.month, lignesMois: s.rows });
      // Mois de référence (Fireflies) : totaux cumulés relevés, pas encore d'usage mensuel.
      if (p.rows.length && p.rows.every(r => r.status === 'Référence')) p.reference = true;
      parsed.push(p);
    }
    catch (e) { skipped.push(`${s.month} : ${e.message}`); }
  }
  return { parsed, skipped };
}

const state = { running: false, last: null };

async function syncAll(db, { isMock = false } = {}) {
  if (state.running) throw Object.assign(new Error('Synchronisation déjà en cours'), { httpStatus: 409 });
  if (!isConfigured()) throw Object.assign(new Error('Lecture SharePoint non configurée'), { httpStatus: 503 });
  state.running = true;
  const results = [];
  try {
    for (const tool of Object.keys(aiUsage.TOOLS)) {
      try {
        const { parsed, skipped } = monthlyPayloads(tool, readWorkbook(await download(tool)));
        if (!parsed.length) throw new Error(skipped[0] || 'Aucun onglet mensuel trouvé dans le rapport');
        for (const p of parsed) aiUsage.ingest(db, p, { isMock });
        results.push({ tool, ok: true, months: parsed.map(p => p.month).sort(), skipped });
      } catch (e) {
        // Message de Graph / xlsx : jamais de jeton ni de secret dedans.
        results.push({ tool, ok: false, error: String(e.message || e).slice(0, 200) });
      }
    }
  } finally {
    state.running = false;
    state.last = { at: new Date().toISOString(), results };
  }
  return state.last;
}

module.exports = { isConfigured, setOverride, parseSettings, settingsView, syncAll, status: () => ({ configured: isConfigured(), running: state.running, last: state.last }), monthlyPayloads, DEFAULT_PATHS };
