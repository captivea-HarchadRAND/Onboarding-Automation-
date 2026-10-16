// [EN-TÊTE] LoginSSO.jsx — page de connexion normale (/login) : un bouton vers /api/auth/microsoft/login (navigation complète, pas
// un appel XHR). Affiche l'erreur renvoyée par le serveur dans ?error=… (unauthorized, disabled, refused, invalid, failed, config, guest, mismatch).

import { useSearchParams } from 'react-router-dom';

// Page de connexion : Microsoft est la seule voie normale. Le mot de passe (accès de secours des
// administrateurs) est sur /login/backup et n'est volontairement pas lié depuis cette page.
const ERRORS = {
  unauthorized: "Ton compte Microsoft n'a pas accès à cette application. Demande à un administrateur de créer ton accès.",
  disabled: 'Ton compte est désactivé. Contacte un administrateur.',
  refused: 'La connexion a été annulée ou refusée par Microsoft.',
  invalid: 'La demande de connexion est invalide ou a expiré. Réessaie.',
  failed: 'La connexion Microsoft a échoué. Réessaie dans un instant.',
  config: "La connexion Microsoft n'est pas configurée sur ce serveur. Contacte un administrateur.",
  guest: "Les comptes invités (externes à Captivea) ne peuvent pas se connecter. Utilise ton compte Microsoft Captivea.",
  mismatch: "Cet accès est déjà relié à un autre compte Microsoft. Contacte un administrateur.",
};

function MicrosoftLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true" style={{ flex: 'none' }}>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function LoginSSO() {
  const [params] = useSearchParams();
  const errorCode = params.get('error');
  const message = errorCode ? (ERRORS[errorCode] || ERRORS.failed) : '';

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'radial-gradient(ellipse at 50% 0%, rgba(79,70,229,.14) 0%, transparent 60%), var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.03em', lineHeight: 1.2 }}>
          Onboarding M365
        </h1>

        <div className="card" style={{ padding: 28 }}>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.6 }}>
            Connecte-toi avec ton compte Microsoft Captivea pour accéder au portail.
          </p>

          {message && <div className="error-box" role="alert">{message}</div>}

          <a
            href="/api/auth/microsoft/login"
            className="sso-btn"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, width: '100%', minHeight: 44,
              padding: '10px 16px', borderRadius: 8, border: '1px solid #8c8c8c', background: '#2f2f2f',
              color: '#ffffff', fontSize: 14, fontWeight: 600, textDecoration: 'none', transition: 'background var(--transition), border-color var(--transition)',
            }}
          >
            <MicrosoftLogo />
            Se connecter avec Microsoft
          </a>

          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '16px 0 0', lineHeight: 1.6 }}>
            L'accès est réservé aux comptes déjà créés dans l'application. La double authentification est gérée par Microsoft.
          </p>
        </div>
      </div>
    </main>
  );
}
