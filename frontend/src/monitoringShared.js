// Constantes d'affichage partagées par les pages du module Monitoring.
export const TOOLS = [
  { key: 'claude',    color: '#818cf8' },
  { key: 'chatgpt',   color: '#22d3ee' },
  { key: 'fireflies', color: '#f472b6' },
];

export const LEVELS = {
  rouge:  { label: 'Inactif · 2 mois ou plus',  color: '#ef4444', bg: 'rgba(239,68,68,.14)',  border: 'rgba(239,68,68,.34)' },
  orange: { label: 'Pas utilisé ce mois-ci', color: '#fb923c', bg: 'rgba(249,115,22,.14)', border: 'rgba(249,115,22,.32)' },
  jaune:  { label: 'Utilise peu',  color: '#facc15', bg: 'rgba(234,179,8,.14)',  border: 'rgba(234,179,8,.32)' },
  vert:   { label: 'Utilise',   color: '#22c55e', bg: 'rgba(34,197,94,.12)',  border: 'rgba(34,197,94,.28)' },
};
