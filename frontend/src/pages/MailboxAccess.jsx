// [EN-TÊTE] MailboxAccess.jsx — module Onboarding, administrateurs : /mailbox-access. Recherche d'une personne dans l'annuaire
// (/api/users/graph-search, anti-rebond) puis cases à cocher parmi les boîtes partagées configurées (Administration → Groupes →
// Boîtes partagées) ; POST /api/shared-mailboxes/grant, résultat boîte par boîte.

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';

function Icon({ path, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', overflow: 'visible' }}>
      {path.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
const SEARCH = ['M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0'];
const CHECK = ['M20 6 9 17l-5-5'];
const MAIL = ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M22 6l-10 7L2 6'];

const STATUS = {
  granted: { label: 'Accès accordé',        color: '#22c55e' },
  already: { label: 'Déjà autorisé',        color: '#facc15' },
  mock:    { label: 'Simulé (mode dév.)',   color: '#94a3b8' },
  error:   { label: 'Échec',                color: '#ef4444' },
};

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ── Recherche d'une personne dans Azure AD ───────────────────────── */
function UserSearch({ user, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const timer = useRef(null);
  const seq = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  function onChange(e) {
    const q = e.target.value;
    setQuery(q);
    if (user) onSelect(null);
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); setOpen(false); setSearched(false); return; }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;           // ignore les réponses d'une recherche périmée
      setLoading(true);
      try {
        const data = await api.get(`/api/users/graph-search?q=${encodeURIComponent(q.trim())}`);
        if (mine !== seq.current) return;
        setResults(Array.isArray(data) ? data : []);
        setSearched(true);
        setOpen(true);
      } catch (_) {
        if (mine === seq.current) { setResults([]); setSearched(true); setOpen(true); }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 300);
  }

  function pick(u) {
    onSelect(u);
    setQuery(u.displayName);
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: user ? '#22c55e' : 'var(--muted)', display: 'flex', pointerEvents: 'none' }}>
          <Icon path={user ? CHECK : SEARCH} size={14} />
        </span>
        <input
          type="text" autoComplete="off" autoFocus
          placeholder="Rechercher une personne (nom ou email)…"
          aria-label="Rechercher une personne dans Azure AD"
          aria-expanded={open}
          value={query}
          onChange={onChange}
          onFocus={() => { if (results.length > 0 && !user) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          style={{ paddingLeft: 34, paddingRight: 34, ...(user ? { borderColor: 'rgba(34,197,94,.5)' } : {}) }}
        />
        {loading && <span className="spinner" style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13 }} />}
      </div>

      {open && (
        <div role="listbox" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,.5)', overflow: 'hidden' }}>
          {results.length === 0 && searched && (
            <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--muted)' }}>Aucune personne trouvée.</div>
          )}
          {results.map(u => (
            <div key={u.id} role="option" tabIndex={0}
              onMouseDown={() => pick(u)}
              onKeyDown={e => { if (e.key === 'Enter') pick(u); }}
              style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{u.displayName}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{u.mail}</div>
            </div>
          ))}
        </div>
      )}

      {user && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(34,197,94,.3)', background: 'rgba(34,197,94,.06)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{user.displayName}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{user.mail}</div>
        </div>
      )}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */
export default function MailboxAccess() {
  const [mailboxes, setMailboxes] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [user, setUser] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get('/api/shared-mailboxes')
      .then(setMailboxes)
      .catch(e => { setLoadError(e.message); setMailboxes([]); });
  }, []);

  const q = norm(filter.trim());
  const visible = useMemo(
    () => (mailboxes || []).filter(m => !q || norm(`${m.name} ${m.email} ${m.scope}`).includes(q)),
    [mailboxes, q]
  );
  const allVisibleChecked = visible.length > 0 && visible.every(m => selected.has(m.email));

  function toggle(email) {
    setSelected(prev => { const n = new Set(prev); if (n.has(email)) n.delete(email); else n.add(email); return n; });
  }
  function toggleAllVisible() {
    setSelected(prev => {
      const n = new Set(prev);
      if (allVisibleChecked) visible.forEach(m => n.delete(m.email)); else visible.forEach(m => n.add(m.email));
      return n;
    });
  }

  async function submit() {
    setError(''); setResult(null);
    if (!user) return setError('Choisis d\'abord une personne.');
    if (selected.size === 0) return setError('Sélectionne au moins une boîte partagée.');
    setSubmitting(true);
    try {
      const data = await api.post('/api/shared-mailboxes/grant', { email: user.mail, mailboxes: [...selected] });
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function reset() { setUser(null); setSelected(new Set()); setFilter(''); setResult(null); setError(''); }

  const canSubmit = !!user && selected.size > 0 && !submitting;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '4px 12px', borderRadius: 999, border: '1px solid rgba(79,70,229,.2)', background: 'rgba(79,70,229,.06)' }}>
          <Icon path={MAIL} size={11} />
          <span style={{ fontSize: 11, color: 'rgba(99,102,241,.8)', fontWeight: 500, letterSpacing: '.3px' }}>Boîtes partagées</span>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', margin: 0, background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          Accès aux boîtes partagées
        </h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          Donne à une personne l'accès à une ou plusieurs boîtes partagées configurées (Administration → Groupes → Boîtes partagées).
        </p>
      </div>

      {error && <div className="error-box" role="alert">{error}</div>}
      {loadError && <div className="error-box" role="alert">{loadError}</div>}

      {result ? (
        <div className="card">
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', color: 'var(--text)' }}>
            {result.ok ? 'Terminé' : 'Terminé avec des erreurs'} — {result.displayName}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 14px' }}>Résultat par boîte partagée</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
            {result.results.map(r => {
              const s = STATUS[r.status] || STATUS.error;
              return (
                <div key={r.email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{r.email}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.label}</div>
                    {r.error && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.error}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" className="btn btn-primary" onClick={reset}>Nouvel accès</button>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>

            <div className="card">
              <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px', color: 'var(--text)' }}>1. Personne</h2>
              <UserSearch user={user} onSelect={setUser} />
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--text)' }}>2. Boîtes partagées</h2>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selected.size} sélectionnée{selected.size > 1 ? 's' : ''}</span>
              </div>

              {mailboxes === null && <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><span className="spinner" /></div>}

              {mailboxes && mailboxes.length === 0 && !loadError && (
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
                  Aucune boîte partagée configurée. Ajoute-en dans Administration → Groupes → Boîtes partagées.
                </p>
              )}

              {mailboxes && mailboxes.length > 0 && (
                <>
                  <div style={{ position: 'relative', marginBottom: 10 }}>
                    <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', display: 'flex', pointerEvents: 'none' }}><Icon path={SEARCH} /></span>
                    <input aria-label="Filtrer les boîtes partagées" placeholder="Filtrer les boîtes…" value={filter} onChange={e => setFilter(e.target.value)} style={{ paddingLeft: 34 }} />
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: 'var(--text2)', textTransform: 'none', letterSpacing: 0, margin: '0 0 8px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={allVisibleChecked} onChange={toggleAllVisible} disabled={visible.length === 0} style={{ width: 'auto' }} />
                    Tout sélectionner{q ? ' (résultats filtrés)' : ''}
                  </label>

                  <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {visible.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 2px' }}>Aucune boîte ne correspond.</div>}
                    {visible.map(m => {
                      const on = selected.has(m.email);
                      return (
                        <label key={m.email} style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                          textTransform: 'none', letterSpacing: 0, margin: 0,
                          border: `1px solid ${on ? 'rgba(99,102,241,.5)' : 'var(--border)'}`, background: on ? 'rgba(99,102,241,.08)' : 'var(--surface2)',
                        }}>
                          <input type="checkbox" checked={on} onChange={() => toggle(m.email)} style={{ width: 'auto', marginTop: 3 }} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.name}</span>
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{m.email}</span>
                            {m.scope && <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{m.scope}</span>}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={submit} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {submitting && <span className="spinner" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,.3)', borderTopColor: '#fff' }} />}
              {submitting ? 'Attribution en cours…' : `Donner l'accès${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
