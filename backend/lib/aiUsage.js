// Supervision de l'usage des outils IA (Claude, ChatGPT, Fireflies).
//
// Le workflow n8n « superviser les IA » calcule chaque mois, par outil et par pays, un tableau
// `lignesMois` (en-tête + une ligne par membre). Ce module reçoit ce tableau tel quel, le stocke,
// puis calcule les classifications affichées dans le module Monitoring :
//   - statut   : Actif / Inactif / Sans licence / Hors liste membres (fourni par n8n)
//   - niveau   : rouge / orange / jaune / vert (calculé ici)
//   - pays     : société d'origine du membre
const { v4: uuidv4 } = require('uuid');

// orangeBelow : en dessous = pas utilisé ce mois-ci (orange).
// lowBelow    : en dessous = utilise peu (jaune) ; au-delà = utilise (vert).
// Seuils du tableau de bord n8n « Supervision des licences IA ».
const TOOLS = {
  claude:    { label: 'Claude',    unit: 'requêtes', orangeBelow: 10, lowBelow: 50 },
  chatgpt:   { label: 'ChatGPT',   unit: 'M tokens', orangeBelow: 1,  lowBelow: 5 },
  fireflies: { label: 'Fireflies', unit: 'réunions', orangeBelow: 1,  lowBelow: 11 },
};

// Types de siège facturés : seul Claude a deux tarifs (Premium / Standard, lus dans la colonne « Siège » du rapport).
// ChatGPT et Fireflies n'ont qu'un prix par licence (« Standard »).
const SEATS = { claude: ['Premium', 'Standard'], chatgpt: ['Standard'], fireflies: ['Standard'] };
const seatOf = (tool, seat) => (tool === 'claude' && /premium/i.test(String(seat ?? '')) ? 'Premium' : 'Standard');

// Seuls ces statuts sont « analysés » : les comptes sans licence ou hors liste n'ont pas de niveau.
const ANALYSED_STATUSES = ['Actif', 'Inactif'];

const MONTHS_FR = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

const MAX = { rows: 5000, email: 254, text: 256, products: 1024, country: 64, status: 64, missing: 20 };

const COLS = {
  country:  ['pays', 'country', 'societe'],
  email:    ['email', 'e_mail', 'user_email'],
  name:     ['nom', 'name'],
  seat:     ['siege', 'type_de_siege', 'seat'],
  role:     ['role'],
  status:   ['statut', 'status'],
  cost:     ['cout_estime_usd', 'cost_usd', 'cout'],
  products: ['produits_utilises', 'produits', 'products'],
};
const USAGE_COLS = {
  claude:    ['requetes', 'requests'],
  chatgpt:   ['tokens_m', 'tokens'],
  fireflies: ['reunions', 'meetings'],
};

const stripAccents = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = s => stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const round2 = n => Math.round(n * 100) / 100;

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const isTool = t => typeof t === 'string' && Object.hasOwn(TOOLS, t);

// Une année aberrante (faute de frappe, push hostile) deviendrait le mois « le plus récent » affiché par défaut.
const validYear = y => Number(y) >= 2020 && Number(y) <= 2100;

function parseMonth(v) {
  const s = String(v ?? '').trim();
  const iso = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
  if (iso) return validYear(iso[1]) ? s : null;
  const m = /^([a-z]+)\s+(\d{4})$/.exec(stripAccents(s).toLowerCase());
  if (m && validYear(m[2])) {
    const i = MONTHS_FR.indexOf(m[1]);
    if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, '0')}`;
  }
  return null;
}

function queryRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const out = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    return out;
  } finally {
    stmt.free();
  }
}

function invalid(message) {
  const e = new Error(message);
  e.httpStatus = 400;
  return e;
}

// Valide et normalise le corps reçu de n8n :
//   { tool, month, lignesMois: [[en-têtes], [ligne], …], manquants?: [pays], reference?: bool }
function parsePayload(body) {
  if (!body || typeof body !== 'object') throw invalid('Corps JSON requis');
  const tool = String(body.tool || '').toLowerCase();
  if (!isTool(tool)) throw invalid(`Outil inconnu : ${String(body.tool).slice(0, 30)}`);
  const month = parseMonth(body.month ?? body.mois ?? body.feuilleMois ?? body.feuille);
  if (!month) throw invalid('Mois invalide (attendu AAAA-MM ou « Septembre 2026 »)');

  const table = body.lignesMois;
  if (!Array.isArray(table) || table.length < 1) throw invalid('lignesMois requis (tableau avec ligne d\'en-tête)');
  if (table.length > MAX.rows + 1) throw invalid(`Trop de lignes (max ${MAX.rows})`);
  const header = table[0];
  if (!Array.isArray(header)) throw invalid('La première ligne de lignesMois doit être l\'en-tête');

  const find = names => header.findIndex(h => names.includes(norm(h)));
  const idx = {
    country: find(COLS.country), email: find(COLS.email), name: find(COLS.name), seat: find(COLS.seat),
    role: find(COLS.role), status: find(COLS.status), cost: find(COLS.cost), products: find(COLS.products),
    usage: find(USAGE_COLS[tool]),
  };
  for (const [key, label] of [['email', 'Email'], ['status', 'Statut'], ['usage', TOOLS[tool].unit]]) {
    if (idx[key] < 0) throw invalid(`Colonne « ${label} » introuvable dans l'en-tête de lignesMois`);
  }

  const text = (r, i, max) => (i >= 0 ? String(r[i] ?? '').trim().slice(0, max) : '');
  const missing = new Set(
    (Array.isArray(body.manquants) ? body.manquants : [])
      .map(s => String(s ?? '').trim().slice(0, MAX.country)).filter(Boolean)
  );
  if (missing.size > MAX.missing) throw invalid('Trop de pays manquants');

  const rows = [];
  for (const r of table.slice(1)) {
    if (!Array.isArray(r)) throw invalid('Chaque ligne de lignesMois doit être un tableau');
    const status = text(r, idx.status, MAX.status);
    const country = text(r, idx.country, MAX.country);
    if (status === 'Fichier manquant') { if (country) missing.add(country); continue; }
    const email = text(r, idx.email, MAX.email + 1).toLowerCase();
    if (!email) continue;
    if (email.length > MAX.email) throw invalid('Email trop long');
    rows.push({
      country, email,
      name: text(r, idx.name, MAX.text), seat: text(r, idx.seat, MAX.text), role: text(r, idx.role, MAX.text),
      status: status || 'Inactif',
      usage: round2(Math.max(0, num(r[idx.usage]))),
      cost: idx.cost >= 0 && String(r[idx.cost] ?? '').trim() !== '' ? round2(num(r[idx.cost])) : null,
      products: text(r, idx.products, MAX.products),
    });
  }
  return { tool, month, reference: body.reference === true, missing: [...missing].slice(0, MAX.missing), rows };
}

// Remplace le relevé existant du même outil/mois (un nouveau passage du workflow écrase l'ancien).
function ingest(db, parsed, { isMock = false } = {}) {
  const mock = isMock ? 1 : 0;
  const id = uuidv4();
  db.run('BEGIN');
  try {
    for (const old of queryRows(db, 'SELECT id FROM ai_usage_runs WHERE tool=? AND month=? AND is_mock=?', [parsed.tool, parsed.month, mock])) {
      db.run('DELETE FROM ai_usage_rows WHERE run_id=?', [old.id]);
      db.run('DELETE FROM ai_usage_runs WHERE id=?', [old.id]);
    }
    db.run(
      'INSERT INTO ai_usage_runs (id, tool, month, reference, missing_countries, is_mock) VALUES (?,?,?,?,?,?)',
      [id, parsed.tool, parsed.month, parsed.reference ? 1 : 0, JSON.stringify(parsed.missing), mock]
    );
    const stmt = db.prepare(
      'INSERT INTO ai_usage_rows (run_id, country, email, name, seat, role, status, usage, cost_usd, products) VALUES (?,?,?,?,?,?,?,?,?,?)'
    );
    try {
      for (const r of parsed.rows) stmt.run([id, r.country, r.email, r.name, r.seat, r.role, r.status, r.usage, r.cost, r.products]);
    } finally {
      stmt.free();
    }
    db.run('COMMIT');
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (_) { /* transaction déjà fermée */ }
    throw e;
  }
  return id;
}

// Niveau d'usage d'un compte pour le mois months[i] (null = non analysé : sans licence, hors liste).
//   vert   : utilise (au-delà de lowBelow)
//   jaune  : utilise peu (sous lowBelow)
//   orange : n'a pas utilisé ce mois-ci (sous orangeBelow)
//   rouge  : aucune utilisation ce mois-ci ni le mois précédent (0 depuis 2 mois ou plus)
function levelOf(tool, vals, months, i) {
  const t = TOOLS[tool];
  const v = vals[months[i]];
  if (v === undefined || v === null) return null;
  if (v === 0 && i >= 1 && vals[months[i - 1]] === 0) return 'rouge';
  return v < t.orangeBelow ? 'orange' : v < t.lowBelow ? 'jaune' : 'vert';
}

const MONTHS_SHOWN = 7; // mois affichés + le mois d'avant pour la comparaison du plus ancien

// € HT / licence / mois, par outil puis par type de siège.
const DEFAULT_PRICES = { claude: { Premium: 30, Standard: 25 }, chatgpt: { Standard: 30 }, fireflies: { Standard: 19 } };

// Tout ce qu'il faut au tableau de bord (vue d'ensemble, pages outil, suivi des personnes).
// Un compte est une « licence payante » s'il est Actif ou Inactif ; il est inactif si son statut le dit
// ou si son usage du mois est nul. Les mois de référence (totaux cumulés) sont ignorés.
function dashboard(db, { isMock = false } = {}) {
  const mock = isMock ? 1 : 0;
  const runs = queryRows(
    db,
    'SELECT id, tool, month, missing_countries, received_at FROM ai_usage_runs WHERE is_mock=? AND reference=0 ORDER BY month DESC',
    [mock]
  );
  const months = [...new Set(runs.map(r => r.month))].slice(0, MONTHS_SHOWN).sort();
  const references = queryRows(db, 'SELECT tool, month FROM ai_usage_runs WHERE is_mock=? AND reference=1 ORDER BY month', [mock]);
  const tools = {};
  for (const [tool, t] of Object.entries(TOOLS)) {
    const mine = runs.filter(r => r.tool === tool && months.includes(r.month));
    const out = {
      label: t.label, unit: t.unit, seats: SEATS[tool], orangeBelow: t.orangeBelow, lowBelow: t.lowBelow,
      empty: mine.length === 0, cells: {}, people: [], missing: [], receivedAt: null,
      referenceMonths: references.filter(r => r.tool === tool).map(r => r.month),
    };
    tools[tool] = out;
    if (!mine.length) continue;
    const people = new Map();
    for (const run of mine) { // déjà triés du plus récent au plus ancien
      if (!out.receivedAt) {
        out.receivedAt = run.received_at;
        try { out.missing = JSON.parse(run.missing_countries || '[]'); } catch (_) { /* valeur illisible : ignorée */ }
      }
      for (const r of queryRows(db, 'SELECT country, email, name, seat, status, usage FROM ai_usage_rows WHERE run_id=?', [run.id])) {
        if (!ANALYSED_STATUSES.includes(r.status)) continue;
        const country = r.country || '—';
        const key = `${country}|${run.month}`;
        const c = out.cells[key] || (out.cells[key] = { lic: 0, active: 0, inactive: 0, low: 0, inactifs: {} });
        c.lic++;
        // inactifs : licences inutilisées par type de siège (le coût d'un siège Premium n'est pas celui d'un Standard)
        if (r.status === 'Inactif' || r.usage === 0) { c.inactive++; const sg = seatOf(tool, r.seat); c.inactifs[sg] = (c.inactifs[sg] || 0) + 1; }
        else { c.active++; if (r.usage < t.lowBelow) c.low++; }
        const p = people.get(r.email) || { country, email: r.email, name: '', vals: {} };
        if (!p.name && r.name) p.name = r.name;
        p.vals[run.month] = r.usage;
        people.set(r.email, p);
      }
    }
    out.people = [...people.values()];
  }

  return { months, tools, ...readPrices(db) };
}

// Prix par outil et par siège. Ancien format (un nombre par outil) : lu comme le prix « Standard ».
function normPrices(input) {
  const out = {};
  for (const [tool, v] of Object.entries(input || {})) {
    if (!isTool(tool)) continue;
    out[tool] = typeof v === 'object' && v !== null ? { ...v } : { Standard: v };
  }
  return out;
}
const mergePrices = (base, extra) => Object.fromEntries(Object.keys(TOOLS).map(tool => [tool, { ...base[tool], ...extra[tool] }]));

function readPrices(db) {
  try {
    const row = queryRows(db, "SELECT value FROM settings WHERE key='monitoring_prices'")[0];
    if (row) return { prices: mergePrices(DEFAULT_PRICES, parsePrices(JSON.parse(row.value))), pricesSaved: true };
  } catch (_) { /* réglage illisible : prix par défaut */ }
  return { prices: mergePrices(DEFAULT_PRICES, {}), pricesSaved: false };
}

// Prix saisis par l'admin : un nombre ≥ 0 par outil et par siège connus, le reste est ignoré.
function parsePrices(input) {
  const out = {};
  for (const [tool, seats] of Object.entries(normPrices(input))) {
    for (const seat of SEATS[tool]) {
      if (seats[seat] === undefined) continue;
      const v = Number(seats[seat]);
      if (!Number.isFinite(v) || v < 0 || v > 100000) throw invalid(`Prix invalide pour ${TOOLS[tool].label}${SEATS[tool].length > 1 ? ' ' + seat : ''}`);
      (out[tool] = out[tool] || {})[seat] = round2(v);
    }
  }
  return out;
}

function savePrices(db, input) {
  const merged = mergePrices(readPrices(db).prices, parsePrices(input));
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('monitoring_prices', ?)", [JSON.stringify(merged)]);
  return merged;
}

// Vue condensée pour le portail : dernier mois de chaque outil, personnes à surveiller par niveau.
function summary(db, { isMock = false } = {}) {
  const d = dashboard(db, { isMock });
  return Object.entries(d.tools).map(([tool, t]) => {
    const last = d.months.filter(m => t.people.some(p => p.vals[m] !== undefined)).pop();
    const out = { tool, label: t.label, month: last || null, empty: t.empty, rouge: 0, orange: 0, yellow: 0, analysed: 0 };
    if (!last) return out;
    const i = d.months.indexOf(last);
    for (const p of t.people) {
      const lv = levelOf(tool, p.vals, d.months, i);
      if (!lv) continue;
      out.analysed++;
      if (lv === 'rouge') out.rouge++; else if (lv === 'orange') out.orange++; else if (lv === 'jaune') out.yellow++;
    }
    return out;
  });
}

// Données fictives pour visualiser le module en mode développement (jamais en production).
function seedDemo(db, { now = new Date() } = {}) {
  const COUNTRIES = ['Captivea France', 'Captivea Luxembourg', 'Captivea USA', 'Captivea India'];
  const FIRST = ['Alex', 'Camille', 'Dana', 'Eli', 'Farah', 'Gaël', 'Hana', 'Ilan', 'Jade', 'Kim', 'Lou', 'Mehdi'];
  const monthsBack = k => {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  // Générateur pseudo-aléatoire déterministe : mêmes données à chaque appel.
  const rng = seed => { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; };
  const SAMPLES = {
    claude:    [0, 0, 2, 4, 7, 9, 12, 16, 19, 24, 38, 55, 90, 140, 210, 320],
    chatgpt:   [0, 0.2, 0.4, 0.7, 0.9, 1.2, 1.6, 1.9, 2.4, 3.1, 4.5, 7, 11, 18],
    fireflies: [0, 0, 0, 1, 1, 2, 2, 3, 4, 6, 9, 12, 17, 23],
  };
  let total = 0;
  for (const tool of Object.keys(TOOLS)) {
    for (let k = 1; k <= 3; k++) {
      const month = monthsBack(k);
      const r = rng(Array.from(tool + month).reduce((a, c) => a + c.charCodeAt(0), 7));
      const header = tool === 'claude'
        ? ['Pays', 'Email', 'Siège', 'Rôle', 'Statut', 'Requêtes', 'Coût estimé (USD)', 'Produits utilisés']
        : tool === 'chatgpt'
          ? ['Pays', 'Email', 'Nom', 'Statut', 'Tokens (M)', 'Lignes de code', 'Coût estimé (USD)']
          : ['Pays', 'Email', 'Nom', 'Statut', 'Réunions'];
      const lines = [header];
      COUNTRIES.forEach((country, ci) => {
        FIRST.slice(0, 5 + ci).forEach((first, ui) => {
          const email = `${first.toLowerCase()}.${ci}${ui}@demo.local`;
          const usage = SAMPLES[tool][Math.floor(r() * SAMPLES[tool].length)];
          const unassigned = tool === 'claude' && r() < 0.08;
          const used = unassigned ? 0 : usage;
          const status = unassigned ? 'Sans licence' : used > 0 ? 'Actif' : 'Inactif';
          if (tool === 'claude') lines.push([country, email, unassigned ? 'Unassigned' : r() < 0.3 ? 'Premium' : 'Standard', ui === 0 ? 'Admin' : 'Membre', status, used, round2(used * 0.9), used > 0 ? 'Claude Code, Chat' : '']);
          else if (tool === 'chatgpt') lines.push([country, email, `${first} Demo`, status, used, used > 1 ? Math.round(used * 120) : 0, round2(used * 3)]);
          else lines.push([country, email, `${first} Demo`, status, used]);
        });
      });
      if (tool === 'claude') lines.push(['Captivea France', 'invite.externe@demo.local', '', '', 'Hors liste membres', 3, 2.7, 'Chat']);
      const parsed = parsePayload({ tool, month, lignesMois: lines, manquants: tool === 'fireflies' && k === 1 ? ['Captivea India'] : [] });
      ingest(db, parsed, { isMock: true });
      total += parsed.rows.length;
    }
  }
  return total;
}

module.exports = { TOOLS, SEATS, isTool, parsePayload, parseMonth, ingest, dashboard, savePrices, summary, seedDemo, levelOf };
