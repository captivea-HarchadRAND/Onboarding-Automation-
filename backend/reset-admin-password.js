/**
 * Reset du mot de passe admin sans perte de données.
 * Usage : node reset-admin-password.js [nouveau_mot_de_passe]
 * Sans argument : un mot de passe fort est généré et affiché une seule fois.
 */
const { scrypt, randomBytes } = require('crypto');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const { generatePassword } = require('./lib/user');

const scryptAsync = promisify(scrypt);

// Paramètres alignés sur server.js (coût scrypt durci, encodé dans le hash)
const SCRYPT_N = 2 ** 15;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const MIN_PASSWORD_LEN = 12;

// Si un mot de passe est fourni, il doit respecter la politique ; sinon on en génère un fort.
const provided = process.argv[2];
function validate(pw) {
  if (!pw || pw.length < MIN_PASSWORD_LEN) return `Minimum ${MIN_PASSWORD_LEN} caractères requis.`;
  if (!/[A-Z]/.test(pw)) return 'Au moins une majuscule requise.';
  if (!/[a-z]/.test(pw)) return 'Au moins une minuscule requise.';
  if (!/[0-9]/.test(pw)) return 'Au moins un chiffre requis.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Au moins un caractère spécial requis.';
  return null;
}

if (provided) {
  const err = validate(provided);
  if (err) { console.error('Mot de passe refusé :', err); process.exit(1); }
}
const NEW_PASSWORD = provided || generatePassword(16);

async function main() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  const DB_PATH = path.join(__dirname, 'data', 'onboarding.db');
  if (!fs.existsSync(DB_PATH)) {
    console.error('Base de données introuvable :', DB_PATH);
    process.exit(1);
  }

  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  const salt = randomBytes(16).toString('hex');
  const hashBuf = await scryptAsync(NEW_PASSWORD, salt, 64, { N: SCRYPT_N, maxmem: SCRYPT_MAXMEM });
  const passwordHash = `${hashBuf.toString('hex')}.${salt}.${SCRYPT_N}`;

  const res = db.exec(`SELECT id, email FROM users WHERE role='admin' LIMIT 1`);
  if (!res.length || !res[0].values.length) {
    console.error('Aucun compte admin trouvé dans la base.');
    process.exit(1);
  }
  const [id, email] = res[0].values[0];

  db.run(`UPDATE users SET password_hash=? WHERE id=?`, [passwordHash, id]);
  // Invalider toutes les sessions actives du compte (cohérent avec la route API reset-password)
  db.run(`DELETE FROM sessions WHERE user_id=?`, [id]);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));

  console.log('');
  console.log('═'.repeat(50));
  console.log('  Mot de passe admin réinitialisé (sessions révoquées).');
  console.log(`    email    : ${email}`);
  console.log(`    password : ${NEW_PASSWORD}`);
  console.log('═'.repeat(50));
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
