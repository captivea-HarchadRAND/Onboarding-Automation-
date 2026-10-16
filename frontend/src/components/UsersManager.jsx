// [EN-TÊTE] UsersManager.jsx — gestion des utilisateurs et de leurs accès aux modules (affiché par PortalAdmin, SUPER ADMIN seulement).
// Tableau : une case par module (enregistrée tout de suite via PUT /api/admin/users/:id/modules, annulée si le serveur refuse),
// création (nom, email, rôle, modules, mot de passe de secours facultatif), modification, mot de passe, désactivation, suppression.
// Un compte sans mot de passe est actif immédiatement et se connecte par Microsoft. La ligne d'un super admin est verrouillée.

import { useEffect, useMemo, useRef, useState } from 'react';
import Select from './Select';
import { api } from '../api';
import { MODULES } from '../modules';

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  const box = useRef(null);
  // Échap ferme ; le focus passe au premier champ à l'ouverture
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    box.current?.querySelector('input:not([type=checkbox]), button.select-btn')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div ref={box} className="card" style={{ width: '100%', maxWidth: 460, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h2>
          <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const EMPTY_FORM = { name: '', email: '', role: 'operator', password: '', modules: ['onboarding'] };
const SEARCH = 'M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0';

// Gestion des utilisateurs de la plateforme et de leur accès aux modules du portail.
export default function UsersManager({ me }) {
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(null);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [pwdForm, setPwdForm]   = useState({ password: '' });
  const [error, setError]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [search, setSearch]     = useState('');
  const [busyMod, setBusyMod]   = useState({}); // id → true pendant l'enregistrement d'un accès
  const [notice, setNotice]     = useState(null);

  function load() {
    api.get('/api/admin/users').then(data => { setUsers(data); setLoading(false); }).catch(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  function openCreate() { setForm(EMPTY_FORM); setError(''); setModal('create'); }
  function openEdit(u)  { setForm({ name: u.name, email: u.email, role: u.role, status: u.status }); setError(''); setModal({ type: 'edit', user: u }); }
  function openPwd(u)   { setPwdForm({ password: '' }); setError(''); setModal({ type: 'pwd', user: u }); }

  async function handleCreate(e) {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      await api.post('/api/admin/users', {
        name: form.name, email: form.email, role: form.role, password: form.password || undefined,
        ...(form.role === 'admin' ? {} : { modules: form.modules }),
      });
      setModal(null);
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

  async function unlinkMicrosoft(u) {
    if (!confirm(`Délier le compte Microsoft de ${u.name} ? Sa prochaine connexion Microsoft avec ${u.email} le reliera de nouveau.`)) return;
    try { await api.delete(`/api/admin/users/${u.id}/microsoft-link`); setModal(null); load(); }
    catch (err) { alert(err.message); }
  }

  async function handleDelete(u) {
    if (!confirm(`Supprimer définitivement ${u.name} ?`)) return;
    try { await api.delete(`/api/admin/users/${u.id}`); load(); }
    catch (err) { alert(err.message); }
  }

  // Accès à un module : enregistré tout de suite, annulé si le serveur refuse.
  async function toggleModule(u, moduleId) {
    const had = u.modules.includes(moduleId);
    const next = had ? u.modules.filter(m => m !== moduleId) : [...u.modules, moduleId];
    const label = MODULES.find(m => m.id === moduleId)?.label || moduleId;
    setUsers(list => list.map(x => (x.id === u.id ? { ...x, modules: next } : x)));
    setBusyMod(b => ({ ...b, [u.id]: true }));
    setNotice(null);
    try {
      await api.put(`/api/admin/users/${u.id}/modules`, { modules: next });
      setNotice({ ok: true, text: `${u.name} : accès ${label} ${had ? 'retiré' : 'accordé'}.` });
    } catch (e) {
      setUsers(list => list.map(x => (x.id === u.id ? { ...x, modules: u.modules } : x)));
      setNotice({ ok: false, text: `${u.name} : modification impossible (${e.message}).` });
    } finally {
      setBusyMod(b => ({ ...b, [u.id]: false }));
    }
  }

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => users.filter(u => !q || `${u.name} ${u.email}`.toLowerCase().includes(q)), [users, q]);
  const count = id => users.filter(u => u.status === 'active' && u.modules.includes(id)).length;

  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Utilisateurs de la plateforme</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {users.length} utilisateur{users.length > 1 ? 's' : ''} · {MODULES.map(m => `${m.label} : ${count(m.id)}`).join(' · ')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: 240, maxWidth: '100%' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', pointerEvents: 'none' }}><path d={SEARCH} /></svg>
              <input aria-label="Rechercher un utilisateur" placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
            </div>
            <button className="btn btn-primary" onClick={openCreate}>+ Ajouter un utilisateur</button>
          </div>
        </div>

        <div aria-live="polite" role="status" style={{ minHeight: notice ? 28 : 0, padding: notice ? '6px 20px 0' : 0, fontSize: 12, fontWeight: 600, color: notice?.ok === false ? 'var(--danger)' : 'var(--success)' }}>
          {notice?.text}
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" /></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Utilisateur</th><th>Rôle</th><th>Statut</th>
                  {MODULES.map(m => <th key={m.id} style={{ textAlign: 'center' }} title={`Accès au module ${m.label}`}>{m.label}</th>)}
                  <th>Créé le</th><th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(u => {
                  const isAdmin = u.role === 'admin';
                  // Un super administrateur a toujours accès à tout (non modifiable).
                  const locked = !!u.superAdmin;
                  const lockWhy = locked ? 'Super administrateur : accès à tout' : undefined;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight: 500, color: 'var(--text)' }}>
                          {u.name}
                          {u.id === me?.id && <span style={{ fontSize: 11, color: 'var(--primary)', marginLeft: 6 }}>(moi)</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.email}</div>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, fontWeight: 600, color: isAdmin ? 'var(--warning)' : 'var(--muted)' }}>
                          {u.superAdmin ? 'Super administrateur' : isAdmin ? 'Administrateur' : 'Opérateur'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${u.status === 'active' ? 'badge-done' : u.status === 'pending' ? 'badge-pending' : 'badge-failed'}`}>
                          {u.status === 'active' ? 'Actif' : u.status === 'pending' ? 'En attente' : 'Désactivé'}
                        </span>
                      </td>
                      {MODULES.map(m => (
                        <td key={m.id} style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox" checked={u.modules.includes(m.id)} disabled={locked || !!busyMod[u.id]}
                            onChange={() => toggleModule(u, m.id)}
                            aria-label={`Accès ${m.label} pour ${u.name}${lockWhy ? ` (${lockWhy})` : ''}`}
                            title={lockWhy}
                          />
                        </td>
                      ))}
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
                  );
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={5 + MODULES.length} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>Aucun utilisateur ne correspond.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, padding: '10px 20px', borderTop: '1px solid var(--border)', lineHeight: 1.6 }}>
          Les cases règlent l'accès de chaque utilisateur aux modules du portail ; le changement est immédiat, sans reconnexion.
          Un administrateur a accès à tout tant que tu ne l'as pas restreint ; un super administrateur a toujours accès à tout.
          Un utilisateur sans module ne voit que la page d'accueil du portail.
        </p>
      </div>

      {/* Modal: Create */}
      {modal === 'create' && (
        <Modal title="Ajouter un utilisateur" onClose={() => setModal(null)}>
        <form onSubmit={handleCreate}>
          {error && <div className="error-box" role="alert">{error}</div>}
          <div className="form-group"><label>Nom</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required autoComplete="off" /></div>
          <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required autoComplete="off" /></div>
          <div className="form-group">
            <label>Rôle</label>
            <Select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="operator">Opérateur</option>
              <option value="admin">Administrateur</option>
            </Select>
          </div>
          <fieldset className="form-group" style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
            <legend style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 8, padding: 0 }}>Accès aux modules</legend>
            {form.role === 'admin' ? (
              <p className="field-hint" style={{ marginTop: 0 }}>Un administrateur a accès à tous les modules.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {MODULES.map(m => {
                  const on = form.modules.includes(m.id);
                  return (
                    <label key={m.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12, margin: 0, padding: '12px 14px', minHeight: 44, cursor: 'pointer',
                      borderRadius: 10, border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
                      background: on ? 'var(--primary-soft)' : 'transparent', fontWeight: 400, transition: 'background var(--transition), border-color var(--transition)',
                    }}>
                      <input
                        type="checkbox" checked={on} style={{ marginTop: 2 }}
                        onChange={e => setForm(f => ({ ...f, modules: e.target.checked ? [...f.modules, m.id] : f.modules.filter(x => x !== m.id) }))}
                      />
                      <span>
                        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{m.label}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginTop: 2 }}>{m.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {form.role !== 'admin' && form.modules.length === 0 && (
              <p className="field-hint" style={{ color: 'var(--warning)' }}>Sans module, l'utilisateur ne verra que la page d'accueil du portail.</p>
            )}
          </fieldset>
          <div className="form-group">
            <label htmlFor="new-user-password">Mot de passe de secours <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(facultatif)</span></label>
            <input id="new-user-password" type="password" autoComplete="new-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            <p className="field-hint">Utile seulement pour l'accès de secours d'un administrateur (/login/backup). Les comptes se connectent avec Microsoft.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Création...' : 'Créer'}</button>
          </div>
        </form>
        </Modal>
      )}

      {/* Modal: Edit */}
      {modal?.type === 'edit' && (
        <Modal title="Modifier l'utilisateur" onClose={() => setModal(null)}>
          <form onSubmit={handleEdit}>
            {error && <div className="error-box" role="alert">{error}</div>}
            <div className="form-group"><label>Nom</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="form-group">
              <label>Rôle</label>
              <Select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="operator">Opérateur</option>
                <option value="admin">Administrateur</option>
              </Select>
            </div>
            <div className="form-group">
              <label>Statut</label>
              <Select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="active">Actif</option>
                <option value="pending">En attente</option>
                <option value="disabled">Désactivé</option>
              </Select>
            </div>
            <div className="form-group">
              <label>Compte Microsoft</label>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {modal.user.microsoftLinked ? 'Relié à son compte Microsoft (première connexion faite).' : 'Pas encore relié : il le sera à sa première connexion Microsoft.'}
                </span>
                {modal.user.microsoftLinked && (
                  <button type="button" className="btn btn-ghost" onClick={() => unlinkMicrosoft(modal.user)}>Délier</button>
                )}
              </div>
              <p className="field-hint">Changer l'email délie aussi le compte Microsoft.</p>
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
            {error && <div className="error-box" role="alert">{error}</div>}
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
