import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function Icon({ path, size = 14, strokeWidth = 1.75 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {Array.isArray(path) ? path.map((d, i) => <path key={i} d={d} />) : <path d={path} />}
    </svg>
  );
}

const IC = {
  rocket:   ['M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2', 'M12 8L6.7 13.3c-1.1 1.1-1.1 2.9 0 4L12 22l10-10-4.7-4.7c-1.1-1.1-2.9-1.1-4 0L8 12', 'M22 2L13.4 10.6', 'M15 2H22V9'],
  clock:    ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  search:   'M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  filter:   ['M22 3H2l8 9.46V19l4 2V12.46L22 3'],
  check:    ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4 12 14.01l-3-3'],
  x:        ['M18 6 6 18', 'M6 6l12 12'],
  spinner:  'M21 12a9 9 0 1 1-6.219-8.56',
  eye:      ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  list:     ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  refresh:  'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  warn:     ['M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  rewind:   ['M1 4v6h6', 'M3.51 15a9 9 0 1 0 .49-3.51'],
};

const STATUS_CFG = {
  done:        { label: 'Terminé',       color: '#22c55e', bg: 'rgba(34,197,94,.12)',   border: 'rgba(34,197,94,.25)'   },
  failed:      { label: 'Échoué',        color: '#ef4444', bg: 'rgba(239,68,68,.12)',  border: 'rgba(239,68,68,.25)'   },
  running:     { label: 'En cours',      color: '#60a5fa', bg: 'rgba(96,165,250,.12)', border: 'rgba(96,165,250,.25)'  },
  pending:     { label: 'En attente',    color: '#94a3b8', bg: 'rgba(148,163,184,.1)', border: 'rgba(148,163,184,.2)'  },
  rolled_back: { label: 'Rollback',      color: '#f59e0b', bg: 'rgba(245,158,11,.12)', border: 'rgba(245,158,11,.25)'  },
};

function StatusBadge({ status, rolledBack }) {
  const s = STATUS_CFG[status] || STATUS_CFG.pending;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center',
        fontSize: 10, fontWeight: 700, letterSpacing: '.3px',
        padding: '2px 8px', borderRadius: 99,
        background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      }}>
        {s.label}
      </span>
      {rolledBack && (
        <span style={{ display: 'inline-flex', color: '#f59e0b' }} title="Rollback effectué">
          <Icon path={IC.rewind} size={11} />
        </span>
      )}
    </div>
  );
}

function Btn({ onClick, disabled, children, variant = 'ghost', style }) {
  const variants = {
    ghost:   { base: 'transparent',        hover: 'var(--surface2)', color: 'var(--muted)', border: 'var(--border)' },
    primary: { base: 'var(--primary)',      hover: 'var(--primary-hover)', color: '#fff', border: 'transparent' },
  };
  const v = variants[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 13px', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
        background: v.base, border: `1px solid ${v.border}`,
        color: disabled ? 'var(--muted)' : v.color,
        fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
        opacity: disabled ? .5 : 1,
        transition: 'background var(--transition), color var(--transition)',
        ...style,
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = v.hover; if (variant === 'ghost') e.currentTarget.style.color = 'var(--text)'; } }}
      onMouseLeave={e => { e.currentTarget.style.background = v.base; if (variant === 'ghost') e.currentTarget.style.color = v.color; }}
      onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--primary)'; }}
      onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      {children}
    </button>
  );
}

export default function History() {
  const [onboardings, setOnboardings] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState('');
  const [search, setSearch]           = useState('');
  const [focusSearch, setFocusSearch] = useState(false);

  function load() {
    setLoading(true);
    const qs = filter ? `?status=${filter}` : '';
    api.get(`/api/onboardings${qs}`)
      .then(data => { setOnboardings(data); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filter]);

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

  const counts = Object.fromEntries(
    Object.keys(STATUS_CFG).map(s => [s, onboardings.filter(o => o.status === s).length])
  );

  return (
    <div>
      {/* Hero header */}
      <div style={{ marginBottom: 24, position: 'relative' }}>
        <div aria-hidden="true" style={{
          position: 'absolute', top: -30, left: '5%', width: 350, height: 120,
          background: 'radial-gradient(ellipse, rgba(79,70,229,.1) 0%, transparent 70%)',
          pointerEvents: 'none', filter: 'blur(24px)',
        }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10,
              padding: '4px 12px', borderRadius: 999,
              border: '1px solid rgba(79,70,229,.2)', background: 'rgba(79,70,229,.06)',
            }}>
              <Icon path={IC.list} size={11} />
              <span style={{ fontSize: 11, color: 'rgba(99,102,241,.7)', fontWeight: 500, letterSpacing: '.3px' }}>Historique</span>
            </div>
            <h1 style={{
              fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em',
              background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              Onboardings
            </h1>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              {onboardings.length} au total
              {counts.running > 0 && <> · <span style={{ color: '#60a5fa', fontWeight: 600 }}>{counts.running} en cours</span></>}
              {counts.failed  > 0 && <> · <span style={{ color: '#ef4444', fontWeight: 600 }}>{counts.failed} échoués</span></>}
            </p>
          </div>
          <Link to="/new" style={{ textDecoration: 'none' }}>
            <Btn variant="primary">
              <Icon path={IC.rocket} size={13} />
              Nouvel onboarding
            </Btn>
          </Link>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 300 }}>
          <span style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--muted)', pointerEvents: 'none', display: 'flex',
          }}>
            <Icon path={IC.search} size={13} />
          </span>
          <input
            placeholder="Rechercher un employé…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={() => setFocusSearch(true)}
            onBlur={() => setFocusSearch(false)}
            style={{
              width: '100%', boxSizing: 'border-box',
              paddingLeft: 32, paddingRight: 10, height: 36,
              borderRadius: 8, border: `1px solid ${focusSearch ? 'var(--primary)' : 'var(--border)'}`,
              background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, outline: 'none',
              boxShadow: focusSearch ? '0 0 0 3px var(--primary-soft)' : 'none',
              transition: 'border-color var(--transition)',
            }}
          />
        </div>

        {/* Status filter pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { value: '',            label: 'Tous',       color: 'var(--muted)' },
            { value: 'done',        label: 'Terminés',   color: '#22c55e' },
            { value: 'running',     label: 'En cours',   color: '#60a5fa' },
            { value: 'failed',      label: 'Échoués',    color: '#ef4444' },
            { value: 'pending',     label: 'En attente', color: '#94a3b8' },
          ].map(opt => {
            const active = filter === opt.value;
            const count  = opt.value ? counts[opt.value] : onboardings.length;
            return (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 99,
                  border: `1px solid ${active ? opt.color + '60' : 'var(--border)'}`,
                  background: active ? opt.color + '14' : 'transparent',
                  color: active ? opt.color : 'var(--muted)',
                  cursor: 'pointer', fontSize: 11, fontWeight: active ? 700 : 400,
                  fontFamily: 'inherit', transition: 'all var(--transition)',
                }}
                onFocus={e => { e.currentTarget.style.boxShadow = `0 0 0 2px var(--primary)`; }}
                onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
              >
                {opt.label}
                {count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    background: active ? opt.color + '25' : 'rgba(255,255,255,.08)',
                    color: active ? opt.color : 'var(--muted)',
                    padding: '0 5px', borderRadius: 99,
                  }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <Btn onClick={load} disabled={loading} style={{ marginLeft: 'auto' }}>
          <Icon path={IC.refresh} size={13} />
          Actualiser
        </Btn>
      </div>

      {/* Table card */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
      }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 60, gap: 10 }}>
            <span className="spinner" style={{ width: 20, height: 20 }} />
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Chargement…</span>
          </div>
        ) : visible.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '56px 24px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: 'var(--surface2)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--muted)',
            }}>
              <Icon path={IC.list} size={22} strokeWidth={1.5} />
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
              {search ? `Aucun résultat pour "${search}"` : 'Aucun onboarding trouvé'}
            </p>
            <Link to="/new" style={{ textDecoration: 'none' }}>
              <Btn variant="primary">
                <Icon path={IC.rocket} size={13} />
                Démarrer un onboarding
              </Btn>
            </Link>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Employé', 'Email M365', 'Groupe SP', 'Licence', 'Statut', 'Lancé par', 'Date', ''].map((h, i) => (
                    <th key={i} style={{
                      textAlign: 'left', padding: '10px 14px',
                      fontSize: 10, fontWeight: 700, letterSpacing: '.5px',
                      textTransform: 'uppercase', color: 'var(--muted)',
                      borderBottom: '1px solid var(--border)',
                      background: 'rgba(255,255,255,.015)',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((o, idx) => (
                  <tr key={o.id} style={{ transition: 'background .08s' }}
                    onMouseEnter={e => { e.currentTarget.querySelectorAll('td').forEach(td => td.style.background = 'var(--surface2)'); }}
                    onMouseLeave={e => { e.currentTarget.querySelectorAll('td').forEach(td => td.style.background = 'transparent'); }}>
                    <td style={{ padding: '12px 14px', borderBottom: idx < visible.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                        {o.employee_firstname} {o.employee_lastname}
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: idx < visible.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
                        {o.employee_email}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: idx < visible.length - 1 ? '1px solid var(--border)' : 'none', maxWidth: 160 }}>
                      <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={o.group_name}>
                        {o.group_name}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: idx < visible.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{o.license_name}</span>
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: idx < visible.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <StatusBadge status={o.status} rolledBack={o.rolled_back} />
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: idx < visible.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{o.created_by_name}</span>
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: idx < visible.length - 1 ? '1px solid var(--border)' : 'none', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {new Date(o.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: idx < visible.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <Link to={`/history/${o.id}`} style={{ textDecoration: 'none' }}>
                        <button style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '4px 10px', borderRadius: 6,
                          border: '1px solid var(--border)', background: 'transparent',
                          color: 'var(--muted)', cursor: 'pointer', fontSize: 11,
                          fontFamily: 'inherit',
                          transition: 'background var(--transition), color var(--transition)',
                        }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface3)'; e.currentTarget.style.color = 'var(--text)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
                          onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--primary)'; }}
                          onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
                        >
                          <Icon path={IC.eye} size={12} />
                          Détails
                        </button>
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
