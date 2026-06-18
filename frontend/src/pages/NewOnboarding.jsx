import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { JOB_ROLES } from '../jobRoles';

async function copyText(text) {
  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return; } catch (_) {}
  }
  // Fallback : textarea visible dans le viewport (requis par certains navigateurs)
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;border:none;outline:none;box-shadow:none;background:transparent';
  document.body.appendChild(el);
  el.focus();
  el.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  if (!ok) throw new Error('copy failed');
}

const STEP_NAMES = ['Employé', 'Groupe', 'Licence', 'Exécution'];

function StepIndicator({ current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 32 }}>
      {STEP_NAMES.map((name, i) => {
        const n = i + 1;
        const done   = current > n;
        const active = current === n;
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center', flex: i < STEP_NAMES.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: done ? 'var(--success)' : active ? 'var(--primary)' : 'var(--surface2)',
                border: `2px solid ${done ? 'var(--success)' : active ? 'var(--primary)' : 'var(--border)'}`,
                color: (done || active) ? '#fff' : 'var(--muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700,
              }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize: 12, fontWeight: active ? 600 : 400, color: active ? 'var(--text)' : done ? 'var(--success)' : 'var(--muted)' }}>
                {name}
              </span>
            </div>
            {i < STEP_NAMES.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? 'var(--success)' : 'var(--border)', margin: '0 12px', opacity: .5 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

const EXEC_STEP_NAMES = ['Création du compte Azure AD', 'Ajout au groupe principal', 'Assignation de la licence', 'Ajout aux groupes SharePoint & communication'];
const EXEC_ICONS = { pending: '⏸', running: '⏳', done: '✅', failed: '❌' };

function ExecProgress({ onboarding }) {
  const steps = onboarding?.steps || [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, margin: '24px 0' }}>
      {(steps.length ? steps : EXEC_STEP_NAMES.map((name, i) => ({ step_number: i + 1, step_name: name, status: 'pending' }))).map((step, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            border: `2px solid ${
              step.status === 'done'    ? 'var(--success)' :
              step.status === 'failed'  ? 'var(--danger)'  :
              step.status === 'running' ? 'var(--info)'    : 'var(--border)'
            }`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, flexShrink: 0,
          }} className={step.status === 'running' ? 'pulse' : ''}>
            {EXEC_ICONS[step.status] || '⏸'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              fontWeight: step.status === 'running' ? 600 : 400,
              color: step.status === 'done'    ? 'var(--success)' :
                     step.status === 'failed'  ? 'var(--danger)'  :
                     step.status === 'running' ? 'var(--text)'    : 'var(--muted)',
              fontSize: 14,
            }}>
              [{step.step_number}/4] {step.step_name}
            </div>
            {step.error_message && (
              <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{step.error_message}</div>
            )}
          </div>
          {step.status === 'running' && <span className="spinner" style={{ width: 16, height: 16 }} />}
          {step.status === 'done'    && <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: 13 }}>OK</span>}
        </div>
      ))}
    </div>
  );
}

// label = affiché ; groupKey = terme de recherche Azure AD (sans 2024_ ni localisation)
// JOB_ROLES importé depuis jobRoles.js

// Rôles globaux : pas de localisation, groupe sans suffixe pays
const GLOBAL_ROLES = new Set(['CFO', 'Directeur Marketing', 'DRH']);
const DEFAULT_LOCATIONS = [
  { code: 'FR',  name: 'France',       flag: '🇫🇷' },
  { code: 'MDG', name: 'Madagascar',   flag: '🇲🇬' },
  { code: 'US',  name: 'United States',flag: '🇺🇸' },
  { code: 'SG',  name: 'Singapore',    flag: '🇸🇬' },
  { code: 'LUX', name: 'Luxembourg',   flag: '🇱🇺' },
  { code: 'IND', name: 'India',        flag: '🇮🇳' },
  { code: 'CA',  name: 'Canada',       flag: '🇨🇦' },
];
const DEFAULT_DOMAIN = 'captivea.com';

function normalizeForEmail(str) {
  return str.trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-]/g, '');
}

function RoleCombobox({ value, onChange }) {
  const [open, setOpen]       = useState(false);
  const [search, setSearch]   = useState('');
  const wrapRef               = useRef(null);

  useEffect(() => {
    function onDown(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const filtered = JOB_ROLES.filter(({ label }) =>
    label.toLowerCase().includes(search.toLowerCase())
  );

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
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 11, pointerEvents: 'none', cursor: 'default' }}
          onMouseDown={e => { e.preventDefault(); setOpen(o => !o); setSearch(''); }}
        >▾</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          maxHeight: 240,
          overflowY: 'auto',
          zIndex: 60,
          boxShadow: '0 8px 24px rgba(0,0,0,.35)',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--muted)' }}>Aucun résultat</div>
          ) : filtered.map(({ label }) => (
            <div
              key={label}
              onMouseDown={() => select(label)}
              style={{
                padding: '9px 14px',
                cursor: 'pointer',
                fontSize: 13,
                color: value === label ? 'var(--primary)' : 'var(--text)',
                background: value === label ? 'rgba(37,99,235,.12)' : 'transparent',
                fontWeight: value === label ? 600 : 400,
                borderBottom: '1px solid var(--border)',
              }}
              onMouseEnter={e => { if (value !== label) e.currentTarget.style.background = 'var(--surface2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = value === label ? 'rgba(37,99,235,.12)' : 'transparent'; }}
            >
              {label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function handle() {
    copyText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }
  return (
    <button
      onClick={handle}
      title={copied ? 'Copié !' : 'Copier'}
      style={{
        position: 'absolute', top: 8, right: 8,
        background: copied ? 'var(--success)' : 'var(--surface)',
        border: `1px solid ${copied ? 'var(--success)' : 'var(--border)'}`,
        borderRadius: 6,
        padding: '3px 7px',
        cursor: 'pointer',
        fontSize: 14,
        lineHeight: 1,
        transition: 'background .2s, border-color .2s',
      }}
    >
      {copied ? '✓' : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      )}
    </button>
  );
}

function LocationCombobox({ value, onChange, locations = [] }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef             = useRef(null);

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
        <span
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 11, pointerEvents: 'none' }}
          onMouseDown={e => { e.preventDefault(); setOpen(o => !o); setSearch(''); }}
        >▾</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, maxHeight: 200, overflowY: 'auto',
          zIndex: 60, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--muted)' }}>Aucun résultat</div>
          ) : filtered.map(loc => (
            <div
              key={loc.code}
              onMouseDown={() => select(loc)}
              style={{
                padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                color: value === loc.code ? 'var(--primary)' : 'var(--text)',
                background: value === loc.code ? 'rgba(37,99,235,.12)' : 'transparent',
                fontWeight: value === loc.code ? 600 : 400,
                borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
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

const EMPTY_FORM = { firstName: '', lastName: '', email: '', emailDomain: DEFAULT_DOMAIN, jobRole: '', location: '' };

function RecapCollapse({ title, count, color, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 8 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 12px', background: 'var(--surface)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, color: 'var(--muted)', display: 'inline-block', transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{title}</span>
        </div>
        <span style={{ fontSize: 11, background: color + '22', color, borderRadius: 10, padding: '1px 8px', fontWeight: 700 }}>{count}</span>
      </button>
      {open && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function RecapItem({ label, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'var(--text)' }}>{label}</span>
    </div>
  );
}

export default function NewOnboarding() {
  const [step, setStep]       = useState(1);
  const [form, setForm]       = useState(EMPTY_FORM);
  const [domains, setDomains]           = useState([DEFAULT_DOMAIN]);
  const [spGlobalGroups, setSpGlobalGroups]   = useState([]);
  const [spCountryGroups, setSpCountryGroups] = useState([]);
  const [locations, setLocations]                   = useState(DEFAULT_LOCATIONS);
  const [pointageGroups, setPointageGroups]         = useState([]);
  const [deptAssignments, setDeptAssignments]       = useState([]);
  const [pointageCommAssign, setPointageCommAssign] = useState([]);
  const [showAllGlobal, setShowAllGlobal]     = useState(false);

  // Groupe
  const [autoGroup, setAutoGroup]         = useState(null);
  const [showManualSearch, setShowManualSearch] = useState(false);
  const [groups, setGroups]               = useState([]);
  const [groupSearch, setGroupSearch]     = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);

  // Licence
  const [licenses, setLicenses]           = useState([]);
  const [selectedLicense, setSelectedLicense] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [onboardingId, setOnboardingId] = useState(null);
  const [onboarding, setOnboarding]     = useState(null);
  const pollRef        = useRef(null);
  const oneTimePwdRef  = useRef(null); // mot de passe reçu une seule fois, jamais persisté

  // Sécurité : vérification mot de passe avant lancement
  const [revealState, setRevealState]     = useState('locked'); // locked | revealed
  const [launchState, setLaunchState]     = useState('idle');   // idle | confirming
  const [verifyPwd, setVerifyPwd]         = useState('');
  const [verifyError, setVerifyError]     = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);

  async function handleLaunch() {
    setVerifyError('');
    setVerifyLoading(true);
    try {
      await api.post('/api/auth/verify-launch-password', { password: verifyPwd });
      setLaunchState('idle');
      setVerifyPwd('');
      await handleSubmit();
    } catch (e) {
      setVerifyError(e.message || 'Mot de passe incorrect');
    } finally {
      setVerifyLoading(false);
    }
  }

  // Charger les domaines depuis la config admin
  useEffect(() => {
    api.get('/api/admin/settings').then(data => {
      const list = data.onboarding_domains;
      if (Array.isArray(list) && list.length > 0) {
        const active = list.filter(d => d.active && d.domain).map(d => d.domain);
        if (active.length > 0) {
          setDomains(active);
          setForm(f => ({ ...f, emailDomain: active[0] }));
        }
      }
      setSpGlobalGroups((data.sharepoint_global_groups  || []).filter(g => g.id));
      setSpCountryGroups((data.sharepoint_country_groups || []).filter(g => g.id));
      setPointageGroups((data.pointage_assignments || []).filter(g => g.id));
      setDeptAssignments((data.department_assignments || []).filter(g => g.id));
      setPointageCommAssign((data.pointage_comm_assignments || []).filter(g => g.id && g.department && g.location));
      if (Array.isArray(data.locations) && data.locations.length > 0) setLocations(data.locations);
    }).catch(() => {});
  }, []);

  // Auto-fill email local part (prenom.nom) depuis prénom / nom
  useEffect(() => {
    const first = normalizeForEmail(form.firstName).toLowerCase();
    const last  = normalizeForEmail(form.lastName).toLowerCase();
    if (!first && !last) return;
    setForm(f => ({ ...f, email: [first, last].filter(Boolean).join('.') }));
  }, [form.firstName, form.lastName]);

  // ── Step 2: auto-match groupe ──────────────────────────────────────────────
  useEffect(() => {
    if (step !== 2) return;
    setAutoGroup(null);
    setShowManualSearch(false);
    setGroupSearch('');

    // Traduire le label affiché en clé de groupe Azure AD
    const groupKey = JOB_ROLES.find(r => r.label === form.jobRole.trim())?.groupKey || form.jobRole.trim();
    const isGlobal = GLOBAL_ROLES.has(form.jobRole.trim());
    // Convention : "SP - {Role} {Location}" ou "SP - {Role}" pour les globaux
    const query = isGlobal
      ? `SP - ${groupKey}`
      : `SP - ${groupKey} ${form.location.trim()}`;
    if (!query) {
      setShowManualSearch(true);
      loadLocationGroups();
      return;
    }

    setLoading(true);
    api.get(`/api/graph/groups?search=${encodeURIComponent(query)}`)
      .then(data => {
        if (data.length > 0) {
          const exact = data.find(g =>
            g.displayName.replace(/^2024_/, '').toLowerCase() === query.toLowerCase()
          ) || data[0];
          setAutoGroup(exact);
          setSelectedGroup(exact);
        } else {
          setShowManualSearch(true);
          loadLocationGroups();
        }
      })
      .catch(e => { setError(e.message); setShowManualSearch(true); loadLocationGroups(); })
      .finally(() => setLoading(false));
  }, [step]);

  // Charge les groupes Pointage de la filiale sélectionnée
  function loadLocationGroups() {
    const loc = form.location.trim();
    const locGroups = pointageGroups
      .filter(g => g.location === loc)
      .map(g => ({ id: g.id, displayName: g.label }));
    setGroups(locGroups);
  }

  function switchToManual() {
    setShowManualSearch(true);
    loadLocationGroups();
  }

  // Recherche locale uniquement dans les groupes Pointage de la filiale sélectionnée
  const searchTimer = useRef(null);
  function handleGroupSearch(value) {
    setGroupSearch(value);
    clearTimeout(searchTimer.current);
    const loc = form.location.trim();
    const locGroups = pointageGroups
      .filter(g => g.location === loc)
      .map(g => ({ id: g.id, displayName: g.label }));
    if (!value.trim()) { setGroups(locGroups); return; }
    setGroups(locGroups.filter(g => g.displayName.toLowerCase().includes(value.toLowerCase())));
  }

  // ── Step 3: licences ──────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 3) return;
    setLoading(true);
    api.get('/api/graph/licenses')
      .then(data => { setLicenses(data); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [step]);

  // ── Step 4: poll ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 4 || !onboardingId) return;
    pollRef.current = setInterval(() => {
      api.get(`/api/onboardings/${onboardingId}`).then(data => {
        if (data.temp_password) oneTimePwdRef.current = data.temp_password;
        setOnboarding(data);
        if (data.status === 'done' || data.status === 'failed') {
          clearInterval(pollRef.current);
          setStep(5);
        }
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(pollRef.current);
  }, [step, onboardingId]);

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      const { id } = await api.post('/api/onboardings', {
        firstName:   form.firstName.trim(),
        lastName:    form.lastName.trim(),
        email:       `${form.email.trim()}@${form.emailDomain}`,
        jobRole:     form.jobRole.trim() || undefined,
        location:    form.location.trim() || undefined,
        groupId:     selectedGroup.id,
        groupName:   selectedGroup.displayName,
        skuId:       selectedLicense.skuId,
        licenseName: selectedLicense.displayName,
      });
      setOnboardingId(id);
      setOnboarding({
        status: 'pending',
        steps: [1, 2, 3, 4].map(n => ({ step_number: n, step_name: EXEC_STEP_NAMES[n - 1], status: 'pending' })),
      });
      setStep(4);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function resetAll() {
    setStep(1); setForm(EMPTY_FORM);
    setSelectedGroup(null); setSelectedLicense(null);
    setAutoGroup(null); setShowManualSearch(false);
    setGroups([]); setLicenses([]);
    setOnboarding(null); setOnboardingId(null);
    setError('');
    setRevealState('locked'); setLaunchState('idle'); setVerifyPwd(''); setVerifyError('');
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div className="page-header">
        <h1 className="page-title">Nouvel onboarding</h1>
      </div>

      <StepIndicator current={step} />
      {error && <div className="error-box">{error}</div>}

      {/* ── Step 1: Infos employé ── */}
      {step === 1 && (
        <div className="card">
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20, color: 'var(--text)' }}>Informations de l'employé</h2>

          <div className="form-row">
            <div className="form-group">
              <label>Prénom *</label>
              <input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} placeholder="Jean" autoFocus />
            </div>
            <div className="form-group">
              <label>Nom *</label>
              <input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} placeholder="Dupont" />
            </div>
          </div>

          {(() => {
            const isGlobal = GLOBAL_ROLES.has(form.jobRole);
            return (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label>Rôle / Poste métier *</label>
                    <RoleCombobox
                      value={form.jobRole}
                      onChange={v => setForm(f => ({
                        ...f,
                        jobRole: v,
                        location: GLOBAL_ROLES.has(v) ? '' : f.location,
                      }))}
                    />
                  </div>

                  {!isGlobal && (
                    <div className="form-group">
                      <label>Localisation *</label>
                      <LocationCombobox
                        value={form.location}
                        onChange={v => setForm(f => ({ ...f, location: v }))}
                        locations={locations}
                      />
                    </div>
                  )}

                  {isGlobal && (
                    <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <div style={{
                        width: '100%', height: 38, borderRadius: 8,
                        background: 'var(--surface2)', border: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', paddingLeft: 12,
                        fontSize: 12, color: 'var(--muted)', gap: 6,
                      }}>
                        <span>🌍</span> Rôle global — sans localisation
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>💡</span>
                  {isGlobal ? (
                    <div>
                      Rôle global : <strong style={{ color: 'var(--text2)' }}>{form.jobRole}</strong>
                      {' '}→ <code style={{ background: 'var(--border)', padding: '1px 6px', borderRadius: 4, fontSize: 11, color: 'var(--info)' }}>SP - {form.jobRole}</code>
                    </div>
                  ) : (
                    <div>
                      Groupe auto-sélectionné :
                      {' '}<strong style={{ color: 'var(--text2)' }}>{form.jobRole || 'IT Person'}</strong>
                      {' '}+ <strong style={{ color: 'var(--text2)' }}>{form.location || 'FR'}</strong>
                      {' '}→ <code style={{ background: 'var(--border)', padding: '1px 6px', borderRadius: 4, fontSize: 11, color: 'var(--info)' }}>SP - {form.jobRole || 'IT Person'} {form.location || 'FR'}</code>
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          <div className="form-group">
            <label>Email M365 *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', height: 38 }}>
              <input
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="Prenom.Nom"
                style={{ borderRadius: '8px 0 0 8px', borderRight: 'none', width: '100%', boxSizing: 'border-box' }}
              />
              <div style={{
                padding: '0 10px',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderLeft: 'none', borderRight: 'none',
                display: 'flex', alignItems: 'center',
                fontSize: 13, color: 'var(--muted)',
              }}>@</div>
              {domains.length > 1 ? (
                <select
                  value={form.emailDomain}
                  onChange={e => setForm(f => ({ ...f, emailDomain: e.target.value }))}
                  style={{ borderRadius: '0 8px 8px 0', height: 38, borderLeft: 'none' }}
                >
                  {domains.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : (
                <div style={{
                  borderRadius: '0 8px 8px 0', height: 38, borderLeft: 'none',
                  border: '1px solid var(--border)', background: 'var(--surface2)',
                  padding: '0 12px', display: 'flex', alignItems: 'center',
                  fontSize: 13, color: 'var(--text2)', whiteSpace: 'nowrap',
                }}>
                  {domains[0] || DEFAULT_DOMAIN}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              className="btn btn-primary"
              disabled={
                !form.firstName.trim() ||
                !form.lastName.trim() ||
                !form.jobRole ||
                (!GLOBAL_ROLES.has(form.jobRole) && !form.location) ||
                !form.email.trim()
              }
              onClick={() => { setError(''); setStep(2); }}
            >
              Suivant →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Groupe (auto-match) ── */}
      {step === 2 && (
        <div className="card">
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>Groupe de sécurité</h2>

          {loading && !autoGroup && !showManualSearch && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" /></div>
          )}

          {/* Auto-match card */}
          {autoGroup && !showManualSearch && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                Groupe correspondant à <strong style={{ color: 'var(--text2)' }}>{[form.jobRole, form.location].filter(Boolean).join(' ')}</strong> :
              </div>
              <div style={{
                border: `2px solid var(--primary)`,
                borderRadius: 10,
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                background: 'rgba(37,99,235,.08)',
                marginBottom: 14,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, flexShrink: 0,
                }}>✓</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{autoGroup.displayName}</div>
                  {autoGroup.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{autoGroup.description}</div>}
                </div>
                <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600, background: 'rgba(37,99,235,.15)', padding: '2px 8px', borderRadius: 4 }}>
                  Auto-sélectionné
                </span>
              </div>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={switchToManual}>
                Changer de groupe...
              </button>
            </div>
          )}

          {/* Message si aucun match + recherche manuelle */}
          {showManualSearch && !autoGroup && form.jobRole && form.location && (
            <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(245,158,11,.1)', borderRadius: 8, fontSize: 13, color: '#b45309', display: 'flex', gap: 8 }}>
              <span>⚠</span>
              <span>Aucun groupe <strong>SP - {form.jobRole}{form.location ? ` ${form.location}` : ''}</strong> trouvé. Sélectionnez manuellement :</span>
            </div>
          )}

          {/* Liste manuelle */}
          {showManualSearch && (
            <>
              <div className="form-group">
                <input
                  placeholder="Rechercher un groupe..."
                  value={groupSearch}
                  onChange={e => handleGroupSearch(e.target.value)}
                  autoFocus={!autoGroup}
                />
              </div>

              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><span className="spinner" /></div>
              ) : groups.length === 0 ? (
                <div className="empty-state"><div>Aucun groupe trouvé</div></div>
              ) : (
                <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                  {groups.map(g => (
                    <div
                      key={g.id}
                      onClick={() => setSelectedGroup(g)}
                      style={{
                        padding: '10px 14px', cursor: 'pointer',
                        borderBottom: '1px solid var(--border)',
                        background: selectedGroup?.id === g.id ? 'rgba(37,99,235,.12)' : 'transparent',
                        display: 'flex', alignItems: 'center', gap: 10,
                        transition: 'background .1s',
                      }}
                    >
                      <div style={{
                        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                        background: selectedGroup?.id === g.id ? 'var(--primary)' : 'var(--border)',
                        border: `2px solid ${selectedGroup?.id === g.id ? 'var(--primary)' : 'var(--border)'}`,
                      }} />
                      <div>
                        <div style={{ fontWeight: selectedGroup?.id === g.id ? 600 : 400, color: 'var(--text)', fontSize: 13 }}>
                          {g.displayName}
                        </div>
                        {g.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{g.description}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Groupes globaux SharePoint — collapsés */}
          {spGlobalGroups.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Groupes globaux <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>({spGlobalGroups.length})</span></h2>
                <button type="button" onClick={() => setShowAllGlobal(v => !v)} style={{ fontSize: 11, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>
                  {showAllGlobal ? 'Réduire' : 'Afficher tout'}
                </button>
              </div>
              {showAllGlobal ? (
                spGlobalGroups.map(g => (
                  <div key={g.id} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, flexShrink: 0 }}>✓</div>
                    <div style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{g.label}</div>
                  </div>
                ))
              ) : (
                <div style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 12, color: 'var(--muted)' }}>
                  {spGlobalGroups.slice(0, 2).map(g => g.label).join(', ')}{spGlobalGroups.length > 2 ? ` +${spGlobalGroups.length - 2} autres` : ''}
                </div>
              )}
            </div>
          )}

          {/* Groupe par pays SharePoint */}
          {form.location && (() => {
            const countryGroup = spCountryGroups.find(g => g.location === form.location);
            return (
              <div style={{ marginTop: 20 }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>Groupe par pays</h2>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                  Groupe correspondant à la localisation <strong style={{ color: 'var(--text2)' }}>{form.location}</strong>
                </p>
                {countryGroup ? (
                  <div style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, flexShrink: 0 }}>✓</div>
                    <div style={{ flex: 1, fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{countryGroup.label}</div>
                    <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600, background: 'rgba(37,99,235,.15)', padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>Auto-sélectionné</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', padding: '8px 0' }}>
                    Aucun groupe configuré pour la localisation {form.location} — configurer dans Admin → SharePoint
                  </div>
                )}
              </div>
            );
          })()}

          {/* Groupes de communication — lookup Pointage (auto + manuel) */}
          {form.jobRole && form.location && (() => {
            const seen = new Set();
            const commList = [];
            // Auto-assignés via department_assignments
            deptAssignments.forEach(g => {
              const depts = g.departments || [];
              if ((depts.length === 0 || depts.includes(form.jobRole)) &&
                  (g.location === 'ALL' || (g.countries || []).includes(form.location))) {
                if (!seen.has(g.id)) { seen.add(g.id); commList.push({ id: g.id, label: g.name || g.id }); }
              }
            });
            // Manuellement assignés via pointage_comm_assignments
            pointageCommAssign.forEach(g => {
              if (g.department === form.jobRole && g.location === form.location) {
                if (!seen.has(g.id)) { seen.add(g.id); commList.push({ id: g.id, label: g.label || g.id }); }
              }
            });
            return (
              <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Groupes de communication</h2>
                  <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface2)', padding: '2px 8px', borderRadius: 10 }}>{form.jobRole} · {form.location}</span>
                </div>
                {commList.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', padding: '8px 0' }}>
                    Aucun groupe de communication configuré pour ce département / filiale.
                  </div>
                ) : commList.map(g => (
                  <div key={g.id} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(124,58,237,.3)', background: 'rgba(124,58,237,.06)', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, flexShrink: 0 }}>✓</div>
                    <div style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{g.label}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={() => { setError(''); setStep(1); }}>← Retour</button>
            <button className="btn btn-primary" disabled={!selectedGroup} onClick={() => { setError(''); setStep(3); }}>
              Suivant →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Licence + Récapitulatif ── */}
      {step === 3 && (
        <div className="card">
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>Sélectionner une licence</h2>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><span className="spinner" /></div>
          ) : licenses.length === 0 ? (
            <div className="empty-state"><div>Aucune licence disponible</div></div>
          ) : (
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 20 }}>
              {licenses.map(lic => (
                <div
                  key={lic.skuId}
                  onClick={() => setSelectedLicense(lic)}
                  style={{
                    padding: '10px 14px', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    background: selectedLicense?.skuId === lic.skuId ? 'rgba(37,99,235,.12)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    transition: 'background .1s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      background: selectedLicense?.skuId === lic.skuId ? 'var(--primary)' : 'var(--border)',
                      border: `2px solid ${selectedLicense?.skuId === lic.skuId ? 'var(--primary)' : 'var(--border)'}`,
                    }} />
                    <div>
                      <div style={{ fontWeight: selectedLicense?.skuId === lic.skuId ? 600 : 400, color: 'var(--text)', fontSize: 13 }}>
                        {lic.displayName}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{lic.skuPartNumber}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>{lic.available} dispo</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{lic.consumed}/{lic.total}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedLicense && (() => {
            const locObj     = locations.find(l => l.code === form.location);
            const globalSP   = spGlobalGroups;
            const countrySP  = spCountryGroups.filter(g => g.location === form.location);
            const seen = new Set(); const commGroups = [];
            deptAssignments.forEach(g => {
              const depts = g.departments || [];
              if ((depts.length === 0 || depts.includes(form.jobRole)) && (g.location==='ALL'||(g.countries||[]).includes(form.location)))
                if (!seen.has(g.id)) { seen.add(g.id); commGroups.push(g.name||g.id); }
            });
            pointageCommAssign.forEach(g => {
              if (g.department===form.jobRole && g.location===form.location)
                if (!seen.has(g.id)) { seen.add(g.id); commGroups.push(g.label||g.id); }
            });
            const allSP = [...globalSP.map(g => g.label), ...countrySP.map(g => g.label)];
            return (
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>

                {/* En-tête employé */}
                <div style={{ background: 'var(--surface2)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                    {form.firstName?.[0]?.toUpperCase()}{form.lastName?.[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{form.firstName} {form.lastName}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{form.email}@{form.emailDomain}</div>
                  </div>
                  {locObj && <span style={{ fontSize: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', color: 'var(--text2)', whiteSpace: 'nowrap', flexShrink: 0 }}>{locObj.flag} {locObj.code}</span>}
                </div>

                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>

                  {/* Rôle */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Rôle</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{form.jobRole}</span>
                  </div>

                  {/* Groupe principal */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>Groupe SP</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', textAlign: 'right', background: 'rgba(37,99,235,.1)', border: '1px solid rgba(37,99,235,.2)', borderRadius: 6, padding: '2px 8px' }}>{selectedGroup?.displayName}</span>
                  </div>

                  {/* Licence */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Licence</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{selectedLicense.displayName}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', background: 'rgba(34,197,94,.12)', borderRadius: 6, padding: '1px 7px' }}>{selectedLicense.available} dispo</span>
                    </div>
                  </div>

                  {/* Séparateur */}
                  {(allSP.length > 0 || commGroups.length > 0) && <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />}

                  {/* Groupes SP collapsés */}
                  {allSP.length > 0 && (
                    <RecapCollapse title="Groupes SharePoint" count={allSP.length} color="#2563eb">
                      {allSP.map((l, i) => <RecapItem key={i} label={l} color="#2563eb" />)}
                    </RecapCollapse>
                  )}

                  {/* Comm collapsés */}
                  {commGroups.length > 0 && (
                    <RecapCollapse title="Groupes de communication" count={commGroups.length} color="#7c3aed">
                      {commGroups.map((l, i) => <RecapItem key={i} label={l} color="#7c3aed" />)}
                    </RecapCollapse>
                  )}

                </div>
              </div>
            );
          })()}

          {launchState === 'confirming' ? (
            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '14px 16px', marginTop: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                🔐 Confirmez votre mot de passe pour lancer l'onboarding
              </div>
              {verifyError && (
                <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, fontSize: 13, color: 'var(--danger)' }}>
                  {verifyError}
                </div>
              )}
              <input
                type="password"
                value={verifyPwd}
                onChange={e => setVerifyPwd(e.target.value)}
                placeholder="Votre mot de passe"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && !verifyLoading && verifyPwd && handleLaunch()}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'space-between' }}>
                <button className="btn btn-ghost" onClick={() => { setLaunchState('idle'); setVerifyPwd(''); setVerifyError(''); }}>
                  ← Retour
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!verifyPwd || verifyLoading}
                  onClick={handleLaunch}
                  style={{ minWidth: 160, justifyContent: 'center' }}
                >
                  {verifyLoading
                    ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Vérification...</>
                    : '🚀 Lancer l\'onboarding'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn btn-ghost" onClick={() => { setError(''); setStep(2); }}>← Retour</button>
              <button
                className="btn btn-primary"
                disabled={!selectedLicense || loading}
                onClick={() => { setError(''); setLaunchState('confirming'); }}
                style={{ minWidth: 160, justifyContent: 'center' }}
              >
                🚀 Lancer l'onboarding
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Step 4: En cours ── */}
      {step === 4 && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span className="spinner" style={{ width: 20, height: 20 }} />
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Onboarding en cours...</h2>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
            {form.firstName} {form.lastName}
            {form.jobRole && form.location && <> · {form.jobRole} {form.location}</>}
            {' '}· {selectedGroup?.displayName} · {selectedLicense?.displayName}
          </div>
          <ExecProgress onboarding={onboarding} />
        </div>
      )}

      {/* ── Step 5: Résultat ── */}
      {step === 5 && onboarding && (
        <div className="card">
          {onboarding.status === 'done' ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--success)', marginBottom: 8 }}>Onboarding terminé !</h2>
              <p style={{ color: 'var(--text2)', fontSize: 14, marginBottom: 4 }}>
                <strong>{form.firstName} {form.lastName}</strong> est maintenant dans Microsoft 365.
              </p>

              {(oneTimePwdRef.current || onboarding.employee_email) && (
                <div style={{ margin: '16px auto 20px', maxWidth: 420, borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>

                  {/* État : verrouillé */}
                  {revealState === 'locked' && (
                    <div style={{ padding: '22px 18px', textAlign: 'center', background: 'var(--surface2)' }}>
                      <div style={{ fontSize: 30, marginBottom: 8 }}>🔒</div>
                      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
                        Identifiants M365 disponibles
                      </div>
                      <button className="btn btn-primary" onClick={() => setRevealState('revealed')}>
                        Révéler les identifiants
                      </button>
                    </div>
                  )}

                  {/* État : révélé */}
                  {revealState === 'revealed' && (() => {
                    const displayName = `${form.firstName} ${form.lastName}`;
                    const credText = `Display Name : ${displayName}\nEmail : ${onboarding.employee_email || ''}\nPassword : ${oneTimePwdRef.current || ''}`;
                    return (
                      <div style={{ position: 'relative' }}>
                        <pre style={{
                          margin: 0,
                          padding: '14px 44px 14px 16px',
                          background: 'var(--surface2)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          fontSize: 13,
                          color: 'var(--text)',
                          fontFamily: 'monospace',
                          lineHeight: 1.9,
                          whiteSpace: 'pre',
                          textAlign: 'left',
                        }}>{credText}</pre>
                        <CopyButton text={credText} />
                      </div>
                    );
                  })()}

                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--danger)', marginBottom: 8 }}>Onboarding échoué</h2>
                {onboarding.rolled_back && (
                  <p style={{ color: 'var(--warning)', fontSize: 13, marginBottom: 4 }}>↩ Rollback effectué — le compte Azure AD a été supprimé.</p>
                )}
                <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>{onboarding.error_message}</p>
              </div>
              <ExecProgress onboarding={onboarding} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 8 }}>
            {onboardingId && (
              <Link to={`/history/${onboardingId}`}>
                <button className="btn btn-ghost">Voir les détails</button>
              </Link>
            )}
            <button className="btn btn-primary" onClick={resetAll}>
              🚀 Nouvel onboarding
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
