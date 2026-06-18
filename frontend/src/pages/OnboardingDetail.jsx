import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

const STEP_ICONS = { pending: '⏸', running: '⏳', done: '✅', failed: '❌' };

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

export default function OnboardingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  function load() {
    api.get(`/api/onboardings/${id}`)
      .then(setData)
      .catch(e => setError(e.message));
  }

  useEffect(() => { load(); }, [id]);

  // Poll si en cours
  useEffect(() => {
    if (!data) return;
    if (data.status !== 'running' && data.status !== 'pending') return;
    const interval = setInterval(load, 1500);
    return () => clearInterval(interval);
  }, [data?.status]);

  if (error) return (
    <div>
      <button className="btn btn-ghost" style={{ marginBottom: 16 }} onClick={() => navigate(-1)}>← Retour</button>
      <div className="error-box">{error}</div>
    </div>
  );

  if (!data) return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 60 }}>
      <span className="spinner" style={{ width: 28, height: 28 }} />
    </div>
  );

  const isLive = data.status === 'running' || data.status === 'pending';

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <Link to="/history" style={{ fontSize: 13, color: 'var(--muted)' }}>← Historique</Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className="page-title">
          {data.employee_firstname} {data.employee_lastname}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isLive && <span className="spinner" style={{ width: 16, height: 16 }} />}
          <StatusBadge status={data.status} />
        </div>
      </div>

      {/* Info card */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>Informations</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            { label: 'Email M365', value: data.employee_email },
            { label: 'Groupe', value: data.group_name },
            { label: 'Licence', value: data.license_name },
            { label: 'Azure AD ID', value: data.employee_ad_id || '—' },
            { label: 'Lancé par', value: data.created_by_name },
            { label: 'Date', value: new Date(data.created_at).toLocaleString('fr-FR') },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', fontFamily: label === 'Email M365' || label === 'Azure AD ID' ? 'monospace' : undefined, wordBreak: 'break-all' }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {data.rolled_back ? (
          <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--warning-bg)', borderRadius: 8, fontSize: 13, color: 'var(--warning)', border: '1px solid rgba(245,158,11,.3)' }}>
            ↩ Rollback effectué — le compte Azure AD a été supprimé.
          </div>
        ) : null}
      </div>

      {/* Steps */}
      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 20, color: 'var(--text)' }}>Étapes</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {data.steps?.map((step, i) => (
            <div key={step.id} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 16,
              paddingBottom: i < data.steps.length - 1 ? 20 : 0,
              position: 'relative',
            }}>
              {/* Connector line */}
              {i < data.steps.length - 1 && (
                <div style={{
                  position: 'absolute',
                  left: 15,
                  top: 32,
                  width: 2,
                  bottom: 0,
                  background: step.status === 'done' ? 'var(--success)' : 'var(--border)',
                  opacity: .4,
                }} />
              )}

              {/* Icon */}
              <div style={{
                width: 32, height: 32,
                borderRadius: '50%',
                border: `2px solid ${
                  step.status === 'done'    ? 'var(--success)' :
                  step.status === 'failed'  ? 'var(--danger)'  :
                  step.status === 'running' ? 'var(--info)'    : 'var(--border)'
                }`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, flexShrink: 0, background: 'var(--surface)',
                zIndex: 1,
              }}
                className={step.status === 'running' ? 'pulse' : ''}
              >
                {STEP_ICONS[step.status]}
              </div>

              {/* Content */}
              <div style={{ flex: 1, paddingTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontWeight: 600,
                    color: step.status === 'done' ? 'var(--success)' :
                           step.status === 'failed' ? 'var(--danger)' :
                           step.status === 'running' ? 'var(--info)' : 'var(--muted)',
                  }}>
                    [{step.step_number}/3] {step.step_name}
                  </span>
                  {step.status === 'running' && (
                    <span style={{ fontSize: 11, color: 'var(--info)' }}>En cours...</span>
                  )}
                </div>
                {step.started_at && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                    {step.completed_at
                      ? `Terminé ${new Date(step.completed_at).toLocaleTimeString('fr-FR')}`
                      : `Démarré ${new Date(step.started_at).toLocaleTimeString('fr-FR')}`
                    }
                  </div>
                )}
                {step.error_message && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '6px 10px', borderRadius: 6 }}>
                    {step.error_message}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {data.status === 'failed' && (
        <div className="card" style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 20 }}>❌</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--danger)', marginBottom: 6 }}>Erreur</div>
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>{data.error_message}</div>
            </div>
          </div>
        </div>
      )}

      {data.status === 'done' && (
        <div className="card" style={{ marginTop: 20, border: '1px solid rgba(34,197,94,.3)', background: 'rgba(34,197,94,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 20 }}>🎉</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--success)', marginBottom: 6 }}>Onboarding terminé</div>
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                {data.employee_email} a été onboardé avec succès.
                {' '}Le mot de passe temporaire devra être changé à la première connexion.
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
        <Link to="/history"><button className="btn btn-ghost">← Historique</button></Link>
        {(data.status === 'done' || data.status === 'failed') && (
          <Link to="/new"><button className="btn btn-primary">🚀 Nouvel onboarding</button></Link>
        )}
      </div>
    </div>
  );
}
