import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

/* ── SVG icons ───────────────────────────────────────────────────── */
function Icon({ path, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', overflow: 'visible' }}>
      {Array.isArray(path)
        ? path.map((d, i) => <path key={i} d={d} stroke="currentColor" fill="none" />)
        : <path d={path} stroke="currentColor" fill="none" />}
    </svg>
  );
}

const ICONS = {
  total:     ['M3 3h18v18H3z', 'M3 9h18', 'M3 15h18', 'M9 3v18', 'M15 3v18'],
  calendar:  ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11'],
  check:     ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4 12 14.01l-3-3'],
  xCircle:   ['M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z', 'M15 9l-6 6', 'M9 9l6 6'],
  clock:     ['M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z', 'M12 6v6l4 2'],
  target:    ['M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  windows:   ['M3 3h8v8H3z', 'M13 3h8v8h-8z', 'M3 13h8v8H3z', 'M13 13h8v8h-8z'],
  refresh:   ['M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16', 'M16 16h5v5'],
  arrowRight:['M5 12h14', 'M12 5l7 7-7 7'],
  plus:      ['M12 5v14', 'M5 12h14'],
  rocket:    ['M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z', 'M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z', 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0', 'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5'],
  eye:       ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
};

/* ── Status badge ────────────────────────────────────────────────── */
const STATUS = {
  done:    { label: 'Terminé',    bg: 'rgba(34,197,94,.12)',  color: '#22c55e' },
  failed:  { label: 'Échoué',     bg: 'rgba(239,68,68,.12)',  color: '#ef4444' },
  running: { label: 'En cours',   bg: 'rgba(6,182,212,.12)',  color: '#06b6d4' },
  pending: { label: 'En attente', bg: 'rgba(148,163,184,.1)', color: '#94a3b8' },
};

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 9px', borderRadius: 999,
      fontSize: 11, fontWeight: 600, letterSpacing: '.2px',
      background: s.bg, color: s.color, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

/* ── Compact stat card ───────────────────────────────────────────── */
function StatCard({ label, value, iconKey, color, highlight }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${highlight ? color + '40' : 'var(--border)'}`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: highlight ? `0 0 16px ${color}18` : `0 1px 3px rgba(0,0,0,.2)`,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 9, flexShrink: 0,
        background: color + '15', border: `1px solid ${color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color,
      }}>
        <Icon path={ICONS[iconKey]} size={16} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
          {value ?? '—'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, fontWeight: 600, letterSpacing: '.4px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          {label}
        </div>
      </div>
    </div>
  );
}

/* ── License bar ─────────────────────────────────────────────────── */
function LicenseRow({ lic }) {
  const pct      = lic.total > 0 ? Math.round((lic.consumed / lic.total) * 100) : 0;
  const lowStock = lic.available <= Math.max(2, Math.round(lic.total * 0.1));
  const bar      = lowStock ? '#ef4444' : pct > 80 ? '#f59e0b' : '#4f46e5';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{lic.displayName}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: lowStock ? '#ef4444' : '#22c55e', whiteSpace: 'nowrap', marginLeft: 10 }}>
          {lic.available} / {lic.total}
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 99, background: 'var(--surface2)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: bar, transition: 'width .5s ease', boxShadow: `0 0 6px ${bar}55` }} />
      </div>
    </div>
  );
}

const MS_FILTER = n => n.includes('Microsoft 365') || n.includes('Office 365');

/* ── Dashboard ───────────────────────────────────────────────────── */
export default function Dashboard() {
  const [stats,      setStats]      = useState(null);
  const [licenses,   setLicenses]   = useState(null);
  const [licUpdated, setLicUpdated] = useState(null);
  const [error,      setError]      = useState('');
  const timer = useRef(null);

  function fetchLicenses() {
    api.get('/api/graph/licenses')
      .then(data => { setLicenses(data.filter(l => MS_FILTER(l.displayName))); setLicUpdated(new Date()); })
      .catch(() => setLicenses([]));
  }

  useEffect(() => {
    api.get('/api/stats').then(setStats).catch(e => setError(e.message));
    fetchLicenses();
    timer.current = setInterval(fetchLicenses, 60_000);
    return () => clearInterval(timer.current);
  }, []);

  const rate = stats?.thisMonth > 0
    ? Math.round((stats.done / stats.thisMonth) * 100)
    : null;

  /* viewport-fill: 100vh minus topbar (52px) and main padding (28px×2) */
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>

      {/* ── Hero (compact horizontal) ─────────────────────────── */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div aria-hidden="true" style={{
          position: 'absolute', top: -40, left: '10%', width: 400, height: 120,
          background: 'radial-gradient(ellipse, rgba(79,70,229,.2) 0%, transparent 70%)',
          pointerEvents: 'none', filter: 'blur(30px)', zIndex: 0,
        }} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '3px 12px', borderRadius: 999, marginBottom: 6,
              border: '1px solid rgba(255,255,255,.09)', background: 'rgba(255,255,255,.04)',
            }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', fontWeight: 600, letterSpacing: '.4px', textTransform: 'uppercase' }}>
                Microsoft 365
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
                Graph API <Icon path={ICONS.arrowRight} size={10} />
              </span>
            </div>
            <h1 style={{
              fontSize: 24, fontWeight: 800, lineHeight: 1.15, margin: 0,
              letterSpacing: '-0.04em',
              background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              Onboarding Microsoft 365
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {error && <span style={{ fontSize: 12, color: '#ef4444' }}>{error}</span>}
            <Link to="/new" style={{ textDecoration: 'none' }}>
              <button style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                color: '#fff', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 0 16px rgba(79,70,229,.4)',
                transition: 'transform var(--transition), box-shadow var(--transition)',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.boxShadow = '0 0 24px rgba(79,70,229,.55)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 0 16px rgba(79,70,229,.4)'; }}
                onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79,70,229,.6)'; }}
                onBlur={e => { e.currentTarget.style.boxShadow = '0 0 16px rgba(79,70,229,.4)'; }}
              >
                <Icon path={ICONS.plus} size={14} />
                Nouvel onboarding
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Stat cards ────────────────────────────────────────── */}
      {stats && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${rate !== null ? 6 : 5}, 1fr)`,
          gap: 12, flexShrink: 0,
        }}>
          <StatCard label="Total"    value={stats.total}     iconKey="total"    color="#4f46e5" />
          <StatCard label="Ce mois"  value={stats.thisMonth} iconKey="calendar" color="#22c55e" />
          <StatCard label="Réussis"  value={stats.done}      iconKey="check"    color="#22c55e" />
          <StatCard label="Échoués"  value={stats.failed}    iconKey="xCircle"  color="#ef4444" />
          <StatCard label="En cours" value={stats.running}   iconKey="clock"    color="#06b6d4" highlight={stats.running > 0} />
          {rate !== null && <StatCard label="Taux réussite" value={`${rate}%`} iconKey="target" color="#f59e0b" />}
        </div>
      )}

      {!stats && !error && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
          <span className="spinner" style={{ width: 26, height: 26 }} />
        </div>
      )}

      {/* ── Bottom row: licenses + recent activity ─────────────── */}
      {stats && (
        <div style={{ display: 'flex', gap: 14 }}>

          {/* Licenses panel */}
          {licenses !== null && licenses.length > 0 && (
            <div style={{
              width: 300, flexShrink: 0,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column',
              boxShadow: '0 1px 3px rgba(0,0,0,.2)', overflow: 'hidden',
            }}>
              {/* Card header */}
              <div style={{
                padding: '14px 16px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'rgba(255,255,255,.015)', flexShrink: 0,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                    background: 'rgba(79,70,229,.15)', border: '1px solid rgba(79,70,229,.25)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a5b4fc',
                  }}>
                    <Icon path={ICONS.windows} size={13} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      Licences M365
                    </div>
                    {licUpdated && (
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>
                        {licUpdated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button" onClick={fetchLicenses} aria-label="Actualiser les licences"
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: 7,
                    background: 'transparent', border: '1px solid var(--border)',
                    cursor: 'pointer', color: 'var(--muted)', fontFamily: 'inherit',
                    transition: 'background var(--transition), color var(--transition)', outline: 'none',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.color = 'var(--text)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
                  onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--primary)'; }}
                  onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <Icon path={ICONS.refresh} size={13} />
                </button>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {licenses.map(lic => <LicenseRow key={lic.skuId} lic={lic} />)}
              </div>
            </div>
          )}

          {/* Recent activity */}
          <div style={{
            flex: 1, minWidth: 0,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column',
            boxShadow: '0 1px 3px rgba(0,0,0,.2)', overflow: 'hidden',
          }}>
            {stats.recent?.length > 0 ? (
              <>
                {/* Card header */}
                <div style={{
                  padding: '14px 18px', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'rgba(255,255,255,.015)', flexShrink: 0,
                }}>
                  <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                    Activité récente
                  </h2>
                  <Link to="/history" style={{
                    fontSize: 12, color: '#a5b4fc', fontWeight: 500,
                    display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none',
                    transition: 'color var(--transition)',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#a5b4fc'; }}
                  >
                    Voir tout <Icon path={ICONS.arrowRight} size={11} />
                  </Link>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr style={{ background: 'var(--surface)' }}>
                        {['Employé', 'Rôle', 'Localisation', 'Statut', 'Par', 'Date', ''].map(h => (
                          <th key={h} style={{
                            textAlign: 'left', padding: '9px 14px',
                            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px',
                            color: 'var(--muted)', borderBottom: '1px solid var(--border)',
                            whiteSpace: 'nowrap', background: 'var(--surface)',
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.recent.map(o => (
                        <tr
                          key={o.id}
                          style={{ transition: 'background var(--transition)', cursor: 'default' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <td style={{ padding: '10px 14px', verticalAlign: 'middle', borderBottom: '1px solid rgba(51,65,85,.5)' }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                              {o.employee_firstname} {o.employee_lastname}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{o.employee_email}</div>
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text2)', verticalAlign: 'middle', borderBottom: '1px solid rgba(51,65,85,.5)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {o.job_role || <span style={{ color: 'var(--muted)' }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text2)', verticalAlign: 'middle', borderBottom: '1px solid rgba(51,65,85,.5)', whiteSpace: 'nowrap' }}>
                            {o.location || <span style={{ color: 'var(--muted)' }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 14px', verticalAlign: 'middle', borderBottom: '1px solid rgba(51,65,85,.5)' }}>
                            <StatusBadge status={o.status} />
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--muted)', verticalAlign: 'middle', borderBottom: '1px solid rgba(51,65,85,.5)', whiteSpace: 'nowrap' }}>
                            {o.created_by_name}
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--muted)', verticalAlign: 'middle', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(51,65,85,.5)' }}>
                            {new Date(o.created_at).toLocaleDateString('fr-FR')}
                          </td>
                          <td style={{ padding: '10px 14px', verticalAlign: 'middle', borderBottom: '1px solid rgba(51,65,85,.5)' }}>
                            <Link to={`/history/${o.id}`} style={{
                              fontSize: 12, color: '#a5b4fc', fontWeight: 500,
                              display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none',
                            }}
                              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; }}
                              onMouseLeave={e => { e.currentTarget.style.color = '#a5b4fc'; }}
                              onFocus={e => { e.currentTarget.style.outline = '2px solid var(--primary)'; e.currentTarget.style.borderRadius = '4px'; }}
                              onBlur={e => { e.currentTarget.style.outline = 'none'; }}
                            >
                              <Icon path={ICONS.eye} size={13} />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' }}>
                <div style={{ color: 'var(--muted)', opacity: .35, marginBottom: 16 }}>
                  <Icon path={ICONS.rocket} size={40} />
                </div>
                <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 8, fontSize: 14 }}>
                  Aucun onboarding pour le moment
                </div>
                <p style={{ marginBottom: 20, fontSize: 13, color: 'var(--muted)' }}>
                  Commencez par onboarder votre premier employé Microsoft 365.
                </p>
                <Link to="/new" style={{ textDecoration: 'none' }}>
                  <button style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '8px 16px', borderRadius: 8, border: 'none',
                    background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                    color: '#fff', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <Icon path={ICONS.plus} size={13} />
                    Démarrer
                  </button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
