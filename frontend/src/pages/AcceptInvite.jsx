import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useUser } from '../context/UserContext';

export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { setUser } = useUser();
  const [inviteUser, setInviteUser] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get(`/api/auth/invite/${token}`)
      .then(data => { setInviteUser(data.user); setLoading(false); })
      .catch(() => { setError('Invitation invalide ou expirée.'); setLoading(false); });
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas.'); return; }
    setError(''); setSubmitting(true);
    try {
      const data = await api.post(`/api/auth/invite/${token}`, { password });
      setUser(data.user);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', marginTop: 80 }}><span className="spinner" /></div>;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, background: 'var(--primary)', borderRadius: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 14 }}>🚀</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Créer mon compte</h1>
          {inviteUser && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Bienvenue, {inviteUser.name}</p>}
        </div>
        <div className="card">
          {error && <div className="error-box">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Mot de passe</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="12 caractères min." required />
            </div>
            <div className="form-group">
              <label>Confirmer</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Répétez le mot de passe" required />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={submitting}>
              {submitting ? 'Activation...' : 'Activer mon compte →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
