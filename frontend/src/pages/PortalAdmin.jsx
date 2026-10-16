// [EN-TÊTE] PortalAdmin.jsx — « Gestion du portail » (/portal-admin), réservée au super administrateur : en-tête + <UsersManager />.

import { useUser } from '../context/UserContext';
import UsersManager from '../components/UsersManager';
import { MODULE_ICONS } from '../modules';

function Icon({ path, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', overflow: 'visible' }}>
      {path.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// Gestion du portail : utilisateurs de la plateforme et accès de chacun aux modules.
export default function PortalAdmin() {
  const { user: me } = useUser();
  return (
    <div>
      <div style={{ marginBottom: 22, position: 'relative' }}>
        <div aria-hidden="true" style={{ position: 'absolute', top: -24, left: '5%', width: 300, height: 100, background: 'radial-gradient(ellipse, rgba(245,158,11,.08) 0%, transparent 70%)', pointerEvents: 'none', filter: 'blur(20px)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '3px 10px', borderRadius: 999, border: '1px solid rgba(245,158,11,.2)', background: 'rgba(245,158,11,.06)' }}>
            <Icon path={MODULE_ICONS.portal} size={11} />
            <span style={{ fontSize: 11, color: 'rgba(245,158,11,.7)', fontWeight: 500, letterSpacing: '.3px' }}>Portail</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', margin: 0, background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Gestion du portail
          </h1>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Crée les utilisateurs et choisis les modules auxquels chacun a accès.
          </p>
        </div>
      </div>
      <UsersManager me={me} />
    </div>
  );
}
