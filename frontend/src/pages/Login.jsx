import { useState } from 'react';
import { useUser } from '../context/UserContext';
import { api } from '../api';

const EyeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
);
const EyeOffIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

/* ── CSS ─────────────────────────────────────────────────────────────────── */
const CSS = `
.fp { transform-box: fill-box; transform-origin: 50% 0%; }

@keyframes fl1 {
  0%,100%{ transform:scaleX(1)    scaleY(1);   opacity:.92; }
  33%    { transform:scaleX(.80)  scaleY(1.18);opacity:1;   }
  66%    { transform:scaleX(1.14) scaleY(.86); opacity:.85; }
}
@keyframes fl2 {
  0%,100%{ transform:scaleX(1.08) scaleY(.90);opacity:.88; }
  42%    { transform:scaleX(.84)  scaleY(1.20);opacity:1;   }
  72%    { transform:scaleX(1.16) scaleY(.82); opacity:.90; }
}
@keyframes fl3 {
  0%,100%{ transform:scaleX(.92) scaleY(1.08);opacity:.90; }
  52%    { transform:scaleX(1.12) scaleY(.86); opacity:.82; }
}

/* smoke clouds — billow outward from nozzle */
@keyframes cloudL {
  0%,100%{ transform:translate(0,0)       scale(1);    opacity:.72; }
  50%    { transform:translate(-14px,5px)  scale(1.10); opacity:.95; }
}
@keyframes cloudR {
  0%,100%{ transform:translate(0,0)      scale(1);    opacity:.68; }
  50%    { transform:translate(14px,5px)  scale(1.11); opacity:.92; }
}

@keyframes sw { 0%,100%{transform:rotate(0deg)}  25%{transform:rotate(.4deg)}  75%{transform:rotate(-.4deg)} }
@keyframes sh { 0%,100%{transform:rotate(0deg) translateY(0)} 20%{transform:rotate(.8deg) translateY(-2px)} 65%{transform:rotate(-.8deg) translateY(2px)} }

/* ── Login form overrides (Pro Max) ── */
.lg-label {
  display: block; font-size: 13px; font-weight: 600;
  color: var(--text2); margin-bottom: 7px;
  text-transform: none; letter-spacing: 0;
}
.lg-input {
  height: 48px !important; padding: 0 14px !important;
  font-size: 14px !important; border-radius: 8px !important;
  transition: border-color .15s, box-shadow .15s !important;
}
.lg-input:focus {
  border-color: var(--primary) !important;
  box-shadow: 0 0 0 3px var(--primary-glow) !important;
}
.lg-input-pw { padding-right: 46px !important; }
.lg-btn {
  height: 48px; font-size: 15px !important; font-weight: 700 !important;
  letter-spacing: .01em; border-radius: 10px !important;
  transition: background .15s, transform .1s, box-shadow .15s !important;
}
.lg-btn:hover:not(:disabled) {
  box-shadow: 0 4px 20px rgba(79,70,229,.4) !important;
}
.lg-btn:active:not(:disabled) { transform: scale(.98) !important; }
.lg-eye {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer;
  color: var(--muted); padding: 6px; display: flex;
  align-items: center; border-radius: 4px; line-height: 0;
}
.lg-eye:hover { color: var(--text2); }
.lg-eye:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

@keyframes cdPop {
  0%   { transform: scale(.2); opacity: 0; }
  70%  { transform: scale(1.18); }
  100% { transform: scale(1);   opacity: 1; }
}
@keyframes cdFadeIn {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .fp { animation: none !important; }
  .lg-btn, .lg-input { transition: none !important; }
}

/* error — rocket chokes, sputters */
@keyframes choke {
  0%,100%{ transform:translate(0,0)     rotate(0deg);  }
  8%     { transform:translate(-6px,1px) rotate(-4deg); }
  16%    { transform:translate(5px,-1px) rotate(4deg);  }
  24%    { transform:translate(-7px,2px) rotate(-5deg); }
  34%    { transform:translate(7px,0)    rotate(5deg);  }
  44%    { transform:translate(-5px,2px) rotate(-4deg); }
  54%    { transform:translate(6px,-1px) rotate(3deg);  }
  64%    { transform:translate(-4px,1px) rotate(-2deg); }
  76%    { transform:translate(3px,0)    rotate(2deg);  }
  88%    { transform:translate(-1px,0)   rotate(-1deg); }
}
@keyframes sputter {
  0%   { transform:scaleY(1.9); opacity:1;  }
  10%  { transform:scaleY(.15); opacity:.2; }
  22%  { transform:scaleY(1.5); opacity:.8; }
  35%  { transform:scaleY(.08); opacity:.15;}
  48%  { transform:scaleY(1.1); opacity:.6; }
  62%  { transform:scaleY(.25); opacity:.3; }
  78%  { transform:scaleY(.5);  opacity:.4; }
  100% { transform:scaleY(.1);  opacity:.1; }
}

/* success — rocket launches */
@keyframes launch {
  0%   { transform:translateY(0)      opacity:1; }
  12%  { transform:translateY(28px);  opacity:1; }   /* s'enfonce */
  20%  { transform:translateY(24px);  opacity:1; }   /* tremble sur place */
  28%  { transform:translateY(30px);  opacity:1; }   /* vibre */
  36%  { transform:translateY(22px);  opacity:1; }   /* vibre */
  44%  { transform:translateY(28px);  opacity:1; }   /* vibre */
  52%  { transform:translateY(0);     opacity:1; }   /* départ */
  70%  { transform:translateY(-400px); opacity:1; }  /* monte */
  85%  { transform:translateY(-900px); opacity:.6; } /* sort de l'écran */
  100% { transform:translateY(-1400px);opacity:0; }  /* disparu */
}
`;

/* ── Rocket SVG ────────────────────────────────────────────────────────────── */
function RocketSVG() {
  return (
    <svg viewBox="0 0 180 252" width="220" height="308"
      style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <clipPath id="bodyClip">
          <path d="M90,10 C55,10 27,58 27,145 C27,196 54,228 90,230 C126,228 153,196 153,145 C153,58 125,10 90,10 Z"/>
        </clipPath>
      </defs>

      {/* Left fin (red) */}
      <path d="M32,178 Q8,202 4,232 L46,232 L55,196 Z"   fill="#E31E24"/>
      {/* Right fin (orange) */}
      <path d="M148,178 Q172,202 176,232 L134,232 L125,196 Z" fill="#F26522"/>

      {/* Nozzle */}
      <rect x="83" y="228" width="14" height="22" rx="5" fill="#F7941D"/>

      {/* Body – left half (orange) */}
      <path d="M90,10 C55,10 27,58 27,145 C27,196 54,228 90,230 L90,10 Z" fill="#F7941D"/>
      {/* Body – right half (yellow) */}
      <path d="M90,10 C125,10 153,58 153,145 C153,196 126,228 90,230 L90,10 Z" fill="#FBB03B"/>

      {/* Nose tip (red) */}
      <path d="M90,10 Q68,14 62,50 Q76,42 90,39 Q104,42 118,50 Q112,14 90,10 Z" fill="#E31E24"/>
      {/* Nose left shade */}
      <path d="M90,10 Q68,14 62,50 Q76,42 90,39 L90,10 Z" fill="#C81018"/>

      {/* Porthole outer (gray) */}
      <circle cx="86" cy="122" r="26" fill="#5B6472"/>
      {/* Porthole inner (cyan) */}
      <circle cx="86" cy="122" r="19" fill="#5DC8E8"/>
      {/* Porthole highlight */}
      <path d="M86,103 C70,103 67,113 67,122 C67,131 71,139 78,142 C74,136 71,129 71,122 C71,115 74,107 80,103 Z"
        fill="rgba(255,255,255,.35)"/>
    </svg>
  );
}

/* ── Flames ───────────────────────────────────────────────────────────────── */
function Flames() {
  return (
    <svg viewBox="0 0 80 80" width="80" height="80"
      style={{ display: 'block', overflow: 'visible' }}>
      <path className="fp" d="M20,0 L30,0 Q38,26 22,74 Q6,40 20,0 Z"   fill="#ff5500" style={{ animation:'fl2 .43s ease-in-out infinite' }}/>
      <path className="fp" d="M50,0 L60,0 Q74,40 58,74 Q42,26 50,0 Z"   fill="#ff5500" style={{ animation:'fl3 .40s ease-in-out infinite' }}/>
      <path className="fp" d="M24,0 L56,0 Q68,30 40,78 Q12,30 24,0 Z"   fill="#ff8c00" style={{ animation:'fl1 .35s ease-in-out infinite' }}/>
      <path className="fp" d="M28,0 L52,0 Q60,28 40,72 Q20,28 28,0 Z"   fill="#ffcc00" style={{ animation:'fl2 .27s ease-in-out infinite reverse' }}/>
      <path className="fp" d="M33,0 L47,0 Q52,22 40,62 Q28,22 33,0 Z"   fill="#fff5cc" style={{ animation:'fl1 .20s ease-in-out infinite' }}/>
    </svg>
  );
}

/* ── Smoke clouds ─────────────────────────────────────────────────────────── */
/*
  Cloud path: 3 bumps on top, flat bottom, drawn with Q bezier curves.
  Left cloud spans x=-85 → x=-10, right cloud is the mirror.
*/
const CLOUD_L = "M -70,44 Q -86,44 -86,28 Q -86,10 -68,13 Q -68,0 -52,0 Q -42,-5 -34,7 Q -26,1 -18,13 Q -8,12 -10,28 Q -10,44 -26,44 Z";
const CLOUD_R = "M 70,44 Q 86,44 86,28 Q 86,10 68,13 Q 68,0 52,0 Q 42,-5 34,7 Q 26,1 18,13 Q 8,12 10,28 Q 10,44 26,44 Z";

function Smoke({ visible }) {
  return (
    <div style={{
      position: 'absolute',
      top: 0, left: 0,
      transform: 'translateX(-50%)',
      opacity: visible ? 1 : 0,
      transition: 'opacity .6s ease',
      pointerEvents: 'none',
    }}>
      <svg viewBox="-90 -8 180 58" width="300" height="97"
        style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <filter id="cloudBlur">
            <feGaussianBlur stdDeviation="1.2"/>
          </filter>
        </defs>

        {/* Left cloud */}
        <g style={{ transformBox:'fill-box', transformOrigin:'50% 50%', animation:'cloudL 2.2s ease-in-out infinite' }}>
          <path d={CLOUD_L} fill="rgba(205,218,228,.78)" filter="url(#cloudBlur)"/>
          <path d={CLOUD_L} fill="rgba(230,240,248,.45)" style={{ transform:'scale(.78) translate(-4px,-2px)' }}/>
        </g>

        {/* Right cloud */}
        <g style={{ transformBox:'fill-box', transformOrigin:'50% 50%', animation:'cloudR 2.6s ease-in-out infinite' }}>
          <path d={CLOUD_R} fill="rgba(205,218,228,.78)" filter="url(#cloudBlur)"/>
          <path d={CLOUD_R} fill="rgba(230,240,248,.45)" style={{ transform:'scale(.78) translate(4px,-2px)' }}/>
        </g>
      </svg>
    </div>
  );
}

/* ── Login page ───────────────────────────────────────────────────────────── */
export default function Login() {
  const { setUser } = useUser();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [focused,  setFocused]  = useState(null);
  const [error,       setError]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [status,      setStatus]      = useState(null);
  const [showPassword, setShowPassword] = useState(false); // null | 'error' | 'success'
  const [countdown, setCountdown] = useState(null);
  const [requires2fa, setRequires2fa] = useState(false);
  const [otpCode,     setOtpCode]     = useState('');

  const phase = (password.length > 0 || focused === 'password') ? 'hot'
              : email.length > 0 ? 'warm'
              : 'idle';

  const NOZZLE_Y = 279;
  const CENTER_X = 110;
  const FLAME_W  = 80;
  const flameLeft = CENTER_X - FLAME_W / 2;

  // Rocket container animation
  const rocketAnim = status === 'success' ? 'launch 2.8s linear forwards'
                   : status === 'error'   ? 'choke 1.1s ease-in-out'
                   : phase === 'hot'      ? 'sh .14s ease-in-out infinite'
                   : phase === 'warm'     ? 'sw .28s ease-in-out infinite'
                   : 'none';

  // Flame container style
  const flameStyle = status === 'success'
    ? { transform: 'scaleY(3)', opacity: 1, transition: 'transform .2s ease' }
    : status === 'error'
    ? { animation: 'sputter 1.1s ease-in-out forwards', opacity: 1 }
    : {
        transform: `scaleY(${phase === 'hot' ? 1.9 : phase === 'warm' ? 1 : 0})`,
        opacity: phase === 'idle' ? 0 : 1,
        transition: 'transform .55s cubic-bezier(.4,0,.2,1), opacity .38s ease',
      };

  function startSuccess(user) {
    setStatus('success');
    setCountdown(3);
    let n = 3;
    const tick = setInterval(() => {
      n -= 1;
      setCountdown(n);
      if (n <= 0) {
        clearInterval(tick);
        setTimeout(() => setUser(user), 1350);
      }
    }, 485);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setStatus(null);
    try {
      const data = await api.post('/api/auth/login', { email, password });
      if (data.requires2fa) {
        setRequires2fa(true);
        setLoading(false);
        return;
      }
      startSuccess(data.user);
    } catch (err) {
      setStatus('error');
      setError(err.message);
      setTimeout(() => setStatus(null), 1200);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify2fa(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.post('/api/auth/verify-2fa', { email, code: otpCode });
      startSuccess(data.user);
    } catch (err) {
      setStatus('error');
      setError(err.message);
      setTimeout(() => setStatus(null), 1200);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <style>{CSS}</style>

      {/* ── Centered row: rocket + form ── */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: 56,
        width: '100%',
        maxWidth: 940,
      }}>

        {/* ── Rocket column ── */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>

          {/* Static wrapper — smoke stays here while rocket flies */}
          <div style={{ position: 'relative', width: 220, height: 308 + 52, overflow: 'visible' }}>

            {/* Mât de lancement — du sol jusqu'au titre */}
            <div style={{
              position: 'absolute',
              left: 108,   /* center x=110 - half width */
              bottom: 16,  /* ground line level */
              top: -30,    /* dépasse au-dessus du wrapper jusqu'au titre */
              width: 4,
              borderRadius: 2,
              background: 'linear-gradient(to bottom, transparent 0%, #334155 20%, #475569 100%)',
              zIndex: 0,
            }}/>

            {/* Rocket + flames — animated on launch */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: 220, height: 308, animation: rocketAnim }}>
              {/* Flames */}
              <div style={{
                position: 'absolute', top: NOZZLE_Y, left: flameLeft,
                transformOrigin: `${FLAME_W / 2}px 0px`,
                pointerEvents: 'none', zIndex: 1,
                ...flameStyle,
              }}>
                <Flames />
              </div>
              {/* Rocket */}
              <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                <RocketSVG />
              </div>
            </div>

            {/* Smoke — OUTSIDE the animated div, reste au sol pendant le vol */}
            <div style={{ position: 'absolute', top: NOZZLE_Y, left: CENTER_X, zIndex: 3 }}>
              <Smoke visible={phase !== 'idle' || status === 'error' || status === 'success'} />
            </div>

            {/* Ground / launch pad */}
            <div style={{ position: 'absolute', top: 308, left: 0, width: 220 }}>
              <svg viewBox="0 0 220 52" width="220" height="52" style={{ display: 'block', overflow: 'visible' }}>
                {/* Platform top */}
                <rect x="55" y="0" width="110" height="10" rx="3" fill="#1e293b"/>
                <rect x="65" y="2" width="90"  height="6"  rx="2" fill="#334155"/>
                {/* Legs */}
                <rect x="72"  y="10" width="8" height="20" fill="#1e293b"/>
                <rect x="140" y="10" width="8" height="20" fill="#1e293b"/>
                {/* Feet */}
                <rect x="62"  y="30" width="28" height="6" rx="2" fill="#334155"/>
                <rect x="130" y="30" width="28" height="6" rx="2" fill="#334155"/>
                {/* Ground line */}
                <rect x="0" y="36" width="220" height="3" rx="1" fill="#1e293b"/>
                {/* Ground texture ticks */}
                {[10,30,50,70,90,110,130,150,170,190,210].map(x => (
                  <rect key={x} x={x} y="39" width="2" height="6" rx="1" fill="#1e293b"/>
                ))}
              </svg>
            </div>
          </div>

        </div>

        {/* ── Form column ── */}
        <div style={{
          width: 380, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>

          {/* Countdown overlay — remplace le formulaire après login réussi */}
          {status === 'success' && countdown !== null && (
            <div style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 20, minHeight: 260,
              animation: 'cdFadeIn .35s ease forwards',
            }}>
              <div key={countdown} style={{
                width: 140, height: 140, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: countdown === 0 ? 'rgba(34,197,94,.15)' : 'rgba(79,70,229,.12)',
                border: `3px solid ${countdown === 0 ? 'rgba(34,197,94,.6)' : 'rgba(79,70,229,.5)'}`,
                boxShadow: countdown === 0 ? '0 0 64px rgba(34,197,94,.4)' : '0 0 64px rgba(79,70,229,.35)',
                fontSize: countdown === 0 ? 32 : 68,
                fontWeight: 800,
                color: countdown === 0 ? '#22c55e' : 'var(--text)',
                letterSpacing: '-3px',
                animation: 'cdPop .45s cubic-bezier(.175,.885,.32,1.275)',
              }}>
                {countdown === 0 ? 'Go !' : countdown}
              </div>
              <div style={{ fontSize: 15, color: 'var(--muted)', fontWeight: 500, letterSpacing: '.01em' }}>
                {countdown === 0 ? 'Accès accordé…' : 'Connexion en cours…'}
              </div>
            </div>
          )}
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.03em', lineHeight: 1.2, display: status === 'success' ? 'none' : undefined }}>
            Onboarding M365
          </h1>

          {/* Card */}
          <div className="card" style={{ padding: 28, display: status === 'success' ? 'none' : undefined }}>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
              Entrez vos identifiants pour continuer
            </p>

            {error && (
              <div className="error-box" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            {requires2fa ? (
              <form onSubmit={handleVerify2fa}>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.6 }}>
                  Un code à 6 chiffres a été envoyé à <strong style={{ color: 'var(--text)' }}>{email}</strong>. Saisissez-le ci-dessous.
                </p>
                <div className="form-group" style={{ marginBottom: 24 }}>
                  <label htmlFor="otp-code" className="lg-label">Code de vérification</label>
                  <input
                    id="otp-code"
                    className="lg-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    autoFocus
                    required
                    style={{ letterSpacing: '0.3em', fontSize: 22, textAlign: 'center' }}
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary lg-btn"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={loading || otpCode.length < 6}
                >
                  {loading
                    ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Vérification…</>
                    : 'Vérifier →'}
                </button>
                <button
                  type="button"
                  style={{ marginTop: 12, width: '100%', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}
                  onClick={() => { setRequires2fa(false); setOtpCode(''); setError(''); }}
                >
                  ← Retour
                </button>
              </form>
            ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="login-email" className="lg-label">Adresse email</label>
                <input
                  id="login-email"
                  className="lg-input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onFocus={() => setFocused('email')}
                  onBlur={() => setFocused(null)}
                  placeholder="admin@monentreprise.com"
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 24 }}>
                <label htmlFor="login-password" className="lg-label">Mot de passe</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="login-password"
                    className={`lg-input lg-input-pw`}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onFocus={() => setFocused('password')}
                    onBlur={() => setFocused(null)}
                    placeholder="••••••••••••"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="lg-eye"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary lg-btn"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={loading}
              >
                {loading
                  ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Connexion en cours…</>
                  : 'Se connecter →'}
              </button>
            </form>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
