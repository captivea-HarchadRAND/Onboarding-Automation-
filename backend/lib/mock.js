const { v4: uuidv4 } = require('uuid');
const { generatePassword } = require('./user');

const DELAY    = parseInt(process.env.MOCK_DELAY_MS  || '1200', 10);
const FAIL_STEP = parseInt(process.env.MOCK_FAIL_STEP || '0',    10);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Faux groupes ─────────────────────────────────────────────────────────────

// Rôles avec localisation — FR change en MG, US, SG, LUX, IND
// 28 rôles avec localisation (FR/MG/US/SG/LUX/IND) — CEO/CFO/Directeur Marketing/DRH sont globaux
const LOCATION_ROLES = [
  'Administrative', 'Administrative responsible', 'Budget Manager', 'Cashflow Manager',
  'CEO',
  'Community Manager', 'Customer referencer', 'Email Manager',
  'HR', 'HR Reponsable', 'Infographiste', 'IT Person',
  'LeadGen', 'Legal', 'Management Control', 'Marketing Manager',
  'Office Manager', 'Operation', 'Operation On boarder', 'Recruiter',
  'Sales (Cold)', 'Sales (Hot)', 'Sales Cold Team Director', 'Sales Cold Team Manager',
  'Sales Manager', 'Team Director', 'Team Manager', 'Webmaster',
];
const MOCK_LOCATIONS = ['FR', 'MG', 'US', 'SG', 'LUX', 'IND'];

// Génération de toutes les combinaisons Rôle × Localisation + groupes globaux
const MOCK_GROUPS = [
  ...LOCATION_ROLES.flatMap(role =>
    MOCK_LOCATIONS.map(loc => ({
      id: `mock-${role.toLowerCase().replace(/[\s()]/g, '-')}-${loc.toLowerCase()}`,
      displayName: `SP - ${role} ${loc}`,
    }))
  ),
  { id: 'mock-grp-cfo',     displayName: 'SP - CFO' },
  { id: 'mock-grp-dirmktg', displayName: 'SP - Directeur Marketing' },
  { id: 'mock-grp-drh',     displayName: 'SP - DRH' },
];

// ─── Fausses licences ─────────────────────────────────────────────────────────

const MOCK_LICENSES = [
  { skuId: 'mock-sku-e3',  skuPartNumber: 'SPE_E3',                displayName: 'Microsoft 365 E3',               available: 42, total: 100, consumed: 58 },
  { skuId: 'mock-sku-bp',  skuPartNumber: 'O365_BUSINESS_PREMIUM', displayName: 'Microsoft 365 Business Premium', available: 15, total: 50,  consumed: 35 },
  { skuId: 'mock-sku-ex1', skuPartNumber: 'EXCHANGESTANDARD',      displayName: 'Exchange Online (Plan 1)',        available: 8,  total: 20,  consumed: 12 },
  { skuId: 'mock-sku-pbi', skuPartNumber: 'POWER_BI_PRO',          displayName: 'Power BI Pro',                   available: 3,  total: 10,  consumed: 7  },
];

// ─── Fonctions mock ───────────────────────────────────────────────────────────

async function listGroups(search = '') {
  await sleep(DELAY / 2);
  if (!search) return MOCK_GROUPS;
  const q = search.toLowerCase();
  return MOCK_GROUPS.filter(g =>
    g.displayName.toLowerCase().includes(q) ||
    (g.description || '').toLowerCase().includes(q)
  );
}

async function addMemberToGroup(groupId, userId) {
  await sleep(DELAY);
  if (FAIL_STEP === 2)
    throw new Error('[MOCK] Accès refusé au groupe — permission manquante (simulation d\'erreur step 2)');
  return null;
}

async function listAvailableLicenses() {
  await sleep(DELAY / 2);
  return MOCK_LICENSES;
}

async function assignLicense(userId, skuId) {
  await sleep(DELAY);
  if (FAIL_STEP === 3)
    throw new Error('[MOCK] Quota de licences dépassé — aucun slot disponible (simulation d\'erreur step 3)');
  return null;
}

async function createUser({ firstName, lastName, email }) {
  await sleep(DELAY);
  if (FAIL_STEP === 1)
    throw new Error('[MOCK] UserPrincipalName déjà utilisé dans Azure AD (simulation d\'erreur step 1)');
  const domain = process.env.DEFAULT_DOMAIN || 'monentreprise.com';
  const slug = `${firstName}.${lastName}`
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.]/g, '');
  return {
    id: `mock-user-${uuidv4()}`,
    displayName: `${firstName} ${lastName}`,
    userPrincipalName: email || `${slug}@${domain}`,
    givenName: firstName,
    surname: lastName,
    temporaryPassword: generatePassword(12),
  };
}

async function getGroupById(id) {
  await sleep(DELAY / 4);
  const grp = MOCK_GROUPS.find(g => g.id === id);
  if (grp) return grp;
  // En mode mock, tout UUID valide est accepté (les vrais IDs Azure AD sont inconnus du mock)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return { id, displayName: `Group (${id.slice(0, 8)}…)` };
  const e = new Error('Group not found'); e.graphStatus = 404; throw e;
}

async function deleteUser(userId) {
  await sleep(DELAY / 2);
  return null;
}

module.exports = {
  listGroups,
  addMemberToGroup,
  getGroupById,
  listAvailableLicenses,
  assignLicense,
  createUser,
  deleteUser,
};
