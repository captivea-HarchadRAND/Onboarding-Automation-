// Modules du portail et accès par utilisateur.
//   - `users.modules` contient la liste accordée (JSON) ; NULL = jamais configuré :
//       administrateur → tous les modules ; autre rôle → Onboarding seul (comportement historique) ;
//   - seul un super administrateur peut fixer la liste d'un administrateur, et un super administrateur
//     a toujours accès à tout (voir modulesFor dans server.js).
const MODULES = {
  onboarding: { label: 'Onboarding' },
  monitoring: { label: 'Monitoring' },
};
const DEFAULT_MODULES = ['onboarding'];

function effectiveModules(user) {
  const fallback = user?.role === 'admin' ? Object.keys(MODULES) : [...DEFAULT_MODULES];
  if (user?.modules == null || user.modules === '') return fallback;
  try {
    const list = JSON.parse(user.modules);
    return Array.isArray(list) ? list.filter(m => Object.hasOwn(MODULES, m)) : fallback;
  } catch (_) {
    return fallback;
  }
}

// Valide la liste envoyée par l'admin : tableau d'identifiants connus, sans doublon.
function parseModules(input) {
  if (!Array.isArray(input) || input.length > Object.keys(MODULES).length) {
    throw Object.assign(new Error('Liste de modules invalide'), { httpStatus: 400 });
  }
  const out = [];
  for (const m of input) {
    if (typeof m !== 'string' || !Object.hasOwn(MODULES, m)) {
      throw Object.assign(new Error(`Module inconnu : ${String(m).slice(0, 30)}`), { httpStatus: 400 });
    }
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

module.exports = { MODULES, DEFAULT_MODULES, effectiveModules, parseModules };
