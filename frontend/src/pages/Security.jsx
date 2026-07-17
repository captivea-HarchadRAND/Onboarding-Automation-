import { useEffect, useState } from 'react';
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
  shield:   'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  warn:     ['M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  key:      ['M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4'],
  check:    ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4 12 14.01l-3-3'],
  lock:     ['M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  refresh:  'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  trash:    ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  x:        ['M18 6 6 18', 'M6 6l12 12'],
  minus:    'M5 12h14',
};

const SEC_CFG = {
  danger:  { color: '#ef4444', bg: 'rgba(239,68,68,.12)',  border: 'rgba(239,68,68,.25)',  icon: IC.warn  },
  warning: { color: '#f59e0b', bg: 'rgba(245,158,11,.12)', border: 'rgba(245,158,11,.25)', icon: IC.key   },
  success: { color: '#22c55e', bg: 'rgba(34,197,94,.12)',  border: 'rgba(34,197,94,.25)',  icon: IC.check },
  info:    { color: '#60a5fa', bg: 'rgba(96,165,250,.12)', border: 'rgba(96,165,250,.25)', icon: IC.lock  },
};

function Checkbox({ checked, indeterminate, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        width: 16, height: 16, borderRadius: 4,
        border: `1.5px solid ${checked || indeterminate ? 'var(--primary)' : 'rgba(255,255,255,.2)'}`,
        background: checked ? 'var(--primary)' : indeterminate ? 'rgba(79,70,229,.35)' : 'transparent',
        cursor: 'pointer', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, lineHeight: 1, transition: 'all .12s',
        color: '#fff',
      }}
      onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--primary)'; }}
      onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
      aria-checked={indeterminate ? 'mixed' : checked}
      role="checkbox"
    >
      {checked
        ? <Icon path={IC.check} size={9} strokeWidth={3} />
        : indeterminate
          ? <Icon path={IC.minus} size={9} strokeWidth={3} />
          : null}
    </button>
  );
}

function Btn({ onClick, disabled, children, variant = 'ghost' }) {
  const v = {
    ghost:   { bg: 'transparent',       hover: 'var(--surface2)',           border: 'var(--border)',           color: 'var(--muted)'   },
    primary: { bg: 'var(--primary)',     hover: 'var(--primary-hover)',      border: 'transparent',             color: '#fff'           },
    blue:    { bg: 'rgba(96,165,250,.08)', hover: 'rgba(96,165,250,.15)',  border: 'rgba(96,165,250,.35)',    color: '#60a5fa'        },
    danger:  { bg: 'rgba(239,68,68,.08)', hover: 'rgba(239,68,68,.15)',   border: 'rgba(239,68,68,.35)',     color: '#ef4444'        },
    dangerSolid: { bg: '#ef4444',        hover: '#dc2626',                   border: 'transparent',             color: '#fff'           },
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '6px 12px', borderRadius: 7,
        border: `1px solid ${v.border}`, background: v.bg,
        color: disabled ? 'var(--muted)' : v.color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
        opacity: disabled ? .5 : 1,
        transition: 'background var(--transition), color var(--transition)',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = v.hover; }}
      onMouseLeave={e => { e.currentTarget.style.background = v.bg; }}
      onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.98)'; }}
      onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--primary)'; }}
      onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      {children}
    </button>
  );
}

export default function Security() {
  const [events,      setEvents]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [selected,    setSelected]    = useState(new Set());
  const [confirmAll,  setConfirmAll]  = useState(false);
  const [confirmSel,  setConfirmSel]  = useState(false);
  const [deleting,    setDeleting]    = useState(false);

  function load() {
    setLoading(true);
    setSelected(new Set());
    api.get('/api/admin/security-events')
      .then(data => { setEvents(Array.isArray(data) ? data : []); setLastRefresh(new Date()); })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function toggleOne(ts) {
    setSelected(prev => { const n = new Set(prev); n.has(ts) ? n.delete(ts) : n.add(ts); return n; });
  }
  function toggleAll() {
    setSelected(selected.size === events.length ? new Set() : new Set(events.map(e => e.ts)));
  }

  async function handleArchive() {
    const res = await fetch('/api/admin/security-events/archive', { credentials: 'include' });
    if (!res.ok) return;
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `security-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDeleteAll() {
    setDeleting(true);
    try { await api.delete('/api/admin/security-events'); setEvents([]); setSelected(new Set()); setLastRefresh(new Date()); }
    catch (_) {} finally { setDeleting(false); setConfirmAll(false); }
  }

  async function handleDeleteSelection() {
    setDeleting(true);
    try {
      await api.delete('/api/admin/security-events/selection', { timestamps: [...selected] });
      setEvents(ev => ev.filter(e => !selected.has(e.ts)));
      setSelected(new Set());
    } catch (_) {} finally { setDeleting(false); setConfirmSel(false); }
  }

  const allChecked  = events.length > 0 && selected.size === events.length;
  const someChecked = selected.size > 0 && selected.size < events.length;
  const nSel        = selected.size;

  return (
    <div>
      {/* Hero header */}
      <div style={{ marginBottom: 16, position: 'relative', flexShrink: 0 }}>
        <div aria-hidden="true" style={{
          position: 'absolute', top: -30, left: '5%', width: 350, height: 120,
          background: 'radial-gradient(ellipse, rgba(96,165,250,.08) 0%, transparent 70%)',
          pointerEvents: 'none', filter: 'blur(24px)',
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10,
            padding: '4px 12px', borderRadius: 999,
            border: '1px solid rgba(96,165,250,.2)', background: 'rgba(96,165,250,.06)',
          }}>
            <Icon path={IC.shield} size={11} />
            <span style={{ fontSize: 11, color: 'rgba(96,165,250,.7)', fontWeight: 500, letterSpacing: '.3px' }}>Sécurité</span>
          </div>
          <h1 style={{
            fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em',
            background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            Événements de sécurité
          </h1>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            50 derniers événements · connexions, accès, invitations, réinitialisations
          </p>
        </div>
      </div>

      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
        flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        {/* Toolbar */}
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(255,255,255,.02)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 10, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {nSel > 0
              ? <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{nSel} sélectionné{nSel > 1 ? 's' : ''}</span>
              : <span>{events.length} événement{events.length !== 1 ? 's' : ''}</span>}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Btn onClick={load} disabled={loading}>
              <Icon path={IC.refresh} size={12} />
              Actualiser
            </Btn>

            <Btn onClick={handleArchive} variant="blue">
              <Icon path={IC.download} size={12} />
              Archiver
            </Btn>

            {/* Delete selection */}
            {nSel > 0 && (
              confirmSel ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    Supprimer {nSel} ligne{nSel > 1 ? 's' : ''} ?
                  </span>
                  <Btn onClick={handleDeleteSelection} disabled={deleting} variant="dangerSolid">
                    {deleting ? 'Suppression…' : 'Confirmer'}
                  </Btn>
                  <Btn onClick={() => setConfirmSel(false)}>Annuler</Btn>
                </div>
              ) : (
                <Btn onClick={() => setConfirmSel(true)} variant="danger">
                  <Icon path={IC.trash} size={12} />
                  Supprimer ({nSel})
                </Btn>
              )
            )}

            {/* Delete all */}
            {nSel === 0 && (
              confirmAll ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Tout effacer ?</span>
                  <Btn onClick={handleDeleteAll} disabled={deleting} variant="dangerSolid">
                    {deleting ? 'Suppression…' : 'Oui, tout'}
                  </Btn>
                  <Btn onClick={() => setConfirmAll(false)}>Annuler</Btn>
                </div>
              ) : (
                <Btn onClick={() => setConfirmAll(true)} variant="danger">
                  <Icon path={IC.trash} size={12} />
                  Tout effacer
                </Btn>
              )
            )}
          </div>
        </div>

        {/* Events list — scrollable */}
        <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto', padding: '0 18px' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, padding: '36px 0' }}>
              <span className="spinner" style={{ width: 18, height: 18 }} />
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Chargement…</span>
            </div>
          ) : events.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 44, height: 44, borderRadius: 10,
                background: 'var(--surface2)', border: '1px solid var(--border)',
                color: 'var(--muted)', marginBottom: 12,
              }}>
                <Icon path={IC.shield} size={20} strokeWidth={1.5} />
              </div>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
                Aucun événement de sécurité enregistré
              </p>
            </div>
          ) : (
            <>
              {/* Select-all header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 0 8px', borderBottom: '1px solid var(--border)',
              }}>
                <Checkbox checked={allChecked} indeterminate={someChecked} onChange={toggleAll} />
                <span style={{ fontSize: 11, color: 'var(--muted)', userSelect: 'none' }}>
                  {allChecked ? 'Tout désélectionner' : 'Tout sélectionner'}
                </span>
              </div>

              {events.map((ev, i) => {
                const s   = SEC_CFG[ev.type] || SEC_CFG.info;
                const sel = selected.has(ev.ts);
                let ts = '';
                try {
                  ts = new Date(ev.ts).toLocaleString('fr-FR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  });
                } catch (_) { ts = ev.ts; }

                return (
                  <div
                    key={i}
                    role="row"
                    aria-selected={sel}
                    onClick={() => toggleOne(ev.ts)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '10px 6px',
                      borderBottom: i < events.length - 1 ? '1px solid rgba(51,65,85,.4)' : 'none',
                      background: sel ? 'rgba(79,70,229,.06)' : 'transparent',
                      borderRadius: 6, cursor: 'pointer',
                      transition: 'background .08s',
                      marginLeft: -6, marginRight: -6,
                    }}
                    onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,.025)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = sel ? 'rgba(79,70,229,.06)' : 'transparent'; }}
                  >
                    <div style={{ paddingTop: 2, flexShrink: 0 }}>
                      <Checkbox checked={sel} onChange={() => toggleOne(ev.ts)} />
                    </div>

                    {/* Type icon */}
                    <div style={{
                      width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                      background: s.bg, border: `1px solid ${s.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: s.color, marginTop: 1,
                    }}>
                      <Icon path={s.icon} size={13} strokeWidth={2} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase',
                          padding: '2px 8px', borderRadius: 8,
                          background: s.bg, color: s.color, border: `1px solid ${s.border}`, flexShrink: 0,
                        }}>
                          {ev.label}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{ts}</span>
                      </div>
                      <div style={{
                        fontSize: 12, color: 'var(--text2)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }} title={ev.msg}>
                        {ev.msg}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        {lastRefresh && (
          <div style={{
            padding: '8px 18px', borderTop: '1px solid var(--border)',
            fontSize: 10, color: 'var(--muted)', textAlign: 'right',
            background: 'rgba(255,255,255,.01)',
          }}>
            Mis à jour : {lastRefresh.toLocaleTimeString('fr-FR')}
          </div>
        )}
      </div>
    </div>
  );
}
