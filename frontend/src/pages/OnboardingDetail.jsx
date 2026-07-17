import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

/* ── Icons ────────────────────────────────────────────────────────── */
function Icon({ path, size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ fill: 'none', stroke: color || 'currentColor', strokeWidth: 1.75,
        strokeLinecap: 'round', strokeLinejoin: 'round', flexShrink: 0, overflow: 'visible' }}>
      {Array.isArray(path)
        ? path.map((d, i) => <path key={i} d={d} />)
        : <path d={path} />}
    </svg>
  );
}

const ICONS = {
  back:    'M19 12H5M12 5l-7 7 7 7',
  check:   'M20 6 9 17l-5-5',
  x:       'M18 6 6 18M6 6l12 12',
  clock:   ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'M12 6v6l4 2'],
  pause:   ['M6 4h4v16H6z', 'M14 4h4v16h-4z'],
  refresh: ['M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16', 'M16 16h5v5'],
  user:    ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
  mail:    ['M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z', 'M22 6l-10 7L2 6'],
  group:   ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  license: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10'],
  id:      ['M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z', 'M16 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4', 'M6 11h4', 'M6 15h3'],
  calendar:['M8 2v4', 'M16 2v4', 'M3 10h18', 'M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11'],
  launch:  ['M3 12 2 3l9 3 6 6-8 0z', 'M14.5 9.5 19 5', 'M11 13l-4 4'],
  undo:    ['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'],
  spark:   ['M12 2L9.1 9.1 2 12l7.1 2.9L12 22l2.9-7.1L22 12l-7.1-2.9z'],
  alert:   ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  skip:    ['M5 4l10 8-10 8V4z', 'M19 4v16'],
};

/* ── Status configs ──────────────────────────────────────────────── */
const STATUS = {
  done:        { label: 'Terminé',    color: '#22c55e', bg: 'rgba(34,197,94,.1)',  border: 'rgba(34,197,94,.25)',  icon: ICONS.check  },
  failed:      { label: 'Échoué',     color: '#ef4444', bg: 'rgba(239,68,68,.1)', border: 'rgba(239,68,68,.25)',  icon: ICONS.x      },
  running:     { label: 'En cours',   color: '#818cf8', bg: 'rgba(129,140,248,.1)',border: 'rgba(129,140,248,.25)',icon: ICONS.refresh },
  pending:     { label: 'En attente', color: '#94a3b8', bg: 'rgba(148,163,184,.08)',border:'rgba(148,163,184,.18)',icon: ICONS.clock  },
  skipped:     { label: 'Ignoré',     color: '#64748b', bg: 'rgba(100,116,139,.08)',border:'rgba(100,116,139,.18)',icon: ICONS.skip   },
  rolled_back: { label: 'Rollback',   color: '#f59e0b', bg: 'rgba(245,158,11,.1)', border: 'rgba(245,158,11,.25)', icon: ICONS.undo  },
};

function StatusBadge({ status, size = 'md' }) {
  const s = STATUS[status] || STATUS.pending;
  const pad = size === 'sm' ? '3px 8px' : '5px 12px';
  const fs  = size === 'sm' ? 11 : 12;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: pad, borderRadius: 20, fontSize: fs, fontWeight: 600,
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      letterSpacing: '.2px', whiteSpace: 'nowrap',
    }}>
      <Icon path={s.icon} size={fs - 1} color={s.color} />
      {s.label}
    </span>
  );
}

/* ── Info row ────────────────────────────────────────────────────── */
function InfoRow({ icon, label, value, mono }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--muted)' }}>
        <Icon path={icon} size={11} />
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px' }}>
          {label}
        </span>
      </div>
      <div style={{
        fontSize: 13, color: 'var(--text2)', lineHeight: 1.5,
        fontFamily: mono ? 'ui-monospace, monospace' : undefined,
        wordBreak: 'break-all',
      }}>
        {value || '—'}
      </div>
    </div>
  );
}

/* ── Step row ────────────────────────────────────────────────────── */
function StepRow({ step, index, total, isLast }) {
  const s = STATUS[step.status] || STATUS.pending;
  const isDone    = step.status === 'done';
  const isRunning = step.status === 'running';
  const isFailed  = step.status === 'failed';

  const timeStr = step.completed_at
    ? new Date(step.completed_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : step.started_at
      ? new Date(step.started_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : null;

  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative' }}>
      {/* Vertical connector */}
      {!isLast && (
        <div style={{
          position: 'absolute', left: 17, top: 36, bottom: -4,
          width: 2, borderRadius: 2,
          background: isDone ? 'rgba(34,197,94,.35)' : 'rgba(148,163,184,.12)',
          transition: 'background .4s ease',
        }} />
      )}

      {/* Step circle */}
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isDone    ? 'rgba(34,197,94,.12)'   :
                    isFailed  ? 'rgba(239,68,68,.12)'    :
                    isRunning ? 'rgba(129,140,248,.12)'   : 'rgba(148,163,184,.07)',
        border: `2px solid ${s.color}`,
        boxShadow: isDone    ? '0 0 12px rgba(34,197,94,.2)'   :
                   isFailed  ? '0 0 12px rgba(239,68,68,.2)'   :
                   isRunning ? '0 0 12px rgba(129,140,248,.25)' : 'none',
        transition: 'all .3s ease',
        zIndex: 1,
        animation: isRunning ? 'pulse 2s infinite' : 'none',
      }}>
        <Icon path={s.icon} size={15} color={s.color} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingTop: 6, paddingBottom: isLast ? 0 : 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 13, fontWeight: 600,
            color: isDone    ? '#e2e8f0' :
                   isFailed  ? '#ef4444'  :
                   isRunning ? '#818cf8'  : 'var(--muted)',
          }}>
            {step.step_name}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, color: 'var(--muted)',
            background: 'rgba(148,163,184,.08)', border: '1px solid rgba(148,163,184,.12)',
            borderRadius: 4, padding: '1px 6px',
          }}>
            {index + 1}/{total}
          </span>
          {isRunning && (
            <span style={{ fontSize: 11, color: '#818cf8', fontStyle: 'italic' }}>En cours…</span>
          )}
        </div>

        {timeStr && (
          <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted)' }}>
            <Icon path={ICONS.clock} size={10} />
            <span style={{ fontSize: 11 }}>
              {step.completed_at ? 'Terminé' : 'Démarré'} à {timeStr}
            </span>
          </div>
        )}

        {step.error_message && (
          <div style={{
            marginTop: 8, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)',
            fontSize: 12, color: '#fca5a5', lineHeight: 1.5,
            display: 'flex', alignItems: 'flex-start', gap: 7,
          }}>
            <Icon path={ICONS.alert} size={13} color="#ef4444" />
            {step.error_message}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────── */
export default function OnboardingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [forceChangePwd, setForceChangePwd] = useState(true);

  function load() {
    api.get(`/api/onboardings/${id}`)
      .then(setData)
      .catch(e => setError(e.message));
  }

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    api.get('/api/admin/settings').then(s => {
      if (s.force_change_password !== undefined) setForceChangePwd(s.force_change_password === 'true');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!data) return;
    if (data.status !== 'running' && data.status !== 'pending') return;
    const interval = setInterval(load, 1500);
    return () => clearInterval(interval);
  }, [data?.status]);

  if (error) return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <button onClick={() => navigate(-1)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 20,
        background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13,
        cursor: 'pointer', padding: '6px 0',
      }}>
        <Icon path={ICONS.back} size={14} />
        Retour
      </button>
      <div style={{
        padding: '14px 16px', borderRadius: 10,
        background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)',
        color: '#fca5a5', fontSize: 13,
      }}>
        {error}
      </div>
    </div>
  );

  if (!data) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
      <span className="spinner" style={{ width: 28, height: 28 }} />
    </div>
  );

  const isLive    = data.status === 'running' || data.status === 'pending';
  const isDone    = data.status === 'done';
  const isFailed  = data.status === 'failed';
  const steps     = data.steps || [];
  const doneCount = steps.filter(s => s.status === 'done').length;
  const progress  = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Breadcrumb */}
      <Link to="/history" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        color: 'var(--muted)', fontSize: 13, textDecoration: 'none',
        padding: '4px 0', width: 'fit-content',
        transition: 'color .15s',
      }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}
      >
        <Icon path={ICONS.back} size={13} />
        Historique
      </Link>

      {/* Header card */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '20px 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0, letterSpacing: '-.3px' }}>
              {data.employee_firstname} {data.employee_lastname}
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace' }}>
              {data.employee_email}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isLive && <span className="spinner" style={{ width: 15, height: 15 }} />}
            <StatusBadge status={data.status} />
          </div>
        </div>

        {/* Progress bar */}
        {steps.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                Progression
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: isDone ? '#22c55e' : 'var(--muted)' }}>
                {doneCount}/{steps.length} étapes
              </span>
            </div>
            <div style={{
              height: 5, borderRadius: 3, background: 'rgba(148,163,184,.12)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 3,
                width: `${progress}%`,
                background: isFailed  ? '#ef4444' :
                            isDone    ? 'linear-gradient(90deg, #22c55e, #16a34a)' :
                                        'linear-gradient(90deg, #818cf8, #6366f1)',
                transition: 'width .5s cubic-bezier(.4,0,.2,1)',
                boxShadow: isDone ? '0 0 8px rgba(34,197,94,.4)' : isLive ? '0 0 8px rgba(129,140,248,.4)' : 'none',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Info grid */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '20px 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
      }}>
        <h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', margin: '0 0 16px' }}>
          Informations
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 32px' }}>
          <InfoRow icon={ICONS.group}    label="Groupe"     value={data.group_name} />
          <InfoRow icon={ICONS.license}  label="Licence"    value={data.license_name} />
          <InfoRow icon={ICONS.id}       label="Azure AD ID" value={data.employee_ad_id} mono />
          <InfoRow icon={ICONS.user}     label="Lancé par"  value={data.created_by_name} />
          <InfoRow icon={ICONS.calendar} label="Date"
            value={new Date(data.created_at).toLocaleString('fr-FR', {
              day: '2-digit', month: '2-digit', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })} />
        </div>

        {data.rolled_back && (
          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 8,
            background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)',
            fontSize: 12, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <Icon path={ICONS.undo} size={13} color="#f59e0b" />
            Rollback effectué — le compte Azure AD a été supprimé.
          </div>
        )}
      </div>

      {/* Steps timeline */}
      {steps.length > 0 && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '20px 24px',
          boxShadow: '0 1px 3px rgba(0,0,0,.3)',
        }}>
          <h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', margin: '0 0 20px' }}>
            Étapes
          </h2>
          <div>
            {steps.map((step, i) => (
              <StepRow
                key={step.id}
                step={step}
                index={i}
                total={steps.length}
                isLast={i === steps.length - 1}
              />
            ))}
          </div>
        </div>
      )}

      {/* Final status card */}
      {isDone && (
        <div style={{
          background: 'rgba(34,197,94,.06)', border: '1px solid rgba(34,197,94,.2)',
          borderRadius: 'var(--radius)', padding: '16px 20px',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon path={ICONS.spark} size={17} color="#22c55e" />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#22c55e', fontSize: 14, marginBottom: 4 }}>
              Onboarding terminé
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text)' }}>{data.employee_email}</strong> a été onboardé avec succès.
              {forceChangePwd && <>{' '}Le mot de passe temporaire devra être changé à la première connexion.</>}
            </div>
          </div>
        </div>
      )}

      {isFailed && (
        <div style={{
          background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)',
          borderRadius: 'var(--radius)', padding: '16px 20px',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon path={ICONS.alert} size={17} color="#ef4444" />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#ef4444', fontSize: 14, marginBottom: 4 }}>
              Onboarding échoué
            </div>
            {data.error_message && (
              <div style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.6 }}>
                {data.error_message}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, paddingBottom: 8 }}>
        <Link to="/history">
          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text2)', cursor: 'pointer',
            transition: 'border-color .15s, color .15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--muted)'; e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)'; }}
          >
            <Icon path={ICONS.back} size={13} />
            Historique
          </button>
        </Link>
        {(isDone || isFailed) && (
          <Link to="/new">
            <button style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'var(--primary)', border: '1px solid transparent',
              color: '#fff', cursor: 'pointer',
              boxShadow: '0 0 18px rgba(79,70,229,.3)',
              transition: 'opacity .15s, box-shadow .15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '.9'; e.currentTarget.style.boxShadow = '0 0 24px rgba(79,70,229,.45)'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.boxShadow = '0 0 18px rgba(79,70,229,.3)'; }}
            >
              <Icon path={ICONS.launch} size={13} color="#fff" />
              Nouvel onboarding
            </button>
          </Link>
        )}
      </div>

    </div>
  );
}
