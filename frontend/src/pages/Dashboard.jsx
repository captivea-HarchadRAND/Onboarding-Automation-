import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function StatCard({ label, value, icon, color, highlight }) {
  return (
    <div className="card" style={{
      display: 'flex', alignItems: 'center', gap: 16,
      border: highlight ? `1px solid ${color}40` : undefined,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10,
        background: color + '20',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, flexShrink: 0,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)' }}>{value ?? '—'}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    done:    { label: 'Terminé',    cls: 'badge-done' },
    failed:  { label: 'Échoué',     cls: 'badge-failed' },
    running: { label: 'En cours',   cls: 'badge-running' },
    pending: { label: 'En attente', cls: 'badge-pending' },
  };
  const s = map[status] || { label: status, cls: 'badge-pending' };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

const MS_BUSINESS_FILTER = n => n.includes('Microsoft 365') || n.includes('Office 365');

export default function Dashboard() {
  const [stats,       setStats]       = useState(null);
  const [licenses,    setLicenses]    = useState(null);
  const [licUpdated,  setLicUpdated]  = useState(null);
  const [error,       setError]       = useState('');
  const licTimer = useRef(null);

  function fetchLicenses() {
    api.get('/api/graph/licenses')
      .then(data => { setLicenses(data.filter(l => MS_BUSINESS_FILTER(l.displayName))); setLicUpdated(new Date()); })
      .catch(() => setLicenses([]));
  }

  useEffect(() => {
    api.get('/api/stats').then(setStats).catch(e => setError(e.message));
    fetchLicenses();
    licTimer.current = setInterval(fetchLicenses, 60_000);
    return () => clearInterval(licTimer.current);
  }, []);

  const rate = stats && stats.thisMonth > 0
    ? Math.round((stats.done / stats.thisMonth) * 100)
    : null;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <Link to="/new">
          <button className="btn btn-primary">🚀 Nouvel onboarding</button>
        </Link>
      </div>

      {error && <div className="error-box">{error}</div>}

      {stats && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16, marginBottom: 28 }}>
            <StatCard label="Total onboardings"  value={stats.total}      icon="📊" color="#2563eb" />
            <StatCard label="Ce mois-ci"          value={stats.thisMonth}  icon="📅" color="#22c55e" />
            <StatCard label="Réussis ce mois"     value={stats.done}       icon="✅" color="#22c55e" />
            <StatCard label="Échoués ce mois"     value={stats.failed}     icon="❌" color="#ef4444" />
            <StatCard label="En cours"            value={stats.running}    icon="⏳" color="#06b6d4" highlight={stats.running > 0} />
            {rate !== null && <StatCard label="Taux de succès" value={`${rate}%`} icon="🎯" color="#f59e0b" />}
          </div>

          {licenses !== null && licenses.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>🪟</span>
                  <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Licences Microsoft disponibles</h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {licUpdated && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Mis à jour {licUpdated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>}
                  <button type="button" onClick={fetchLicenses} title="Actualiser" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', color: 'var(--muted)', fontSize: 13 }}>↻</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {licenses.map(lic => {
                  const pct      = lic.total > 0 ? Math.round((lic.consumed / lic.total) * 100) : 0;
                  const lowStock = lic.available <= Math.max(2, Math.round(lic.total * 0.1));
                  return (
                    <div key={lic.skuId}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{lic.displayName}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: lowStock ? '#ef4444' : '#22c55e', whiteSpace: 'nowrap', marginLeft: 12 }}>
                          {lic.available} / {lic.total} dispo
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 4, background: lowStock ? '#ef4444' : pct > 80 ? '#f59e0b' : '#2563eb', transition: 'width .4s' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stats.recent?.length > 0 ? (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Activité récente</h2>
                <Link to="/history" style={{ fontSize: 13, color: 'var(--primary)' }}>Voir tout →</Link>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employé</th>
                      <th>Rôle</th>
                      <th>Localisation</th>
                      <th>Statut</th>
                      <th>Par</th>
                      <th>Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recent.map(o => (
                      <tr key={o.id}>
                        <td style={{ fontWeight: 500, color: 'var(--text)' }}>
                          <div>{o.employee_firstname} {o.employee_lastname}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{o.employee_email}</div>
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--text2)' }}>{o.job_role || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                        <td style={{ fontSize: 13, color: 'var(--text2)' }}>{o.location || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                        <td><StatusBadge status={o.status} /></td>
                        <td style={{ color: 'var(--muted)', fontSize: 13 }}>{o.created_by_name}</td>
                        <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                          {new Date(o.created_at).toLocaleDateString('fr-FR')}
                        </td>
                        <td>
                          <Link to={`/history/${o.id}`} style={{ fontSize: 12, color: 'var(--primary)' }}>Détails</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="empty-state">
                <div className="icon">🚀</div>
                <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Aucun onboarding</div>
                <div style={{ marginBottom: 16, fontSize: 13 }}>Commencez par onboarder votre premier employé.</div>
                <Link to="/new"><button className="btn btn-primary">Démarrer →</button></Link>
              </div>
            </div>
          )}
        </>
      )}

      {!stats && !error && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 60 }}>
          <span className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      )}
    </div>
  );
}
