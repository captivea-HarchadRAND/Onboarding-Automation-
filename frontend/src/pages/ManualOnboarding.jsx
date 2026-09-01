import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { JOB_ROLES } from '../jobRoles';

const GLOBAL_ROLES = new Set(['CFO', 'Directeur Marketing', 'DRH']);

const DEFAULT_LOCATIONS = [
  { code: 'FR',  name: 'France',        flag: '🇫🇷' },
  { code: 'MDG', name: 'Madagascar',    flag: '🇲🇬' },
  { code: 'US',  name: 'United States', flag: '🇺🇸' },
  { code: 'SG',  name: 'Singapore',     flag: '🇸🇬' },
  { code: 'LUX', name: 'Luxembourg',    flag: '🇱🇺' },
  { code: 'IND', name: 'India',         flag: '🇮🇳' },
  { code: 'CA',  name: 'Canada',        flag: '🇨🇦' },
];

function RoleCombobox({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDown(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const filtered = JOB_ROLES.filter(({ label }) => label.toLowerCase().includes(search.toLowerCase()));
  const displayValue = open ? search : (value || '');
  function select(label) { onChange(label); setSearch(''); setOpen(false); }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          value={displayValue}
          placeholder="Rechercher ou sélectionner un poste..."
          onFocus={() => { setSearch(''); setOpen(true); }}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          autoComplete="off"
          style={{ paddingRight: 30 }}
        />
        <span
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none', display: 'flex' }}
          onMouseDown={e => { e.preventDefault(); setOpen(o => !o); setSearch(''); }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </div>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, maxHeight: 240, overflowY: 'auto', zIndex: 60, boxShadow: '0 8px 24px rgba(0,0,0,.35)' }}>
          {filtered.length === 0
            ? <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--muted)' }}>Aucun résultat</div>
            : filtered.map(({ label }) => (
              <div key={label} onMouseDown={() => select(label)}
                style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 13, color: value === label ? 'var(--primary)' : 'var(--text)', background: value === label ? 'rgba(37,99,235,.12)' : 'transparent', fontWeight: value === label ? 600 : 400, borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => { if (value !== label) e.currentTarget.style.background = 'var(--surface2)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = value === label ? 'rgba(37,99,235,.12)' : 'transparent'; }}
              >{label}</div>
            ))}
        </div>
      )}
    </div>
  );
}

function LocationCombobox({ value, onChange, locations = [] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDown(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const filtered = locations.filter(l => l.code.toLowerCase().includes(search.toLowerCase()) || l.name.toLowerCase().includes(search.toLowerCase()));
  const selected = locations.find(l => l.code === value);
  const displayValue = open ? search : (selected ? `${selected.flag} ${selected.code}` : (value || ''));
  function select(loc) { onChange(loc.code); setSearch(''); setOpen(false); }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          value={displayValue}
          placeholder="Rechercher ou sélectionner..."
          onFocus={() => { setSearch(''); setOpen(true); }}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          autoComplete="off"
          style={{ paddingRight: 30 }}
        />
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none', display: 'flex' }}
          onMouseDown={e => { e.preventDefault(); setOpen(o => !o); setSearch(''); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </div>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, maxHeight: 200, overflowY: 'auto', zIndex: 60, boxShadow: '0 8px 24px rgba(0,0,0,.35)' }}>
          {filtered.length === 0
            ? <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--muted)' }}>Aucun résultat</div>
            : filtered.map(loc => (
              <div key={loc.code} onMouseDown={() => select(loc)}
                style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 13, color: value === loc.code ? 'var(--primary)' : 'var(--text)', background: value === loc.code ? 'rgba(37,99,235,.12)' : 'transparent', fontWeight: value === loc.code ? 600 : 400, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}
                onMouseEnter={e => { if (value !== loc.code) e.currentTarget.style.background = 'var(--surface2)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = value === loc.code ? 'rgba(37,99,235,.12)' : 'transparent'; }}
              >
                <span>{loc.flag}</span>
                <span style={{ fontWeight: 600 }}>{loc.code}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{loc.name}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export default function ManualOnboarding() {
  const [form, setForm] = useState({ email: '', jobRole: '', location: '', city: '' });
  const [locations, setLocations] = useState(DEFAULT_LOCATIONS);
  const [spCountryGroups, setSpCountryGroups] = useState([]);
  const [autoGroup, setAutoGroup] = useState(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get('/api/admin/settings').then(data => {
      if (Array.isArray(data.locations) && data.locations.length > 0) setLocations(data.locations);
      setSpCountryGroups((data.sharepoint_country_groups || []).filter(g => g.id));
    }).catch(() => {});
  }, []);

  const citiesForLocation = spCountryGroups
    .filter(g => g.location === form.location)
    .flatMap(g => g.cities || [])
    .filter(c => c && c.name && c.id);

  useEffect(() => {
    const { jobRole, location } = form;
    if (!jobRole) { setAutoGroup(null); return; }
    const isGlobal = GLOBAL_ROLES.has(jobRole.trim());
    if (!isGlobal && !location) { setAutoGroup(null); return; }

    const groupKey = JOB_ROLES.find(r => r.label === jobRole.trim())?.groupKey || jobRole.trim();
    const query = isGlobal ? `SP - ${groupKey}` : `SP - ${groupKey} ${location.trim()}`;

    setGroupLoading(true);
    setAutoGroup(null);
    api.get(`/api/graph/groups?search=${encodeURIComponent(query)}`)
      .then(data => {
        if (data.length > 0) {
          const exact = data.find(g =>
            g.displayName.replace(/^2024_/, '').toLowerCase() === query.toLowerCase()
          ) || data[0];
          setAutoGroup(exact);
        }
      })
      .catch(() => {})
      .finally(() => setGroupLoading(false));
  }, [form.jobRole, form.location]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setResult(null);

    const { email, jobRole, location, city } = form;
    if (!email.trim()) return setError('Email requis');
    if (!jobRole.trim()) return setError('Rôle requis');
    const isGlobal = GLOBAL_ROLES.has(jobRole.trim());
    if (!isGlobal && !location.trim()) return setError('Localisation requise');
    if (!isGlobal && citiesForLocation.length > 0 && !city.trim()) return setError('Ville requise pour cette localisation');
    if (!autoGroup) return setError('Aucun groupe trouvé pour ce rôle et cette localisation');

    setLoading(true);
    try {
      const data = await api.post('/api/onboardings/manual', {
        email: email.trim(),
        groupId: autoGroup.id,
        groupName: autoGroup.displayName,
        jobRole: jobRole.trim(),
        location: isGlobal ? '' : location.trim(),
        city: isGlobal ? '' : city.trim(),
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setForm({ email: '', jobRole: '', location: '', city: '' });
    setAutoGroup(null);
    setResult(null);
    setError('');
  }

  const isGlobal = GLOBAL_ROLES.has(form.jobRole.trim());

  if (result) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', paddingTop: 40 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: result.skipped ? 'rgba(234,179,8,.1)' : 'rgba(34,197,94,.1)', border: `2px solid ${result.skipped ? 'rgba(234,179,8,.3)' : 'rgba(34,197,94,.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            {result.skipped
              ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
            }
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>
            {result.skipped ? 'Déjà membre' : 'Ajouté avec succès'}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>
            {result.displayName || form.email}
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
            {result.skipped ? 'est déjà membre de' : 'a été ajouté au groupe'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, marginBottom: result.spGroupCount ? 8 : 20 }}>
            {result.groupName}
          </p>
          {result.spGroupCount > 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              + {result.spGroupCount} groupe{result.spGroupCount > 1 ? 's' : ''} SharePoint/communication
            </p>
          )}
          {result.githubInvited && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 8, padding: '6px 12px', marginBottom: 16, fontSize: 12, color: 'var(--primary)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
              Invitation GitHub envoyée
            </div>
          )}
          <div>
            <button onClick={reset} style={{ padding: '9px 20px', borderRadius: 8, background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              Nouvel ajout
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ marginBottom: 24, position: 'relative' }}>
        <div aria-hidden="true" style={{ position: 'absolute', top: -30, left: '5%', width: 350, height: 120, background: 'radial-gradient(ellipse, rgba(79,70,229,.1) 0%, transparent 70%)', pointerEvents: 'none', filter: 'blur(24px)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '4px 12px', borderRadius: 999, border: '1px solid rgba(79,70,229,.2)', background: 'rgba(79,70,229,.06)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span style={{ fontSize: 11, color: 'rgba(99,102,241,.7)', fontWeight: 500, letterSpacing: '.3px' }}>Onboarding Manuel</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Ajout au groupe
          </h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Pour les comptes M365 créés manuellement — ajoute l'utilisateur au groupe SharePoint + invitation GitHub.
          </p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Adresse email M365 *</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="jean.dupont@captivea.com"
              autoFocus
            />
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20, color: 'var(--text)' }}>Rôle & Localisation</h2>

          <div className="form-row">
            <div className="form-group">
              <label>Rôle / Poste métier *</label>
              <RoleCombobox
                value={form.jobRole}
                onChange={v => setForm(f => ({ ...f, jobRole: v, location: GLOBAL_ROLES.has(v) ? '' : f.location }))}
              />
            </div>
            {!isGlobal && (
              <div className="form-group">
                <label>Localisation *</label>
                <LocationCombobox
                  value={form.location}
                  onChange={v => setForm(f => ({ ...f, location: v, city: '' }))}
                  locations={locations}
                />
              </div>
            )}
          </div>

          {!isGlobal && citiesForLocation.length > 0 && (
            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Ville *</label>
              <select
                value={form.city}
                onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
              >
                <option value="">Sélectionner…</option>
                {citiesForLocation.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          )}

          {groupLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>
              <span className="spinner" style={{ width: 14, height: 14 }} />
              Recherche du groupe…
            </div>
          )}
          {!groupLoading && autoGroup && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(37,99,235,.06)', border: '1px solid rgba(37,99,235,.2)', borderRadius: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <div>
                <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700 }}>{autoGroup.displayName}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Groupe sélectionné automatiquement</div>
              </div>
            </div>
          )}
          {!groupLoading && form.jobRole && ((!isGlobal && form.location) || isGlobal) && !autoGroup && (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)', padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
              Aucun groupe trouvé pour ce rôle et cette localisation.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={loading || !autoGroup || (!isGlobal && citiesForLocation.length > 0 && !form.city)}
            style={{ padding: '10px 24px', borderRadius: 8, background: (loading || !autoGroup) ? 'var(--surface2)' : 'var(--primary)', color: (loading || !autoGroup) ? 'var(--muted)' : '#fff', border: 'none', cursor: (loading || !autoGroup) ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            {loading && <span className="spinner" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,.3)', borderTopColor: '#fff' }} />}
            {loading ? 'Ajout en cours…' : 'Ajouter au groupe + GitHub'}
          </button>
        </div>
      </form>
    </div>
  );
}
