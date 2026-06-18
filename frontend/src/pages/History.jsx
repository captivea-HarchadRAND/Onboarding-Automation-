import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function StatusBadge({ status }) {
  const map = {
    done:    { label: 'Terminé',       cls: 'badge-done' },
    failed:  { label: 'Échoué',        cls: 'badge-failed' },
    running: { label: 'En cours',      cls: 'badge-running' },
    pending: { label: 'En attente',    cls: 'badge-pending' },
    rolled_back: { label: 'Rollback',  cls: 'badge-rolled' },
  };
  const s = map[status] || { label: status, cls: 'badge-pending' };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export default function History() {
  const [onboardings, setOnboardings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');

  function load() {
    setLoading(true);
    const qs = filter ? `?status=${filter}` : '';
    api.get(`/api/onboardings${qs}`)
      .then(data => { setOnboardings(data); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filter]);

  // Poll si des onboardings sont en cours
  useEffect(() => {
    const hasRunning = onboardings.some(o => o.status === 'running' || o.status === 'pending');
    if (!hasRunning) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [onboardings]);

  const visible = onboardings.filter(o => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      o.employee_firstname?.toLowerCase().includes(q) ||
      o.employee_lastname?.toLowerCase().includes(q) ||
      o.employee_email?.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Historique des onboardings</h1>
        <Link to="/new"><button className="btn btn-primary">🚀 Nouvel onboarding</button></Link>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input
          style={{ maxWidth: 260 }}
          placeholder="Rechercher un employé..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 160 }}>
          <option value="">Tous les statuts</option>
          <option value="done">Terminés</option>
          <option value="failed">Échoués</option>
          <option value="running">En cours</option>
          <option value="pending">En attente</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <span className="spinner" style={{ width: 28, height: 28 }} />
          </div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📋</div>
            <div>Aucun onboarding trouvé</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employé</th>
                  <th>Email M365</th>
                  <th>Groupe</th>
                  <th>Licence</th>
                  <th>Statut</th>
                  <th>Lancé par</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(o => (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 500, color: 'var(--text)' }}>
                      {o.employee_firstname} {o.employee_lastname}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>
                      {o.employee_email}
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.group_name}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{o.license_name}</td>
                    <td>
                      <StatusBadge status={o.status} />
                      {o.rolled_back ? <span style={{ fontSize: 11, color: 'var(--warning)', marginLeft: 6 }}>↩ rollback</span> : null}
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>{o.created_by_name}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(o.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td>
                      <Link to={`/history/${o.id}`}>
                        <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}>Détails</button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
