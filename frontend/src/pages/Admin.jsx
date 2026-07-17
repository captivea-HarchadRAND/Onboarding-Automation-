import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useUser } from '../context/UserContext';
import { JOB_ROLES } from '../jobRoles';

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h2>
          <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Tab: Utilisateurs ────────────────────────────────────────────────────────

function TabUsers({ me }) {
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(null);
  const [form, setForm]         = useState({ name: '', email: '', role: 'operator', password: '' });
  const [pwdForm, setPwdForm]   = useState({ password: '' });
  const [error, setError]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [inviteLink, setInviteLink] = useState('');

  function load() {
    api.get('/api/admin/users').then(data => { setUsers(data); setLoading(false); }).catch(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  function openCreate() { setForm({ name: '', email: '', role: 'operator', password: '' }); setInviteLink(''); setError(''); setModal('create'); }
  function openEdit(u)  { setForm({ name: u.name, email: u.email, role: u.role, status: u.status }); setError(''); setModal({ type: 'edit', user: u }); }
  function openPwd(u)   { setPwdForm({ password: '' }); setError(''); setModal({ type: 'pwd', user: u }); }

  async function handleCreate(e) {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      const data = await api.post('/api/admin/users', { name: form.name, email: form.email, role: form.role, password: form.password || undefined });
      if (data.invite_token) { setInviteLink(`${window.location.origin}/invite/${data.invite_token}`); }
      else setModal(null);
      load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function handleEdit(e) {
    e.preventDefault(); setError(''); setSaving(true);
    try { await api.put(`/api/admin/users/${modal.user.id}`, { name: form.name, email: form.email, role: form.role, status: form.status }); setModal(null); load(); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function handlePwd(e) {
    e.preventDefault(); setError(''); setSaving(true);
    try { await api.put(`/api/admin/users/${modal.user.id}/reset-password`, { password: pwdForm.password }); setModal(null); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function toggleStatus(u) {
    const status = u.status === 'disabled' ? 'active' : 'disabled';
    try { await api.put(`/api/admin/users/${u.id}`, { status }); load(); }
    catch (err) { alert(err.message); }
  }

  async function handleDelete(u) {
    if (!confirm(`Supprimer définitivement ${u.name} ?`)) return;
    try { await api.delete(`/api/admin/users/${u.id}`); load(); }
    catch (err) { alert(err.message); }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={openCreate}>+ Ajouter un utilisateur</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          Utilisateurs de la plateforme
        </div>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" /></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th>Créé le</th><th></th></tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 500, color: 'var(--text)' }}>
                      {u.name}
                      {u.id === me?.id && <span style={{ fontSize: 11, color: 'var(--primary)', marginLeft: 6 }}>(moi)</span>}
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--muted)' }}>{u.email}</td>
                    <td>
                      <span style={{ fontSize: 12, fontWeight: 600, color: u.role === 'admin' ? 'var(--warning)' : 'var(--muted)', textTransform: 'capitalize' }}>
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${u.status === 'active' ? 'badge-done' : u.status === 'pending' ? 'badge-pending' : 'badge-failed'}`}>
                        {u.status === 'active' ? 'Actif' : u.status === 'pending' ? 'En attente' : 'Désactivé'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => openEdit(u)}>Modifier</button>
                        <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => openPwd(u)}>Mot de passe</button>
                        {u.id !== me?.id && (
                          <button className={`btn ${u.status === 'disabled' ? 'btn-ghost' : 'btn-danger'}`} style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => toggleStatus(u)}>
                            {u.status === 'disabled' ? 'Réactiver' : 'Désactiver'}
                          </button>
                        )}
                        {u.status === 'disabled' && u.id !== me?.id && (
                          <button className="btn btn-danger" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => handleDelete(u)}>Supprimer</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Create */}
      {modal === 'create' && (
        <Modal title="Ajouter un utilisateur" onClose={() => setModal(null)}>
          {inviteLink ? (
            <div>
              <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--success)' }}>Utilisateur créé. Partagez ce lien d'invitation :</div>
              <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'var(--info)', wordBreak: 'break-all', marginBottom: 16 }}>{inviteLink}</div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => navigator.clipboard?.writeText(inviteLink)}>Copier le lien</button>
              <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => setModal(null)}>Fermer</button>
            </div>
          ) : (
            <form onSubmit={handleCreate}>
              {error && <div className="error-box">{error}</div>}
              <div className="form-group"><label>Nom *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div className="form-group"><label>Email *</label><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required /></div>
              <div className="form-group">
                <label>Rôle</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="operator">Opérateur</option>
                  <option value="admin">Administrateur</option>
                </select>
              </div>
              <div className="form-group">
                <label>Mot de passe <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(vide = lien d'invitation)</span></label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Laisser vide pour envoyer une invitation" />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Création...' : 'Créer'}</button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* Modal: Edit */}
      {modal?.type === 'edit' && (
        <Modal title="Modifier l'utilisateur" onClose={() => setModal(null)}>
          <form onSubmit={handleEdit}>
            {error && <div className="error-box">{error}</div>}
            <div className="form-group"><label>Nom</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="form-group">
              <label>Rôle</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="operator">Opérateur</option>
                <option value="admin">Administrateur</option>
              </select>
            </div>
            <div className="form-group">
              <label>Statut</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="active">Actif</option>
                <option value="pending">En attente</option>
                <option value="disabled">Désactivé</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Password */}
      {modal?.type === 'pwd' && (
        <Modal title={`Réinitialiser — ${modal.user.name}`} onClose={() => setModal(null)}>
          <form onSubmit={handlePwd}>
            {error && <div className="error-box">{error}</div>}
            <div className="form-group"><label>Nouveau mot de passe</label><input type="password" value={pwdForm.password} onChange={e => setPwdForm({ password: e.target.value })} placeholder="12 caractères min." required /></div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement...' : 'Réinitialiser'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ─── Tab: API ─────────────────────────────────────────────────────────────────

function TabAPI() {
  const [settings, setSettings] = useState(null);
  const [form, setForm]         = useState({});
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    api.get('/api/admin/settings').then(data => {
      setSettings(data);
      setForm({
        azure_client_id:  data.azure_client_id  || '',
        default_domain:   data.default_domain   || '',
      });
    }).catch(e => setError(e.message));
  }, []);

  async function handleSave(e) {
    e.preventDefault(); setError(''); setSaving(true); setSaved(false);
    try {
      const payload = { ...form };
      await api.put('/api/admin/settings', payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      const data = await api.get('/api/admin/settings');
      setSettings(data);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  function field(key) {
    return { value: form[key] ?? '', onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) };
  }

  if (!settings) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><span className="spinner" /></div>;

  return (
    <form onSubmit={handleSave}>
      {error  && <div className="error-box">{error}</div>}
      {saved  && <div style={{ background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--success)' }}>Paramètres enregistrés.</div>}

      {/* Azure AD */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>Azure AD / Microsoft Graph</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Credentials de l'App Registration. Ces permissions doivent être accordées en type <strong style={{ color: 'var(--text2)' }}>Application</strong> (pas Delegated).
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {[
            { code: 'User.ReadWrite.All' },
            { code: 'Group.ReadWrite.All' },
            { code: 'Directory.Read.All' },
          ].map(({ code }) => (
            <code key={code} style={{ background: 'var(--surface2)', padding: '3px 8px', borderRadius: 4, fontSize: 11, color: 'var(--info)' }}>{code}</code>
          ))}
        </div>

        <div className="form-group">
          <label>Client ID</label>
          <input placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" {...field('azure_client_id')} />
        </div>
        <div className="form-group">
          <label>Client Secret</label>
          <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 6,
            background: settings.azure_client_secret_set ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.10)',
            color: settings.azure_client_secret_set ? 'var(--success)' : '#ef4444',
            border: `1px solid ${settings.azure_client_secret_set ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}` }}>
            {settings.azure_client_secret_set ? '● Configuré' : '○ Non configuré'}
          </span>
        </div>
      </div>

      {/* Paramètres org */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>Paramètres de l'organisation</h2>

        <div className="form-group">
          <label>Domaine par défaut</label>
          <input placeholder="monentreprise.com" {...field('default_domain')} />
          <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
            Utilisé pour générer l'email si non saisi (prenom.nom@domaine)
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="btn btn-primary" disabled={saving} style={{ minWidth: 160, justifyContent: 'center' }}>
          {saving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
        </button>
      </div>
    </form>
  );
}

// ─── Tab: Organisation (SharePoint) ──────────────────────────────────────────

const LOCATION_OPTIONS = ['FR', 'MDG', 'US', 'SG', 'LUX', 'IND', 'CA'];

function RoleSearchDropdown({ existing, onSelect, onCancel, pool: poolProp }) {
  const [query, setQuery] = useState('');
  const pool = poolProp && poolProp.length > 0 ? poolProp : JOB_ROLES;
  const filtered = pool.filter(r =>
    !existing.includes(r.label) &&
    r.label.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <div style={{ position: 'relative' }}>
      <input
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        placeholder="Rechercher un rôle..."
        style={{ padding: '4px 12px', borderRadius: 20, border: '2px solid var(--primary)', fontSize: 13, background: 'var(--surface2)', color: 'var(--text)', width: 220, outline: 'none' }}
      />
      {filtered.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, maxHeight: 220, overflowY: 'auto', minWidth: 240, boxShadow: '0 6px 20px rgba(0,0,0,.4)' }}>
          {filtered.map(r => (
            <div key={r.label}
              onMouseDown={e => { e.preventDefault(); onSelect(r.label); }}
              style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)', color: 'var(--text)', transition: 'background .1s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(37,99,235,.12)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {r.label}
            </div>
          ))}
        </div>
      )}
      {filtered.length === 0 && query && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', minWidth: 200 }}>
          Aucun rôle correspondant
        </div>
      )}
    </div>
  );
}

function DeptPillsEditor({ depts, onChange, allowedRoles }) {
  const [adding, setAdding] = useState(false);
  const pool = allowedRoles && allowedRoles.length > 0
    ? allowedRoles.map(r => ({ label: r }))
    : JOB_ROLES;
  const hasMore = pool.some(r => !depts.includes(r.label));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 34, padding: '2px 0' }}>
      {depts.map(d => (
        <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px 2px 10px', borderRadius: 12, background: 'rgba(124,58,237,.15)', border: '1px solid rgba(124,58,237,.3)', fontSize: 12, color: '#a78bfa', whiteSpace: 'nowrap' }}>
          {d}
          <button type="button" onClick={() => onChange(depts.filter(x => x !== d))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a78bfa', padding: '0 0 0 2px', lineHeight: 1, fontSize: 14 }}>×</button>
        </span>
      ))}
      {adding ? (
        <RoleSearchDropdown
          existing={depts}
          pool={pool}
          onSelect={role => { onChange([...depts, role]); setAdding(false); }}
          onCancel={() => setAdding(false)}
        />
      ) : hasMore ? (
        <button type="button" onClick={() => setAdding(true)}
          style={{ padding: '2px 8px', borderRadius: 12, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 11 }}>
          + Rôle
        </button>
      ) : null}
    </div>
  );
}

function CommGroupRows({ groups, setGroups, locations, allowedRoles }) {
  function add()           { setGroups(g => [...g, { name: '', location: 'ALL', countries: [], departments: [], id: '' }]); }
  function remove(i)       { setGroups(g => g.filter((_, idx) => idx !== i)); }
  function update(i, k, v) { setGroups(g => g.map((item, idx) => idx === i ? { ...item, [k]: v } : item)); }

  return (
    <div>
      {groups.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', padding: '8px 0' }}>Aucun groupe configuré.</div>
      )}
      {groups.map((g, i) => {
        const isGbl = g.location === 'ALL';
        const countries = g.countries || [];
        const available = locations.filter(l => !countries.includes(l.code));
        const paysInvalid = !isGbl && (g.departments || []).length > 0 && countries.length === 0;
        return (
          <div key={i} style={{ marginBottom: 10, padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
            {/* Ligne 1 : Nom + toggle + supprimer */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <input placeholder="Nom *" value={g.name || ''} onChange={e => update(i, 'name', e.target.value)}
                style={{ flex: 1, ...(!(g.name || '').trim() ? { borderColor: 'rgba(239,68,68,.6)' } : {}) }} />
              <div onClick={() => update(i, 'location', isGbl ? 'DEFAULT' : 'ALL')}
                style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none',
                         padding: '6px 11px', borderRadius: 7, border: `1px solid ${isGbl ? 'rgba(5,150,105,.35)' : 'var(--border)'}`,
                         background: isGbl ? 'rgba(5,150,105,.07)' : 'transparent', flexShrink: 0, transition: 'all .15s' }}>
                <div style={{ width: 30, height: 17, borderRadius: 9, background: isGbl ? '#059669' : '#4b5563', position: 'relative', transition: 'background .2s' }}>
                  <div style={{ width: 13, height: 13, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: isGbl ? 15 : 2, transition: 'left .2s', boxShadow: '0 1px 2px rgba(0,0,0,.4)' }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: isGbl ? '#34d399' : 'var(--muted)' }}>{isGbl ? '🌐 Global' : 'Défaut'}</span>
              </div>
              <button type="button" onClick={() => remove(i)}
                style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, width: 30, height: 34, cursor: 'pointer', color: 'var(--muted)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
            </div>
            {/* Ligne 2 : Pays + Rôles + ID */}
            <div style={{ display: 'grid', gridTemplateColumns: !isGbl ? '1fr 1.5fr 1.5fr' : '1fr 1.5fr', gap: 8, alignItems: 'start' }}>
              {!isGbl && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 34, padding: '3px 7px', borderRadius: 6, border: paysInvalid ? '1px solid rgba(239,68,68,.5)' : '1px solid var(--border)', background: 'var(--surface)' }}>
                  {countries.map(code => {
                    const loc = locations.find(l => l.code === code);
                    return (
                      <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px 2px 9px', borderRadius: 12, background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.3)', fontSize: 11, color: '#818cf8', whiteSpace: 'nowrap' }}>
                        {loc?.flag} {code}
                        <button type="button" onClick={() => update(i, 'countries', countries.filter(c => c !== code))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#818cf8', padding: '0 0 0 2px', lineHeight: 1, fontSize: 13 }}>×</button>
                      </span>
                    );
                  })}
                  {available.length > 0 && (
                    <select defaultValue="" onChange={e => { if (e.target.value) { update(i, 'countries', [...countries, e.target.value]); e.target.value = ''; }}}
                      style={{ fontSize: 11, padding: '2px 4px', borderRadius: 6, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
                      <option value="">+ Pays</option>
                      {available.map(l => <option key={l.code} value={l.code}>{l.flag} {l.code}</option>)}
                    </select>
                  )}
                </div>
              )}
              <DeptPillsEditor depts={g.departments || []} onChange={depts => update(i, 'departments', depts)} allowedRoles={allowedRoles} />
              <input type="text" autoComplete="off" placeholder="Group Object ID" value={g.id}
                onChange={e => update(i, 'id', e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: 12, WebkitTextSecurity: g.id ? 'disc' : 'none', ...(g.id.trim() === '' ? { borderColor: 'rgba(239,68,68,.6)' } : {}) }} />
            </div>
          </div>
        );
      })}
      <button type="button" onClick={add} style={{ marginTop: 4, padding: '6px 14px', borderRadius: 6, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>
        + Ajouter un groupe
      </button>
    </div>
  );
}

function GroupRows({ groups, setGroups, showLocation = false, showCities = false, locations = [] }) {
  const [confirmIdx, setConfirmIdx] = useState(null);
  const [expandedCities, setExpandedCities] = useState(new Set());

  function add() {
    if (groups.some(g => g.label.trim() === '')) return;
    setGroups(g => [...g, showLocation ? { label: '', id: '', location: '', cities: [] } : { label: '', id: '' }]);
  }
  function remove(i) { setGroups(g => g.filter((_, idx) => idx !== i)); setConfirmIdx(null); }
  function update(i, key, val) { setGroups(g => g.map((item, idx) => idx === i ? { ...item, [key]: val } : item)); }
  function addCity(i)        { setGroups(g => g.map((item, idx) => idx === i ? { ...item, cities: [...(item.cities || []), { name: '', id: '' }] } : item)); }
  function removeCity(i, ci) { setGroups(g => g.map((item, idx) => idx === i ? { ...item, cities: (item.cities || []).filter((_, x) => x !== ci) } : item)); }
  function updateCity(i, ci, key, val) { setGroups(g => g.map((item, idx) => idx === i ? { ...item, cities: (item.cities || []).map((c, x) => x === ci ? { ...c, [key]: val } : c) } : item)); }
  function toggleCities(i) {
    setExpandedCities(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }

  return (
    <div>
      {groups.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 0', fontStyle: 'italic' }}>
          Aucun groupe configuré.
        </div>
      )}
      {groups.map((g, i) => {
        const cities = g.cities || [];
        const cityCount = cities.length;
        const citiesOpen = expandedCities.has(i) || cityCount > 0;
        return (
        <div key={i} style={{ marginBottom: showCities && g.location ? 12 : 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: showLocation ? '1fr auto 1.4fr auto' : '1fr 1.4fr auto', gap: 8, alignItems: 'center' }}>
          <input
            placeholder="Nom affiché *"
            value={g.label}
            onChange={e => update(i, 'label', e.target.value)}
            style={g.label.trim() === '' ? { borderColor: 'rgba(239,68,68,.6)', outline: 'none' } : {}}
          />
          {showLocation && (
            <select
              value={g.location || ''}
              onChange={e => update(i, 'location', e.target.value)}
              title="Code pays"
              style={{
                height: 34, borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--surface2)', color: g.location ? 'var(--text)' : 'var(--muted)',
                fontSize: 12, padding: '0 6px', cursor: 'pointer', width: 70,
              }}
            >
              <option value="">Pays</option>
              {locations.map(l => <option key={l.code} value={l.code}>{l.flag} {l.code}</option>)}
            </select>
          )}
          <input
            type="text"
            autoComplete="off"
            placeholder="Group Object ID"
            value={g.id}
            onChange={e => update(i, 'id', e.target.value)}
            style={{ fontFamily: 'monospace', fontSize: 12, WebkitTextSecurity: g.id ? 'disc' : 'none' }}
          />
          {confirmIdx === i ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => remove(i)}
                style={{
                  background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.4)',
                  borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                  color: '#ef4444', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                }}
              >Oui</button>
              <button
                type="button"
                onClick={() => setConfirmIdx(null)}
                style={{
                  background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                  color: 'var(--muted)', fontSize: 11,
                }}
              >Non</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmIdx(i)}
              style={{
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 6, width: 30, height: 34, cursor: 'pointer',
                color: 'var(--muted)', fontSize: 14, display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
              title="Supprimer"
            >✕</button>
          )}
          </div>

          {showCities && g.location && (
            !citiesOpen ? (
              <button
                type="button"
                onClick={() => toggleCities(i)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  marginTop: 7, marginLeft: 4,
                  padding: '5px 14px 5px 10px', borderRadius: 20,
                  border: '1px solid rgba(99,102,241,.4)',
                  background: 'rgba(99,102,241,.09)',
                  color: '#818cf8', cursor: 'pointer', fontSize: 11, fontWeight: 500,
                  transition: 'background .15s, border-color .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,.18)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,.7)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,.09)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,.4)'; }}
              >
                <span style={{ fontSize: 14 }}>📍</span>
                Ajouter des villes
              </button>
            ) : (
              <div style={{
                marginTop: 8,
                background: 'rgba(99,102,241,.04)',
                border: '1px solid rgba(99,102,241,.18)',
                borderRadius: 8,
                padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: cityCount > 0 ? 10 : 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13 }}>📍</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '.06em' }}>Villes</span>
                    {cityCount > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: 'rgba(99,102,241,.2)', color: '#818cf8' }}>
                        {cityCount}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => cityCount === 0 && toggleCities(i)}
                    title={cityCount === 0 ? 'Fermer' : 'Supprimez toutes les villes pour fermer'}
                    style={{ background: 'none', border: 'none', cursor: cityCount === 0 ? 'pointer' : 'default', color: 'var(--muted)', fontSize: 13, padding: '2px 4px', opacity: cityCount === 0 ? 0.7 : 0.25 }}
                  >✕</button>
                </div>

                {cities.map((c, ci) => (
                  <div key={ci} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                    <input
                      placeholder="Nom de la ville"
                      value={c.name || ''}
                      onChange={e => updateCity(i, ci, 'name', e.target.value)}
                      style={{ height: 30, fontSize: 12, ...(c.name?.trim() === '' && c.id?.trim() ? { borderColor: 'rgba(239,68,68,.6)' } : {}) }}
                    />
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="Group Object ID"
                      value={c.id || ''}
                      onChange={e => updateCity(i, ci, 'id', e.target.value)}
                      style={{ fontFamily: 'monospace', fontSize: 11, height: 30, WebkitTextSecurity: c.id ? 'disc' : 'none', ...(c.id?.trim() === '' && c.name?.trim() ? { borderColor: 'rgba(239,68,68,.6)' } : {}) }}
                    />
                    <button
                      type="button"
                      onClick={() => removeCity(i, ci)}
                      title="Supprimer"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, padding: '0 6px', lineHeight: 1, opacity: 0.6 }}
                    >×</button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => addCity(i)}
                  style={{
                    marginTop: cityCount > 0 ? 4 : 0,
                    padding: '4px 12px', borderRadius: 6,
                    border: '1px dashed rgba(99,102,241,.4)',
                    background: 'transparent', color: '#818cf8',
                    cursor: 'pointer', fontSize: 11,
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                  }}
                >
                  <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Ville
                </button>
              </div>
            )
          )}
        </div>
        );
      })}
      {(() => {
        const blocked = groups.some(g => g.label.trim() === '');
        return (
          <button
            type="button"
            onClick={add}
            disabled={blocked}
            title={blocked ? 'Renseignez d\'abord le nom du groupe en attente' : ''}
            style={{
              marginTop: 4, background: 'transparent',
              border: `1px dashed ${blocked ? 'rgba(239,68,68,.4)' : 'var(--border)'}`,
              borderRadius: 6, padding: '6px 14px',
              cursor: blocked ? 'not-allowed' : 'pointer',
              color: blocked ? 'rgba(239,68,68,.6)' : 'var(--muted)',
              fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
              opacity: blocked ? 0.7 : 1,
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            {blocked ? 'Renseignez le nom du groupe en attente' : 'Ajouter un groupe'}
          </button>
        );
      })()}
    </div>
  );
}

function DomainRows({ domains, setDomains }) {
  const [confirmIdx, setConfirmIdx] = useState(null);

  function add() {
    if (domains.some(d => d.domain.trim() === '')) return;
    setDomains(d => [...d, { domain: '', active: false }]);
  }
  function remove(i) { setDomains(d => d.filter((_, idx) => idx !== i)); setConfirmIdx(null); }
  function updateDomain(i, val) { setDomains(d => d.map((item, idx) => idx === i ? { ...item, domain: val } : item)); }
  function toggleActive(i) { setDomains(d => d.map((item, idx) => idx === i ? { ...item, active: !item.active } : item)); }

  return (
    <div>
      {domains.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 0', fontStyle: 'italic' }}>
          Aucun domaine configuré.
        </div>
      )}
      {domains.map((d, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          {/* Toggle actif/inactif */}
          <button
            type="button"
            onClick={() => toggleActive(i)}
            title={d.active ? 'Actif — cliquer pour désactiver' : 'Inactif — cliquer pour activer'}
            style={{
              width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
              background: d.active ? 'var(--primary)' : 'var(--border)',
              position: 'relative', transition: 'background .2s', flexShrink: 0,
            }}
          >
            <span style={{
              position: 'absolute', top: 3, left: d.active ? 22 : 3,
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              transition: 'left .2s', display: 'block',
            }} />
          </button>

          <input
            placeholder="exemple.com"
            value={d.domain}
            onChange={e => updateDomain(i, e.target.value)}
            style={{
              fontFamily: 'monospace', fontSize: 13,
              opacity: d.active ? 1 : 0.5,
              ...(d.domain.trim() === '' ? { borderColor: 'rgba(239,68,68,.6)' } : {}),
            }}
          />

          {confirmIdx === i ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button type="button" onClick={() => remove(i)} style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.4)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: '#ef4444', fontSize: 11, fontWeight: 600 }}>Oui</button>
              <button type="button" onClick={() => setConfirmIdx(null)} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: 'var(--muted)', fontSize: 11 }}>Non</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmIdx(i)} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, width: 30, height: 34, cursor: 'pointer', color: 'var(--muted)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Supprimer">✕</button>
          )}
        </div>
      ))}
      {(() => {
        const blocked = domains.some(d => d.domain.trim() === '');
        return (
          <button type="button" onClick={add} disabled={blocked}
            style={{ marginTop: 4, background: 'transparent', border: `1px dashed ${blocked ? 'rgba(239,68,68,.4)' : 'var(--border)'}`, borderRadius: 6, padding: '6px 14px', cursor: blocked ? 'not-allowed' : 'pointer', color: blocked ? 'rgba(239,68,68,.6)' : 'var(--muted)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, opacity: blocked ? 0.7 : 1 }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            {blocked ? 'Renseignez le domaine en attente' : 'Ajouter un domaine'}
          </button>
        );
      })()}
    </div>
  );
}

function TabOrg({ locations, onLocationsChange }) {
  const [globalGroups,        setGlobalGroups]        = useState(null);
  const [countryGroups,       setCountryGroups]       = useState(null);
  const [communicationGroups, setCommunicationGroups] = useState(null);
  const [pointageRoles,       setPointageRoles]       = useState([]);
  const [pointageCommAssign,  setPointageCommAssign]  = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState('');

  useEffect(() => {
    api.get('/api/admin/settings').then(data => {
      setGlobalGroups(data.sharepoint_global_groups   || []);
      setCountryGroups(data.sharepoint_country_groups || []);
      setPointageRoles(data.pointage_departments       || []);
      setPointageCommAssign(data.pointage_comm_assignments || []);
      const raw = (data.department_assignments || []).filter(g => g.id);
      setCommunicationGroups(raw.map(g => ({
        name:        g.name        || g.label || '',
        location:    g.location === 'ALL' ? 'ALL' : 'DEFAULT',
        countries:   g.countries   || [],
        departments: g.departments || (g.department ? [g.department] : []),
        id:          g.id,
      })));
    }).catch(e => setError(e.message));
  }, []);

  async function handleSave(e) {
    e.preventDefault(); setError(''); setSaving(true); setSaved(false);
    const hasEmpty = [...globalGroups, ...countryGroups].some(g => g.label.trim() === '');
    if (hasEmpty) { setError('Chaque groupe doit avoir un nom.'); setSaving(false); return; }
    const hasMissingId = [
      ...globalGroups.map(g => ({ label: g.label, id: g.id })),
      ...countryGroups.map(g => ({ label: g.label, id: g.id })),
      ...communicationGroups.map(g => ({ label: g.name, id: g.id })),
    ].some(g => !g.id?.trim());
    if (hasMissingId) { setError('Chaque groupe doit avoir un Group Object ID.'); setSaving(false); return; }
    const hasNoPays = communicationGroups.filter(g => g.id).some(g => g.location !== 'ALL' && (g.departments || []).length > 0 && (g.countries || []).length === 0);
    if (hasNoPays) { setError('Un groupe Default avec des rôles doit avoir au moins un pays.'); setSaving(false); return; }
    // Villes : si renseignée, une ville doit avoir un nom ET un Group Object ID
    const badCity = countryGroups.some(g => (g.cities || []).some(c => (c.name?.trim() || c.id?.trim()) && (!c.name?.trim() || !c.id?.trim())));
    if (badCity) { setError('Chaque ville doit avoir un nom ET un Group Object ID.'); setSaving(false); return; }
    // Vérification Azure AD sur tous les groupes (nouveaux, modifiés et existants)
    const toVerify = [
      ...globalGroups.filter(g => g.id?.trim()).map(g => ({ id: g.id.trim(), label: g.label })),
      ...countryGroups.filter(g => g.id?.trim()).map(g => ({ id: g.id.trim(), label: g.label })),
      ...countryGroups.flatMap(g => (g.cities || []).filter(c => c.id?.trim()).map(c => ({ id: c.id.trim(), label: `${g.label} / ${c.name}` }))),
      ...communicationGroups.filter(g => g.id?.trim()).map(g => ({ id: g.id.trim(), label: g.name || g.id })),
    ];
    const uniqueToVerify = [...new Map(toVerify.map(g => [g.id, g])).values()];
    if (uniqueToVerify.length > 0) {
      const verifyResults = await Promise.all(
        uniqueToVerify.map(g =>
          api.get(`/api/graph/groups/${encodeURIComponent(g.id)}`).then(() => null).catch(() => g)
        )
      );
      const notFound = verifyResults.filter(Boolean);
      if (notFound.length > 0) {
        setError(`Groupe(s) introuvable(s) dans l'organisation : ${notFound.map(g => `"${g.label || g.id}"`).join(', ')}`);
        setSaving(false);
        return;
      }
    }
    try {
      const deptAssignments = communicationGroups
        .filter(g => g.id)
        .map(g => ({ name: g.name, location: g.location, countries: g.countries || [], departments: g.departments || [], id: g.id }));

      // Sync Groupes→Pointage : retirer les assignments pour les groupes supprimés ou sans départements
      const validGroupIds = new Set(deptAssignments.filter(g => g.departments.length > 0).map(g => g.id));
      const updatedPointageComm = pointageCommAssign.filter(a => validGroupIds.has(a.id));

      // Nettoyer les villes vides (nom ET id non renseignés) avant sauvegarde
      const cleanCountryGroups = countryGroups.map(g => ({
        ...g,
        cities: (g.cities || []).filter(c => c.name?.trim() && c.id?.trim()).map(c => ({ name: c.name.trim(), id: c.id.trim() })),
      }));

      await api.put('/api/admin/settings', {
        sharepoint_global_groups:  globalGroups,
        sharepoint_country_groups: cleanCountryGroups,
        department_assignments:    deptAssignments,
        pointage_comm_assignments: updatedPointageComm,
      });
      setPointageCommAssign(updatedPointageComm);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  const [activeSection, setActiveSection] = useState('global');

  const NAV = [
    { key: 'global',  iconPath: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M2 12h20', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'], label: 'Globaux',      sub: 'Tous les employés',     count: globalGroups?.length },
    { key: 'country', iconPath: ['M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z', 'M8 2v16', 'M16 6v16'],                                                                                           label: 'Par pays',     sub: 'Selon la localisation', count: countryGroups?.length },
    { key: 'comm',    iconPath: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.2 19.79 19.79 0 0 1 1.61 4.6 2 2 0 0 1 3.6 2.4h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.87-1.87a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'], label: 'Communication', sub: 'Par département',       count: communicationGroups?.length },
  ];

  if (globalGroups === null) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><span className="spinner" /></div>;

  const activeNav = NAV.find(n => n.key === activeSection);

  return (
    <form onSubmit={handleSave}>
      {error && <div className="error-box">{error}</div>}
      {saved && <div style={{ background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--success)' }}>Paramètres enregistrés.</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ display: 'flex' }}>

          {/* ── Panneau gauche : navigation ── */}
          <div style={{ width: 210, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 16px 10px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', borderBottom: '1px solid var(--border)' }}>
              Groupes
            </div>
            {NAV.map(s => {
              const isActive = activeSection === s.key;
              return (
                <div
                  key={s.key}
                  onClick={() => setActiveSection(s.key)}
                  style={{
                    padding: '13px 16px', cursor: 'pointer',
                    borderLeft: `3px solid ${isActive ? 'var(--primary)' : 'transparent'}`,
                    background: isActive ? 'rgba(37,99,235,.1)' : 'transparent',
                    borderBottom: '1px solid var(--border)',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,.04)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ display: 'flex', color: isActive ? 'var(--primary)' : 'var(--muted)' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          {(s.iconPath || []).map((d, i) => <path key={i} d={d} />)}
                        </svg>
                      </span>
                      <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--primary)' : 'var(--text)' }}>{s.label}</span>
                    </div>
                    {s.count != null && (
                      <span style={{ fontSize: 11, fontWeight: 700, minWidth: 20, textAlign: 'center', padding: '1px 6px', borderRadius: 9, background: isActive ? 'rgba(37,99,235,.18)' : 'rgba(255,255,255,.08)', color: isActive ? 'var(--primary)' : 'var(--muted)' }}>
                        {s.count}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 23 }}>{s.sub}</div>
                </div>
              );
            })}
          </div>

          {/* ── Panneau droit : contenu ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* Header section */}
            <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'flex', color: 'var(--muted)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {(activeNav?.iconPath || []).map((d, i) => <path key={i} d={d} />)}
                </svg>
              </span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Groupes {activeNav?.label.toLowerCase()}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{activeNav?.sub}</div>
              </div>
            </div>
            {/* Content */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
              {activeSection === 'global'  && <GroupRows groups={globalGroups}  setGroups={setGlobalGroups} />}
              {activeSection === 'country' && <GroupRows groups={countryGroups} setGroups={setCountryGroups} showLocation showCities locations={locations} />}
              {activeSection === 'comm'    && <CommGroupRows groups={communicationGroups} setGroups={setCommunicationGroups} locations={locations} allowedRoles={pointageRoles} />}
            </div>
          </div>

        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="btn btn-primary" disabled={saving} style={{ minWidth: 160, justifyContent: 'center' }}>
          {saving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
        </button>
      </div>
    </form>
  );
}

// ─── Tab: Onboarding ─────────────────────────────────────────────────────────


function TabOnboarding() {
  const [settings, setSettings] = useState(null);
  const [form, setForm]         = useState({});
  const [domains, setDomains]   = useState(null);
  const [saving, setSaving]               = useState(false);
  const [saved, setSaved]                 = useState(false);
  const [error, setError]                 = useState('');

  useEffect(() => {
    api.get('/api/admin/settings').then(data => {
      setSettings(data);
      setForm({
        force_change_password: data.force_change_password === 'true' ? 'true' : 'false',
      });
      setDomains(data.onboarding_domains || ['captivea.com']);
    }).catch(e => setError(e.message));
  }, []);

  async function handleSave(e) {
    e.preventDefault(); setError(''); setSaving(true); setSaved(false);
    if (domains.some(d => d.domain.trim() === '')) { setError('Chaque domaine doit être renseigné.'); setSaving(false); return; }
    try {
      const payload = { ...form, onboarding_domains: domains };
      await api.put('/api/admin/settings', payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      const data = await api.get('/api/admin/settings');
      setSettings(data);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  if (!settings || domains === null) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><span className="spinner" /></div>;

  return (
    <form onSubmit={handleSave}>
      {error && <div className="error-box">{error}</div>}
      {saved && <div style={{ background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--success)' }}>Paramètres enregistrés.</div>}

      {/* Mot de passe employé */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>Mot de passe du nouvel employé</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Mot de passe assigné à chaque nouveau compte M365 créé lors de l'onboarding.
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { value: 'false', label: 'Définitif', desc: "L'employé n'est pas forcé de le changer" },
            { value: 'true',  label: 'Temporaire', desc: "L'employé doit le changer à la 1ère connexion" },
          ].map(opt => (
            <div key={opt.value} onClick={() => setForm(f => ({ ...f, force_change_password: opt.value }))}
              style={{ flex: 1, padding: '12px 14px', borderRadius: 8, cursor: 'pointer', border: `2px solid ${form.force_change_password === opt.value ? 'var(--primary)' : 'var(--border)'}`, background: form.force_change_password === opt.value ? 'rgba(37,99,235,.08)' : 'var(--surface2)', transition: 'all .15s' }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, color: form.force_change_password === opt.value ? 'var(--primary)' : 'var(--text)', marginBottom: 2 }}>
                {form.force_change_password === opt.value ? '● ' : '○ '}{opt.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{opt.desc}</div>
            </div>
          ))}
        </div>
      </div>


      {/* Domaines email */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 18 }}>@</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Domaines email</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              Domaines disponibles dans le dropdown lors d'un nouvel onboarding
            </div>
          </div>
        </div>
        <DomainRows domains={domains} setDomains={setDomains} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="btn btn-primary" disabled={saving} style={{ minWidth: 160, justifyContent: 'center' }}>
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}

// ─── Tab: Pointage ───────────────────────────────────────────────────────────

const PILL_COLORS = ['#2563eb','#7c3aed','#059669','#d97706','#db2777','#0891b2','#65a30d'];

function TabPointage({ locations, onLocationsChange }) {
  const [selectedLoc, setSelectedLoc] = useState(locations[0]?.code || 'MDG');
  const [error, setError]             = useState('');

  // ── Section SP ──
  const [assignments, setAssignments] = useState(null);
  const [spGroups,    setSpGroups]    = useState([]);
  const [spSearch,    setSpSearch]    = useState('');
  const [spResults,   setSpResults]   = useState([]);
  const [spSearching, setSpSearching] = useState(false);
  const [spSelLeft,   setSpSelLeft]   = useState(new Set());
  const [spSelRight,  setSpSelRight]  = useState(null);
  const [spSaving,    setSpSaving]    = useState(false);
  const [spSaved,     setSpSaved]     = useState(false);

  // ── Créer / supprimer filiale ──
  const [addingLoc,      setAddingLoc]      = useState(false);
  const [newLocCode,     setNewLocCode]     = useState('');
  const [newLocName,     setNewLocName]     = useState('');
  const [newLocFlag,     setNewLocFlag]     = useState('');
  const [locSaving,      setLocSaving]      = useState(false);
  const [confirmDelLoc,  setConfirmDelLoc]  = useState(null);

  // ── Section Départements ──
  const [departments,     setDepartments]    = useState([]);
  const [selectedDept,    setSelectedDept]   = useState(null);
  const [deptAssignments, setDeptAssignments] = useState({});
  const [deptSearch,      setDeptSearch]     = useState('');
  const [deptGroupsBase,  setDeptGroupsBase] = useState([]);
  const [deptAllConfig,   setDeptAllConfig]   = useState([]);
  const [deptResults,     setDeptResults]    = useState([]);
  const [deptSearching,   setDeptSearching]  = useState(false);
  const [deptSelLeft,     setDeptSelLeft]    = useState(new Set());
  const [deptSelRight,    setDeptSelRight]   = useState(null);
  const [deptSaving,      setDeptSaving]     = useState(false);
  const [deptSaved,       setDeptSaved]      = useState(false);
  const [addingDept,      setAddingDept]     = useState(false);
  const [newDeptName,     setNewDeptName]    = useState('');

  // Chargement initial
  useEffect(() => {
    setSpSearching(true);
    Promise.all([
      api.get('/api/admin/settings'),
      api.get('/api/graph/groups').catch(() => []),
    ]).then(([data, azureGroups]) => {
      const spMap = {};
      locations.forEach(l => { spMap[l.code] = []; });
      (data.pointage_assignments || []).forEach(g => { if (spMap[g.location]) spMap[g.location].push({ label: g.label, id: g.id }); });
      setAssignments(spMap);

      const configuredIds = new Set([
        ...(data.sharepoint_global_groups  || []),
        ...(data.sharepoint_country_groups || []),
      ].filter(g => g.id).map(g => g.id));
      const base = (Array.isArray(azureGroups) ? azureGroups : []).filter(g => !configuredIds.has(g.id));
      setSpGroups(base);
      setSpResults(base);

      // Groupes disponibles pour la section Départements = uniquement les groupes configurés dans Groupes de communication
      const rawDeptConfig = (data.department_assignments || []).filter(g => g.id);
      setDeptAllConfig(rawDeptConfig);
      const commGroups = rawDeptConfig.map(g => ({
        id:          g.id,
        displayName: g.name || g.id,
        location:    g.location,
        countries:   g.countries || [],
        departments: g.departments || [],
        description: [g.location === 'ALL' ? '🌐 GBL' : (g.countries || []).length > 0 ? `📍 ${(g.countries || []).join(', ')}` : 'Default', ...(g.departments || []).slice(0, 2)].filter(Boolean).join(' · '),
      }));
      setDeptGroupsBase(commGroups);
      setDeptResults(commGroups);

      // Fix 1 : on recharge aussi la liste des depts sauvegardés (même sans assignation)
      const dMap = {};
      (data.pointage_departments || []).forEach(d => { dMap[d] = {}; });
      (data.pointage_comm_assignments || []).filter(g => g.id && g.department && g.location).forEach(g => {
        if (!dMap[g.department]) dMap[g.department] = {};
        if (!dMap[g.department][g.location]) dMap[g.department][g.location] = [];
        dMap[g.department][g.location].push({ label: g.label || g.displayName || g.department, id: g.id });
      });
      setDeptAssignments(dMap);
      setDepartments(Object.keys(dMap));

    }).catch(e => setError(e.message)).finally(() => setSpSearching(false));
  }, []);

  // Recherche SP
  useEffect(() => {
    if (!spSearch.trim()) { setSpResults(spGroups); return; }
    setSpSearching(true);
    const t = setTimeout(() => {
      api.get(`/api/graph/groups?search=${encodeURIComponent(spSearch)}`)
        .then(data => {
          const live = Array.isArray(data) ? data : [];
          const extras = spGroups.filter(g => g.displayName?.toLowerCase().includes(spSearch.toLowerCase()) && !live.some(r => r.id === g.id));
          setSpResults([...live, ...extras]);
        })
        .catch(() => setSpResults(spGroups.filter(g => g.displayName?.toLowerCase().includes(spSearch.toLowerCase()))))
        .finally(() => setSpSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [spSearch, spGroups]);

  // Recherche Départements — filtrage local uniquement sur les groupes configurés
  useEffect(() => {
    if (!deptSearch.trim()) { setDeptResults(deptGroupsBase); return; }
    setDeptResults(deptGroupsBase.filter(g => g.displayName?.toLowerCase().includes(deptSearch.toLowerCase())));
  }, [deptSearch, deptGroupsBase]);

  async function removeLocation(code) {
    setLocSaving(true); setConfirmDelLoc(null);
    try {
      const newLocations    = locations.filter(l => l.code !== code);
      const newAssignments  = Object.fromEntries(Object.entries(assignments).filter(([loc]) => loc !== code));
      const newDeptAssign   = Object.fromEntries(
        Object.entries(deptAssignments).map(([dept, locMap]) => [
          dept,
          Object.fromEntries(Object.entries(locMap).filter(([loc]) => loc !== code)),
        ])
      );
      const newDeptConfig   = deptAllConfig.map(g => {
        const newCountries = (g.countries || []).filter(c => c !== code);
        return { ...g, countries: newCountries, departments: newCountries.length === 0 && g.location !== 'ALL' ? [] : (g.departments || []) };
      });
      const spGroups        = [];
      Object.entries(newAssignments).forEach(([loc, list]) => list.forEach(g => spGroups.push({ label: g.label, id: g.id, location: loc })));
      const commGroups      = [];
      Object.entries(newDeptAssign).forEach(([dept, locMap]) =>
        Object.entries(locMap).forEach(([loc, list]) => list.forEach(g => commGroups.push({ label: g.label, id: g.id, location: loc, department: dept })))
      );
      await api.put('/api/admin/settings', {
        locations:                 newLocations,
        pointage_assignments:      spGroups,
        pointage_comm_assignments: commGroups,
        department_assignments:    newDeptConfig,
      });
      onLocationsChange(newLocations);
      setAssignments(newAssignments);
      setDeptAssignments(newDeptAssign);
      setDeptAllConfig(newDeptConfig);
      if (selectedLoc === code) setSelectedLoc(newLocations[0]?.code || null);
    } catch (err) { setError(err.message); } finally { setLocSaving(false); }
  }

  function selectLoc(code) { setSelectedLoc(code); setSpSelLeft(new Set()); setSpSelRight(null); setSpSearch(''); }

  function spAssign() {
    if (!spSelLeft.size || !assignments) return;
    const toAdd = spResults.filter(g => spSelLeft.has(g.id));
    setAssignments(a => {
      const n = {};
      Object.keys(a).forEach(loc => { n[loc] = loc === selectedLoc ? a[loc] : a[loc].filter(g => !spSelLeft.has(g.id)); });
      const cur = n[selectedLoc] || [];
      n[selectedLoc] = [...cur, ...toAdd.filter(g => !cur.some(c => c.id === g.id)).map(g => ({ label: g.displayName, id: g.id }))];
      return n;
    });
    setSpSelLeft(new Set());
  }

  async function saveSP() {
    setSpSaving(true); setError('');
    try {
      const groups = [];
      Object.entries(assignments).forEach(([location, list]) => list.forEach(g => groups.push({ label: g.label, id: g.id, location })));
      await api.put('/api/admin/settings', { pointage_assignments: groups });
      setSpSaved(true); setTimeout(() => setSpSaved(false), 3000);
    } catch (err) { setError(err.message); } finally { setSpSaving(false); }
  }

  async function addLocation() {
    const code = newLocCode.trim().toUpperCase();
    const name = newLocName.trim();
    if (!code || !name) return;
    if (locations.some(l => l.code === code)) { setError(`La filiale "${code}" existe déjà.`); return; }
    const flag = newLocFlag.trim() || '🏳️';
    setLocSaving(true);
    try {
      const newList = [...locations, { code, name, flag }];
      await api.put('/api/admin/settings', { locations: newList });
      onLocationsChange(newList);
      setAssignments(a => ({ ...a, [code]: [] }));
      setNewLocCode(''); setNewLocName(''); setNewLocFlag('');
      setAddingLoc(false);
    } catch (err) { setError(err.message); } finally { setLocSaving(false); }
  }

  function selectDept(d) { setSelectedDept(d); setDeptSelLeft(new Set()); setDeptSelRight(null); setDeptSearch(''); }

  function addDept() {
    const name = newDeptName.trim();
    if (!name || departments.includes(name)) return;
    setDepartments(d => [...d, name]);
    setDeptAssignments(a => ({ ...a, [name]: {} }));
    setNewDeptName(''); setAddingDept(false);
    selectDept(name);
  }

  function deptAssign() {
    if (!deptSelLeft.size || !selectedDept) return;
    const toAdd = deptResults.filter(g => deptSelLeft.has(g.id));
    setDeptAssignments(a => {
      const n = {};
      Object.keys(a).forEach(dept => {
        n[dept] = {};
        Object.keys(a[dept]).forEach(loc => {
          n[dept][loc] = (dept === selectedDept && loc === selectedLoc) ? a[dept][loc] : a[dept][loc].filter(g => !deptSelLeft.has(g.id));
        });
      });
      if (!n[selectedDept]) n[selectedDept] = {};
      const cur = n[selectedDept][selectedLoc] || [];
      n[selectedDept][selectedLoc] = [...cur, ...toAdd.filter(g => !cur.some(c => c.id === g.id)).map(g => ({ label: g.displayName, id: g.id }))];
      return n;
    });
    setDeptSelLeft(new Set());
  }

  function deptUnassign() {
    if (!deptSelRight || !selectedDept) return;
    setDeptAssignments(a => {
      const n = { ...a, [selectedDept]: { ...a[selectedDept], [selectedLoc]: (a[selectedDept]?.[selectedLoc] || []).filter(g => g.id !== deptSelRight) } };
      return n;
    });
    setDeptSelRight(null);
  }

  async function saveDepts() {
    setDeptSaving(true); setError('');
    try {
      const groups = [];
      Object.entries(deptAssignments).forEach(([department, locMap]) => {
        Object.entries(locMap).forEach(([location, list]) => {
          list.forEach(g => groups.push({ label: g.label, id: g.id, location, department }));
        });
      });

      // Sync vers department_assignments :
      // - Groupes GBL (location=ALL) : gérés depuis l'onglet Groupes, on ne touche pas à leurs departments
      // - Groupes non-GBL (DEFAULT) : Pointage est la source de vérité, on remplace entièrement
      const pointageDeptsByGroupId = {};
      const pointageLocsByGroupId  = {};
      groups.forEach(g => {
        if (!pointageDeptsByGroupId[g.id]) pointageDeptsByGroupId[g.id] = new Set();
        pointageDeptsByGroupId[g.id].add(g.department);
        if (!pointageLocsByGroupId[g.id]) pointageLocsByGroupId[g.id] = new Set();
        pointageLocsByGroupId[g.id].add(g.location);
      });
      const syncedDeptConfig = deptAllConfig.map(g => {
        // GBL ou Default+pays : géré depuis Groupes, on ne touche pas
        if (g.location === 'ALL' || (g.location !== 'ALL' && (g.countries || []).length > 0)) {
          return { name: g.name, location: g.location, countries: g.countries || [], departments: g.departments || [], id: g.id };
        }
        // Default sans pays : Pointage est la source de vérité — sync depts ET pays
        const ptDepts = pointageDeptsByGroupId[g.id] ? [...pointageDeptsByGroupId[g.id]] : [];
        const ptLocs  = pointageLocsByGroupId[g.id]  ? [...pointageLocsByGroupId[g.id]]  : [];
        return { name: g.name, location: 'DEFAULT', countries: ptLocs, departments: ptDepts, id: g.id };
      });

      // Dédoublonnage DB : retirer de pointage_comm_assignments les groupes déjà auto-assignés via department_assignments
      const cleanGroups = groups.filter(entry => {
        const grp = syncedDeptConfig.find(g => g.id === entry.id);
        if (!grp) return true;
        if (grp.location === 'ALL') return false;
        if ((grp.countries || []).includes(entry.location) && (grp.departments || []).includes(entry.department)) return false;
        return true;
      });

      await api.put('/api/admin/settings', {
        pointage_comm_assignments: cleanGroups,
        pointage_departments:      departments,
        department_assignments:    syncedDeptConfig,
      });
      // Sync state local : retirer aussi les entrées nettoyées de deptAssignments
      const cleanKeys = new Set(cleanGroups.map(g => `${g.id}::${g.department}::${g.location}`));
      setDeptAssignments(prev => {
        const next = {};
        Object.entries(prev).forEach(([dept, locMap]) => {
          next[dept] = {};
          Object.entries(locMap).forEach(([loc, list]) => {
            next[dept][loc] = list.filter(g => cleanKeys.has(`${g.id}::${dept}::${loc}`));
          });
        });
        return next;
      });
      setDeptAllConfig(syncedDeptConfig);
      const newCommGroups = syncedDeptConfig.map(g => ({
        id: g.id, displayName: g.name || g.id, location: g.location, countries: g.countries || [], departments: g.departments || [],
        description: [g.location === 'ALL' ? '🌐 GBL' : (g.countries || []).length > 0 ? `📍 ${(g.countries || []).join(', ')}` : 'Default', ...(g.departments || []).slice(0, 2)].filter(Boolean).join(' · '),
      }));
      setDeptGroupsBase(newCommGroups);
      setDeptResults(newCommGroups.filter(g => !deptSearch.trim() || g.displayName?.toLowerCase().includes(deptSearch.toLowerCase())));
      setDeptSaved(true); setTimeout(() => setDeptSaved(false), 3000);
    } catch (err) { setError(err.message); } finally { setDeptSaving(false); }
  }

  async function removeAutoGroup(groupId) {
    const updated = deptAllConfig.map(g => {
      if (g.id !== groupId) return g;
      const newCountries = (g.countries || []).filter(c => c !== selectedLoc);
      // Si plus aucune filiale, vider aussi les depts (groupe redevient disponible)
      const newDepts = newCountries.length === 0 ? [] : (g.departments || []);
      return { ...g, countries: newCountries, departments: newDepts };
    });
    try {
      await api.put('/api/admin/settings', { department_assignments: updated });
      setDeptAllConfig(updated);
      const newCommGroups = updated.map(g => ({
        id: g.id, displayName: g.name || g.id, location: g.location, countries: g.countries || [], departments: g.departments || [],
        description: [g.location === 'ALL' ? '🌐 GBL' : (g.countries || []).length > 0 ? `📍 ${(g.countries || []).join(', ')}` : 'Default', ...(g.departments || []).slice(0, 2)].filter(Boolean).join(' · '),
      }));
      setDeptGroupsBase(newCommGroups);
      setDeptResults(newCommGroups.filter(g => !deptSearch.trim() || g.displayName?.toLowerCase().includes(deptSearch.toLowerCase())));
    } catch (err) { setError(err.message); }
  }

  if (!assignments) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><span className="spinner" /></div>;

  const currentLoc   = locations.find(l => l.code === selectedLoc);
  const spCurrent    = assignments[selectedLoc] || [];
  const spCurrentIds = new Set(spCurrent.map(g => g.id));
  const deptCurrent  = selectedDept ? (deptAssignments[selectedDept]?.[selectedLoc] || []) : [];

  return (
    <div>
      {error && <div className="error-box">{error}</div>}

      {/* ── Pills filiales + bouton créer ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
        {locations.map((loc, i) => {
          const spCount   = assignments[loc.code]?.length || 0;
          const active    = selectedLoc === loc.code;
          const color     = PILL_COLORS[i % PILL_COLORS.length];
          const confirming = confirmDelLoc === loc.code;
          return (
            <div key={loc.code} style={{ display: 'flex', alignItems: 'center', border: `2px solid ${active ? color : confirming ? 'rgba(239,68,68,.5)' : 'var(--border)'}`, borderRadius: 20, background: active ? color : confirming ? 'rgba(239,68,68,.07)' : 'transparent', transition: 'all .15s', overflow: 'hidden' }}>
              <button type="button" onClick={() => { selectLoc(loc.code); setConfirmDelLoc(null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 14px', background: 'transparent', border: 'none', color: active ? '#fff' : 'var(--text2)', cursor: 'pointer', fontWeight: active ? 700 : 400, fontSize: 13 }}
              >
                <span>{loc.flag}</span>{loc.code}
                {spCount > 0 && <span style={{ background: active ? 'rgba(255,255,255,.3)' : color, color: '#fff', borderRadius: 10, padding: '0 6px', fontSize: 11, fontWeight: 700 }}>{spCount}</span>}
              </button>
              {confirming ? (
                <>
                  <button type="button" onClick={() => removeLocation(loc.code)} disabled={locSaving}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11, fontWeight: 700, padding: '0 6px', lineHeight: 1 }}>Oui</button>
                  <button type="button" onClick={() => setConfirmDelLoc(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 11, padding: '0 8px 0 2px', lineHeight: 1 }}>Non</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDelLoc(loc.code)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: active ? 'rgba(255,255,255,.7)' : 'var(--muted)', fontSize: 15, padding: '0 10px 0 2px', lineHeight: 1 }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = active ? 'rgba(255,255,255,.7)' : 'var(--muted)'}
                >×</button>
              )}
            </div>
          );
        })}
        {addingLoc ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input autoFocus value={newLocFlag} onChange={e => setNewLocFlag(e.target.value)} placeholder="🏳️" style={{ padding: '4px 8px', borderRadius: 20, border: '2px solid var(--primary)', fontSize: 18, background: 'var(--surface2)', color: 'var(--text)', width: 54, textAlign: 'center' }} />
            <input value={newLocCode} onChange={e => setNewLocCode(e.target.value.toUpperCase())} placeholder="Code (CA)" style={{ padding: '4px 10px', borderRadius: 20, border: '2px solid var(--primary)', fontSize: 13, background: 'var(--surface2)', color: 'var(--text)', width: 80 }} />
            <input value={newLocName} onChange={e => setNewLocName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addLocation(); if (e.key === 'Escape') { setAddingLoc(false); setNewLocCode(''); setNewLocName(''); setNewLocFlag(''); } }} placeholder="Nom complet" style={{ padding: '4px 10px', borderRadius: 20, border: '2px solid var(--primary)', fontSize: 13, background: 'var(--surface2)', color: 'var(--text)', width: 140 }} />
            <button type="button" onClick={addLocation} disabled={locSaving} style={{ padding: '4px 10px', borderRadius: 20, background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13 }}>{locSaving ? '…' : '✓'}</button>
            <button type="button" onClick={() => { setAddingLoc(false); setNewLocCode(''); setNewLocName(''); setNewLocFlag(''); }} style={{ padding: '4px 10px', borderRadius: 20, background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>✕</button>
          </div>
        ) : (
          <button type="button" onClick={() => setAddingLoc(true)} style={{ padding: '5px 12px', borderRadius: 20, border: '2px dashed var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}>+ Filiale</button>
        )}
      </div>

      {/* ── Section Groupes SP ── */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)', marginBottom: 10, letterSpacing: '.3px', textTransform: 'uppercase' }}>
        Groupes de sécurité SP
      </div>
      <input placeholder="Rechercher un groupe Azure AD..." value={spSearch} onChange={e => { setSpSearch(e.target.value); setSpSelLeft(new Set()); }} style={{ width: '100%', boxSizing: 'border-box', marginBottom: 10 }} />

      {(() => {
        const assignedElsewhere = {};
        Object.entries(assignments).forEach(([loc, list]) => { if (loc !== selectedLoc) list.forEach(g => { assignedElsewhere[g.id] = loc; }); });
        // Disponibles : non assignés nulle part
        const availLeft   = spResults.filter(g => !spCurrentIds.has(g.id) && !assignedElsewhere[g.id]);
        // Déjà assignés ailleurs : visibles en lecture seule (clic → naviguer vers leur filiale)
        const assignedLeft = spResults.filter(g => !spCurrentIds.has(g.id) && assignedElsewhere[g.id]);
        const listStyle = { height: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' };
        const rowStyle  = (active) => ({ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: active ? 'rgba(37,99,235,.12)' : 'transparent', display: 'flex', alignItems: 'center', gap: 8, transition: 'background .1s', userSelect: 'none' });
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 52px 1fr', gap: 12, alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>DISPONIBLES · {availLeft.length}{spSelLeft.size > 0 ? ` · ${spSelLeft.size} sél.` : ''}</div>
              <div style={listStyle}>
                {spSearching && <div style={{ padding: 20, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>}
                {!spSearching && availLeft.length === 0 && !spSearch.trim() && <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Aucun groupe SP disponible</div>}
                {!spSearching && availLeft.map(g => {
                  const checked = spSelLeft.has(g.id);
                  const toggle  = () => setSpSelLeft(prev => { const n = new Set(prev); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; });
                  return (
                    <div key={g.id} onClick={toggle} style={rowStyle(checked)}>
                      <input type="checkbox" checked={checked} onChange={toggle} onClick={e => e.stopPropagation()} style={{ width: 15, height: 15, accentColor: 'var(--primary)', flexShrink: 0, cursor: 'pointer' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: 'var(--text)' }}>{g.displayName}</div>
                        {g.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{g.description}</div>}
                      </div>
                    </div>
                  );
                })}
                {spSearch.trim() && assignedLeft.length > 0 && (
                  <>
                    {availLeft.length > 0 && <div style={{ borderTop: '1px dashed var(--border)', margin: '4px 0' }} />}
                    {assignedLeft.map(g => {
                      const takenLoc = assignedElsewhere[g.id];
                      const locInfo  = locations.find(l => l.code === takenLoc);
                      return (
                        <div key={g.id} onClick={() => selectLoc(takenLoc)} style={{ ...rowStyle(false), opacity: 0.7 }}>
                          <div style={{ width: 15, height: 15, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>📍</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: 'var(--text)' }}>{g.displayName}</div>
                            <div style={{ fontSize: 11, color: '#f59e0b' }}>{locInfo?.flag} Assigné à {takenLoc} — cliquer pour y aller</div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, paddingTop: 44 }}>
              <button type="button" onClick={spAssign} disabled={!spSelLeft.size} style={{ width: 40, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: spSelLeft.size ? 'var(--primary)' : 'var(--surface2)', color: spSelLeft.size ? '#fff' : 'var(--muted)', cursor: spSelLeft.size ? 'pointer' : 'not-allowed', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>→</button>
              <button type="button" onClick={() => { setAssignments(a => ({ ...a, [selectedLoc]: a[selectedLoc].filter(g => g.id !== spSelRight) })); setSpSelRight(null); }} disabled={!spSelRight} style={{ width: 40, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: spSelRight ? 'rgba(239,68,68,.15)' : 'var(--surface2)', color: spSelRight ? '#ef4444' : 'var(--muted)', cursor: spSelRight ? 'pointer' : 'not-allowed', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>{currentLoc?.flag} {currentLoc?.code} — {currentLoc?.name?.toUpperCase()} · {spCurrent.length}</div>
              <div style={listStyle}>
                {spCurrent.length === 0 && <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Aucun groupe assigné à {currentLoc?.code}</div>}
                {spCurrent.map(g => (
                  <div key={g.id} onClick={() => setSpSelRight(g.id === spSelRight ? null : g.id)} style={rowStyle(spSelRight === g.id)}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: spSelRight === g.id ? '#ef4444' : 'var(--primary)', flexShrink: 0 }} />
                    <div style={{ fontSize: 13, color: 'var(--text)' }}>{g.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        {spSaved && <span style={{ fontSize: 12, color: 'var(--success)', alignSelf: 'center', marginRight: 12 }}>✓ Enregistré</span>}
        <button type="button" className="btn btn-primary" onClick={saveSP} disabled={spSaving} style={{ minWidth: 160, justifyContent: 'center' }}>
          {spSaving ? 'Enregistrement...' : 'Appliquer'}
        </button>
      </div>

      {/* ── Séparateur Départements ── */}
      <div style={{ margin: '28px 0', borderTop: '1px solid var(--border)' }} />

      {/* ── Titre section Départements ── */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)', marginBottom: 10, letterSpacing: '.3px', textTransform: 'uppercase' }}>
        Groupes par département
      </div>

      {/* ── Pills départements ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        {departments.map((d, i) => {
          const active    = selectedDept === d;
          const autoGrps  = deptAllConfig.filter(g =>
            (g.departments || []).includes(d) &&
            (g.location === 'ALL' || (g.location !== 'ALL' && (g.countries || []).includes(selectedLoc)))
          );
          const autoIds   = new Set(autoGrps.map(g => g.id));
          const manualIds = new Set((deptAssignments[d]?.[selectedLoc] || []).map(g => g.id));
          const total     = new Set([...autoIds, ...manualIds]).size;
          const color = PILL_COLORS[(i + 3) % PILL_COLORS.length];
          return (
            <div key={d} style={{ display: 'flex', alignItems: 'center', border: `2px solid ${active ? color : 'var(--border)'}`, borderRadius: 20, background: active ? color : 'transparent', transition: 'all .15s', overflow: 'hidden' }}>
              <button type="button" onClick={() => selectDept(d)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 14px', background: 'transparent', border: 'none', color: active ? '#fff' : 'var(--text2)', cursor: 'pointer', fontWeight: active ? 700 : 400, fontSize: 13 }}
              >
                {d}
                {total > 0 && <span style={{ background: active ? 'rgba(255,255,255,.3)' : color, color: '#fff', borderRadius: 10, padding: '0 6px', fontSize: 11, fontWeight: 700 }}>{total}</span>}
              </button>
              <button type="button" onClick={() => {
                setDepartments(ds => ds.filter(x => x !== d));
                setDeptAssignments(a => { const n = { ...a }; delete n[d]; return n; });
                if (selectedDept === d) setSelectedDept(null);
              }} style={{ background: 'transparent', border: 'none', borderLeft: `1px solid ${active ? 'rgba(255,255,255,.3)' : 'var(--border)'}`, color: active ? '#fff' : 'var(--muted)', cursor: 'pointer', padding: '5px 8px', fontSize: 13, lineHeight: 1 }}>×</button>
            </div>
          );
        })}
        {addingDept ? (
          <RoleSearchDropdown
            existing={departments}
            onSelect={role => {
              if (!role || departments.includes(role)) return;
              setDepartments(d => [...d, role]);
              setDeptAssignments(a => ({ ...a, [role]: {} }));
              setAddingDept(false);
              selectDept(role);
            }}
            onCancel={() => setAddingDept(false)}
          />
        ) : (
          <button type="button" onClick={() => setAddingDept(true)} style={{ padding: '5px 12px', borderRadius: 20, border: '2px dashed var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}>+ Ajouter</button>
        )}
      </div>

      {selectedDept && (
        <>
          <input placeholder="Rechercher un groupe de communication..." value={deptSearch} onChange={e => { setDeptSearch(e.target.value); setDeptSelLeft(new Set()); }} style={{ width: '100%', boxSizing: 'border-box', marginBottom: 10 }} />
          {(() => {
            // Groupes auto-inclus : GBL (toutes filiales) OU Default+pays correspondant à la filiale courante
            const gblAutoGroups = deptAllConfig.filter(g =>
              (g.departments || []).includes(selectedDept) &&
              (
                g.location === 'ALL' ||
                (g.location !== 'ALL' && (g.countries || []).includes(selectedLoc))
              )
            );
            const gblAutoIds = new Set(gblAutoGroups.map(g => g.id));

            const deptCurrentIds = new Set(deptCurrent.map(g => g.id));
            const allGblIds = new Set(deptAllConfig.filter(g => g.location === 'ALL').map(g => g.id));

            // Disponible = pas de departments configurés (non auto-assigné), pas GBL, pas déjà assigné ici
            const deptAvailLeft = deptResults.filter(g =>
              !deptCurrentIds.has(g.id) &&
              !allGblIds.has(g.id) &&
              !gblAutoIds.has(g.id) &&
              (g.departments || []).length === 0
            );
            const listStyle = { height: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' };
            const rowStyle  = (active) => ({ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: active ? 'rgba(37,99,235,.12)' : 'transparent', display: 'flex', alignItems: 'center', gap: 8, transition: 'background .1s', userSelect: 'none' });
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 52px 1fr', gap: 12, alignItems: 'start' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>DISPONIBLES · {deptAvailLeft.length}{deptSelLeft.size > 0 ? ` · ${deptSelLeft.size} sél.` : ''}</div>
                  <div style={listStyle}>
                    {deptSearching && <div style={{ padding: 20, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>}
                    {!deptSearching && deptAvailLeft.length === 0 && !deptSearch.trim() && <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Aucun groupe disponible</div>}
                    {!deptSearching && deptAvailLeft.map(g => {
                      const checked = deptSelLeft.has(g.id);
                      const toggle  = () => setDeptSelLeft(prev => { const n = new Set(prev); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; });
                      return (
                        <div key={g.id} onClick={toggle} style={rowStyle(checked)}>
                          <input type="checkbox" checked={checked} onChange={toggle} onClick={e => e.stopPropagation()} style={{ width: 15, height: 15, accentColor: 'var(--primary)', flexShrink: 0, cursor: 'pointer' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: 'var(--text)' }}>{g.displayName}</div>
                            {g.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{g.description}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, paddingTop: 44 }}>
                  <button type="button" onClick={deptAssign} disabled={!deptSelLeft.size} style={{ width: 40, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: deptSelLeft.size ? 'var(--primary)' : 'var(--surface2)', color: deptSelLeft.size ? '#fff' : 'var(--muted)', cursor: deptSelLeft.size ? 'pointer' : 'not-allowed', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>→</button>
                  <button type="button" onClick={deptUnassign} disabled={!deptSelRight} style={{ width: 40, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: deptSelRight ? 'rgba(239,68,68,.15)' : 'var(--surface2)', color: deptSelRight ? '#ef4444' : 'var(--muted)', cursor: deptSelRight ? 'pointer' : 'not-allowed', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>
                    {currentLoc?.flag} {selectedDept} — {currentLoc?.code} · {new Set([...gblAutoGroups.map(g => g.id), ...deptCurrent.map(g => g.id)]).size}
                  </div>
                  <div style={listStyle}>
                    {deptCurrent.length === 0 && gblAutoGroups.length === 0 && (
                      <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Aucun groupe pour {selectedDept} · {currentLoc?.code}</div>
                    )}
                    {(() => {
                      const autoIds = new Set(gblAutoGroups.map(g => g.id));
                      return [
                        ...gblAutoGroups.map(g => ({ id: g.id, name: g.name || g.id, isAuto: true, isGbl: g.location === 'ALL' })),
                        ...deptCurrent.filter(g => !autoIds.has(g.id)).map(g => ({ id: g.id, name: g.label, isAuto: false, isGbl: false })),
                      ];
                    })().map(g => (
                      <div key={g.isAuto ? `gbl-${g.id}` : g.id} style={{ ...rowStyle(false), cursor: 'default' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c3aed', flexShrink: 0 }} />
                        <div style={{ fontSize: 13, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                        {!g.isGbl && (
                          <button type="button"
                            onClick={async () => {
                              setDeptAssignments(a => ({ ...a, [selectedDept]: { ...a[selectedDept], [selectedLoc]: (a[selectedDept]?.[selectedLoc] || []).filter(x => x.id !== g.id) } }));
                              if (g.isAuto) await removeAutoGroup(g.id);
                            }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 16, padding: '0 4px', lineHeight: 1, opacity: 0.7 }}
                            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                            onMouseLeave={e => e.currentTarget.style.opacity = '0.7'}
                          >×</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        {deptSaved && <span style={{ fontSize: 12, color: 'var(--success)', alignSelf: 'center', marginRight: 12 }}>✓ Enregistré</span>}
        <button type="button" className="btn btn-primary" onClick={saveDepts} disabled={deptSaving} style={{ minWidth: 160, justifyContent: 'center' }}>
          {deptSaving ? 'Enregistrement...' : 'Appliquer Départements'}
        </button>
      </div>

    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

// ─── TabSchemas ───────────────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  {
    number: 1,
    key: null,
    icon: '👤',
    title: 'Création du compte Azure AD',
    description: 'Crée l\'utilisateur dans Azure Active Directory avec son email, prénom, nom et localisation.',
    required: true,
  },
  {
    number: 2,
    key: 'step2_group',
    icon: '👥',
    title: 'Ajout au groupe principal',
    description: 'Ajoute l\'employé au groupe Microsoft 365 sélectionné lors de l\'onboarding.',
    required: false,
  },
  {
    number: 3,
    key: 'step3_license',
    icon: '🔑',
    title: 'Assignation de la licence',
    description: 'Assigne la licence Microsoft 365 choisie. Réessaie automatiquement si Exchange n\'est pas encore prêt.',
    required: false,
    hasConfig: true,
  },
  {
    number: 4,
    key: 'step4_sp_groups',
    icon: '🌐',
    title: 'Ajout aux groupes SharePoint & Communication',
    description: 'Ajoute l\'employé à tous les groupes selon sa localisation, ses villes et son département.',
    required: false,
  },
];

function SchemaToggle({ enabled, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        width: 42, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
        background: enabled ? 'var(--primary)' : 'rgba(255,255,255,.15)',
        position: 'relative', flexShrink: 0, transition: 'background .2s',
      }}
    >
      <span style={{
        position: 'absolute', top: 3,
        left: enabled ? 21 : 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left .2s',
        display: 'block',
      }} />
    </button>
  );
}

function RetryDelaysEditor({ delays, onChange }) {
  const [input, setInput] = useState(delays.join(', '));
  const [err, setErr] = useState('');

  function commit(val) {
    const parts = val.split(',').map(s => s.trim()).filter(Boolean);
    const nums = parts.map(Number);
    if (nums.some(n => !Number.isInteger(n) || n < 1 || n > 600)) {
      setErr('Entiers entre 1 et 600 uniquement');
      return;
    }
    if (nums.length === 0 || nums.length > 10) {
      setErr('Entre 1 et 10 valeurs');
      return;
    }
    setErr('');
    onChange(nums);
  }

  return (
    <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(37,99,235,.05)', borderRadius: 8, border: '1px solid rgba(37,99,235,.15)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.4px' }}>
        Délais de retry Exchange (secondes)
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
        Séquence de délais en secondes avant chaque nouvelle tentative si Exchange n'est pas prêt. Ex : 15, 30, 60
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {delays.map((d, i) => (
          <span key={i} style={{ padding: '3px 10px', borderRadius: 12, background: 'rgba(37,99,235,.15)', color: 'var(--primary)', fontSize: 12, fontWeight: 600 }}>
            {d}s
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onBlur={e => commit(e.target.value)}
          placeholder="15, 30, 45, 60, 90"
          style={{ flex: 1, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}
        />
        <button type="button" onClick={() => commit(input)} className="btn" style={{ padding: '5px 12px', fontSize: 11 }}>Appliquer</button>
      </div>
      {err && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{err}</div>}
    </div>
  );
}

const NODE_COLORS = ['#2563eb', '#7c3aed', '#d97706', '#059669'];

const STEP_DETAILS = [
  [['Email', "Depuis le formulaire d'onboarding"], ['Prénom / Nom', 'Depuis le formulaire'], ['Localisation', 'Depuis le formulaire'], ['Mot de passe', 'Généré automatiquement']],
  [['Groupe cible', "Sélectionné lors de l'onboarding"], ['Source', 'Onglet Groupes → Globaux']],
  null,
  [['Groupes globaux', 'Tous les employés'], ['Groupes par pays', 'Selon la localisation'], ['Groupes par ville', 'Selon la ville sélectionnée'], ['Groupes communication', 'Selon le département']],
];

function TabSchemas() {
  const [schema, setSchema]             = useState(null);
  const [saving, setSaving]             = useState(false);
  const [saved, setSaved]               = useState(false);
  const [error, setError]               = useState('');
  const [selectedStep, setSelectedStep] = useState(null);

  useEffect(() => { api.get('/api/admin/schema').then(setSchema).catch(() => {}); }, []);

  function toggle(key) { setSchema(s => ({ ...s, [key]: { ...s[key], enabled: !s[key].enabled } })); }
  function setRetryDelays(d) { setSchema(s => ({ ...s, step3_license: { ...s.step3_license, retry_delays: d } })); }
  function handleSave() {
    setSaving(true); setError('');
    api.put('/api/admin/schema', schema)
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 2500); })
      .catch(e => setError(e.message || 'Erreur'))
      .finally(() => setSaving(false));
  }

  if (!schema) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><span className="spinner" /></div>;

  function isEnabled(i) {
    const s = PIPELINE_STEPS[i];
    return s.required || schema[s.key]?.enabled !== false;
  }

  // Canvas geometry
  const NW = 155, NH = 80, GAP = 68, PAD = 28, CH = 240;
  const NY = Math.floor((CH - NH) / 2);
  const PY = NY + NH / 2;
  const CW = PAD + PIPELINE_STEPS.length * NW + (PIPELINE_STEPS.length - 1) * GAP + PAD;
  function nx(i) { return PAD + i * (NW + GAP); }

  const sel      = PIPELINE_STEPS.find(s => s.number === selectedStep) ?? null;
  const selIdx   = sel ? PIPELINE_STEPS.indexOf(sel) : -1;
  const selOn    = selIdx >= 0 ? isEnabled(selIdx) : false;
  const selColor = sel ? NODE_COLORS[sel.number - 1] : '#2563eb';
  const selDets  = sel ? STEP_DETAILS[sel.number - 1] : null;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Pipeline d'onboarding</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Cliquez sur un nœud pour configurer l'étape</div>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn btn-primary" style={{ minWidth: 152, justifyContent: 'center' }}>
          {saved ? '✓ Enregistré' : saving ? 'Enregistrement...' : 'Enregistrer le schéma'}
        </button>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}

      {/* Workspace: grid — canvas colonne 1fr, panel colonne fixe */}
      <div style={{ display: 'grid', gridTemplateColumns: sel ? `1fr 380px` : '1fr', borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,.07)', background: '#0c1017', backgroundImage: 'radial-gradient(rgba(255,255,255,.11) 1px, transparent 1px)', backgroundSize: '22px 22px' }}>

        {/* Canvas */}
        <div style={{ overflowX: 'auto', minHeight: CH }}>
          <div
            onClick={e => { if (e.currentTarget === e.target) setSelectedStep(null); }}
            style={{ position: 'relative', width: CW, height: CH, userSelect: 'none' }}
          >

            {/* Hint when nothing selected */}
            {!sel && (
              <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,.18)', pointerEvents: 'none' }}>
                Cliquez sur un nœud pour ouvrir ses paramètres →
              </div>
            )}

            {/* SVG bezier connections */}
            <svg style={{ position: 'absolute', inset: 0, width: CW, height: CH, pointerEvents: 'none', overflow: 'visible' }}>
              <defs>
                <marker id="sc-arr-off" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0.5 L0,6.5 L6,3.5 z" fill="rgba(255,255,255,.15)" />
                </marker>
                <marker id="sc-arr-on" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0.5 L0,6.5 L6,3.5 z" fill="rgba(37,99,235,.85)" />
                </marker>
              </defs>
              {PIPELINE_STEPS.slice(0, -1).map((_, i) => {
                const x1 = nx(i) + NW + 5, x2 = nx(i + 1) - 5, cp = (x2 - x1) * 0.45;
                const on = isEnabled(i) && isEnabled(i + 1);
                return (
                  <path key={i}
                    d={`M ${x1} ${PY} C ${x1 + cp} ${PY}, ${x2 - cp} ${PY}, ${x2} ${PY}`}
                    stroke={on ? 'rgba(37,99,235,.5)' : 'rgba(255,255,255,.08)'}
                    strokeWidth={on ? 2.5 : 1.5} strokeDasharray={on ? 'none' : '5,4'}
                    fill="none" markerEnd={on ? 'url(#sc-arr-on)' : 'url(#sc-arr-off)'}
                  />
                );
              })}
            </svg>

            {/* Nodes */}
            {PIPELINE_STEPS.map((step, i) => {
              const enabled = isEnabled(i), color = NODE_COLORS[i], isSel = selectedStep === step.number;
              return (
                <div key={step.number}
                  onClick={e => { e.stopPropagation(); setSelectedStep(isSel ? null : step.number); }}
                  style={{
                    position: 'absolute', left: nx(i), top: NY, width: NW, height: NH,
                    background: isSel ? '#1c2540' : '#13191f',
                    border: `1.5px solid ${isSel ? color : 'rgba(255,255,255,.1)'}`,
                    borderRadius: 11, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 0 12px',
                    opacity: enabled ? 1 : 0.32, transition: 'all .15s',
                    boxShadow: isSel ? `0 0 0 3px ${color}30, 0 8px 28px rgba(0,0,0,.7)` : '0 2px 10px rgba(0,0,0,.5)',
                  }}
                >
                  {i > 0 && <div style={{ position: 'absolute', left: -6, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, borderRadius: '50%', background: '#0c1017', border: `2px solid ${enabled ? color : 'rgba(255,255,255,.18)'}`, zIndex: 1 }} />}
                  <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: enabled ? `${color}1e` : 'rgba(255,255,255,.04)', border: `1.5px solid ${enabled ? `${color}50` : 'rgba(255,255,255,.07)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, transition: 'all .2s' }}>
                    {step.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.25, marginBottom: 5, color: enabled ? '#dde4ef' : 'rgba(255,255,255,.25)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {step.title}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: enabled ? '#22c55e' : 'rgba(255,255,255,.16)', flexShrink: 0 }} />
                      <span style={{ fontSize: 10, fontWeight: 500, color: enabled ? '#22c55e' : 'rgba(255,255,255,.28)' }}>
                        {step.required ? 'Requis' : enabled ? 'Actif' : 'Inactif'}
                      </span>
                    </div>
                  </div>
                  {i < PIPELINE_STEPS.length - 1 && <div style={{ position: 'absolute', right: -6, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, borderRadius: '50%', background: '#0c1017', border: `2px solid ${enabled ? color : 'rgba(255,255,255,.18)'}`, zIndex: 1 }} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel — n8n-style, grid child, full natural height */}
        {sel && (
          <div style={{ background: '#111820', borderLeft: '1px solid rgba(255,255,255,.12)', display: 'flex', flexDirection: 'column' }}>

            {/* Panel header */}
            <div style={{ padding: '13px 13px 11px', borderBottom: '1px solid rgba(255,255,255,.07)', background: '#0e151e', display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: `${selColor}20`, border: `1.5px solid ${selColor}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                {sel.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#dde4ef', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sel.title}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.32)', marginTop: 2 }}>Étape {sel.number} / {PIPELINE_STEPS.length}</div>
              </div>
              <button onClick={() => setSelectedStep(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.3)', fontSize: 14, padding: '3px 5px', borderRadius: 4, lineHeight: 1, flexShrink: 0 }}>✕</button>
            </div>

            {/* Panel body */}
            <div style={{ flex: 1 }}>

              {/* GÉNÉRAL */}
              <div style={{ padding: '13px 13px 10px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.7px', textTransform: 'uppercase', color: 'rgba(255,255,255,.22)', marginBottom: 9 }}>Général</div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 11px', background: 'rgba(255,255,255,.04)', borderRadius: 8, border: '1px solid rgba(255,255,255,.07)', marginBottom: 9 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#c9d1d9', marginBottom: 2 }}>Statut</div>
                    <div style={{ fontSize: 10, color: selOn ? '#22c55e' : 'rgba(255,255,255,.28)' }}>
                      {sel.required ? 'Toujours exécutée' : selOn ? 'Sera exécutée' : 'Sera ignorée'}
                    </div>
                  </div>
                  {sel.required
                    ? <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: `${selColor}20`, color: selColor, letterSpacing: '.3px' }}>REQUIS</span>
                    : <SchemaToggle enabled={selOn} onChange={() => toggle(sel.key)} />
                  }
                </div>

                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.36)', lineHeight: 1.6, padding: '0 2px' }}>{sel.description}</div>
              </div>

              {/* PARAMÈTRES */}
              <div style={{ padding: '13px 13px 10px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.7px', textTransform: 'uppercase', color: 'rgba(255,255,255,.22)', marginBottom: 9 }}>Paramètres</div>

                {selDets && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {selDets.map(([label, value]) => (
                      <div key={label} style={{ padding: '7px 10px', background: 'rgba(255,255,255,.03)', borderRadius: 7, border: '1px solid rgba(255,255,255,.06)' }}>
                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,.28)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 3 }}>{label}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)' }}>{value}</div>
                      </div>
                    ))}
                  </div>
                )}

                {sel.number === 3 && (
                  selOn
                    ? <RetryDelaysEditor delays={schema.step3_license?.retry_delays || [15, 30, 45, 60, 90]} onChange={setRetryDelays} />
                    : <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,.03)', borderRadius: 7, border: '1px solid rgba(255,255,255,.06)', fontSize: 11, color: 'rgba(255,255,255,.28)', fontStyle: 'italic' }}>
                        Activez cette étape pour configurer les paramètres.
                      </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function TabIcon({ id }) {
  const paths = {
    users:      [['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'], 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    onboarding: [['M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2', 'M12 8L6.7 13.3c-1.1 1.1-1.1 2.9 0 4L12 22l10-10-4.7-4.7c-1.1-1.1-2.9-1.1-4 0L8 12', 'M22 2L13.4 10.6', 'M15 2H22V9']],
    api:        [['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'], ['M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71']],
    org:        [['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z']],
    pointage:   [['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z', 'M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z']],
    schema:     [['M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'], ['M18.375.375a2.121 2.121 0 1 1 3 3L12 12l-4 1 1-4z']],
  };
  const path = paths[id] || paths.org;
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path.flat().map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

const TABS = [
  { id: 'users',      label: 'Utilisateurs' },
  { id: 'onboarding', label: 'Onboarding'   },
  { id: 'api',        label: 'API'           },
  { id: 'org',        label: 'Groupes'       },
  { id: 'pointage',   label: 'Pointage'      },
  { id: 'schema',     label: 'Schémas'       },
];

const DEFAULT_LOCATIONS = [
  { code: 'FR',  name: 'France',         flag: '🇫🇷' },
  { code: 'MDG', name: 'Madagascar',      flag: '🇲🇬' },
  { code: 'US',  name: 'United States',   flag: '🇺🇸' },
  { code: 'SG',  name: 'Singapore',       flag: '🇸🇬' },
  { code: 'LUX', name: 'Luxembourg',      flag: '🇱🇺' },
  { code: 'IND', name: 'India',           flag: '🇮🇳' },
  { code: 'CA',  name: 'Canada',          flag: '🇨🇦' },
];

// ─── Admin page ───────────────────────────────────────────────────────────────

export default function Admin() {
  const { user: me } = useUser();
  const [activeTab, setActiveTab] = useState('users');
  const [locations, setLocations] = useState(DEFAULT_LOCATIONS);

  useEffect(() => {
    api.get('/api/admin/settings').then(data => {
      if (Array.isArray(data.locations) && data.locations.length > 0) setLocations(data.locations);
    }).catch(() => {});
  }, []);

  return (
    <div>
      {/* Hero header */}
      <div style={{ marginBottom: 22, position: 'relative' }}>
        <div aria-hidden="true" style={{
          position: 'absolute', top: -24, left: '5%', width: 300, height: 100,
          background: 'radial-gradient(ellipse, rgba(245,158,11,.08) 0%, transparent 70%)',
          pointerEvents: 'none', filter: 'blur(20px)',
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8,
            padding: '3px 10px', borderRadius: 999,
            border: '1px solid rgba(245,158,11,.2)', background: 'rgba(245,158,11,.06)',
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span style={{ fontSize: 11, color: 'rgba(245,158,11,.7)', fontWeight: 500, letterSpacing: '.3px' }}>Administration</span>
          </div>
          <h1 style={{
            fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em',
            background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            Administration
          </h1>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: activeTab === tab.id ? 'rgba(79,70,229,.08)' : 'transparent',
              border: 'none',
              borderBottom: `2px solid ${activeTab === tab.id ? 'var(--primary)' : 'transparent'}`,
              padding: '9px 16px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--text)' : 'var(--muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: -1,
              borderRadius: '6px 6px 0 0',
              transition: 'color .15s, background .15s',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => { if (activeTab !== tab.id) { e.currentTarget.style.color = 'var(--text2)'; e.currentTarget.style.background = 'rgba(255,255,255,.03)'; } }}
            onMouseLeave={e => { if (activeTab !== tab.id) { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.background = 'transparent'; } }}
            onFocus={e => { e.currentTarget.style.outline = '2px solid var(--primary)'; e.currentTarget.style.outlineOffset = '-2px'; }}
            onBlur={e => { e.currentTarget.style.outline = 'none'; }}
          >
            <TabIcon id={tab.id} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'users'      && <TabUsers me={me} />}
      {activeTab === 'onboarding' && <TabOnboarding />}
      {activeTab === 'api'        && <TabAPI />}
      {activeTab === 'org'        && <TabOrg locations={locations} onLocationsChange={setLocations} />}
      {activeTab === 'pointage'   && <TabPointage locations={locations} onLocationsChange={setLocations} />}
      {activeTab === 'schema'     && <TabSchemas />}
    </div>
  );
}
