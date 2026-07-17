import { useState, useEffect, useRef } from 'react';
import { api } from '../api';

/* ── SVG icons — no emoji (ui-ux-pro-max) ───────────────────────── */
function Icon({ path, size = 16, strokeWidth = 1.75 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {Array.isArray(path)
        ? path.map((d, i) => <path key={i} d={d} />)
        : <path d={path} />}
    </svg>
  );
}

const IC = {
  offboard:  ['M17 16l4-4m0 0l-4-4m4 4H7', 'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0'],
  user:      ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  mail:      ['M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z', 'M22 6l-10 7L2 6'],
  check:     ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4 12 14.01l-3-3'],
  x:         ['M18 6 6 18', 'M6 6l12 12'],
  clock:     ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  skip:      ['M5 4l10 8-10 8V4z', 'M19 4v16'],
  warn:      ['M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  pause:     ['M6 4h4v16H6z', 'M14 4h4v16h-4z'],
  search:    ['M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0'],
  copy:      ['M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  chevDown:  'M6 9l6 6 6-6',
  chevRight: 'M9 18l6-6-6-6',
  download:  ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  arrowLeft: ['M19 12H5', 'M12 19l-7-7 7-7'],
  shield:    'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  group:     ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
};

/* ── Step status config ──────────────────────────────────────────── */
const STEP_CFG = {
  done:    { icon: IC.check,  color: '#22c55e', bg: 'rgba(34,197,94,.15)',  border: 'rgba(34,197,94,.4)',  label: 'Terminé' },
  failed:  { icon: IC.x,     color: '#ef4444', bg: 'rgba(239,68,68,.15)', border: 'rgba(239,68,68,.4)', label: 'Échoué' },
  running: { icon: IC.clock, color: '#60a5fa', bg: 'rgba(96,165,250,.15)', border: 'rgba(96,165,250,.4)', label: 'En cours' },
  skipped: { icon: IC.skip,  color: '#94a3b8', bg: 'rgba(148,163,184,.1)', border: 'rgba(148,163,184,.3)', label: 'Ignoré' },
  pending: { icon: IC.pause, color: '#475569', bg: 'rgba(71,85,105,.1)',   border: 'rgba(71,85,105,.25)', label: 'En attente' },
  manual:  { icon: IC.warn,  color: '#f59e0b', bg: 'rgba(245,158,11,.15)', border: 'rgba(245,158,11,.4)', label: 'Manuel' },
};

/* ── UserSearch ──────────────────────────────────────────────────── */
function UserSearch({ value, display, onSelect, placeholder, label, helpText, required }) {
  const [query,     setQuery]     = useState(display || '');
  const [results,   setResults]   = useState([]);
  const [open,      setOpen]      = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [hovered,   setHovered]   = useState(-1);
  const [focused,   setFocused]   = useState(false);
  const debRef = useRef(null);

  useEffect(() => { setQuery(display || ''); }, [display]);

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    if (!q.trim()) { onSelect('', ''); setResults([]); setOpen(false); return; }
    clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      if (q.trim().length < 2) return;
      setLoading(true);
      try {
        const data = await api.get(`/api/users/graph-search?q=${encodeURIComponent(q.trim())}`);
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
      } catch (_) { setResults([]); }
      finally { setLoading(false); }
    }, 300);
  }

  const borderColor = value
    ? 'rgba(34,197,94,.5)'
    : focused
      ? 'var(--primary)'
      : 'var(--border)';

  return (
    <div>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 700,
        color: 'var(--muted)', marginBottom: 6,
        textTransform: 'uppercase', letterSpacing: '.5px',
      }}>
        {label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={handleChange}
          onFocus={() => { setFocused(true); results.length > 0 && setOpen(true); }}
          onBlur={() => { setFocused(false); setTimeout(() => { setOpen(false); setHovered(-1); }, 150); }}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          style={{
            width: '100%', padding: '9px 36px 9px 36px',
            borderRadius: 8, border: `1px solid ${borderColor}`,
            background: 'var(--surface2)', color: 'var(--text)',
            fontSize: 13, outline: 'none', boxSizing: 'border-box',
            transition: 'border-color var(--transition)',
            boxShadow: focused ? `0 0 0 3px ${value ? 'rgba(34,197,94,.15)' : 'var(--primary-soft)'}` : 'none',
          }}
        />
        {/* Left search icon */}
        <span style={{
          position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
          color: value ? '#22c55e' : 'var(--muted)', display: 'flex', pointerEvents: 'none',
        }}>
          {value
            ? <Icon path={IC.check} size={14} strokeWidth={2.5} />
            : <Icon path={IC.search} size={14} />}
        </span>
        {/* Right spinner */}
        {loading && (
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
            <span className="spinner" style={{ width: 13, height: 13 }} />
          </span>
        )}

        {open && results.length > 0 && (
          <div role="listbox" style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 300,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,.5)',
            overflow: 'hidden',
          }}>
            {results.map((u, i) => (
              <div
                key={u.id}
                role="option"
                aria-selected={hovered === i}
                onMouseDown={() => { onSelect(u.mail, u.displayName); setOpen(false); }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(-1)}
                style={{
                  padding: '9px 12px', cursor: 'pointer',
                  background: hovered === i ? 'var(--surface2)' : 'transparent',
                  borderBottom: i < results.length - 1 ? '1px solid rgba(51,65,85,.5)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 10,
                  transition: 'background .08s',
                }}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, color: '#fff',
                }}>
                  {u.displayName?.[0]?.toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{u.displayName}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.mail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {helpText && (
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.5 }}>{helpText}</p>
      )}
    </div>
  );
}

/* ── CopyCommand ─────────────────────────────────────────────────── */
function CopyCommand({ cmd }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      background: 'rgba(0,0,0,.4)', border: '1px solid rgba(245,158,11,.2)',
      borderRadius: 7, padding: '8px 10px', marginTop: 6,
    }}>
      <code style={{
        flex: 1, fontSize: 11, color: '#fcd34d',
        wordBreak: 'break-all', fontFamily: 'monospace', lineHeight: 1.6,
      }}>
        {cmd}
      </code>
      <button
        onClick={copy}
        aria-label="Copier la commande"
        style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
          background: copied ? 'rgba(34,197,94,.15)' : 'rgba(245,158,11,.1)',
          border: `1px solid ${copied ? 'rgba(34,197,94,.35)' : 'rgba(245,158,11,.3)'}`,
          borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
          fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
          color: copied ? '#22c55e' : '#f59e0b',
          transition: 'all .15s', whiteSpace: 'nowrap',
        }}
        onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--primary)'; }}
        onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
      >
        <Icon path={copied ? IC.check : IC.copy} size={12} strokeWidth={2} />
        {copied ? 'Copié !' : 'Copier'}
      </button>
    </div>
  );
}

/* ── GroupList ───────────────────────────────────────────────────── */
function GroupList({ groups }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginLeft: 46, marginTop: 6 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '3px 0', fontSize: 11, color: '#a5b4fc',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontFamily: 'inherit', transition: 'color var(--transition)',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#a5b4fc'; }}
        onFocus={e => { e.currentTarget.style.outline = '2px solid var(--primary)'; e.currentTarget.style.borderRadius = '4px'; }}
        onBlur={e => { e.currentTarget.style.outline = 'none'; }}
        aria-expanded={open}
      >
        <span style={{ display: 'flex', transition: 'transform .2s', transform: open ? 'rotate(90deg)' : 'none' }}>
          <Icon path={IC.chevRight} size={12} />
        </span>
        {open ? 'Masquer les groupes' : `Voir les ${groups.length} groupes supprimés`}
      </button>
      {open && (
        <div style={{
          marginTop: 6, padding: '8px 10px',
          background: 'var(--surface2)', borderRadius: 7,
          border: '1px solid var(--border)',
          maxHeight: 180, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {groups.map((name, i) => (
            <div key={i} style={{
              fontSize: 11, color: 'var(--muted)',
              display: 'flex', alignItems: 'center', gap: 7,
            }}>
              <span style={{ color: '#ef4444', display: 'flex', flexShrink: 0 }}>
                <Icon path={IC.x} size={10} strokeWidth={2.5} />
              </span>
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Vertical stepper (sean0205 pattern) ─────────────────────────── */
function StepItem({ step, index, total, isLast }) {
  const cfg = STEP_CFG[step.status] || STEP_CFG.pending;
  const isRunning = step.status === 'running';

  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative' }}>
      {/* Connector line */}
      {!isLast && (
        <div style={{
          position: 'absolute', left: 14, top: 30, bottom: -14,
          width: 2, background: step.status === 'done'
            ? 'rgba(34,197,94,.3)'
            : 'rgba(51,65,85,.5)',
          transition: 'background .4s',
        }} />
      )}

      {/* Step indicator */}
      <div style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
        background: cfg.bg, border: `2px solid ${cfg.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: cfg.color, zIndex: 1,
        boxShadow: isRunning ? `0 0 12px ${cfg.color}50` : 'none',
      }} className={isRunning ? 'pulse' : ''}>
        {isRunning
          ? <span className="spinner" style={{ width: 12, height: 12 }} />
          : <Icon path={cfg.icon} size={13} strokeWidth={2.5} />
        }
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 18, paddingTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{
            fontSize: 13, fontWeight: isRunning ? 600 : 400,
            color: step.status === 'pending' ? 'var(--muted)' : cfg.color,
            lineHeight: 1.4,
          }}>
            {step.name}
          </span>
          <span style={{
            fontSize: 10, color: cfg.color,
            background: cfg.bg, padding: '1px 7px',
            borderRadius: 99, fontWeight: 600, letterSpacing: '.3px',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {cfg.label}
          </span>
        </div>

        {step.status === 'manual' ? (
          <div style={{ marginTop: 6 }}>
            <p style={{ fontSize: 11, color: '#f59e0b', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon path={IC.warn} size={12} />
              Action manuelle requise — Exchange Online PowerShell
            </p>
            <CopyCommand cmd={step.detail} />
          </div>
        ) : step.detail ? (
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {step.detail}
          </p>
        ) : null}

        {step.name === 'Suppression des groupes' && step.status === 'done' && step.removedGroups?.length > 0 && (
          <GroupList groups={step.removedGroups} />
        )}
      </div>
    </div>
  );
}

/* ── Progress counter badge ──────────────────────────────────────── */
function ProgressBadge({ steps }) {
  if (!steps?.length) return null;
  const done = steps.filter(s => s.status === 'done' || s.status === 'skipped' || s.status === 'manual').length;
  const pct  = Math.round((done / steps.length) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
        {done} / {steps.length} étapes
      </span>
      <div style={{ width: 80, height: 4, borderRadius: 99, background: 'var(--surface2)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, borderRadius: 99,
          background: 'linear-gradient(90deg, #4f46e5, #22c55e)',
          transition: 'width .4s ease',
        }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pct}%</span>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────── */
export default function Offboarding() {
  const [form, setForm] = useState({
    targetEmail: '', targetDisplay: '',
    accessTo: '',    accessToDisplay: '',
    transferEmails: false,
  });
  const [confirming,  setConfirming]  = useState(false);
  const [error,       setError]       = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [jobId,       setJobId]       = useState(null);
  const [job,         setJob]         = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      try {
        const data = await api.get(`/api/offboarding/${jobId}`);
        if (data.steps && job?.removedGroups) {
          data.steps = data.steps.map(s =>
            s.name === 'Suppression des groupes'
              ? { ...s, removedGroups: data.removedGroups }
              : s
          );
        }
        setJob(data);
        if (data.status === 'done' || data.status === 'failed') clearInterval(pollRef.current);
      } catch (_) {}
    };
    poll();
    pollRef.current = setInterval(poll, 800);
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  async function launch() {
    setError(''); setSubmitting(true);
    try {
      const { id } = await api.post('/api/offboarding', {
        targetEmail:    form.targetEmail,
        accessTo:       form.accessTo || null,
        transferEmails: form.transferEmails,
      });
      setJobId(id);
    } catch (err) {
      setError(err.message || 'Erreur lors du lancement');
      setConfirming(false);
    } finally { setSubmitting(false); }
  }

  function reset() {
    clearInterval(pollRef.current);
    setJobId(null); setJob(null);
    setForm({ targetEmail: '', targetDisplay: '', accessTo: '', accessToDisplay: '', transferEmails: false });
    setConfirming(false); setError('');
  }

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); setConfirming(false); setError(''); }

  /* ── Progress view ─────────────────────────────────────────────── */
  if (jobId) {
    const isDone   = job?.status === 'done';
    const isFailed = job?.status === 'failed';
    const hasManual = job?.steps?.some(s => s.status === 'manual');
    const steps = job?.steps || [];

    const stepsWithGroups = steps.map(s =>
      s.name === 'Suppression des groupes' && isDone && job?.removedGroups?.length
        ? { ...s, removedGroups: job.removedGroups }
        : s
    );

    return (
      <div style={{ maxWidth: 600 }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12,
            padding: '4px 12px', borderRadius: 999,
            border: '1px solid rgba(239,68,68,.2)', background: 'rgba(239,68,68,.06)' }}>
            <Icon path={IC.offboard} size={11} />
            <span style={{ fontSize: 11, color: 'rgba(239,68,68,.7)', fontWeight: 500, letterSpacing: '.3px' }}>Offboarding</span>
          </div>
          <h1 style={{
            fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em',
            background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            {job?.displayName || form.targetDisplay || form.targetEmail}
          </h1>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {job?.targetEmail || form.targetEmail}
          </p>
        </div>

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,.3)',
        }}>
          {/* Status header */}
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(255,255,255,.02)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isDone ? (
                <span style={{ display: 'flex', color: '#22c55e' }}><Icon path={IC.check} size={15} strokeWidth={2.5} /></span>
              ) : isFailed ? (
                <span style={{ display: 'flex', color: '#ef4444' }}><Icon path={IC.x} size={15} strokeWidth={2.5} /></span>
              ) : (
                <span className="spinner" style={{ width: 14, height: 14 }} />
              )}
              <span style={{
                fontSize: 13, fontWeight: 600,
                color: isDone ? '#22c55e' : isFailed ? '#ef4444' : '#60a5fa',
              }}>
                {isDone ? (hasManual ? 'Complété — actions manuelles requises' : 'Offboarding terminé') : isFailed ? 'Erreur lors de l\'offboarding' : 'Offboarding en cours…'}
              </span>
            </div>
            <ProgressBadge steps={steps} />
          </div>

          {/* Steps — vertical stepper */}
          <div style={{ padding: '20px 20px 4px' }}>
            {stepsWithGroups.map((step, i) => (
              <StepItem
                key={i}
                step={step}
                index={i}
                total={stepsWithGroups.length}
                isLast={i === stepsWithGroups.length - 1}
              />
            ))}
          </div>

          {/* Summary */}
          {(isDone || isFailed) && (
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{
                marginTop: 12,
                padding: '14px 16px',
                background: isDone
                  ? (hasManual ? 'rgba(245,158,11,.06)' : 'rgba(34,197,94,.07)')
                  : 'rgba(239,68,68,.07)',
                border: `1px solid ${isDone ? (hasManual ? 'rgba(245,158,11,.25)' : 'rgba(34,197,94,.2)') : 'rgba(239,68,68,.2)'}`,
                borderRadius: 9,
                borderLeft: `3px solid ${isDone ? (hasManual ? '#f59e0b' : '#22c55e') : '#ef4444'}`,
              }}>
                {isDone ? (
                  <>
                    <p style={{ fontSize: 13, fontWeight: 600, color: hasManual ? '#f59e0b' : '#22c55e', marginBottom: 6 }}>
                      {hasManual ? 'Actions manuelles requises' : 'Offboarding complété'}
                    </p>
                    <ul style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <li>· Compte <strong style={{ color: 'var(--text2)' }}>{job.targetEmail}</strong> désactivé et converti en boîte partagée</li>
                      {job.accessTo && <li>· <strong style={{ color: 'var(--text2)' }}>{job.accessTo}</strong> a l'accès complet à la boîte</li>}
                      {job.transferEmails && job.accessTo && <li>· Transfert des nouveaux emails activé (copie conservée)</li>}
                      {hasManual && <li style={{ color: '#f59e0b' }}>· Les commandes Exchange Online doivent être exécutées manuellement</li>}
                    </ul>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#ef4444', marginBottom: 4 }}>Erreur</p>
                    <p style={{ fontSize: 12, color: 'var(--muted)' }}>{job.error || 'Erreur inconnue'}</p>
                  </>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                {hasManual && (
                  <a
                    href={`/api/offboarding/${jobId}/script`}
                    download
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '8px 14px', borderRadius: 7, textDecoration: 'none',
                      border: '1px solid rgba(245,158,11,.35)',
                      background: 'rgba(245,158,11,.08)', color: '#f59e0b',
                      fontSize: 12, fontWeight: 600,
                      transition: 'background var(--transition)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,.15)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,158,11,.08)'; }}
                  >
                    <Icon path={IC.download} size={13} />
                    Télécharger le script (.bat)
                  </a>
                )}
                <button
                  onClick={reset}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px', borderRadius: 7, border: '1px solid var(--border)',
                    background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
                    fontSize: 12, fontFamily: 'inherit',
                    transition: 'background var(--transition), color var(--transition)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.color = 'var(--text)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
                  onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--primary)'; }}
                  onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <Icon path={IC.arrowLeft} size={13} />
                  Nouvel offboarding
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Form view ─────────────────────────────────────────────────── */
  return (
    <div style={{ maxWidth: 560 }}>
      {/* Hero header */}
      <div style={{ marginBottom: 28, position: 'relative' }}>
        <div aria-hidden="true" style={{
          position: 'absolute', top: -40, left: '10%', width: 400, height: 160,
          background: 'radial-gradient(ellipse, rgba(239,68,68,.12) 0%, transparent 70%)',
          pointerEvents: 'none', filter: 'blur(30px)',
        }} />
        <div style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 12px', borderRadius: 999, marginBottom: 14,
          border: '1px solid rgba(239,68,68,.2)', background: 'rgba(239,68,68,.06)',
        }}>
          <Icon path={IC.shield} size={11} />
          <span style={{ fontSize: 11, color: 'rgba(239,68,68,.7)', fontWeight: 500, letterSpacing: '.3px' }}>
            Action irréversible
          </span>
        </div>
        <h1 style={{
          fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em',
          background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          Offboarding
        </h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
          Désactivation du compte · Retrait des groupes · Conversion en boîte partagée
        </p>
      </div>

      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
        overflow: 'hidden',
      }}>
        {/* Form body */}
        <div style={{ padding: '22px 22px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          <UserSearch
            label="Utilisateur à offboarder"
            required
            placeholder="Rechercher par nom ou email…"
            value={form.targetEmail}
            display={form.targetDisplay}
            onSelect={(mail, name) => setField('targetEmail', mail) || setForm(f => ({ ...f, targetEmail: mail, targetDisplay: name }))}
            helpText="Ce compte sera désactivé et converti en boîte partagée"
          />

          <UserSearch
            label="Donner accès à"
            placeholder="Rechercher par nom ou email… (optionnel)"
            value={form.accessTo}
            display={form.accessToDisplay}
            onSelect={(mail, name) => setForm(f => ({ ...f, accessTo: mail, accessToDisplay: name, transferEmails: false }))}
            helpText="Ce compte obtiendra un accès complet à la boîte partagée"
          />

          {/* Transfer emails toggle */}
          {form.accessTo && (
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '12px 14px', borderRadius: 9, cursor: 'pointer',
              background: form.transferEmails ? 'rgba(79,70,229,.06)' : 'var(--surface2)',
              border: `1px solid ${form.transferEmails ? 'rgba(79,70,229,.35)' : 'var(--border)'}`,
              transition: 'border-color var(--transition), background var(--transition)',
            }}>
              <input
                type="checkbox"
                checked={form.transferEmails}
                onChange={e => setForm(f => ({ ...f, transferEmails: e.target.checked }))}
                style={{ marginTop: 1, accentColor: 'var(--primary)', width: 15, height: 15, flexShrink: 0, cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                  Transférer les emails entrants
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                  Les nouveaux emails seront également envoyés à{' '}
                  <strong style={{ color: 'var(--text2)' }}>{form.accessToDisplay || form.accessTo}</strong> —
                  une copie reste dans la boîte partagée
                </div>
              </div>
            </label>
          )}

          {error && (
            <div role="alert" style={{
              padding: '10px 14px',
              background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)',
              borderLeft: '3px solid #ef4444',
              borderRadius: 8, color: '#ef4444', fontSize: 12,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Icon path={IC.x} size={13} strokeWidth={2.5} />
              {error}
            </div>
          )}
        </div>

        {/* Confirmation zone — alert-dialog pattern (shadcn) */}
        {confirming ? (
          <div style={{
            margin: '0 22px 22px',
            padding: '16px 18px',
            background: 'rgba(239,68,68,.05)',
            border: '1px solid rgba(239,68,68,.28)',
            borderLeft: '3px solid #ef4444',
            borderRadius: 9,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
              <span style={{ color: '#ef4444', display: 'flex' }}>
                <Icon path={IC.warn} size={15} strokeWidth={2} />
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>
                Confirmer l'offboarding de {form.targetDisplay || form.targetEmail}
              </span>
            </div>
            <ul style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.75, paddingLeft: 0, listStyle: 'none', marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <li>· Le compte sera <strong style={{ color: 'var(--text2)' }}>immédiatement bloqué</strong></li>
              <li>· Retiré de <strong style={{ color: 'var(--text2)' }}>tous les groupes Microsoft 365</strong></li>
              <li>· La boîte sera convertie en <strong style={{ color: 'var(--text2)' }}>Shared Mailbox</strong></li>
              {form.accessTo && <li>· <strong style={{ color: 'var(--text2)' }}>{form.accessToDisplay || form.accessTo}</strong> recevra un accès complet</li>}
              {form.transferEmails && form.accessTo && <li>· Les emails entrants seront transférés (copie conservée)</li>}
            </ul>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={launch}
                disabled={submitting}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '9px 18px', borderRadius: 8, border: 'none',
                  background: submitting ? 'rgba(220,38,38,.5)' : '#dc2626',
                  color: '#fff', cursor: submitting ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                  transition: 'transform var(--transition), background var(--transition)',
                  opacity: submitting ? .7 : 1,
                }}
                onMouseEnter={e => { if (!submitting) e.currentTarget.style.background = '#b91c1c'; }}
                onMouseLeave={e => { e.currentTarget.style.background = submitting ? 'rgba(220,38,38,.5)' : '#dc2626'; }}
                onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }}
                onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 3px rgba(220,38,38,.4)'; }}
                onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
              >
                {submitting
                  ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Lancement…</>
                  : <><Icon path={IC.offboard} size={14} /> Confirmer et lancer</>}
              </button>
              <button
                onClick={() => setConfirming(false)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '9px 14px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--muted)', cursor: 'pointer',
                  fontSize: 13, fontFamily: 'inherit',
                  transition: 'background var(--transition), color var(--transition)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
                onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--primary)'; }}
                onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
              >
                Annuler
              </button>
            </div>
          </div>
        ) : (
          /* Launch button — bottom of card */
          <div style={{ padding: '0 22px 22px' }}>
            <button
              onClick={() => {
                if (!form.targetEmail) { setError('Sélectionnez un utilisateur à offboarder'); return; }
                setError(''); setConfirming(true);
              }}
              style={{
                width: '100%', padding: '11px', borderRadius: 8,
                border: '1px solid rgba(220,38,38,.35)',
                background: 'rgba(220,38,38,.07)', color: '#ef4444',
                cursor: 'pointer', fontSize: 13, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                fontFamily: 'inherit',
                transition: 'background var(--transition), border-color var(--transition)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(220,38,38,.12)'; e.currentTarget.style.borderColor = 'rgba(220,38,38,.5)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(220,38,38,.07)'; e.currentTarget.style.borderColor = 'rgba(220,38,38,.35)'; }}
              onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.99)'; }}
              onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 3px rgba(239,68,68,.25)'; }}
              onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
            >
              <Icon path={IC.offboard} size={15} />
              Lancer l'offboarding
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
