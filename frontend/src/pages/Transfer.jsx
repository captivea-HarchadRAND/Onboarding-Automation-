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

export default function Transfer() {
  const [form, setForm] = useState({ email: '', jobRole: '', location: '', city: '' });
  const [locations, setLocations] = useState(DEFAULT_LOCATIONS);
  const [spCountryGroups, setSpCountryGroups] = useState([]);
  const [autoGroup, setAutoGroup] = useState(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [newGroupsPreview, setNewGroupsPreview] = useState([]);
  const [newGroupsLoading, setNewGroupsLoading] = useState(false);

  const [lookup, setLookup] = useState(null);       // { displayName, groups } de l'email recherché
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [lookedUpEmail, setLookedUpEmail] = useState('');

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

  // Aperçu des groupes SharePoint/communication qui seront ajoutés (globaux + pays/ville +
  // communication), pour confirmation avant de valider la mutation.
  useEffect(() => {
    const { jobRole, location, city } = form;
    if (!jobRole.trim()) { setNewGroupsPreview([]); return; }
    const isGlobal = GLOBAL_ROLES.has(jobRole.trim());
    if (!isGlobal && !location.trim()) { setNewGroupsPreview([]); return; }

    setNewGroupsLoading(true);
    const params = new URLSearchParams({ jobRole: jobRole.trim() });
    if (!isGlobal) {
      params.set('location', location.trim());
      if (city.trim()) params.set('city', city.trim());
    }
    if (autoGroup?.id) params.set('excludeGroupId', autoGroup.id);
    api.get(`/api/onboardings/resolve-groups?${params.toString()}`)
      .then(data => setNewGroupsPreview(Array.isArray(data) ? data : []))
      .catch(() => setNewGroupsPreview([]))
      .finally(() => setNewGroupsLoading(false));
  }, [form.jobRole, form.location, form.city, autoGroup]);

  async function handleLookup() {
    const email = form.email.trim();
    if (!email) return;
    setLookupError('');
    setLookup(null);
    setLookupLoading(true);
    try {
      const data = await api.get(`/api/onboardings/transfer/groups?email=${encodeURIComponent(email)}`);
      setLookup(data);
      setLookedUpEmail(email);
    } catch (err) {
      setLookupError(err.message);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setResult(null);

    const { email, jobRole, location, city } = form;
    if (!email.trim()) return setError('Email requis');
    if (email.trim() !== lookedUpEmail) return setError('Recherche les groupes actuels avant de continuer (bouton "Rechercher")');
    if (!jobRole.trim()) return setError('Nouveau poste requis');
    const isGlobal = GLOBAL_ROLES.has(jobRole.trim());
    if (!isGlobal && !location.trim()) return setError('Nouvelle localisation requise');
    if (!isGlobal && citiesForLocation.length > 0 && !city.trim()) return setError('Ville requise pour cette localisation');
    if (!autoGroup) return setError('Aucun groupe trouvé pour ce nouveau poste/localisation');

    setLoading(true);
    try {
      const data = await api.post('/api/onboardings/transfer', {
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
    setLookup(null);
    setLookedUpEmail('');
    setLookupError('');
    setAutoGroup(null);
    setResult(null);
    setError('');
  }

  const isGlobal = GLOBAL_ROLES.has(form.jobRole.trim());

  if (result) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', paddingTop: 40 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(34,197,94,.1)', border: '2px solid rgba(34,197,94,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>Mutation effectuée</h2>
          <p style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>
            {result.displayName || form.email}
          </p>
          {result.removedGroups?.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
              Retiré de : {result.removedGroups.join(', ')}
            </p>
          )}
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
            {result.skipped ? 'était déjà membre de' : 'a été ajouté au groupe'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, marginBottom: result.spGroupCount ? 8 : 20 }}>
            {result.groupName}
          </p>
          {result.spGroupCount > 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              + {result.spGroupCount} groupe{result.spGroupCount > 1 ? 's' : ''} SharePoint/communication
            </p>
          )}
          <div>
            <button onClick={reset} style={{ padding: '9px 20px', borderRadius: 8, background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              Nouvelle mutation
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ marginBottom: 24, position: 'relative' }}>
        <div aria-hidden="true" style={{ position: 'absolute', top: -30, left: '5%', width: 350, height: 120, background: 'radial-gradient(ellipse, rgba(79,70,229,.1) 0%, transparent 70%)', pointerEvents: 'none', filter: 'blur(24px)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '4px 12px', borderRadius: 999, border: '1px solid rgba(79,70,229,.2)', background: 'rgba(79,70,229,.06)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 21l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            <span style={{ fontSize: 11, color: 'rgba(99,102,241,.7)', fontWeight: 500, letterSpacing: '.3px' }}>Mutation</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Changement de poste / pays
          </h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Retire la personne de tous ses groupes actuels (comme un offboarding, sans toucher au compte ni à la licence) puis l'ajoute aux groupes de son nouveau poste/pays.
          </p>
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Adresse email M365 *</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="email"
              value={form.email}
              onChange={e => { setForm(f => ({ ...f, email: e.target.value })); if (lookup) { setLookup(null); setLookedUpEmail(''); } }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleLookup(); } }}
              placeholder="jean.dupont@captivea.com"
              autoFocus
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={handleLookup}
              disabled={!form.email.trim() || lookupLoading}
              style={{ padding: '0 18px', borderRadius: 8, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', cursor: lookupLoading ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
            >
              {lookupLoading && <span className="spinner" style={{ width: 13, height: 13 }} />}
              Rechercher
            </button>
          </div>
          {lookupError && <p style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{lookupError}</p>}
        </div>
      </div>

      {lookup && (
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16, alignItems: 'start' }}>

            {/* Colonne grisée — groupes actuels */}
            <div className="card" style={{ background: 'var(--surface2)' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>{lookup.displayName}</h2>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                Groupes actuels — {lookup.groups.length > 0 ? 'tous seront retirés' : 'aucun'}
              </p>
              {lookup.groups.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>Aucun groupe (ou mode développement — Graph simulée).</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {lookup.groups.map(g => (
                    <div key={g.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      padding: '6px 10px', borderRadius: 6,
                      background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)',
                    }}>
                      <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.displayName}>
                        {g.displayName}
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.3px', textTransform: 'uppercase', color: '#ef4444', flexShrink: 0 }}>
                        sera retiré
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Colonne droite — nouveau poste/pays */}
            <div className="card">
              <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: 'var(--text)' }}>Nouveau poste / pays</h2>
              <div className="form-group">
                <label>Nouveau poste *</label>
                <RoleCombobox
                  value={form.jobRole}
                  onChange={v => setForm(f => ({ ...f, jobRole: v, location: GLOBAL_ROLES.has(v) ? '' : f.location }))}
                />
              </div>
              {!isGlobal && (
                <div className="form-group" style={{ marginTop: 12 }}>
                  <label>Nouvelle localisation *</label>
                  <LocationCombobox
                    value={form.location}
                    onChange={v => setForm(f => ({ ...f, location: v, city: '' }))}
                    locations={locations}
                  />
                </div>
              )}
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
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Nouveau groupe sélectionné automatiquement</div>
                  </div>
                </div>
              )}
              {!groupLoading && form.jobRole && ((!isGlobal && form.location) || isGlobal) && !autoGroup && (
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)', padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
                  Aucun groupe trouvé pour ce poste et cette localisation.
                </div>
              )}
            </div>
          </div>

          {autoGroup && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>Confirmation</h2>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                Groupes qui seront ajoutés {newGroupsLoading && '(calcul en cours…)'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  padding: '6px 10px', borderRadius: 6,
                  background: 'rgba(34,197,94,.06)', border: '1px solid rgba(34,197,94,.2)',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={autoGroup.displayName}>
                    {autoGroup.displayName} <span style={{ color: 'var(--muted)', fontSize: 10 }}>(groupe principal)</span>
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.3px', textTransform: 'uppercase', color: '#22c55e', flexShrink: 0 }}>
                    sera ajouté
                  </span>
                </div>
                {newGroupsPreview.map(g => (
                  <div key={g.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '6px 10px', borderRadius: 6,
                    background: 'rgba(34,197,94,.06)', border: '1px solid rgba(34,197,94,.2)',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.label}>
                      {g.label}
                    </span>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.3px', textTransform: 'uppercase', color: '#22c55e', flexShrink: 0 }}>
                      sera ajouté
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" disabled={loading || !autoGroup || (!isGlobal && citiesForLocation.length > 0 && !form.city)}
              style={{ padding: '10px 24px', borderRadius: 8, background: (loading || !autoGroup) ? 'var(--surface2)' : 'var(--primary)', color: (loading || !autoGroup) ? 'var(--muted)' : '#fff', border: 'none', cursor: (loading || !autoGroup) ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              {loading && <span className="spinner" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,.3)', borderTopColor: '#fff' }} />}
              {loading ? 'Mutation en cours…' : 'Effectuer la mutation'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
