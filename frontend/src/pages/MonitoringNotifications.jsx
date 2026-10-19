// [EN-TÊTE] MonitoringNotifications.jsx — module Monitoring : Notifications (/monitoring/notifications), administrateurs avec le module.
// Historique des synchronisations SharePoint (les 30 dernières, conservées en base) et de leurs erreurs :
// données = GET /api/monitoring/ai-usage → sharepoint.history ; bouton « Synchroniser SharePoint » = POST /api/monitoring/ai-usage/sync ;
// suppression d'une entrée / de tout l'historique = DELETE /api/monitoring/ai-usage/sync-history[/:date] (avec confirmation).
// Même charte que la page Licences IA (en-tête, tuiles, onglets, jetons LEVELS / TOOLS de monitoringShared.js).

import { useEffect, useState } from 'react';
import { api } from '../api';
import { MODULE_ICONS } from '../modules';
import { TOOLS, LEVELS } from '../monitoringShared';

const CHECK = ['M20 6L9 17l-5-5'];
const ALERT = ['M12 9v4', 'M12 17h.01', 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'];
const TRASH = ['M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6', 'M14 11v6'];
const REFRESH = ['M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16', 'M16 16h5v5'];

function Icon({ path, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', overflow: 'visible', flexShrink: 0 }}>
      {path.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

const fmtDate = iso => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function ago(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 0) return '';
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

const triggerLabel = t => (t === 'auto' ? 'Automatique' : t ? `Manuelle · ${t}` : '');
const shortCountry = s => s.replace(/^Captivea\s+/i, '');

function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.3px', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || 'var(--text)', lineHeight: 1.15, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', minHeight: 16 }}>{sub}</div>
    </div>
  );
}

// Pastille d'état : icône + texte (la couleur ne porte jamais seule l'information).
function Chip({ level, icon, children }) {
  const l = LEVELS[level];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, color: l.color, background: l.bg, border: `1px solid ${l.border}`, whiteSpace: 'nowrap' }}>
      <Icon path={icon} size={11} />{children}
    </span>
  );
}

export default function MonitoringNotifications() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [confirm, setConfirm] = useState(null); // date de l'entrée à supprimer, ou 'all'
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get('/api/monitoring/ai-usage')
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) { setData(null); setError(e.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  async function sync() {
    setSyncing(true); setSyncMsg(null);
    try {
      const out = await api.post('/api/monitoring/ai-usage/sync');
      const failed = out.results.filter(r => !r.ok);
      setSyncMsg(failed.length
        ? { ok: false, text: `Synchronisation incomplète : ${failed.map(r => `${data?.tools?.[r.tool]?.label || r.tool} (${r.error})`).join(', ')}` }
        : { ok: true, text: 'Synchronisation terminée.' });
      setReloadKey(k => k + 1);
    } catch (e) {
      setSyncMsg({ ok: false, text: e.message });
    } finally {
      setSyncing(false);
    }
  }

  async function remove(target) {
    setDeleting(true); setSyncMsg(null);
    try {
      await api.delete(target === 'all' ? '/api/monitoring/ai-usage/sync-history' : `/api/monitoring/ai-usage/sync-history/${encodeURIComponent(target)}`);
      setConfirm(null);
      setReloadKey(k => k + 1);
    } catch (e) {
      setSyncMsg({ ok: false, text: e.message });
    } finally {
      setDeleting(false);
    }
  }

  // Confirmation en ligne (pas de boîte native) : « Supprimer » puis « Confirmer / Annuler ».
  const DeleteControl = ({ target, label, confirmText }) => (confirm === target ? (
    <span role="group" aria-label={confirmText} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)' }}>
      {confirmText}
      <button type="button" className="btn btn-danger" disabled={deleting} onClick={() => remove(target)} style={{ padding: '3px 12px', fontSize: 12 }}>
        {deleting ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Confirmer'}
      </button>
      <button type="button" className="btn btn-ghost" disabled={deleting} onClick={() => setConfirm(null)} style={{ padding: '3px 12px', fontSize: 12 }}>Annuler</button>
    </span>
  ) : (
    <button type="button" className="btn btn-ghost" onClick={() => setConfirm(target)} style={{ padding: '3px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Icon path={TRASH} size={12} /> {label}
    </button>
  ));

  const sp = data?.sharepoint;
  const history = sp?.history || [];
  const withErrors = history.filter(h => h.results.some(r => !r.ok));
  const shown = tab === 'errors' ? withErrors : history;
  const last = history[0];
  const lastErrs = last ? last.results.filter(r => !r.ok).length : 0;
  const label = tool => data?.tools?.[tool]?.label || tool;
  const color = tool => TOOLS.find(t => t.key === tool)?.color || 'var(--muted)';

  const TABS = [
    { value: 'all', label: 'Toutes', count: history.length },
    { value: 'errors', label: 'Avec erreurs', count: withErrors.length },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── En-tête ── */}
      <div style={{ position: 'relative' }}>
        <div aria-hidden="true" style={{ position: 'absolute', top: -40, left: '8%', width: 380, height: 120, background: 'radial-gradient(ellipse, rgba(34,211,238,.14) 0%, transparent 70%)', pointerEvents: 'none', filter: 'blur(28px)' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '4px 12px', borderRadius: 999, border: '1px solid rgba(34,211,238,.25)', background: 'rgba(34,211,238,.06)' }}>
              <Icon path={MODULE_ICONS.bell} size={11} />
              <span style={{ fontSize: 11, color: 'rgba(103,232,249,.85)', fontWeight: 500, letterSpacing: '.3px' }}>Monitoring</span>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', margin: 0, background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Notifications
            </h1>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Historique des synchronisations SharePoint et de leurs erreurs (les 30 dernières). Une synchronisation automatique tourne toutes les 6 h.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {sp?.configured && (
              <button type="button" className="btn btn-primary" disabled={syncing} onClick={sync} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {syncing ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <Icon path={REFRESH} size={13} />} Synchroniser SharePoint
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setReloadKey(k => k + 1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon path={REFRESH} size={13} /> Actualiser
            </button>
          </div>
        </div>
      </div>

      {syncMsg && (
        <div role={syncMsg.ok ? 'status' : 'alert'} className={syncMsg.ok ? undefined : 'error-box'}
          style={{ marginBottom: 0, ...(syncMsg.ok ? { padding: '10px 14px', borderRadius: 10, fontSize: 13, color: LEVELS.vert.color, background: LEVELS.vert.bg, border: `1px solid ${LEVELS.vert.border}` } : {}) }}>
          {syncMsg.text}
        </div>
      )}
      {error && <div className="error-box" role="alert" style={{ marginBottom: 0 }}>{error}</div>}
      {loading && !data && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}><span className="spinner" style={{ width: 14, height: 14 }} /> Chargement…</div>}

      {data && !sp?.configured && (
        <div className="card" style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
          La lecture SharePoint n'est pas configurée : renseigne <code>MONITORING_SP_DRIVE_ID</code> dans le <code>.env</code> du serveur pour suivre les synchronisations ici.
        </div>
      )}

      {sp?.configured && (
        <>
          {/* ── Tuiles ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            <Kpi label="Dernière synchronisation" value={last ? ago(last.at) : '—'} sub={last ? `${fmtDate(last.at)} · ${triggerLabel(last.trigger)}` : 'Aucune synchronisation enregistrée'} />
            <Kpi label="Erreurs à la dernière" value={last ? lastErrs : '—'} color={last ? (lastErrs ? LEVELS.rouge.color : LEVELS.vert.color) : undefined}
              sub={last ? (lastErrs ? `sur ${last.results.length} outils` : 'Tous les outils sont à jour') : ''} />
            <Kpi label="Sans erreur" value={history.length ? `${history.length - withErrors.length}/${history.length}` : '—'}
              sub={history.length ? 'synchronisations réussies' : ''} />
          </div>

          {/* ── Onglets ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid var(--border)' }}>
          <div role="tablist" aria-label="Filtrer l'historique" style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {TABS.map(t => {
              const on = t.value === tab;
              return (
                <button key={t.value} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.value)}
                  style={{ background: on ? 'rgba(79,70,229,.08)' : 'transparent', border: 'none', borderBottom: `2px solid ${on ? 'var(--primary)' : 'transparent'}`, padding: '9px 16px', cursor: 'pointer', fontSize: 13, fontWeight: on ? 600 : 400, color: on ? 'var(--text)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}>
                  {t.label}
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '0 7px', borderRadius: 999, background: 'var(--surface2)', color: 'var(--text2)' }}>{t.count}</span>
                </button>
              );
            })}
          </div>
          {history.length > 0 && <DeleteControl target="all" label="Tout effacer" confirmText="Effacer tout l'historique ?" />}
          </div>

          {shown.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 32, fontSize: 13, color: 'var(--muted)' }}>
              {history.length === 0
                ? "Aucune synchronisation enregistrée pour le moment. Lance « Synchroniser SharePoint » ou attends la prochaine synchronisation automatique."
                : 'Aucune synchronisation avec erreur : tout est à jour.'}
            </div>
          )}

          {/* ── Journal ── */}
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
            {shown.map((h, i) => {
              const bad = h.results.filter(r => !r.ok);
              const lv = bad.length ? 'rouge' : 'vert';
              return (
                <li key={h.at + i} className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: `3px solid ${LEVELS[lv].color}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(148,163,184,.04)' }}>
                    <Chip level={lv} icon={bad.length ? ALERT : CHECK}>{bad.length ? `${bad.length} erreur${bad.length > 1 ? 's' : ''}` : 'Réussie'}</Chip>
                    <b style={{ fontSize: 13, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(h.at)}</b>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{ago(h.at)}{h.trigger ? ` · ${triggerLabel(h.trigger)}` : ''}</span>
                    <span style={{ marginLeft: 'auto' }}><DeleteControl target={h.at} label="Supprimer" confirmText="Supprimer cette entrée ?" /></span>
                  </div>
                  <div style={{ padding: '0 16px 4px', display: 'grid' }}>
                    {h.results.map((r, k) => (
                      <div key={r.tool} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 140px) minmax(0, 1fr)', gap: '4px 14px', alignItems: 'start', padding: '10px 0', borderTop: k ? '1px solid var(--border)' : 'none' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                          <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 3, background: color(r.tool) }} />{label(r.tool)}
                        </span>
                        {r.ok ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text2)' }}>
                            <Chip level="vert" icon={CHECK}>OK</Chip>
                            <span>{r.months.length} mois</span>
                            {r.societes?.length > 0 && <span style={{ color: 'var(--muted)' }}>· {r.societes.length} société{r.societes.length > 1 ? 's' : ''} : {r.societes.map(shortCountry).join(', ')}</span>}
                            {r.skipped?.length > 0 && <span style={{ color: LEVELS.orange.color }}>· {r.skipped.length} onglet{r.skipped.length > 1 ? 's' : ''} ignoré{r.skipped.length > 1 ? 's' : ''} : {r.skipped.join(' ; ')}</span>}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, lineHeight: 1.5, padding: '7px 10px', borderRadius: 8, color: 'var(--text)', background: LEVELS.rouge.bg, border: `1px solid ${LEVELS.rouge.border}` }}>
                            <span style={{ color: LEVELS.rouge.color, marginTop: 2 }}><Icon path={ALERT} size={13} /></span>
                            <span>{r.error}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
