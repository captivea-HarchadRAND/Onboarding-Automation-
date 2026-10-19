// Synchronisation du monitoring depuis les rapports Excel du workflow n8n, stockés dans SharePoint.
// Lecture seule : l'app télécharge `Report.xlsx` de chaque outil via Microsoft Graph et réutilise
// la même validation / le même stockage que l'ingestion n8n (aiUsage.parsePayload / ingest).
// Le workflow n8n écrit UN rapport par société (Claude, ChatGPT) : un chemin qui contient {societe} est lu
// pour chaque pays de la liste (Monitoring > Administration > Pays) ; les onglets d'un même mois sont
// regroupés en un seul relevé (sinon le dernier pays lu remplacerait les autres). Une société sans rapport
// (404) est simplement ignorée. Fireflies : un seul rapport (équipe unique, « Captivea Group »).
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

const BASE = 'Knowledge/IT knowledge/Management/SI/AI';
const SOCIETE = '{societe}';
const DEFAULT_PATHS = {
  claude:    `${BASE}/${SOCIETE}/Claude/Report/Report.xlsx`,
  chatgpt:   `${BASE}/${SOCIETE}/ChatGPT/Report/Report.xlsx`,
  fireflies: `${BASE}/Captivea Group/Fireflies/Report/Rapport Supervision Fireflies.xlsx`,
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

// Rapports à lire pour un outil : un par société si le chemin contient {societe}, sinon un seul.
function reportTargets(tool, societes) {
  const p = reportPath(tool);
  if (!p.includes(SOCIETE)) return [{ societe: null, path: p }];
  return societes.map(s => ({ societe: s, path: p.split(SOCIETE).join(s) }))
    .filter(t => !t.path.split('/').some(seg => seg === '..' || seg === '.' || seg === ''));
}

// null = rapport absent (404), seulement si allowMissing (société sans rapport pour cet outil).
async function download(filePath, { allowMissing = false } = {}) {
  const { token } = await getCredential().getToken('https://graph.microsoft.com/.default');
  const drive = encodeURIComponent(driveId());
  const path = filePath.split('/').map(encodeURIComponent).join('/');
  const res = await retryFetch(`https://graph.microsoft.com/v1.0/drives/${drive}/root:/${path}:/content`, {
    headers: { Authorization: `Bearer ${token}` },
  }, { attemptTimeoutMs: 20000, label: 'SharePoint' });
  if (res.status === 404) {
    if (allowMissing) return null;
    throw new Error('Rapport introuvable dans SharePoint (chemin à vérifier)');
  }
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

// Regroupe les relevés de plusieurs sociétés : un seul relevé par mois (lignes et pays manquants cumulés).
function mergeByMonth(list) {
  const byMonth = new Map();
  for (const p of list) {
    const m = byMonth.get(p.month);
    if (!m) { byMonth.set(p.month, { ...p, rows: [...p.rows], missing: [...p.missing] }); continue; }
    m.rows.push(...p.rows);
    m.missing = [...new Set([...m.missing, ...p.missing])];
    m.reference = m.reference && p.reference;
  }
  return [...byMonth.values()];
}

// Historique des synchronisations (les plus récentes d'abord), conservé en base par le serveur (setHistory / onSync).
const MAX_HISTORY = 30;
const state = { running: false, last: null, history: [] };

function setHistory(list) {
  state.history = Array.isArray(list) ? list.slice(0, MAX_HISTORY) : [];
  state.last = state.history[0] || null;
}

// Supprime une entrée (identifiée par sa date) ou, sans argument, tout l'historique. Renvoie le nombre d'entrées retirées.
function removeHistory(at) {
  const before = state.history.length;
  setHistory(at === undefined ? [] : state.history.filter(h => h.at !== at));
  return before - state.history.length;
}

async function syncAll(db, { isMock = false, trigger = '' } = {}) {
  if (state.running) throw Object.assign(new Error('Synchronisation déjà en cours'), { httpStatus: 409 });
  if (!isConfigured()) throw Object.assign(new Error('Lecture SharePoint non configurée'), { httpStatus: 503 });
  state.running = true;
  const results = [];
  try {
    const societes = aiUsage.readCountries(db).countries.map(c => c.name);
    for (const tool of Object.keys(aiUsage.TOOLS)) {
      try {
        const targets = reportTargets(tool, societes);
        const perSociete = targets.some(t => t.societe);
        const all = [], skipped = [], read = [];
        for (const t of targets) {
          const buf = await download(t.path, { allowMissing: perSociete });
          if (!buf) continue;
          const out = monthlyPayloads(tool, readWorkbook(buf));
          all.push(...out.parsed);
          skipped.push(...out.skipped.map(x => (t.societe ? `${t.societe} — ${x}` : x)));
          if (t.societe) read.push(t.societe);
        }
        if (perSociete && !read.length) throw new Error('Aucun rapport trouvé dans SharePoint pour les pays de la liste (chemin à vérifier)');
        const parsed = mergeByMonth(all);
        if (!parsed.length) throw new Error(skipped[0] || 'Aucun onglet mensuel trouvé dans le rapport');
        for (const p of parsed) aiUsage.ingest(db, p, { isMock });
        results.push({ tool, ok: true, months: parsed.map(p => p.month).sort(), skipped, ...(perSociete ? { societes: read } : {}) });
      } catch (e) {
        // Message de Graph / xlsx : jamais de jeton ni de secret dedans.
        results.push({ tool, ok: false, error: String(e.message || e).slice(0, 200) });
      }
    }
  } finally {
    state.running = false;
    state.last = { at: new Date().toISOString(), trigger, results };
    state.history = [state.last, ...state.history].slice(0, MAX_HISTORY);
  }
  return state.last;
}

module.exports = { isConfigured, setOverride, parseSettings, settingsView, syncAll, setHistory, removeHistory, status: () => ({ configured: isConfigured(), running: state.running, last: state.last, history: state.history }), monthlyPayloads, mergeByMonth, reportTargets, DEFAULT_PATHS };
