/**
 * Reset du mot de passe admin sans perte de données.
 * Usage : node reset-admin-password.js [nouveau_mot_de_passe]
 * Défaut  : Admin@2024!
 */
const { scrypt, randomBytes } = require('crypto');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

const scryptAsync = promisify(scrypt);
const NEW_PASSWORD = process.argv[2] || 'Admin@2024!';

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
  const hashBuf = await scryptAsync(NEW_PASSWORD, salt, 64);
  const passwordHash = `${hashBuf.toString('hex')}.${salt}`;

  const res = db.exec(`SELECT id, email FROM users WHERE role='admin' LIMIT 1`);
  if (!res.length || !res[0].values.length) {
    console.error('Aucun compte admin trouvé dans la base.');
    process.exit(1);
  }
  const [id, email] = res[0].values[0];

  db.run(`UPDATE users SET password_hash=? WHERE id=?`, [passwordHash, id]);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));

  console.log('');
  console.log('═'.repeat(50));
  console.log('  Mot de passe admin réinitialisé.');
  console.log(`    email    : ${email}`);
  console.log(`    password : ${NEW_PASSWORD}`);
  console.log('═'.repeat(50));
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
