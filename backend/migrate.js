// Applique à la demande les migrations de base de données en attente, puis affiche l'état de la base.
//   Usage (serveur arrêté) :   cd backend && node migrate.js
// Utilise exactement le même code que le démarrage du serveur (db.js) : les données existantes ne sont jamais effacées,
// seules les nouvelles tables ou colonnes sont ajoutées. Sans effet si la base est déjà à jour (peut être relancé sans risque).
// Normalement inutile : le serveur applique les migrations tout seul à chaque démarrage (pm2 restart onboarding).
// ATTENTION : ne pas le lancer pendant que le serveur tourne (il garde la base en mémoire et l'écraserait) : pm2 stop d'abord.
const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'onboarding.db');

(async () => {
  if (!fs.existsSync(dbFile)) {
    console.error(`Aucune base trouvée à ${dbFile} : arrêt (aucune base vide n'est créée).`);
    process.exit(1);
  }
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const read = db => {
    const one = sql => db.exec(sql)[0]?.values[0][0];
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0].values.map(r => r[0]);
    return { version: one('SELECT MAX(version) FROM schema_version'), counts: Object.fromEntries(tables.map(t => [t, one(`SELECT COUNT(*) FROM ${t}`)])) };
  };

  const before = read(new SQL.Database(fs.readFileSync(dbFile)));
  const { getDB } = require('./db');
  const after = read(await getDB());

  console.log(`Base : ${dbFile}`);
  console.log(`Version du schéma : ${before.version} → ${after.version}${before.version === after.version ? ' (déjà à jour)' : ''}`);
  console.log('Table'.padEnd(22) + 'lignes avant → après');
  for (const t of Object.keys(after.counts)) {
    const b = before.counts[t];
    console.log(t.padEnd(22) + (b === undefined ? 'nouvelle table → ' + after.counts[t] : `${b} → ${after.counts[t]}${b === after.counts[t] ? '' : '   ⚠️ DIFFÉRENT'}`));
  }
  // Pas de process.exit() ici : le script se termine de lui-même (une sortie forcée provoque une erreur de fin sous Windows).
})().catch(e => { console.error('ERREUR', e.message); process.exitCode = 1; });
