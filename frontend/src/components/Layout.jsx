import { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../context/UserContext';

/* ── SVG icon system (no emoji — ui-ux-pro-max rule) ─────────────── */
function Icon({ path, size = 16 }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', overflow: 'visible' }}
    >
      {Array.isArray(path)
        ? path.map((d, i) => <path key={i} d={d} stroke="currentColor" fill="none" />)
        : <path d={path} stroke="currentColor" fill="none" />}
    </svg>
  );
}

const ICONS = {
  dashboard:    ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  new:          'M12 5v14M5 12h14',
  history:      'M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  admin:        ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'],
  security:     'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  offboarding:  'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1',
  logout:       ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  chevronDown:  'M6 9l6 6 6-6',
  panelClose:   ['M11 3H3v18h8', 'M15 9l-3 3 3 3'],
  panelOpen:    ['M3 3h8v18H3', 'M13 9l3 3-3 3'],
  beaker:       ['M9 3h6', 'M10 9L4.5 18A2 2 0 0 0 6 21h12a2 2 0 0 0 1.5-3L14 9', 'M9 3v6m6-6v6'],
};

/* ── Nav config ───────────────────────────────────────────────────── */
const NAV_GROUPS = [
  {
    items: [
      { to: '/',        label: 'Dashboard',         icon: 'dashboard',   end: true },
      { to: '/new',     label: 'Nouvel onboarding', icon: 'new' },
      { to: '/history', label: 'Historique',         icon: 'history' },
    ],
  },
  {
    heading: 'Administration',
    adminOnly: true,
    items: [
      { to: '/admin',       label: 'Administration', icon: 'admin' },
      { to: '/security',    label: 'Sécurité',       icon: 'security' },
      { to: '/offboarding', label: 'Offboarding',    icon: 'offboarding', danger: true },
    ],
  },
];

const ROUTE_LABELS = {
  '/':            'Dashboard',
  '/new':         'Nouvel onboarding',
  '/history':     'Historique',
  '/admin':       'Administration',
  '/security':    'Sécurité',
  '/offboarding': 'Offboarding',
};

/* ── NavLink item ─────────────────────────────────────────────────── */
function SidebarLink({ item }) {
  const danger = !!item.danger;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '7px 10px',
        borderRadius: 7,
        fontSize: 13,
        fontWeight: isActive ? 600 : 400,
        textDecoration: 'none',
        cursor: 'pointer',
        transition: 'background var(--transition), color var(--transition)',
        color: isActive
          ? (danger ? '#ef4444' : 'var(--text)')
          : (danger ? 'var(--muted)' : 'var(--muted)'),
        background: isActive
          ? (danger ? 'rgba(239,68,68,.1)' : 'rgba(79,70,229,.12)')
          : 'transparent',
        outline: 'none',
        marginBottom: 1,
      })}
      onMouseEnter={e => {
        const active = e.currentTarget.getAttribute('aria-current') === 'page';
        if (!active) {
          e.currentTarget.style.background = danger ? 'rgba(239,68,68,.07)' : 'var(--surface2)';
          e.currentTarget.style.color = danger ? '#ef4444' : 'var(--text2)';
        }
      }}
      onMouseLeave={e => {
        const active = e.currentTarget.getAttribute('aria-current') === 'page';
        if (!active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--muted)';
        }
      }}
      onFocus={e => {
        e.currentTarget.style.boxShadow = '0 0 0 2px var(--primary)';
      }}
      onBlur={e => {
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <span style={{ display: 'flex', flexShrink: 0, opacity: .7 }}>
        <Icon path={ICONS[item.icon]} size={15} />
      </span>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {item.label}
      </span>
    </NavLink>
  );
}

/* ── Layout ───────────────────────────────────────────────────────── */
export default function Layout() {
  const { user, logout, mockMode } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(true);
  const [wsHover, setWsHover] = useState(false);

  const pageLabel = ROUTE_LABELS[location.pathname] ?? 'Onboarding';
  const initials  = user?.name?.[0]?.toUpperCase() ?? '?';

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── Skip link (keyboard accessibility) ───────────────── */}
      <a
        href="#main-content"
        style={{
          position: 'absolute', top: -40, left: 0,
          background: 'var(--primary)', color: '#fff',
          padding: '8px 16px', borderRadius: 6, zIndex: 9999,
          fontSize: 13, fontWeight: 600, textDecoration: 'none',
          transition: 'top .15s',
        }}
        onFocus={e => { e.currentTarget.style.top = '8px'; }}
        onBlur={e => { e.currentTarget.style.top = '-40px'; }}
      >
        Aller au contenu principal
      </a>

      {/* ── Sidebar ──────────────────────────────────────────── */}
      <div
        role="navigation"
        aria-label="Navigation principale"
        style={{
          width: open ? 'var(--sidebar-w)' : 0,
          minWidth: open ? 'var(--sidebar-w)' : 0,
          overflow: 'hidden',
          transition: 'width 280ms cubic-bezier(.4,0,.2,1), min-width 280ms cubic-bezier(.4,0,.2,1)',
          flexShrink: 0,
          background: 'var(--surface)',
          borderRight: open ? '1px solid var(--border)' : 'none',
          height: '100vh',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ width: 'var(--sidebar-w)', display: 'flex', flexDirection: 'column', height: '100%', padding: '12px 8px' }}>

          {/* Workspace / user switcher — arunjdass pattern */}
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 8px', borderRadius: 9, marginBottom: 14,
              background: wsHover ? 'var(--surface2)' : 'transparent',
              cursor: 'pointer',
              transition: 'background var(--transition)',
              userSelect: 'none',
            }}
            onMouseEnter={() => setWsHover(true)}
            onMouseLeave={() => setWsHover(false)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {/* Avatar with indigo gradient — Enterprise SaaS style */}
              <div style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: '#fff',
                boxShadow: '0 2px 8px rgba(79,70,229,.4)',
              }}>
                {initials}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
                  {user?.name ?? 'Utilisateur'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                  {user?.role === 'admin' ? 'Administrateur' : 'Membre'}
                </div>
              </div>
            </div>
            <span style={{ color: 'var(--muted)', opacity: .5, flexShrink: 0 }}>
              <Icon path={ICONS.chevronDown} size={14} />
            </span>
          </div>

          {/* Nav groups */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {NAV_GROUPS.map((group, i) => {
              if (group.adminOnly && user?.role !== 'admin') return null;
              return (
                <div key={i}>
                  {group.heading && (
                    <div style={{
                      padding: '4px 10px 5px',
                      fontSize: 10, fontWeight: 700,
                      letterSpacing: '.8px', textTransform: 'uppercase',
                      color: 'rgba(148,163,184,.45)',
                      userSelect: 'none',
                    }}>
                      {group.heading}
                    </div>
                  )}
                  {group.items.map(item => (
                    <SidebarLink key={item.to} item={item} />
                  ))}
                </div>
              );
            })}
          </div>

          {/* Logout */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
            <button
              onClick={handleLogout}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                width: '100%', padding: '7px 10px', borderRadius: 7,
                background: 'transparent', border: 'none',
                color: 'var(--muted)', fontSize: 13, fontWeight: 400,
                cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                transition: 'background var(--transition), color var(--transition)',
                outline: 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,.08)'; e.currentTarget.style.color = '#ef4444'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
              onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px #ef4444'; }}
              onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
            >
              <span style={{ display: 'flex', flexShrink: 0, opacity: .7 }}>
                <Icon path={ICONS.logout} size={15} />
              </span>
              Déconnexion
            </button>
          </div>
        </div>
      </div>

      {/* ── Main ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Top bar */}
        <header style={{
          height: 52, flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex', alignItems: 'center',
          padding: '0 20px', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Toggle button */}
            <button
              onClick={() => setOpen(v => !v)}
              aria-label={open ? 'Fermer la navigation' : 'Ouvrir la navigation'}
              aria-expanded={open}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 7,
                background: 'transparent', border: 'none',
                color: 'var(--muted)', cursor: 'pointer',
                transition: 'background var(--transition), color var(--transition)',
                outline: 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.color = 'var(--text)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
              onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--primary)'; }}
              onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
            >
              <Icon path={open ? ICONS.panelClose : ICONS.panelOpen} size={17} />
            </button>

            {/* Breadcrumb */}
            <nav aria-label="Fil d'Ariane" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
              <span style={{ color: 'var(--muted)' }}>Onboarding M365</span>
              <span style={{ color: 'var(--border)', fontSize: 16 }}>/</span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{pageLabel}</span>
            </nav>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {user?.role === 'admin' && (
              <span style={{
                fontSize: 11, fontWeight: 600, letterSpacing: '.3px',
                background: 'var(--primary-soft)',
                color: '#a5b4fc',
                padding: '3px 9px', borderRadius: 999,
                border: '1px solid rgba(79,70,229,.3)',
              }}>
                Admin
              </span>
            )}
            <div
              title={user?.name}
              style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, color: '#fff',
                boxShadow: '0 0 0 2px var(--surface), 0 0 0 3px rgba(79,70,229,.4)',
              }}
            >
              {initials}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main id="main-content" style={{ flex: 1, padding: '28px 32px', overflowY: 'auto' }}>
          {mockMode && (
            <div role="alert" style={{
              background: 'var(--warning-bg)',
              border: '1px solid rgba(245,158,11,.3)',
              borderRadius: 9, padding: '10px 16px',
              marginBottom: 22, fontSize: 13, color: '#fbbf24',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ display: 'flex', flexShrink: 0 }}>
                <Icon path={ICONS.beaker} size={16} />
              </span>
              <div>
                <strong>Mode développement</strong> — Graph API simulée.
                Aucun compte Microsoft 365 réel n'est créé.
              </div>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
