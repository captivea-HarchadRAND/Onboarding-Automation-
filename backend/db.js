const path = require('path');
const fs = require('fs');

let db;

async function getDB() {
  if (db) return db;

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const DB_PATH = path.join(DATA_DIR, 'onboarding.db');

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');
  migrate(db);
  saveDB();

  return db;
}

function saveDB() {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
  const DB_PATH = path.join(DATA_DIR, 'onboarding.db');
  const TMP_PATH = `${DB_PATH}.tmp`;
  const data = db.export();
  // Écriture atomique : on écrit dans un fichier temporaire puis on renomme (rename atomique sur
  // le même volume). Évite un fichier .db tronqué/corrompu si le process est tué pendant l'écriture.
  fs.writeFileSync(TMP_PATH, Buffer.from(data));
  fs.renameSync(TMP_PATH, DB_PATH);
}

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER, applied_at TEXT)`);
  const res = db.exec(`SELECT MAX(version) as v FROM schema_version`);
  const current = res[0]?.values[0]?.[0] || 0;

  const migrations = [
    // v1: tables principales
    `CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      role        TEXT DEFAULT 'operator',
      password_hash TEXT,
      status      TEXT DEFAULT 'active',
      invite_token TEXT,
      invite_expires TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT,
      role        TEXT,
      expires_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS onboardings (
      id                  TEXT PRIMARY KEY,
      employee_firstname  TEXT NOT NULL,
      employee_lastname   TEXT NOT NULL,
      employee_email      TEXT NOT NULL,
      employee_ad_id      TEXT,
      group_id            TEXT NOT NULL,
      group_name          TEXT NOT NULL,
      sku_id              TEXT NOT NULL,
      license_name        TEXT NOT NULL,
      status              TEXT DEFAULT 'pending',
      error_message       TEXT,
      rolled_back         INTEGER DEFAULT 0,
      created_by          TEXT,
      created_by_name     TEXT,
      created_at          TEXT DEFAULT (datetime('now')),
      completed_at        TEXT
    );
    CREATE TABLE IF NOT EXISTS onboarding_steps (
      id              TEXT PRIMARY KEY,
      onboarding_id   TEXT NOT NULL REFERENCES onboardings(id) ON DELETE CASCADE,
      step_number     INTEGER NOT NULL,
      step_name       TEXT NOT NULL,
      status          TEXT DEFAULT 'pending',
      error_message   TEXT,
      started_at      TEXT,
      completed_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_onboardings_status   ON onboardings(status);
    CREATE INDEX IF NOT EXISTS idx_onboardings_created  ON onboardings(created_at);
    CREATE INDEX IF NOT EXISTS idx_steps_onboarding     ON onboarding_steps(onboarding_id);`,

    // v2: rôle métier et localisation de l'employé
    `ALTER TABLE onboardings ADD COLUMN job_role TEXT;
     ALTER TABLE onboardings ADD COLUMN location TEXT;`,

    // v3: colonne historique — NE PAS UTILISER. Le mot de passe temporaire ne doit JAMAIS
    // être persisté en DB : il vit uniquement en mémoire (tempPasswordStore, TTL 10 min)
    // et n'est renvoyé qu'une fois à son créateur. Colonne conservée pour ne pas casser
    // la séquence de migrations ; toute écriture ici romprait l'invariant de sécurité.
    `ALTER TABLE onboardings ADD COLUMN temp_password TEXT;`,
  ];

  for (let i = current; i < migrations.length; i++) {
    db.run(migrations[i]);
    db.run(`INSERT INTO schema_version VALUES (${i + 1}, datetime('now'))`);
  }
}

module.exports = { getDB, saveDB };
