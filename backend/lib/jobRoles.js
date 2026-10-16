// [EN-TÊTE] jobRoles.js (serveur) — postes connus et convention de nommage des groupes principaux « SP - … ».
// COPIE de frontend/src/jobRoles.js (JOB_ROLES) et de GLOBAL_ROLES (NewOnboarding.jsx, ManualOnboarding.jsx, Transfer.jsx) :
// toute modification d'un côté doit être reportée de l'autre.
// Sert à reconnaître un groupe principal fabriqué par l'app : « SP - {clé du poste} {code pays} », ou « SP - {clé} » pour un
// poste global (préfixe historique « 2024_ » accepté). Un groupe « SP … » d'un autre usage (ex. « SP Legal Archive ») n'est
// donc jamais pris pour un groupe de poste : il n'est ni retiré lors d'une mutation, ni accepté comme groupe principal.

const JOB_ROLES = [
  { label: 'Administrative responsible',  groupKey: 'Administrative responsible' },
  { label: 'Budget Manager',              groupKey: 'Budget Manager' },
  { label: 'Cashflow Manager',            groupKey: 'Cashflow Manager' },
  { label: 'CEO',                         groupKey: 'CEO' },
  { label: 'CFO',                         groupKey: 'CFO' },
  { label: 'Community Manager',           groupKey: 'Community Manager' },
  { label: 'Customer referencer',         groupKey: 'Customer referencer' },
  { label: 'Directeur Marketing',         groupKey: 'Directeur Marketing' },
  { label: 'DRH',                         groupKey: 'DRH' },
  { label: 'Email Manager',               groupKey: 'Email Manager' },
  { label: 'HR',                          groupKey: 'HR' },
  { label: 'HR Reponsable',               groupKey: 'HR Responsable' }, // libellé historique conservé (réglages) ; groupes Entra « SP - HR Responsable … »
  { label: 'Infographiste',               groupKey: 'Infographiste' },
  { label: 'IT Person',                   groupKey: 'IT Person' },
  { label: 'LeadGen',                     groupKey: 'LeadGen' },
  { label: 'Legal',                       groupKey: 'Legal' },
  { label: 'Management Control',          groupKey: 'Management Control' },
  { label: 'Marketing Manager',           groupKey: 'Marketing Manager' },
  { label: 'Office Manager',              groupKey: 'Office Manager' },
  { label: 'Operation',                   groupKey: 'Operation' },
  { label: 'Operation On boarder',        groupKey: 'Operation On boarder' },
  { label: 'Recruiter',                   groupKey: 'Recruiter' },
  { label: 'Sales Development Represent', groupKey: 'Sales (Cold)' },
  { label: 'Sales (Hot)',                 groupKey: 'Sales (Hot)' },
  { label: 'Sales Cold Team Director',    groupKey: 'Sales Cold Team Director' },
  { label: 'Sales Cold Team Manager',     groupKey: 'Sales Cold Team Manager' },
  { label: 'Sales Manager',               groupKey: 'Sales Manager' },
  { label: 'Team Director',               groupKey: 'Team Director' },
  { label: 'Team Manager',                groupKey: 'Team Manager' },
  { label: 'Webmaster',                   groupKey: 'Webmaster' },
];
const GLOBAL_ROLES = new Set(['CFO', 'Directeur Marketing', 'DRH']);

// Comparaison de noms de groupes : sans le préfixe « 2024_ », espaces réduits, sans casse.
const groupNameKey = s => String(s || '').replace(/^2024_/, '').replace(/\s+/g, ' ').trim().toLowerCase();

const groupKeyOf = role => (JOB_ROLES.find(r => r.label === String(role || '').trim()) || {}).groupKey || String(role || '').trim();

// Nom du groupe principal attendu pour un poste et un pays (null si pas de poste).
function expectedPrimaryGroupName(jobRole, location) {
  const role = String(jobRole || '').trim();
  if (!role) return null;
  return GLOBAL_ROLES.has(role) ? `SP - ${groupKeyOf(role)}` : `SP - ${groupKeyOf(role)} ${String(location || '').trim()}`;
}

// Tous les noms de groupes principaux que l'app peut fabriquer, pour les codes pays donnés (normalisés).
function primaryGroupNames(locationCodes) {
  const names = new Set();
  for (const r of JOB_ROLES) {
    if (GLOBAL_ROLES.has(r.label)) { names.add(groupNameKey(`SP - ${r.groupKey}`)); continue; }
    for (const code of locationCodes) names.add(groupNameKey(`SP - ${r.groupKey} ${code}`));
  }
  return names;
}

module.exports = { JOB_ROLES, GLOBAL_ROLES, groupNameKey, expectedPrimaryGroupName, primaryGroupNames };
