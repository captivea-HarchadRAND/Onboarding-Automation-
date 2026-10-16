// Registre des modules du portail. Ajouter un module = ajouter une entrée ici (et ses routes dans
// App.jsx) : la page Portail et la navigation latérale se construisent à partir de cette liste.

export const MODULE_ICONS = {
  portal:     ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
  onboarding: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M19 8v6', 'M22 11h-6'],
  monitoring: ['M22 12h-4l-3 9L9 3l-3 9H2'],
};

export const MODULES = [
  {
    id: 'onboarding',
    label: 'Onboarding',
    description: 'Créer, muter et suivre les comptes Microsoft 365 des employés : groupes, licences, GitHub.',
    to: '/dashboard',
    icon: 'onboarding',
    color: '#818cf8',
    prefixes: ['/dashboard', '/new', '/mailbox-access', '/transfer', '/history', '/admin', '/security', '/offboarding'],
    nav: [
      { to: '/dashboard', label: 'Dashboard',                icon: 'dashboard' },
      { to: '/new',       label: 'Nouvel onboarding',        icon: 'new' },
      { to: '/mailbox-access', label: 'Accès boîtes partagées', icon: 'mailbox', adminOnly: true },
      { to: '/transfer',  label: 'Changement de poste/pays', icon: 'transfer', adminOnly: true },
      { to: '/history',   label: 'Historique',               icon: 'history' },
    ],
    // Pages d'administration propres au module Onboarding (visibles uniquement dans ce module).
    adminNav: [
      { to: '/admin',       label: 'Administration', icon: 'admin' },
      { to: '/security',    label: 'Sécurité',       icon: 'security' },
      { to: '/offboarding', label: 'Offboarding',    icon: 'offboarding', danger: true },
    ],
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    description: "Suivre l'usage des licences IA (Claude, ChatGPT, Fireflies) et classer les comptes à surveiller.",
    to: '/monitoring',
    icon: 'monitoring',
    color: '#22d3ee',
    prefixes: ['/monitoring'],
    nav: [
      { to: '/monitoring', label: 'Licences IA', icon: 'monitoring', end: true },
    ],
    // Administration du module : emplacement des rapports (SharePoint) et prix des licences.
    adminNav: [
      { to: '/monitoring/admin', label: 'Administration', icon: 'admin' },
    ],
  },
];

// Un administrateur accède à tous les modules ; les autres, à ceux que l'admin leur a accordés
// (Gestion du portail). Le serveur applique la même règle : ceci ne fait que masquer l'interface.
export function canAccess(user, moduleId) {
  return !!user?.modules?.includes(moduleId);
}

export function moduleForPath(pathname) {
  return MODULES.find(m => m.prefixes.some(p => pathname === p || pathname.startsWith(p + '/'))) || null;
}
