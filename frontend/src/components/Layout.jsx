import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';

const NAV = [
  { to: '/',        label: 'Dashboard',         icon: '📊', end: true },
  { to: '/new',     label: 'Nouvel onboarding', icon: '🚀' },
  { to: '/history', label: 'Historique',         icon: '📋' },
];

export default function Layout() {
  const { user, logout, mockMode } = useUser();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 'var(--sidebar-w)',
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0, left: 0, bottom: 0,
        zIndex: 10,
      }}>
        {/* Logo */}
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34,
              background: 'var(--primary)',
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>🚀</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Onboarding</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Microsoft 365</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {NAV.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 10px',
                borderRadius: 6,
                color: isActive ? 'var(--text)' : 'var(--muted)',
                background: isActive ? 'var(--surface2)' : 'transparent',
                fontWeight: isActive ? 600 : 400,
                fontSize: 13,
                textDecoration: 'none',
                marginBottom: 2,
                transition: 'all .15s',
              })}
            >
              <span style={{ fontSize: 15 }}>{icon}</span>
              {label}
            </NavLink>
          ))}

          {user?.role === 'admin' && (
            <NavLink
              to="/admin"
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 10px',
                borderRadius: 6,
                color: isActive ? 'var(--text)' : 'var(--muted)',
                background: isActive ? 'var(--surface2)' : 'transparent',
                fontWeight: isActive ? 600 : 400,
                fontSize: 13,
                textDecoration: 'none',
                marginTop: 8,
                borderTop: '1px solid var(--border)',
                paddingTop: 12,
                transition: 'all .15s',
              })}
            >
              <span style={{ fontSize: 15 }}>⚙️</span>
              Administration
            </NavLink>
          )}
        </nav>

        {/* User */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 30, height: 30,
              borderRadius: '50%',
              background: 'var(--primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, color: '#fff',
              flexShrink: 0,
            }}>
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'capitalize' }}>{user?.role}</div>
            </div>
          </div>
          <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', fontSize: 12 }} onClick={handleLogout}>
            Déconnexion
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 32px', minHeight: '100vh' }}>
        {mockMode && (
          <div style={{
            background: 'rgba(245,158,11,.12)',
            border: '1px solid rgba(245,158,11,.35)',
            borderRadius: 8,
            padding: '10px 16px',
            marginBottom: 22,
            fontSize: 13,
            color: '#b45309',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ fontSize: 16 }}>🧪</span>
            <div>
              <strong>Mode développement</strong> — Graph API simulée.
              Aucun compte Microsoft 365 réel n'est créé. Les données sont fictives.
            </div>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
