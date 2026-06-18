const { graphFetch } = require('./graph');
const { randomBytes }  = require('crypto');

// Charset sans caractères AltGr, accessibles sur QWERTY EN et AZERTY FR
const UPPER    = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER    = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS   = '0123456789';
const SPECIALS = '!-_';
const ALL      = UPPER + LOWER + DIGITS + SPECIALS;

// Génère un mot de passe fort via CSPRNG (crypto.randomBytes = OS entropy pool).
// Sélection par modulo — biais négligeable (< 0.4 %) pour des charsets < 100 chars.
// Garantie de complexité : 1 upper + 1 lower + 1 digit + 1 special avant shuffle.
function generatePassword(length = 16) {
  const pick = (charset) => {
    let b;
    do { b = randomBytes(1)[0]; } while (b >= 256 - (256 % charset.length));
    return charset[b % charset.length];
  };

  const mandatory = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIALS)];
  const rest = Array.from({ length: length - 4 }, () => pick(ALL));
  const chars = [...mandatory, ...rest];

  // Fisher-Yates shuffle avec bytes crypto
  const shuffle = randomBytes(chars.length);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// Mapping codes filiales → ISO 3166-1 alpha-2 (requis par Microsoft pour l'assignation de licences)
const LOCATION_TO_ISO = {
  FR:  'FR',
  MDG: 'MG',
  US:  'US',
  SG:  'SG',
  LUX: 'LU',
  IND: 'IN',
  CA:  'CA',
};

async function createUser({ firstName, lastName, email, location }) {
  const domain        = process.env.DEFAULT_DOMAIN    || 'monentreprise.com';
  const usageLocation = LOCATION_TO_ISO[location] || process.env.USAGE_LOCATION || 'FR';
  const forceChange   = process.env.FORCE_CHANGE_PASSWORD === 'true';
  const password      = generatePassword(16);

  const slug = `${firstName}.${lastName}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.]/g, '');

  const userPrincipalName = email || `${slug}@${domain}`;

  const user = await graphFetch('/users', {
    method: 'POST',
    body: {
      accountEnabled: true,
      displayName: `${firstName} ${lastName}`,
      givenName: firstName,
      surname: lastName,
      mailNickname: slug,
      userPrincipalName,
      usageLocation,
      passwordProfile: {
        forceChangePasswordNextSignIn: forceChange,
        password,
      },
    },
  });
  return { ...user, temporaryPassword: password };
}

async function deleteUser(userId) {
  return graphFetch(`/users/${userId}`, { method: 'DELETE' });
}

module.exports = { createUser, deleteUser, generatePassword };
