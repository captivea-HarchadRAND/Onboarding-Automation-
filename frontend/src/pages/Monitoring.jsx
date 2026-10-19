// [EN-TÊTE] Monitoring.jsx — module Monitoring : tableau de bord des licences IA (/monitoring), accessible aux utilisateurs ayant le module.
// Onglets : Vue d'ensemble, Claude, ChatGPT, Fireflies, Suivi des personnes. Filtres : mois, pays, comparaison au mois précédent.
// Une seule requête GET /api/monitoring/ai-usage renvoie tout (cellules par pays/mois, personnes, prix) ; les calculs d'affichage se
// font ici. Niveaux (levelFor) : vert « Utilise », jaune « Utilise peu », orange « Pas utilisé ce mois-ci », rouge « Inactif · 2 mois
// ou plus » (0 ce mois-ci ET le mois précédent) — MÊME règle que lib/aiUsage.js (levelOf), à garder synchronisées.
// Administrateurs : bouton « Synchroniser SharePoint ». Non-administrateurs : data.readOnly = true (pas de configuration technique).

import { useEffect, useMemo, useState } from 'react';
import Select from '../components/Select';
import { api } from '../api';
import { MODULE_ICONS } from '../modules';
import { TOOLS, LEVELS } from '../monitoringShared';

/* ── Constantes d'affichage ──────────────────────────────────────── */
const LEVEL_ORDER = ['rouge', 'orange', 'jaune', 'vert'];
const TAB_ICONS = {
  overview: MODULE_ICONS.portal,
  claude: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z'],
  chatgpt: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  fireflies: ['M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v4'],
  people: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
};

const TABS = [
  { value: 'overview', label: "Vue d'ensemble" },
  { value: 'claude', label: 'Claude' },
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'fireflies', label: 'Fireflies' },
  { value: 'people', label: 'Suivi des personnes' },
];
const TOOL_NOTE = {
  claude: 'Usage = requêtes du mois. Un siège « Unassigned » n’est pas compté.',
  chatgpt: 'Usage = millions de tokens (ChatGPT + Codex) ; les crédits ne mesurent pas l’usage.',
  fireflies: 'Usage = réunions du mois (total relevé − total du mois précédent).',
};

// Expression à coller dans le corps JSON du nœud « HTTP Request » du workflow n8n, par outil.
const N8N_BODY = {
  claude:    "{{ { tool: 'claude', month: $json.mois, manquants: $json.manquants, lignesMois: $json.lignesMois } }}",
  chatgpt:   "{{ { tool: 'chatgpt', month: $json.mois, manquants: $json.manquants, lignesMois: $json.lignesMois } }}",
  fireflies: "{{ { tool: 'fireflies', month: $json.feuille, reference: $json.reference, manquants: $json.manquants, lignesMois: $json.lignesMois } }}",
};
const N8N_AFTER = { claude: 'Calcul Claude', chatgpt: 'Calcul ChatGPT', fireflies: 'Ajouter feuille du mois Fireflies' };

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmtUsage = n => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
const pctv = v => `${nf1.format(v)} %`;
const ZERO = { lic: 0, active: 0, inactive: 0, low: 0, inactifs: {} };

function fmtMonth(m, short = false) {
  if (!m) return '';
  const [y, mm] = m.split('-').map(Number);
  const s = new Date(y, mm - 1, 1).toLocaleDateString('fr-FR', short ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtReceived(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z'); // SQLite stocke en UTC
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const countryLabel = c => (c || '—').replace(/^Captivea\s+/i, '');

// Même règle que côté serveur (aiUsage.levelOf), pour le mois months[i] :
//   vert = lowBelow ou plus · jaune = plus de 0, sous lowBelow · orange = 0 ce mois-ci
//   rouge = 0 utilisation ce mois-ci et le mois précédent (inactif depuis 2 mois ou plus)
const valueLevel = (tl, v) => (v === 0 ? 'orange' : v < tl.lowBelow ? 'jaune' : 'vert');
function levelFor(tl, vals, months, i) {
  const v = vals[months[i]];
  if (v === undefined || v === null) return null;
  if (v === 0 && i >= 1 && vals[months[i - 1]] === 0) return 'rouge';
  return valueLevel(tl, v);
}

// Définition de chaque niveau, avec les seuils de l'outil.
function levelHelp(tl) {
  const u = tl.unit;
  return {
    vert: `Au moins ${nf0.format(tl.lowBelow)} ${u} dans le mois.`,
    jaune: `Plus de 0 et moins de ${nf0.format(tl.lowBelow)} ${u} dans le mois.`,
    orange: `Aucune utilisation ce mois-ci (0 ${u}).`,
    rouge: 'Aucune utilisation ce mois-ci ni le mois précédent (0 depuis 2 mois ou plus).',
  };
}

function LevelLegend({ tl }) {
  const help = levelHelp(tl);
  return (
    <ul style={{ listStyle: 'none', display: 'grid', gap: 8, margin: '0', padding: 0 }}>
      {LEVEL_ORDER.slice().reverse().map(lv => (
        <li key={lv} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, auto) 1fr', gap: 10, alignItems: 'center', fontSize: 12, color: 'var(--text2)' }}>
          <LevelPill level={lv} /><span>{help[lv]}</span>
        </li>
      ))}
    </ul>
  );
}

function Icon({ path, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', overflow: 'visible' }}>
      {path.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
const REFRESH = ['M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16', 'M16 16h5v5'];

/* ── Briques ─────────────────────────────────────────────────────── */
function LevelPill({ level }) {
  const l = LEVELS[level];
  if (!l) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: l.bg, color: l.color, border: `1px solid ${l.border}`, whiteSpace: 'nowrap' }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: l.color }} />{l.label}
    </span>
  );
}

// Écart avec le mois précédent. La flèche dit le sens, la couleur dit « favorable / défavorable »
// (grise quand la hausse n'est ni bonne ni mauvaise, ex. nombre de licences) ; le libellé complet est
// dans l'infobulle et pour les lecteurs d'écran, jamais la couleur seule.
function Delta({ cur, prev, goodUp = true, neutral = false, pts = false }) {
  if (prev == null) return null;
  const same = pts ? Math.abs(cur - prev) < 0.05 : cur === prev;
  const sign = n => (n > 0 ? '+' : '−');
  let text, detail, up = cur > prev;
  if (same) {
    text = '0'; detail = 'stable';
  } else if (pts) {
    text = `${sign(cur - prev)}${nf1.format(Math.abs(cur - prev))} pt`;
    detail = `${up ? 'hausse' : 'baisse'} de ${nf1.format(Math.abs(cur - prev))} point`;
  } else if (!prev) {
    text = 'nouveau'; detail = 'aucune valeur le mois précédent';
  } else {
    const pc = ((cur - prev) / prev) * 100;
    text = `${sign(pc)}${nf1.format(Math.abs(pc))} %`;
    detail = `${up ? 'hausse' : 'baisse'} de ${nf1.format(Math.abs(pc))} %`;
  }
  const tone = same || neutral ? 'flat' : (up === goodUp ? 'vert' : 'rouge');
  const col = tone === 'flat' ? { color: 'var(--text2)', bg: 'var(--surface2)', border: 'var(--border)' }
    : { color: LEVELS[tone].color, bg: LEVELS[tone].bg, border: LEVELS[tone].border };
  const verdict = tone === 'vert' ? ', favorable' : tone === 'rouge' ? ', défavorable' : '';
  const label = `${detail} par rapport au mois précédent${verdict}`;
  return (
    <span title={label} aria-label={label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
      color: col.color, background: col.bg, border: `1px solid ${col.border}`,
    }}>
      {!same && text !== 'nouveau' && (
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" style={{ flex: 'none', transform: up ? 'none' : 'rotate(180deg)' }}>
          <path d="M5 1.5 9 8H1z" fill="currentColor" />
        </svg>
      )}
      <span aria-hidden="true">{text}</span>
    </span>
  );
}

function Spark({ values }) {
  if (values.length < 2) return null;
  const w = 200, h = 34, mx = Math.max(...values), mn = Math.min(...values);
  const sx = i => (i / (values.length - 1)) * w;
  const sy = v => h - 3 - ((v - mn) / (mx - mn || 1)) * (h - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block', width: '100%', height: 34, marginTop: 6 }}>
      <path d={`${d}L${w},${h}L0,${h}Z`} fill="#818cf8" opacity=".12" />
      <path d={d} fill="none" stroke="#818cf8" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ label, value, delta, was, spark }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, letterSpacing: '.3px', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', lineHeight: 1.15, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minHeight: 22 }}>
        {delta}
        {was && <span style={{ fontSize: 11, color: 'var(--muted)' }}>vs {was} le mois précédent</span>}
      </div>
      {spark}
    </div>
  );
}

function Card({ title, sub, children }) {
  return (
    <div className="card" style={{ padding: 18, minWidth: 0 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{title}</h2>
      {sub && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0', lineHeight: 1.5 }}>{sub}</p>}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

// Barres horizontales : valeur du mois + repère du mois précédent.
function HBars({ rows, goodUp = false }) {
  const mx = Math.max(1, ...rows.map(r => Math.max(r.v, r.p ?? 0)));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,150px) minmax(0,1fr) auto', gap: '10px 12px', alignItems: 'center' }}>
      {rows.map(r => (
        <FragmentRow key={r.name}>
          <span title={r.name} style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
          <div style={{ position: 'relative', height: 16 }} title={`${r.name} : ${nf0.format(r.v)}`}>
            <div style={{ position: 'absolute', left: 0, top: 2, bottom: 2, width: `${(r.v / mx) * 100}%`, minWidth: r.v ? 2 : 0, borderRadius: '0 4px 4px 0', background: r.color || '#818cf8' }} />
            {r.p != null && <div title={`Mois précédent : ${nf0.format(r.p)}`} style={{ position: 'absolute', top: -1, bottom: -1, left: `${(r.p / mx) * 100}%`, width: 2, background: 'var(--text)', opacity: 0.45 }} />}
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', textAlign: 'right' }}>
            {nf0.format(r.v)} {r.p != null && <Delta cur={r.v} prev={r.p} goodUp={goodUp} />}
          </span>
        </FragmentRow>
      ))}
    </div>
  );
}
function FragmentRow({ children }) { return <>{children}</>; }

// Barres empilées à 100 % : actives / faible usage / inactives, par outil.
const MIX = [
  { key: 'ok', label: 'Actives', color: '#22c55e' },
  { key: 'low', label: 'Faible usage', color: '#facc15' },
  { key: 'inactive', label: 'Inactives', color: '#ef4444' },
];
function StackBars({ rows }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
        {MIX.map(m => <span key={m.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 11, height: 11, borderRadius: 3, background: m.color, display: 'inline-block' }} />{m.label}</span>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(70px,110px) minmax(0,1fr)', gap: '10px 12px', alignItems: 'center' }}>
        {rows.map(r => {
          const tot = r.ok + r.low + r.inactive;
          return (
            <FragmentRow key={r.name}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{r.name}</span>
              <div style={{ display: 'flex', height: 22, gap: 2 }}>
                {MIX.map(m => r[m.key] > 0 && (
                  <div key={m.key} title={`${r.name} · ${m.label} : ${nf1.format((r[m.key] / tot) * 100)} % (${r[m.key]})`}
                    style={{ flex: r[m.key], background: m.color, borderRadius: 4, minWidth: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0b1020', fontSize: 11, fontWeight: 800, overflow: 'hidden' }}>
                    {(r[m.key] / tot) * 100 >= 12 ? `${nf0.format((r[m.key] / tot) * 100)} %` : ''}
                  </div>
                ))}
              </div>
            </FragmentRow>
          );
        })}
      </div>
    </>
  );
}

// Courbes : licences inactives par outil et par mois.
function TrendLines({ labels, series }) {
  const W = 560, H = 200, m = { l: 34, r: 14, t: 12, b: 26 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, n = labels.length;
  const top = Math.max(1, ...series.flatMap(s => s.vals));
  const x = i => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = v => m.t + ih - (v / top) * ih;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Licences inactives par outil et par mois">
      {[0, 0.5, 1].map(f => (
        <g key={f}>
          <line x1={m.l} x2={W - m.r} y1={y(f * top)} y2={y(f * top)} stroke="var(--border)" strokeDasharray={f ? '3 3' : undefined} />
          <text x={m.l - 6} y={y(f * top) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{nf0.format(f * top)}</text>
        </g>
      ))}
      {labels.map((l, i) => <text key={l} x={x(i)} y={H - 7} textAnchor="middle" fontSize="10" fill="var(--muted)">{fmtMonth(l, true)}</text>)}
      {series.map(s => (
        <g key={s.name}>
          <path d={s.vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {s.vals.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill={s.color} stroke="var(--surface)" strokeWidth="1.5">
              <title>{`${s.name} · ${fmtMonth(labels[i])} : ${nf0.format(v)} inactive${v > 1 ? 's' : ''}`}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  );
}

function IngestHelp({ tool, label, ingestConfigured }) {
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>Aucun relevé reçu pour {label}</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 14px' }}>
        Le workflow n8n envoie son résultat mensuel à cette application. Une fois relié, le tableau de bord se remplit ici.
      </p>
      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
        {ingestConfigured
          ? <><b>1.</b> Le jeton d'ingestion est configuré.</>
          : <><b>1.</b> Définis <code>MONITORING_INGEST_TOKEN</code> (24 caractères minimum, secret) dans <code>backend/.env</code>, puis redémarre le serveur.</>}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginTop: 8 }}>
        <b>2.</b> Dans n8n, ajoute après le nœud « {N8N_AFTER[tool]} » un nœud <b>HTTP Request</b> :<br />
        méthode <code>POST</code>, URL <code>https://&lt;ton-domaine&gt;/api/monitoring/ai-usage/ingest</code>, en-tête <code>Authorization: Bearer &lt;jeton&gt;</code>, corps JSON en mode <b>Expression</b> :
      </div>
      <pre style={{ margin: '10px 0 0', padding: '12px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text2)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{N8N_BODY[tool]}</pre>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '14px 0 0' }}>
        <b>Ou, sans n8n dans la boucle :</b> l'app peut relire les rapports Excel dans SharePoint, en lecture seule. Indique l'emplacement des rapports dans <b>Administration</b> (menu de gauche, ou <code>MONITORING_SP_DRIVE_ID</code> dans <code>backend/.env</code>), avec une app Entra qui a la permission <code>Sites.Selected</code> en lecture sur le site. Un bouton « Synchroniser SharePoint » apparaît alors, et la synchronisation tourne aussi toutes les 6 h.
      </p>
      {tool === 'fireflies' && (
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '10px 0 0' }}>
          Ce nœud doit renvoyer <code>lignesMois</code>, <code>feuille</code> et <code>reference</code> : vérifie qu'il contient bien le calcul du mois (dans l'export, son code semble être celui du nœud « Calcul Fireflies - html »).
        </p>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */
export default function Monitoring() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [seeding, setSeeding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  // Avertissements masqués : la clé contient le texte, un nouveau problème réapparaît donc.
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('monitoring_dismissed') || '[]')); } catch (_) { return new Set(); }
  });
  const dismiss = k => setDismissed(prev => {
    const next = new Set(prev).add(k);
    try { localStorage.setItem('monitoring_dismissed', JSON.stringify([...next].slice(-50))); } catch (_) { /* stockage indisponible : masqué pour cette session */ }
    return next;
  });

  const [tab, setTab] = useState('overview');
  const [month, setMonth] = useState(null);
  const [country, setCountry] = useState('all');
  const [compare, setCompare] = useState(true);
  const [peopleTool, setPeopleTool] = useState('all');
  const [peopleLevel, setPeopleLevel] = useState('alert');
  const [search, setSearch] = useState('');

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

  async function seedDemo() {
    setSeeding(true);
    try { await api.post('/api/monitoring/ai-usage/demo'); setMonth(null); setReloadKey(k => k + 1); }
    catch (e) { setError(e.message); }
    finally { setSeeding(false); }
  }

  async function syncSharePoint() {
    setSyncing(true); setSyncMsg(null);
    try {
      const out = await api.post('/api/monitoring/ai-usage/sync');
      const failed = out.results.filter(r => !r.ok);
      setSyncMsg({
        ok: failed.length === 0,
        text: failed.length ? failed.map(r => `${r.tool} : ${r.error}`).join(' · ') : 'Données synchronisées depuis SharePoint.',
      });
      setMonth(null); setReloadKey(k => k + 1);
    } catch (e) {
      setSyncMsg({ ok: false, text: e.message });
    } finally { setSyncing(false); }
  }

  const months = data?.months || [];
  const cur = months.includes(month) ? month : months[months.length - 1] || null;
  const prevM = cur ? months[months.indexOf(cur) - 1] || null : null;
  const cmp = compare && !!prevM;
  const allEmpty = !!data && TOOLS.every(t => data.tools[t.key].empty);

  /* Pays du filtre : liste définie dans Administration > Pays (puis pays trouvés dans les rapports hors liste), fournie par le serveur. */
  const countries = useMemo(() => {
    if (data?.countries?.length) return data.countries;
    const s = new Set();
    if (data) for (const t of TOOLS) for (const k of Object.keys(data.tools[t.key].cells)) s.add(k.slice(0, k.lastIndexOf('|')));
    return [...s].sort();
  }, [data]);

  const pickedCountries = country === 'all' ? countries : [country];
  const cell = (tool, c, m) => data.tools[tool].cells[`${c}|${m}`] || ZERO;
  const agg = (tool, m) => pickedCountries.reduce((a, c) => {
    const x = cell(tool, c, m);
    const inactifs = { ...a.inactifs };
    for (const [sg, n] of Object.entries(x.inactifs || {})) inactifs[sg] = (inactifs[sg] || 0) + n;
    return { lic: a.lic + x.lic, active: a.active + x.active, inactive: a.inactive + x.inactive, low: a.low + x.low, inactifs };
  }, { ...ZERO });
  const rate = x => (x.lic ? (x.active / x.lic) * 100 : 0);
  /* Coût des licences inactives : chaque inactive est comptée au prix de son siège (Claude : Premium ou Standard ; les autres outils : un seul prix). */
  const seatPrice = (tool, seat) => Number(data?.prices?.[tool]?.[seat] ?? data?.prices?.[tool]?.Standard) || 0;
  const costOf = (tool, x) => {
    const parSiege = x.inactifs || {};
    const classees = Object.values(parSiege).reduce((a, b) => a + b, 0);
    return Object.entries(parSiege).reduce((a, [seat, n]) => a + n * seatPrice(tool, seat), 0) + Math.max(0, x.inactive - classees) * seatPrice(tool, 'Standard');
  };
  const peopleOf = tool => data.tools[tool].people.filter(p => country === 'all' || p.country === country);

  const toolDef = key => ({ key, ...data.tools[key] });

  /* ── Vue d'ensemble ── */
  function renderOverview() {
    if (allEmpty) {
      return (
        <div className="card" style={{ maxWidth: 760 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>Aucun relevé reçu</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            Ouvre l'onglet d'un outil (Claude, ChatGPT, Fireflies) pour voir comment relier le workflow n8n à cette application.
          </p>
          {data.demoAvailable && (
            <button type="button" className="btn btn-primary" disabled={seeding} onClick={seedDemo} style={{ marginTop: 16 }}>
              {seeding ? 'Chargement…' : 'Charger des données de démonstration'}
            </button>
          )}
        </div>
      );
    }
    const span = months.filter(m => TOOLS.some(t => data.tools[t.key].cells && pickedCountries.some(c => data.tools[t.key].cells[`${c}|${m}`])));
    const total = m => TOOLS.reduce((a, t) => {
      const x = agg(t.key, m);
      return { lic: a.lic + x.lic, active: a.active + x.active, inactive: a.inactive + x.inactive, cost: a.cost + costOf(t.key, x) };
    }, { lic: 0, active: 0, inactive: 0, cost: 0 });
    const now = total(cur), before = cmp ? total(prevM) : null;
    const series = span.map(total);
    const missing = TOOLS.filter(t => data.tools[t.key].empty).map(t => data.tools[t.key].label);

    const rows = TOOLS.flatMap(t => pickedCountries.map(c => ({ t, c, x: cell(t.key, c, cur), p: cmp ? cell(t.key, c, prevM) : null })))
      .filter(r => r.x.lic || (r.p && r.p.lic));
    const mxInactive = Math.max(1, ...rows.map(r => r.x.inactive));

    return (
      <>
        {missing.length > 0 && !dismissed.has(`missing|${missing.join(',')}`) && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', borderRadius: 10, border: '1px dashed var(--border)', background: 'var(--surface)', fontSize: 12, color: 'var(--text2)' }}>
            <div style={{ flex: 1 }}><b>Relevé introuvable :</b> {missing.join(', ')}.</div>
            <button type="button" className="btn btn-ghost" style={{ padding: '2px 10px', fontSize: 12, flexShrink: 0 }}
              onClick={() => dismiss(`missing|${missing.join(',')}`)}>Masquer</button>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
          <Kpi label="Licences payantes" value={nf0.format(now.lic)} spark={<Spark values={series.map(s => s.lic)} />}
            delta={before && <Delta neutral cur={now.lic} prev={before.lic} />} was={before && nf0.format(before.lic)} />
          <Kpi label="Licences inactives" value={nf0.format(now.inactive)} spark={<Spark values={series.map(s => s.inactive)} />}
            delta={before && <Delta cur={now.inactive} prev={before.inactive} goodUp={false} />} was={before && nf0.format(before.inactive)} />
          <Kpi label="Taux d'activité" value={pctv(now.lic ? (now.active / now.lic) * 100 : 0)} spark={<Spark values={series.map(s => (s.lic ? (s.active / s.lic) * 100 : 0))} />}
            delta={before && <Delta pts cur={now.lic ? (now.active / now.lic) * 100 : 0} prev={before.lic ? (before.active / before.lic) * 100 : 0} />}
            was={before && pctv(before.lic ? (before.active / before.lic) * 100 : 0)} />
          <Kpi label="Coût des inactives (mois)" value={eur.format(now.cost)} spark={<Spark values={series.map(s => s.cost)} />}
            delta={before && <Delta cur={now.cost} prev={before.cost} goodUp={false} />} was={before && eur.format(before.cost)} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
          <Card title="Licences inactives par outil" sub="0 utilisation sur le mois ; le trait vertical marque le mois précédent.">
            <HBars rows={TOOLS.map(t => ({ name: data.tools[t.key].label, color: t.color, v: agg(t.key, cur).inactive, p: cmp ? agg(t.key, prevM).inactive : null }))} />
          </Card>
          <Card title="Répartition des licences par outil" sub="Part des licences actives, à faible usage et inactives.">
            <StackBars rows={TOOLS.map(t => {
              const x = agg(t.key, cur);
              return { name: data.tools[t.key].label, lic: x.lic, ok: Math.max(0, x.active - x.low), low: x.low, inactive: x.inactive };
            }).filter(r => r.lic)} />
          </Card>
        </div>

        <Card title="Licences inactives par outil, mois par mois" sub="Nombre de licences payantes sans aucune utilisation dans le mois.">
          {span.length < 2
            ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>L'évolution s'affichera dès que les relevés couvriront au moins 2 mois.</div>
            : (
              <>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                  {TOOLS.map(t => <span key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 12, height: 3, borderRadius: 2, background: t.color, display: 'inline-block' }} />{data.tools[t.key].label}</span>)}
                </div>
                <TrendLines labels={span} series={TOOLS.map(t => ({ name: data.tools[t.key].label, color: t.color, vals: span.map(m => agg(t.key, m).inactive) }))} />
              </>
            )}
        </Card>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Détail par outil et par pays</h2>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>Coût = licences inactives × prix mensuel du siège (Claude : Premium ou Standard), défini dans l'onglet Prix.</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Outil</th><th>Pays</th>
                  <th style={{ textAlign: 'right' }}>Licences</th><th style={{ textAlign: 'right' }}>Actives</th><th>Inactives</th>
                  <th style={{ textAlign: 'right' }}>Taux d'activité</th><th style={{ textAlign: 'right' }}>Coût inactives</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ t, c, x, p }) => (
                  <tr key={`${t.key}|${c}`}>
                    <td style={{ fontWeight: 600, color: 'var(--text)' }}>{data.tools[t.key].label}</td>
                    <td>{countryLabel(c)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{nf0.format(x.lic)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{nf0.format(x.active)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 150 }}>
                        <i style={{ display: 'block', height: 8, width: `${(x.inactive / mxInactive) * 90}px`, minWidth: x.inactive ? 2 : 0, borderRadius: '0 4px 4px 0', background: '#ef4444' }} />
                        <b style={{ color: 'var(--text)' }}>{nf0.format(x.inactive)}</b>
                        {p && <Delta cur={x.inactive} prev={p.inactive} goodUp={false} />}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pctv(rate(x))}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{eur.format(costOf(t.key, x))}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>Aucune licence pour ces filtres.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  /* ── Page d'un outil ── */
  function renderTool(key) {
    const tl = toolDef(key);
    if (tl.empty && tl.referenceMonths?.length) {
      return (
        <div className="card" style={{ maxWidth: 760 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>Mois de référence reçu pour {tl.label}</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            Le relevé de {tl.referenceMonths.map(m => fmtMonth(m)).join(', ')} sert de base : les totaux sont enregistrés, et l'usage mensuel apparaîtra dès le mois suivant.
          </p>
        </div>
      );
    }
    if (tl.empty && data.readOnly) return <div className="card" style={{ maxWidth: 560 }}><p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>Aucun relevé reçu pour {tl.label} pour le moment.</p></div>;
    if (tl.empty) return <IngestHelp tool={key} label={tl.label} ingestConfigured={data.ingestConfigured} />;
    const span = months.filter(m => pickedCountries.some(c => tl.cells[`${c}|${m}`]));
    const now = agg(key, cur), before = cmp ? agg(key, prevM) : null;
    const cost = x => costOf(key, x);

    const people = peopleOf(key);
    const curI = months.indexOf(cur);
    const counts = i => Object.fromEntries(LEVEL_ORDER.map(lv => [lv, people.filter(p => levelFor(tl, p.vals, months, i) === lv).length]));
    const cNow = counts(curI), cBefore = cmp ? counts(curI - 1) : null;
    const lvTotal = LEVEL_ORDER.reduce((s, lv) => s + cNow[lv], 0) || 1;
    const lvTotalBefore = cBefore ? LEVEL_ORDER.reduce((s, lv) => s + cBefore[lv], 0) || 1 : 1;

    const watch = people
      .map(p => ({ p, lv: levelFor(tl, p.vals, months, curI) }))
      .filter(x => x.lv && x.lv !== 'vert')
      .sort((a, b) => (a.p.vals[cur] ?? 0) - (b.p.vals[cur] ?? 0) || a.p.email.localeCompare(b.p.email));

    return (
      <>
        {!dismissed.has(`note|${key}|${tl.receivedAt}|${tl.missing.join(',')}`) && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 12, color: 'var(--text2)', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(99,102,241,.3)', background: 'rgba(99,102,241,.08)' }}>
            <div style={{ flex: 1 }}>
              {TOOL_NOTE[key]}
              {tl.receivedAt && <> Relevé reçu le {fmtReceived(tl.receivedAt)}.</>}
              {tl.missing.length > 0 && <> <b>Fichier manquant :</b> {tl.missing.join(', ')}.</>}
            </div>
            <button type="button" className="btn btn-ghost" style={{ padding: '2px 10px', fontSize: 12, flexShrink: 0 }}
              onClick={() => dismiss(`note|${key}|${tl.receivedAt}|${tl.missing.join(',')}`)}>Masquer</button>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
          <Kpi label="Licences payantes" value={nf0.format(now.lic)} spark={<Spark values={span.map(m => agg(key, m).lic)} />}
            delta={before && <Delta neutral cur={now.lic} prev={before.lic} />} was={before && nf0.format(before.lic)} />
          <Kpi label="Licences inactives" value={nf0.format(now.inactive)} spark={<Spark values={span.map(m => agg(key, m).inactive)} />}
            delta={before && <Delta cur={now.inactive} prev={before.inactive} goodUp={false} />} was={before && nf0.format(before.inactive)} />
          <Kpi label="Taux d'activité" value={pctv(rate(now))} spark={<Spark values={span.map(m => rate(agg(key, m)))} />}
            delta={before && <Delta pts cur={rate(now)} prev={rate(before)} />} was={before && pctv(rate(before))} />
          <Kpi label="Coût des inactives (mois)" value={eur.format(cost(now))} spark={<Spark values={span.map(m => cost(agg(key, m)))} />}
            delta={before && <Delta cur={cost(now)} prev={cost(before)} goodUp={false} />} was={before && eur.format(cost(before))} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
          <Card title="Licences inactives par pays" sub="Le trait vertical marque le mois précédent.">
            <HBars rows={pickedCountries.map(c => ({ name: countryLabel(c), color: '#818cf8', v: cell(key, c, cur).inactive, p: cmp ? cell(key, c, prevM).inactive : null }))} />
          </Card>
          <Card title="Personnes par niveau d'usage" sub="Niveau du mois sélectionné ; « Inactif » = aucune utilisation depuis 2 mois ou plus.">
            <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: '10px 12px', alignItems: 'center' }}>
              {LEVEL_ORDER.map(lv => (
                <FragmentRow key={lv}>
                  <LevelPill level={lv} />
                  <div style={{ height: 12, borderRadius: 99, background: 'var(--surface2)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(cNow[lv] / lvTotal) * 100}%`, background: LEVELS[lv].color, borderRadius: 99 }} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    <b style={{ color: 'var(--text)' }}>{nf0.format(cNow[lv])}</b> · {pctv((cNow[lv] / lvTotal) * 100)}{' '}
                    {cBefore && (lv !== 'rouge' || curI >= 2) && <Delta pts cur={(cNow[lv] / lvTotal) * 100} prev={(cBefore[lv] / lvTotalBefore) * 100} goodUp={lv === 'vert'} />}
                  </span>
                </FragmentRow>
              ))}
            </div>
          </Card>
        </div>

        <Card title="Que veulent dire les niveaux ?" sub={`Seuils pour ${tl.label}, en ${tl.unit} par mois.`}>
          <LevelLegend tl={tl} />
        </Card>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Personnes à surveiller</h2>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>
              {watch.length} personne{watch.length > 1 ? 's' : ''} à surveiller (tous les niveaux sauf « Utilise »), de la moins active à la plus active.
              À vérifier avant toute action : congés, arrêts, arrivées du mois, comptes partagés.
            </p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Niveau</th><th>Pays</th><th>Email</th><th>Nom</th>
                  <th style={{ textAlign: 'right' }}>{fmtMonth(cur)}</th>
                  {prevM && <th style={{ textAlign: 'right' }}>{fmtMonth(prevM)}</th>}
                </tr>
              </thead>
              <tbody>
                {watch.map(({ p, lv }) => (
                  <tr key={p.email}>
                    <td><LevelPill level={lv} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{countryLabel(p.country)}</td>
                    <td style={{ fontWeight: 600, color: 'var(--text)' }}>{p.email}</td>
                    <td>{p.name || '—'}</td>
                    <td style={{ textAlign: 'right' }}><UsageCell tl={tl} v={p.vals[cur]} /></td>
                    {prevM && <td style={{ textAlign: 'right' }}><UsageCell tl={tl} v={p.vals[prevM]} /></td>}
                  </tr>
                ))}
                {watch.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: '#22c55e', fontWeight: 600 }}>Aucune licence à surveiller pour ces filtres.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  /* ── Suivi des personnes ── */
  function renderPeople() {
    if (allEmpty && data.readOnly) return <div className="card" style={{ maxWidth: 560 }}><p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>Aucun relevé reçu pour le moment.</p></div>;
    if (allEmpty) return <IngestHelp tool="claude" label="les outils IA" ingestConfigured={data.ingestConfigured} />;
    const span = months.filter(m => months.indexOf(m) <= months.indexOf(cur));
    const q = search.trim().toLowerCase();
    const tools = peopleTool === 'all' ? TOOLS : TOOLS.filter(t => t.key === peopleTool);
    const rows = tools.flatMap(t => {
      const tl = toolDef(t.key);
      return tl.empty ? [] : peopleOf(t.key).map(p => ({ tl, p, lv: levelFor(tl, p.vals, months, months.indexOf(cur)) }));
    })
      .filter(x => (peopleLevel === 'all' ? true : peopleLevel === 'rouge' ? x.lv === 'rouge' : x.lv && x.lv !== 'vert'))
      .filter(x => !q || `${x.p.email} ${x.p.name}`.toLowerCase().includes(q))
      .sort((a, b) => LEVEL_ORDER.indexOf(a.lv) - LEVEL_ORDER.indexOf(b.lv) || a.p.email.localeCompare(b.p.email));

    return (
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Historique mois par mois</h2>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>Une ligne par personne et par outil ; chaque mois est coloré selon son niveau d'usage. « Inactif » = aucune utilisation depuis 2 mois ou plus.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Select aria-label="Outil" value={peopleTool} onChange={e => setPeopleTool(e.target.value)} style={{ width: 'auto' }}>
              <option value="all">Tous les outils</option>
              {TOOLS.map(t => <option key={t.key} value={t.key}>{data.tools[t.key].label}</option>)}
            </Select>
            <Select aria-label="Niveau" value={peopleLevel} onChange={e => setPeopleLevel(e.target.value)} style={{ width: 'auto' }}>
              <option value="alert">À surveiller (tout sauf « Utilise »)</option>
              <option value="rouge">Inactif (2 mois ou plus) seulement</option>
              <option value="all">Tous les niveaux</option>
            </Select>
            <input aria-label="Rechercher une personne" placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 180, height: 34 }} />
          </div>
        </div>
        <details style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>Que veulent dire les niveaux ?</summary>
          <div style={{ display: 'grid', gap: 14, marginTop: 10 }}>
            {TOOLS.filter(t => !data.tools[t.key].empty).map(t => (
              <div key={t.key}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{data.tools[t.key].label}</div>
                <LevelLegend tl={toolDef(t.key)} />
              </div>
            ))}
          </div>
        </details>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Outil</th><th>Pays</th><th>Email</th><th>Niveau</th>
                {span.map(m => <th key={m} style={{ textAlign: 'right' }}>{fmtMonth(m, true)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map(({ tl, p, lv }) => (
                <tr key={`${tl.key}|${p.email}`}>
                  <td style={{ fontWeight: 600, color: 'var(--text)' }}>{tl.label}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{countryLabel(p.country)}</td>
                  <td>{p.email}</td>
                  <td><LevelPill level={lv} /></td>
                  {span.map(m => <td key={m} style={{ textAlign: 'right' }}><UsageCell tl={tl} v={p.vals[m]} /></td>)}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4 + span.length} style={{ textAlign: 'center', padding: 28, color: '#22c55e', fontWeight: 600 }}>Aucune licence à surveiller pour ces filtres.</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > 300 && <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>300 premières lignes sur {rows.length} : affine les filtres.</div>}
      </div>
    );
  }

  const subline = cur ? `${fmtMonth(cur)} · ${country === 'all' ? 'tous les pays' : countryLabel(country)}${cmp ? ` · comparé à ${fmtMonth(prevM).toLowerCase()}` : ''}` : '';
  const filtersVisible = data && !allEmpty;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── En-tête ── */}
      <div style={{ position: 'relative' }}>
        <div aria-hidden="true" style={{ position: 'absolute', top: -40, left: '8%', width: 380, height: 120, background: 'radial-gradient(ellipse, rgba(34,211,238,.14) 0%, transparent 70%)', pointerEvents: 'none', filter: 'blur(28px)' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '4px 12px', borderRadius: 999, border: '1px solid rgba(34,211,238,.25)', background: 'rgba(34,211,238,.06)' }}>
              <Icon path={MODULE_ICONS.monitoring} size={11} />
              <span style={{ fontSize: 11, color: 'rgba(103,232,249,.85)', fontWeight: 500, letterSpacing: '.3px' }}>Monitoring</span>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', margin: 0, background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Supervision des licences IA
            </h1>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{subline || 'Usage mensuel par outil et par pays, relevé par le workflow n8n « superviser les IA »'}
              {data?.sharepoint?.last && <> · Synchronisé le {fmtReceived(data.sharepoint.last.at.replace('T', ' ').slice(0, 19))}</>}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {data?.sharepoint?.configured && (
              <button type="button" className="btn btn-primary" disabled={syncing} onClick={syncSharePoint} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {syncing ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <Icon path={REFRESH} size={13} />} Synchroniser SharePoint
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setReloadKey(x => x + 1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon path={REFRESH} size={13} /> Actualiser
            </button>
          </div>
        </div>
      </div>

      <div role="tablist" aria-label="Pages du monitoring" style={{ display: 'flex', gap: 2, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
        {TABS.map(t => {
          const on = t.value === tab;
          return (
            <button key={t.value} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.value)}
              style={{
                background: on ? 'rgba(79,70,229,.08)' : 'transparent', border: 'none',
                borderBottom: `2px solid ${on ? 'var(--primary)' : 'transparent'}`,
                padding: '9px 16px', cursor: 'pointer', fontSize: 13, fontWeight: on ? 600 : 400,
                color: on ? 'var(--text)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6,
                marginBottom: -1, borderRadius: '6px 6px 0 0', transition: 'color .15s, background .15s', fontFamily: 'inherit',
              }}
              onMouseEnter={e => { if (!on) { e.currentTarget.style.color = 'var(--text2)'; e.currentTarget.style.background = 'rgba(255,255,255,.03)'; } }}
              onMouseLeave={e => { if (!on) { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.background = 'transparent'; } }}>
              <Icon path={TAB_ICONS[t.value]} size={13} />
              {data && t.value in data.tools ? data.tools[t.value].label : t.label}
            </button>
          );
        })}
      </div>

      {filtersVisible && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--muted)', margin: 0 }}>
            Mois
            <Select value={cur || ''} onChange={e => setMonth(e.target.value)} style={{ width: 'auto', minWidth: 170, fontWeight: 400, color: 'var(--text)' }}>
              {[...months].reverse().map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
            </Select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--muted)', margin: 0 }}>
            Pays
            <Select value={country} onChange={e => setCountry(e.target.value)} style={{ width: 'auto', minWidth: 170, fontWeight: 400, color: 'var(--text)' }}>
              <option value="all">Tous les pays</option>
              {countries.map(c => <option key={c} value={c}>{countryLabel(c)}</option>)}
            </Select>
          </label>
          {prevM ? (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--muted)', margin: 0 }}>
              Comparer à
              <Select value={compare ? 'prev' : 'none'} onChange={e => setCompare(e.target.value === 'prev')} style={{ width: 'auto', minWidth: 170, fontWeight: 400, color: 'var(--text)' }}>
                <option value="prev">Mois précédent</option>
                <option value="none">Sans comparaison</option>
              </Select>
            </label>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, paddingBottom: 11 }}>La comparaison avec le mois précédent sera disponible dès le 2ᵉ mois de données.</p>
          )}
        </div>
      )}

      {syncMsg && (
        <div role={syncMsg.ok ? 'status' : 'alert'} className={syncMsg.ok ? undefined : 'error-box'}
          style={{ marginBottom: 0, ...(syncMsg.ok ? { padding: '10px 14px', borderRadius: 10, fontSize: 13, color: LEVELS.vert.color, background: LEVELS.vert.bg, border: `1px solid ${LEVELS.vert.border}` } : {}) }}>
          {syncMsg.text}
        </div>
      )}
      {(() => {
        const text = (data?.sharepoint?.last?.results || []).filter(r => !r.ok).map(r => `${r.tool} (${r.error})`).join(', ');
        if (!text || syncMsg || dismissed.has(`sync|${text}`)) return null;
        return (
          <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 12, color: LEVELS.orange.color }}>
            <span style={{ flex: 1 }}>Dernière synchronisation SharePoint incomplète : {text}</span>
            <button type="button" className="btn btn-ghost" style={{ padding: '2px 10px', fontSize: 12, flexShrink: 0 }} onClick={() => dismiss(`sync|${text}`)}>Masquer</button>
          </div>
        );
      })()}

      {error && <div className="error-box" role="alert" style={{ marginBottom: 0 }}>{error}</div>}

      {loading && !data && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><span className="spinner" style={{ width: 26, height: 26 }} /></div>
      )}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
          {tab === 'overview' && renderOverview()}
          {tab === 'people' && renderPeople()}
          {data.tools[tab] && renderTool(tab)}
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
            Constats uniquement : aucune action automatique n'est faite sur les comptes. Seules les licences Actif / Inactif sont comptées ; les mois de référence sont ignorés.
          </p>
        </div>
      )}
    </div>
  );
}

// Usage d'un mois, coloré selon le niveau (sans le « rouge », qui dépend du mois précédent).
function UsageCell({ tl, v }) {
  if (v === undefined || v === null) return <span style={{ color: 'var(--muted)' }}>—</span>;
  const l = LEVELS[valueLevel(tl, v)];
  return <span style={{ display: 'inline-block', minWidth: 34, textAlign: 'center', padding: '2px 7px', borderRadius: 6, fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums', background: l.bg, color: l.color }}>{fmtUsage(v)}</span>;
}
