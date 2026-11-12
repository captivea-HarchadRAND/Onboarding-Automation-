// Alertes du Monitoring : prévenir le CEO de chaque pays des licences IA qui ne servent pas.
//
// Réglages (Monitoring > Administration > Alertes), table `settings` :
//   monitoring_alerts     { minLevel: 'rouge' | 'orange' | 'jaune', autoSend, attachPdf, languages: { "<pays>": 'fr' | 'en' }, recipients: { "<pays>": ["ceo@…", …] } }
//   monitoring_alert_log  derniers envois (qui, à qui, combien de licences, succès / échec)
// « N'utilise pas l'IA alors qu'il a la licence » = niveau orange (0 ce mois-ci) ou rouge (0 depuis 2 mois ou plus) ;
// « utilise peu » = jaune (plus de 0 mais sous le seuil de l'outil). Même règle que le tableau de bord (aiUsage.levelOf).
// Le niveau minimal choisi décide de ce qui est envoyé : rouge seul, + orange, ou + jaune.
// L'envoi lui-même (SMTP) est fait par server.js : ce module ne fait que calculer et rédiger.

const aiUsage = require('./aiUsage');
const { buildEmail, personName, langFor, defaultLang } = require('./alertDocs');

const LEVELS = ['rouge', 'orange', 'jaune'];        // du plus grave au moins grave
const LEVEL_LABEL = { rouge: 'Inactif · 2 mois ou plus', orange: 'Pas utilisé ce mois-ci', jaune: 'Utilise peu' };
const MAX = { perCountry: 5, countries: 30, country: 64, email: 254, log: 30 };
const EMAIL_RE = /^[^@\s,;<>"']+@[^@\s,;<>"']+\.[^@\s,;<>"']+$/;

const invalid = message => Object.assign(new Error(message), { httpStatus: 400 });

function readKey(db, key) {
  const stmt = db.prepare('SELECT value FROM settings WHERE key=?');
  try {
    stmt.bind([key]);
    return stmt.step() ? JSON.parse(stmt.getAsObject().value) : null;
  } catch (_) {
    return null;                                   // réglage illisible : valeurs par défaut
  } finally {
    stmt.free();
  }
}
const writeKey = (db, key, value) => db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);

// Adresses saisies (liste ou texte séparé par virgules / points-virgules / retours à la ligne) → liste propre.
function parseEmails(raw, country) {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,;\s]+/);
  const out = [];
  for (const v of list) {
    const e = String(v ?? '').trim().toLowerCase();
    if (!e) continue;
    if (e.length > MAX.email || !EMAIL_RE.test(e)) throw invalid(`Adresse e-mail invalide pour ${country} : « ${e.slice(0, 60)} »`);
    if (!out.includes(e)) out.push(e);
  }
  if (out.length > MAX.perCountry) throw invalid(`Trop d'adresses pour ${country} (max ${MAX.perCountry})`);
  return out;
}

function parseSettings(input) {
  if (!input || typeof input !== 'object') throw invalid('Corps JSON requis');
  const minLevel = input.minLevel === undefined ? 'rouge' : input.minLevel;
  if (!LEVELS.includes(minLevel)) throw invalid('Niveau minimal invalide (rouge, orange ou jaune)');
  const autoSend = input.autoSend === true;
  const attachPdf = input.attachPdf === true;       // joindre le détail en PDF à l'e-mail (désactivé par défaut)
  const languages = {};
  for (const [c, l] of Object.entries(input.languages && typeof input.languages === 'object' ? input.languages : {})) {
    const name = String(c).replace(/[\u0000-\u001f]/g, '').trim();
    if (name && name.length <= MAX.country && (l === 'fr' || l === 'en')) languages[name] = l;   // langue de l'e-mail et du PDF de ce pays
  }
  const recipients = {};
  const entries = Object.entries(input.recipients && typeof input.recipients === 'object' ? input.recipients : {});
  if (entries.length > MAX.countries) throw invalid(`Trop de pays (max ${MAX.countries})`);
  for (const [country, raw] of entries) {
    const name = String(country).replace(/[\u0000-\u001f]/g, '').trim();
    if (!name || name.length > MAX.country) throw invalid('Nom de pays invalide');
    const emails = parseEmails(raw, name);
    if (emails.length) recipients[name] = emails;
  }
  return { minLevel, autoSend, attachPdf, languages, recipients };
}

function readSettings(db) {
  const saved = readKey(db, 'monitoring_alerts');
  try {
    if (saved) return { settings: parseSettings(saved), saved: true };
  } catch (_) { /* réglage abîmé : ignoré */ }
  return { settings: { minLevel: 'rouge', autoSend: false, attachPdf: false, languages: {}, recipients: {} }, saved: false };
}

function saveSettings(db, input) {
  const settings = parseSettings(input);
  writeKey(db, 'monitoring_alerts', settings);
  return settings;
}

const readLog = db => (Array.isArray(readKey(db, 'monitoring_alert_log')) ? readKey(db, 'monitoring_alert_log') : []);
function appendLog(db, entries) {
  writeKey(db, 'monitoring_alert_log', [...entries, ...readLog(db)].slice(0, MAX.log));
}

// Supprime une entrée du journal (par sa date) ou, sans argument, tout le journal. Renvoie le nombre d'entrées retirées.
// N'a aucun effet sur l'état de l'envoi automatique (monitoring_alert_state) : une alerte déjà envoyée ne repart pas.
function removeLog(db, at) {
  const before = readLog(db);
  const after = at === undefined ? [] : before.filter(l => l.at !== at);
  writeKey(db, 'monitoring_alert_log', after);
  return before.length - after.length;
}

// Licences payantes sans usage ou peu utilisées, au dernier mois relevé de chaque outil, regroupées par pays.
//   → { months: { outil: 'AAAA-MM' }, byCountry: { pays: [ { tool, toolLabel, unit, month, name, email, usage, level } ] } }
function digest(db, { isMock = false } = {}) {
  const d = aiUsage.dashboard(db, { isMock });
  const byCountry = {}, months = {};
  for (const [tool, t] of Object.entries(d.tools)) {
    const last = d.months.filter(m => t.people.some(p => p.vals[m] !== undefined)).pop();
    if (!last) continue;
    months[tool] = last;
    const i = d.months.indexOf(last);
    for (const p of t.people) {
      const level = aiUsage.levelOf(tool, p.vals, d.months, i);
      if (!LEVELS.includes(level)) continue;       // vert = utilise : jamais signalé
      (byCountry[p.country] = byCountry[p.country] || []).push({
        tool, toolLabel: t.label, unit: t.unit, month: last, name: p.name || '', email: p.email, usage: p.vals[last], level,
      });
    }
  }
  const order = (a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.toolLabel.localeCompare(b.toolLabel) || a.email.localeCompare(b.email);
  for (const list of Object.values(byCountry)) list.sort(order);
  return { months, byCountry };
}

// ── Envoi automatique : UNE alerte par mois et par pays ─────────────────────────────────────────────────
// État (table settings, clé monitoring_alert_state) : { sent: { "<pays>": "AAAA-MM" }, firstSeen: { "AAAA-MM": date ISO } }.
//   sent       dernier mois déjà alerté pour chaque pays : jamais deux alertes pour le même mois, même si la synchro
//              relit les rapports toutes les 6 h (un envoi en échec n'est pas noté : il est retenté au contrôle suivant).
//   firstSeen  première fois où le mois a été vu dans les données. Les trois outils n'arrivent pas en même temps :
//              le mois est « prêt » quand TOUS les outils qui ont des données l'ont, ou 24 h après sa première apparition
//              (un outil en retard ne bloque pas l'alerte).
const GRACE_MS = 24 * 60 * 60 * 1000;

const readState = db => {
  const s = readKey(db, 'monitoring_alert_state');
  return { sent: { ...(s && s.sent) }, firstSeen: { ...(s && s.firstSeen) } };
};
const writeState = (db, state) => writeKey(db, 'monitoring_alert_state', {
  sent: state.sent,
  firstSeen: Object.fromEntries(Object.entries(state.firstSeen).sort().slice(-12)),   // 12 derniers mois suffisent
});

// Où en sont les données ? → { month, ready, reason, byCountry (licences du mois M seulement), state }
function plan(db, { isMock = false, now = new Date() } = {}) {
  const d = digest(db, { isMock });
  const have = Object.entries(d.months);                      // outil → dernier mois relevé
  const state = readState(db);
  if (!have.length) return { month: null, ready: false, reason: 'Aucune donnée', byCountry: {}, state };
  const month = have.map(([, m]) => m).sort().pop();           // mois le plus récent, tous outils confondus
  if (!state.firstSeen[month]) state.firstSeen[month] = now.toISOString();
  const complete = have.every(([, m]) => m === month);
  const waited = now.getTime() - new Date(state.firstSeen[month]).getTime() >= GRACE_MS;
  const byCountry = Object.fromEntries(Object.entries(d.byCountry)
    .map(([c, items]) => [c, items.filter(x => x.month === month)]).filter(([, items]) => items.length));
  return {
    month, ready: complete || waited, state, byCountry,
    reason: complete ? 'Tous les outils ont le mois' : waited ? 'Un outil est en retard : 24 h écoulées' : 'En attente des autres outils (24 h max)',
  };
}

// Ne garde que les licences au niveau choisi ou plus grave (rouge seul, rouge + orange, ou + jaune).
const keepLevel = (items, minLevel) => items.filter(x => LEVELS.indexOf(x.level) <= LEVELS.indexOf(minLevel));

// Nombre de licences concernées par pays, pour chacun des deux niveaux minimaux (aperçu avant envoi).
function counts(byCountry) {
  return Object.fromEntries(Object.entries(byCountry).map(([c, items]) => [c, Object.fromEntries(LEVELS.map(l => [l, keepLevel(items, l).length]))]));
}

module.exports = { langFor, defaultLang, LEVELS, LEVEL_LABEL, parseSettings, readSettings, saveSettings, readLog, appendLog, removeLog, digest, plan, readState, writeState, keepLevel, counts, buildEmail };
