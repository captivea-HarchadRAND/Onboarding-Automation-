// [EN-TÊTE] MonitoringAdmin.jsx — module Monitoring : Administration (/monitoring/admin), administrateurs avec le module.
// Onglet « Source des documents » : chemins des 3 rapports Excel dans SharePoint (PUT /api/monitoring/ai-usage/sharepoint-settings ;
// le drive se règle dans le .env : MONITORING_SP_DRIVE_ID) + « Enregistrer et synchroniser ». Onglet « Pays » : pays du filtre et autres écritures (PUT /api/monitoring/ai-usage/countries). Onglet « Prix » : prix mensuel par outil (Claude : un prix par siège, Premium et Standard)
// (PUT /api/monitoring/ai-usage/prices). Onglet « Alertes » : adresse e-mail du CEO de chaque pays + niveau minimal, aperçu du nombre de
// licences sans usage, envoi de test (à soi) ou au CEO (GET/PUT /api/monitoring/ai-usage/alerts, POST …/alerts/send).

import { useEffect, useState } from 'react';
import { api } from '../api';
import Select from '../components/Select';
import { MODULE_ICONS } from '../modules';
import { TOOLS, LEVELS } from '../monitoringShared';

const PRICE_NOTE = "Sert à calculer le coût des licences inactives. Les licences Claude sont comptées au prix de leur siège (Premium ou Standard, lu dans la colonne « Siège » du rapport) ; ChatGPT et Fireflies ont un seul prix. Saisis le prix réellement payé, hors taxes.";

const SECTIONS = [
  { value: 'source', label: 'Source des documents', icon: ['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'] },
  { value: 'countries', label: 'Pays', icon: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M2 12h20', 'M12 2a15 15 0 0 1 0 20', 'M12 2a15 15 0 0 0 0 20'] },
  { value: 'alerts', label: 'Alertes', icon: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'] },
  { value: 'prices', label: 'Prix', icon: ['M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z', 'M7 7h.01'] },
];

function Icon({ path, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', overflow: 'visible' }}>
      {path.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// Administration du module Monitoring : où se trouvent les rapports (SharePoint) et prix des licences.
export default function MonitoringAdmin() {
  const [data, setData] = useState(null);
  /* types de siège facturés : fournis par le serveur (Claude : Premium + Standard, les autres : Standard) */
  const seatsOf = tool => data?.tools?.[tool]?.seats || ['Standard'];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [section, setSection] = useState('source');
  const [prices, setPrices] = useState({});
  const [priceMsg, setPriceMsg] = useState(null);
  const [spForm, setSpForm] = useState({ claude: '', chatgpt: '', fireflies: '' });
  const [spMsg, setSpMsg] = useState(null);
  const [spBusy, setSpBusy] = useState(false);
  const [countryForm, setCountryForm] = useState([]);
  const [countryMsg, setCountryMsg] = useState(null);
  const [alerts, setAlerts] = useState(null);                 // GET /alerts : réglages enregistrés, aperçu, journal
  const [alertForm, setAlertForm] = useState({ minLevel: 'rouge', autoSend: false, attachPdf: false, languages: {}, recipients: {} });
  const [alertMsg, setAlertMsg] = useState(null);
  const [alertBusy, setAlertBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(null);       // pays (ou 'all') en attente de confirmation
  const [alertReload, setAlertReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get('/api/monitoring/ai-usage')
      .then(d => {
        if (cancelled) return;
        setData(d); setPrices(d.prices);
        setCountryForm((d.countryList || []).map(c => ({ name: c.name, aliases: c.aliases.join(', ') })));
        const saved = d.sharepoint?.settings?.saved;
        if (saved) setSpForm({ claude: saved.paths.claude || '', chatgpt: saved.paths.chatgpt || '', fireflies: saved.paths.fireflies || '' });
      })
      .catch(e => { if (!cancelled) { setData(null); setError(e.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  useEffect(() => {
    if (section !== 'alerts') return undefined;
    let cancelled = false;
    api.get('/api/monitoring/ai-usage/alerts')
      .then(a => {
        if (cancelled) return;
        setAlerts(a);
        setAlertForm({ minLevel: a.settings.minLevel, autoSend: !!a.settings.autoSend, attachPdf: !!a.settings.attachPdf, languages: { ...(a.languages || {}) }, recipients: Object.fromEntries(a.countries.map(c => [c, (a.settings.recipients[c] || []).join(', ')])) });
      })
      .catch(e => { if (!cancelled) setAlertMsg({ ok: false, text: e.message }); });
    return () => { cancelled = true; };
  }, [section, alertReload]);

  const splitEmails = v => String(v || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  const alertBody = () => ({ minLevel: alertForm.minLevel, autoSend: alertForm.autoSend, attachPdf: alertForm.attachPdf, languages: alertForm.languages, recipients: Object.fromEntries(Object.entries(alertForm.recipients).map(([c, v]) => [c, splitEmails(v)])) });
  // Les envois utilisent les réglages ENREGISTRÉS : on bloque donc l'envoi tant que le formulaire a des modifications.
  const alertsDirty = () => !alerts || alertForm.minLevel !== alerts.settings.minLevel || alertForm.autoSend !== !!alerts.settings.autoSend || alertForm.attachPdf !== !!alerts.settings.attachPdf
    || alerts.countries.some(c => (alertForm.languages[c] || 'fr') !== ((alerts.languages || {})[c] || 'fr'))
    || alerts.countries.some(c => splitEmails(alertForm.recipients[c]).join(',') !== (alerts.settings.recipients[c] || []).join(','));

  async function saveAlerts() {
    setAlertBusy(true); setAlertMsg(null);
    try {
      await api.put('/api/monitoring/ai-usage/alerts', alertBody());
      setAlertMsg({ ok: true, text: 'Réglages des alertes enregistrés.' });
      setAlertReload(k => k + 1);
    } catch (e) {
      setAlertMsg({ ok: false, text: e.message });
    } finally { setAlertBusy(false); }
  }

  async function sendAlert(country, test) {
    setAlertBusy(true); setAlertMsg(null); setConfirmSend(null);
    try {
      const out = await api.post('/api/monitoring/ai-usage/alerts/send', { country, test });
      const label = { sent: 'envoyée', nothing: 'aucune licence concernée', no_recipient: "pas d'adresse enregistrée", failed: 'échec' };
      const lines = out.results.map(r => `${r.country.replace(/^Captivea\s+/i, '')} : ${label[r.status] || r.status}${r.status === 'sent' ? ` (${r.count} licence${r.count > 1 ? 's' : ''})` : ''}`);
      setAlertMsg({ ok: out.ok, text: (test ? 'Test — ' : 'Alerte — ') + lines.join(' · ') });
      setAlertReload(k => k + 1);
    } catch (e) {
      setAlertMsg({ ok: false, text: e.message });
    } finally { setAlertBusy(false); }
  }

  async function saveSharePoint(thenSync) {
    setSpBusy(true); setSpMsg(null);
    try {
      await api.put('/api/monitoring/ai-usage/sharepoint-settings', {
        paths: { claude: spForm.claude, chatgpt: spForm.chatgpt, fireflies: spForm.fireflies },
      });
      if (thenSync) {
        const out = await api.post('/api/monitoring/ai-usage/sync');
        const failed = out.results.filter(r => !r.ok);
        setSpMsg(failed.length
          ? { ok: false, text: 'Emplacement enregistré, mais la synchronisation a échoué : ' + failed.map(r => `${r.tool} (${r.error})`).join(' · ') }
          : { ok: true, text: 'Emplacement enregistré et données synchronisées.' });
      } else {
        setSpMsg({ ok: true, text: 'Emplacement enregistré.' });
      }
      setReloadKey(k => k + 1);
    } catch (e) {
      setSpMsg({ ok: false, text: e.message });
    } finally { setSpBusy(false); }
  }

  async function savePrices() {
    setPriceMsg(null);
    try {
      const body = Object.fromEntries(TOOLS.map(t => [t.key, Object.fromEntries(seatsOf(t.key).map(sg => [sg, Number(prices[t.key]?.[sg])]))]));
      await api.put('/api/monitoring/ai-usage/prices', body);
      setPriceMsg({ ok: true, text: 'Prix enregistrés.' });
      setReloadKey(k => k + 1);
    } catch (e) {
      setPriceMsg({ ok: false, text: e.message });
    }
  }

  async function saveCountries() {
    setCountryMsg(null);
    try {
      await api.put('/api/monitoring/ai-usage/countries', {
        countries: countryForm.map(c => ({ name: c.name, aliases: c.aliases.split(',').map(s => s.trim()).filter(Boolean) })),
      });
      setCountryMsg({ ok: true, text: 'Liste des pays enregistrée.' });
      setReloadKey(k => k + 1);
    } catch (e) {
      setCountryMsg({ ok: false, text: e.message });
    }
  }

  /* ── Pays proposés dans le filtre du tableau de bord ── */
  function renderCountries() {
    const setRow = (i, patch) => setCountryForm(rows => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    const listed = new Set(countryForm.map(c => c.name.trim().toLowerCase()));
    const unlisted = (data.unlistedCountries || []).filter(c => !listed.has(c.toLowerCase()));
    return (
      <div className="card" style={{ maxWidth: 760, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Pays du tableau de bord</h2>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 999, color: data.countriesSaved ? LEVELS.vert.color : 'var(--muted)', background: data.countriesSaved ? LEVELS.vert.bg : 'var(--surface2)', border: '1px solid var(--border)' }}>
            {data.countriesSaved ? 'enregistrés' : 'liste par défaut'}
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '6px 0 16px' }}>
          Pays proposés dans le filtre « Pays » du Monitoring, dans cet ordre, même sans licence ce mois-ci. Le nom doit correspondre à la colonne « Pays » des rapports ; « Autres noms » rattache d'autres écritures au même pays (ex. « France » → « Captivea France »), sans tenir compte des majuscules ni des accents.
        </p>
        <div style={{ display: 'grid', gap: 12 }}>
          {countryForm.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr) auto', gap: 10, alignItems: 'end' }}>
              <div>
                <label htmlFor={`ct-name-${i}`}>Nom affiché</label>
                <input id={`ct-name-${i}`} value={c.name} onChange={e => setRow(i, { name: e.target.value })} placeholder="Captivea France" autoComplete="off" maxLength={64} />
              </div>
              <div>
                <label htmlFor={`ct-alias-${i}`}>Autres noms (séparés par des virgules)</label>
                <input id={`ct-alias-${i}`} value={c.aliases} onChange={e => setRow(i, { aliases: e.target.value })} placeholder="France" autoComplete="off" />
              </div>
              <button type="button" className="btn btn-ghost" aria-label={`Retirer ${c.name || 'ce pays'}`} title="Retirer"
                onClick={() => setCountryForm(rows => rows.filter((_, k) => k !== i))} style={{ minHeight: 38 }}>
                <Icon path={['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6']} size={14} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} disabled={countryForm.length >= 30}
          onClick={() => setCountryForm(rows => [...rows, { name: '', aliases: '' }])}>
          <Icon path={['M12 5v14', 'M5 12h14']} size={13} /> Ajouter un pays
        </button>
        {unlisted.length > 0 && (
          <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, background: LEVELS.jaune.bg, border: `1px solid ${LEVELS.jaune.border}` }}>
            <p style={{ fontSize: 12, color: 'var(--text)', margin: '0 0 8px', lineHeight: 1.6 }}>
              Trouvés dans les rapports mais absents de la liste (ils restent affichés à la fin du filtre) :
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {unlisted.map(u => (
                <button key={u} type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px', minHeight: 30 }}
                  onClick={() => setCountryForm(rows => [...rows, { name: u, aliases: '' }])}>
                  <Icon path={['M12 5v14', 'M5 12h14']} size={12} /> Ajouter « {u} »
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
          <button type="button" className="btn btn-primary" onClick={saveCountries}>Enregistrer</button>
          {countryMsg && <span role={countryMsg.ok ? 'status' : 'alert'} style={{ fontSize: 12, fontWeight: 600, color: countryMsg.ok ? LEVELS.vert.color : LEVELS.rouge.color }}>{countryMsg.text}</span>}
        </div>
      </div>
    );
  }

  /* ── Paramètres : emplacement des rapports SharePoint ── */
  function renderSettings() {
    const sp = data.sharepoint?.settings;
    const SRC = { app: ['défini ici', LEVELS.vert], env: ['fichier .env', null], default: ['par défaut', null], none: ['non défini', LEVELS.orange] };
    const badge = src => {
      const [text, l] = SRC[src] || SRC.default;
      return <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap', color: l ? l.color : 'var(--muted)', background: l ? l.bg : 'var(--surface2)', border: `1px solid ${l ? l.border : 'var(--border)'}` }}>{text}</span>;
    };
    const field = (id, label, srcKey, placeholder, hint) => (
      <div key={id}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <label htmlFor={`sp-${id}`} style={{ margin: 0 }}>{label}</label>
          {badge(srcKey)}
        </div>
        <input id={`sp-${id}`} value={spForm[id]} onChange={e => setSpForm(f => ({ ...f, [id]: e.target.value }))}
          placeholder={placeholder} spellCheck={false} autoComplete="off" />
        {hint && <p className="field-hint">{hint}</p>}
      </div>
    );
    return (
      <div className="card" style={{ maxWidth: 760, padding: 18 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Source des données : SharePoint</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '6px 0 16px' }}>
          Chemin des rapports Excel produits par le workflow n8n, dans la bibliothèque SharePoint. L'app les lit en lecture seule. Un champ laissé vide reprend la valeur du fichier <code>.env</code>, sinon celle par défaut.
        </p>
        <div style={{ display: 'grid', gap: 16 }}>
          {TOOLS.map(t => field(t.key, `Rapport ${data.tools[t.key].label}`, sp.sources.paths[t.key], sp.effective.paths[t.key],
            t.key === 'claude' ? 'Chemin du fichier dans la bibliothèque : dossier/sous-dossier/fichier.xlsx. {societe} est remplacé par chaque pays de l\'onglet « Pays » (un rapport par société, comme dans le workflow n8n) ; une société sans rapport est ignorée.' : null))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
          <button type="button" className="btn btn-primary" disabled={spBusy} onClick={() => saveSharePoint(false)}>Enregistrer</button>
          <button type="button" className="btn btn-ghost" disabled={spBusy} onClick={() => saveSharePoint(true)}>
            {spBusy && <span className="spinner" style={{ width: 13, height: 13 }} />} Enregistrer et synchroniser
          </button>
          {spMsg && <span role={spMsg.ok ? 'status' : 'alert'} style={{ fontSize: 12, fontWeight: 600, color: spMsg.ok ? LEVELS.vert.color : LEVELS.rouge.color }}>{spMsg.text}</span>}
        </div>
        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, margin: '14px 0 0' }}>
          La bibliothèque SharePoint se définit dans le <code>.env</code> du serveur (<code>MONITORING_SP_DRIVE_ID</code>) : {sp.driveConfigured ? <b style={{ color: LEVELS.vert.color }}>configurée</b> : <b style={{ color: LEVELS.orange.color }}>non configurée</b>}. L'accès se règle côté Microsoft 365 : l'app Entra doit avoir la permission <code>Sites.Selected</code> et la lecture sur le site concerné. Une synchronisation automatique tourne toutes les 6 h dès que la bibliothèque est configurée.
        </p>
      </div>
    );
  }

  /* ── Alertes aux CEOs ── */
  function renderAlerts() {
    if (!alerts) {
      return alertMsg
        ? <div className="error-box" role="alert">{alertMsg.text}</div>
        : <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" style={{ width: 22, height: 22 }} /></div>;
    }
    const dirty = alertsDirty();
    const countOf = c => alerts.counts?.[c]?.[alertForm.minLevel] ?? 0;
    const withMail = alerts.countries.filter(c => (alerts.settings.recipients[c] || []).length);
    const canSend = alerts.smtpConfigured && !dirty && !alertBusy;
    const mois = Object.entries(alerts.months || {}).map(([t, m]) => `${data.tools[t]?.label || t} ${m}`).join(' · ');
    const small = { padding: '4px 12px', fontSize: 12, minHeight: 32 };
    const moisLong = m => { const [y, mm] = String(m).split('-'); return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); };
    const confirmRow = (text, onYes) => (
      <span role="group" aria-label={text} title={text} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
        <button type="button" className="btn btn-danger" style={small} disabled={alertBusy} onClick={onYes} autoFocus>Confirmer</button>
        <button type="button" className="btn btn-ghost" style={small} onClick={() => setConfirmSend(null)}>Annuler</button>
      </span>
    );
    const smtpColors = alerts.smtpConfigured ? LEVELS.vert : LEVELS.orange;
    return (
      <div style={{ display: 'grid', gap: 16, maxWidth: 820 }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Alerter les CEOs</h2>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 999, color: smtpColors.color, background: smtpColors.bg, border: `1px solid ${smtpColors.border}` }}>
              {alerts.smtpConfigured ? "envoi d'e-mails configuré" : "envoi d'e-mails non configuré (SMTP)"}
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '6px 0 16px' }}>
            Indique l'adresse du CEO de chaque pays. Il reçoit la liste des personnes de son pays qui ont une licence IA (Claude, ChatGPT, Fireflies) mais ne s'en servent pas. Tu peux envoyer à la main ci-dessous, ou activer l'envoi automatique.
            {mois && <> Relevé pris en compte : {mois}.</>}
          </p>
          <div style={{ maxWidth: 520 }}>
            <label htmlFor="al-level">Quelles licences signaler ?</label>
            <Select id="al-level" value={alertForm.minLevel} onChange={e => setAlertForm(f => ({ ...f, minLevel: e.target.value }))}>
              <option value="rouge">Inactives depuis 2 mois ou plus (rouge)</option>
              <option value="orange">Dès qu'une licence n'a pas servi ce mois-ci (orange et rouge)</option>
              <option value="jaune">Aussi celles qui servent peu (jaune, orange et rouge)</option>
            </Select>
            {alertForm.minLevel === 'jaune' && (
              <p className="field-hint" style={{ marginTop: 6 }}>
                « Utilise peu » = plus de 0 mais sous le seuil de l'outil : {Object.values(data.tools).map(t => `${t.label} moins de ${t.lowBelow} ${t.unit}`).join(' · ')}.
              </p>
            )}
          </div>
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <label htmlFor="al-auto" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: 0, cursor: 'pointer' }}>
              <input id="al-auto" type="checkbox" checked={alertForm.autoSend} onChange={e => setAlertForm(f => ({ ...f, autoSend: e.target.checked }))} style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0 }} />
              <span>
                <span style={{ display: 'block', fontWeight: 600, color: 'var(--text)' }}>Envoyer l'alerte automatiquement</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginTop: 2 }}>
                  Une seule alerte par mois et par pays, dès que les données du mois sont prêtes (tous les outils ont le nouveau mois, ou 24 h après le premier si l'un est en retard). Après chaque synchronisation et toutes les 6 h, l'application vérifie seulement si une alerte est due : une alerte déjà envoyée pour ce mois ne repart jamais.
                </span>
              </span>
            </label>
            {alerts.auto?.month && (
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0 28px', lineHeight: 1.6 }}>
                Mois suivi : <b style={{ color: 'var(--text)' }}>{alerts.auto.month}</b> · {alerts.auto.ready ? 'données prêtes' : 'en attente'} ({alerts.auto.reason.toLowerCase()}).
              </p>
            )}
          </div>
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <label htmlFor="al-pdf" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: 0, cursor: 'pointer' }}>
              <input id="al-pdf" type="checkbox" checked={alertForm.attachPdf} onChange={e => setAlertForm(f => ({ ...f, attachPdf: e.target.checked }))} style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0 }} />
              <span>
                <span style={{ display: 'block', fontWeight: 600, color: 'var(--text)' }}>Joindre le détail en PDF</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginTop: 2 }}>
                  L'e-mail contient en pièce jointe un PDF aux couleurs Captivea avec la liste des licences du pays, que le CEO peut télécharger ou transférer. S'applique aux envois manuels, aux tests et à l'envoi automatique.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Adresse du CEO par pays</h2>
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '6px 0 16px' }}>
            Plusieurs adresses possibles (séparées par une virgule, 5 au maximum). Laisse vide pour ne pas alerter un pays.
          </p>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(148,163,184,.06)' }}>
                  {[['Pays', 'left'], ['E-mail du CEO', 'left'], ['Langue', 'left'], ['Licences', 'right'], ['Dernière alerte', 'left'], ['Envoi', 'right']].map(([h, a]) => (
                    <th key={h} scope="col" style={{ padding: '10px 14px', textAlign: a, fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {alerts.countries.map(c => {
                  const n = countOf(c);
                  const saved = (alerts.settings.recipients[c] || []).length > 0;
                  const lastSent = alerts.auto?.sent?.[c];
                  const cell = { padding: '10px 14px', borderTop: '1px solid var(--border)', verticalAlign: 'middle' };
                  return (
                    <tr key={c}>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        {/^Captivea\s+/i.test(c) && <span style={{ color: 'var(--muted)' }}>Captivea </span>}<b style={{ color: 'var(--text)' }}>{c.replace(/^Captivea\s+/i, '')}</b>
                      </td>
                      <td style={{ ...cell, minWidth: 240 }}>
                        <input type="text" inputMode="email" autoComplete="off" spellCheck={false} aria-label={`E-mail du CEO — ${c}`} placeholder="prenom.nom@captivea.com"
                          style={{ margin: 0, padding: '7px 10px', fontSize: 13, width: '100%', minWidth: 230 }}
                          value={alertForm.recipients[c] || ''} onChange={e => setAlertForm(f => ({ ...f, recipients: { ...f.recipients, [c]: e.target.value } }))} />
                      </td>
                      <td style={cell}>
                        <Select aria-label={`Langue de l'e-mail et du PDF — ${c}`} value={alertForm.languages[c] || 'fr'} style={{ width: 'auto', minWidth: 84 }}
                          onChange={e => setAlertForm(f => ({ ...f, languages: { ...f.languages, [c]: e.target.value } }))}>
                          <option value="fr">Français</option>
                          <option value="en">English</option>
                        </Select>
                      </td>
                      <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {n > 0
                          ? <span title={`${n} licence${n > 1 ? 's' : ''} sans usage au dernier mois relevé`} style={{ display: 'inline-block', minWidth: 28, textAlign: 'center', fontSize: 12, fontWeight: 800, padding: '2px 9px', borderRadius: 999, color: LEVELS.orange.color, background: LEVELS.orange.bg, border: `1px solid ${LEVELS.orange.border}` }}>{n}</span>
                          : <span style={{ color: 'var(--muted)' }} aria-label="aucune licence concernée">0</span>}
                      </td>
                      <td style={{ ...cell, whiteSpace: 'nowrap', color: lastSent ? 'var(--text2)' : 'var(--muted)', fontSize: 12 }}>
                        {lastSent ? moisLong(lastSent) : '—'}
                      </td>
                      <td style={{ ...cell, textAlign: 'right' }}>
                        {confirmSend === c
                          ? confirmRow(`Envoyer à ${(alerts.settings.recipients[c] || []).join(', ')} ?`, () => sendAlert(c, false))
                          : saved && n > 0
                            ? (
                              <span style={{ display: 'inline-flex', gap: 8 }}>
                                <button type="button" className="btn btn-ghost" style={small} disabled={!canSend} onClick={() => sendAlert(c, true)}>Test</button>
                                <button type="button" className="btn btn-primary" style={small} disabled={!canSend} onClick={() => setConfirmSend(c)}>Envoyer</button>
                              </span>
                            )
                            : <span style={{ fontSize: 12, color: 'var(--muted)' }}>{!saved ? 'pas d’adresse' : 'rien à signaler'}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button type="button" className="btn btn-primary" disabled={alertBusy || !dirty} onClick={saveAlerts}>
              {alertBusy && <span className="spinner" style={{ width: 13, height: 13 }} />} Enregistrer
            </button>
            {confirmSend === 'all'
              ? confirmRow(`Envoyer aux ${withMail.length} pays qui ont une adresse ?`, () => sendAlert('all', false))
              : <button type="button" className="btn btn-ghost" disabled={!canSend || withMail.length === 0} onClick={() => setConfirmSend('all')}>Envoyer à tous les CEOs</button>}
            {dirty && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Enregistre d'abord les modifications pour pouvoir envoyer.</span>}
          </div>
          {alertMsg && <p role={alertMsg.ok ? 'status' : 'alert'} style={{ fontSize: 12, fontWeight: 600, margin: '12px 0 0', color: alertMsg.ok ? LEVELS.vert.color : LEVELS.rouge.color }}>{alertMsg.text}</p>}
        </div>

      </div>
    );
  }

  /* ── Prix ── */
  function renderPrices() {
    return (
      <div className="card" style={{ maxWidth: 640, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Prix mensuel par licence</h2>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 999, color: data.pricesSaved ? LEVELS.vert.color : 'var(--muted)', background: data.pricesSaved ? LEVELS.vert.bg : 'var(--surface2)', border: '1px solid var(--border)' }}>
            {data.pricesSaved ? 'enregistrés' : "valeurs d'exemple"}
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '6px 0 14px' }}>{PRICE_NOTE}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          {TOOLS.flatMap(t => seatsOf(t.key).map(sg => (
            <label key={t.key + sg} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
              {data.tools[t.key].label}{seatsOf(t.key).length > 1 ? ' ' + sg : ''} · € / mois
              <input type="number" min="0" step="0.5" value={prices[t.key]?.[sg] ?? ''} onChange={e => setPrices(p => ({ ...p, [t.key]: { ...p[t.key], [sg]: e.target.value } }))} />
            </label>
          )))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button type="button" className="btn btn-primary" onClick={savePrices}>Enregistrer</button>
          {priceMsg && <span role="status" style={{ fontSize: 12, fontWeight: 600, color: priceMsg.ok ? LEVELS.vert.color : LEVELS.rouge.color }}>{priceMsg.text}</span>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ marginBottom: 6, position: 'relative' }}>
        <div aria-hidden="true" style={{ position: 'absolute', top: -24, left: '5%', width: 300, height: 100, background: 'radial-gradient(ellipse, rgba(245,158,11,.08) 0%, transparent 70%)', pointerEvents: 'none', filter: 'blur(20px)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '3px 10px', borderRadius: 999, border: '1px solid rgba(245,158,11,.2)', background: 'rgba(245,158,11,.06)' }}>
            <Icon path={['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z']} size={11} />
            <span style={{ fontSize: 11, color: 'rgba(245,158,11,.7)', fontWeight: 500, letterSpacing: '.3px' }}>Administration</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', margin: 0, background: 'linear-gradient(to bottom, #ffffff 35%, rgba(255,255,255,.4))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Administration
          </h1>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Monitoring · source des rapports des licences IA et prix de chaque licence.</p>
        </div>
      </div>

      {error && <div className="error-box" role="alert" style={{ marginBottom: 0 }}>{error}</div>}
      {loading && !data && <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><span className="spinner" style={{ width: 26, height: 26 }} /></div>}
      {data && (
        <>
          <div role="tablist" aria-label="Sections d'administration" style={{ display: 'flex', gap: 2, marginBottom: 8, borderBottom: '1px solid var(--border)' }}>
            {SECTIONS.map(s => {
              const on = s.value === section;
              return (
                <button key={s.value} type="button" role="tab" id={`tab-${s.value}`} aria-selected={on} aria-controls={`panel-${s.value}`} onClick={() => setSection(s.value)}
                  style={{
                    background: on ? 'rgba(79,70,229,.08)' : 'transparent', border: 'none',
                    borderBottom: `2px solid ${on ? 'var(--primary)' : 'transparent'}`,
                    padding: '9px 16px', cursor: 'pointer', fontSize: 13, fontWeight: on ? 600 : 400,
                    color: on ? 'var(--text)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6,
                    marginBottom: -1, borderRadius: '6px 6px 0 0', transition: 'color .15s, background .15s', fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => { if (!on) { e.currentTarget.style.color = 'var(--text2)'; e.currentTarget.style.background = 'rgba(255,255,255,.03)'; } }}
                  onMouseLeave={e => { if (!on) { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.background = 'transparent'; } }}>
                  <Icon path={s.icon} size={13} />
                  {s.label}
                </button>
              );
            })}
          </div>
          <div role="tabpanel" id={`panel-${section}`} aria-labelledby={`tab-${section}`}>
            {section === 'source' ? renderSettings() : section === 'countries' ? renderCountries() : section === 'alerts' ? renderAlerts() : renderPrices()}
          </div>
        </>
      )}
    </div>
  );
}
