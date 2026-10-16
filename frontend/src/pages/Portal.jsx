// [EN-TÊTE] Portal.jsx — page d'accueil (/) : une carte par module accessible (modules.js + canAccess), avec un état en direct
// (/api/stats pour Onboarding, /api/monitoring/ai-usage/summary pour Monitoring). Sans module : message « Aucun module disponible ».

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useUser } from '../context/UserContext';
import { MODULES, MODULE_ICONS, canAccess } from '../modules';

function Icon({ path, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', overflow: 'visible' }}>
      {path.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

const ARROW = ['M5 12h14', 'M12 5l7 7-7 7'];

function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }

// Ligne d'état affichée sous la description de chaque module (chargée en tâche de fond,
// silencieuse en cas d'erreur : le portail doit rester utilisable même si une API est KO).
function useModuleStatus(moduleId) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const done = s => { if (!cancelled) setStatus(s); };

    if (moduleId === 'onboarding') {
      api.get('/api/stats').then(s => done({
        text: `${plural(s.thisMonth ?? 0, 'onboarding ce mois', 'onboardings ce mois')}`,
        alert: s.failed > 0 ? `${s.failed} échoué${s.failed > 1 ? 's' : ''}` : null,
      })).catch(() => {});
    } else if (moduleId === 'monitoring') {
      api.get('/api/monitoring/ai-usage/summary').then(list => {
        const withData = list.filter(t => !t.empty);
        if (!withData.length) { done({ text: 'Aucun relevé reçu pour le moment', alert: null }); return; }
        const watch = withData.reduce((s, t) => s + t.rouge + t.orange + t.yellow, 0);
        done({
          text: `${plural(withData.length, 'outil suivi', 'outils suivis')}`,
          alert: watch > 0 ? `${plural(watch, 'licence à surveiller', 'licences à surveiller')}` : null,
        });
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [moduleId]);

  return status;
}

function ModuleCard({ module: m }) {
  const status = useModuleStatus(m.id);
  const [hover, setHover] = useState(false);

  return (
    <Link
      to={m.to}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 16, textDecoration: 'none', minHeight: 260,
        background: 'var(--surface)', border: `1px solid ${hover ? m.color + '66' : 'var(--border)'}`,
        borderRadius: 'var(--radius)', padding: 28,
        boxShadow: hover ? `0 8px 28px ${m.color}22` : '0 1px 3px rgba(0,0,0,.2)',
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'transform var(--transition), box-shadow var(--transition), border-color var(--transition)',
      }}
    >
      <div style={{
        width: 54, height: 54, borderRadius: 14,
        background: m.color + '1f', border: `1px solid ${m.color}40`, color: m.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon path={MODULE_ICONS[m.icon]} size={22} />
      </div>

      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>{m.label}</div>
        <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, margin: '8px 0 0' }}>{m.description}</p>
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 52 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5, fontSize: 12, color: 'var(--text2)', minWidth: 0 }}>
          {status ? (
            <>
              <span>{status.text}</span>
              {status.alert && (
                <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: 'rgba(249,115,22,.14)', color: '#fb923c' }}>
                  {status.alert}
                </span>
              )}
            </>
          ) : <span style={{ color: 'var(--muted)' }}>&nbsp;</span>}
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, color: m.color, background: m.color + '14', border: `1px solid ${m.color}33`, flexShrink: 0 }}>
          Ouvrir <Icon path={ARROW} size={13} />
        </span>
      </div>
    </Link>
  );
}

export default function Portal() {
  const { user } = useUser();
  const modules = MODULES.filter(m => canAccess(user, m.id));
  const firstName = (user?.name || '').split(' ')[0];

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <div style={{ marginBottom: 28, position: 'relative' }}>
        <div aria-hidden="true" style={{ position: 'absolute', top: -40, left: '5%', width: 420, height: 140, background: 'radial-gradient(ellipse, rgba(79,70,229,.18) 0%, transparent 70%)', pointerEvents: 'none', filter: 'blur(28px)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '4px 12px', borderRadius: 999, border: '1px solid rgba(79,70,229,.2)', background: 'rgba(79,70,229,.06)' }}>
            <Icon path={MODULE_ICONS.portal} size={11} />
            <span style={{ fontSize: 11, color: 'rgba(99,102,241,.8)', fontWeight: 500, letterSpacing: '.3px' }}>Portail</span>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', margin: 0, background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            {firstName ? `Bonjour ${firstName}` : 'Bienvenue'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>Choisis un module pour commencer.</p>
        </div>
      </div>

      {modules.length === 0 ? (
        <div className="card" style={{ maxWidth: 560 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>Aucun module disponible</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            Tu n'as accès à aucun module pour le moment. Demande l'accès à un administrateur du portail.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
          {modules.map(m => <ModuleCard key={m.id} module={m} />)}
        </div>
      )}
    </div>
  );
}
