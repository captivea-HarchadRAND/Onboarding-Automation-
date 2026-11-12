// Rédaction des alertes aux CEOs : l'e-mail (HTML + texte) et le PDF joint, en français ou en anglais.
// Le PDF reprend le design validé dans Claude Design (« PDF alerte licences IA ») : charte du skill captivea-dashboard
// (rouge #BA131A → #E4575D, fond #F5F4F4, cartes blanches, tuiles de chiffres, pastilles), police Nunito incorporée
// (backend/lib/fonts, licence OFL) ; sans ces fichiers, Helvetica. Dimensions du design en px × 0,75 = points PDF.

const path = require('path');
const { Pdf, TtfFont, PAGE } = require('./simplePdf');

const LEVELS = ['rouge', 'orange', 'jaune'];
const CHARTE = { brand: '#BA131A', ink: '#212529', muted: '#6b7177', line: '#e7e2e2', rowLine: '#f0ecec', paper: '#F5F4F4', tint: '#fbe9ea', white: '#ffffff' };
const PILL = { rouge: ['#8f1d14', '#fde4e1'], orange: ['#9a3b00', '#ffe3cc'], jaune: ['#6b5400', '#fdf3c4'] };   // [texte, fond]
const KPI = { rouge: '#BA131A', orange: '#c2410c', jaune: '#a16207' };
const DOT = { claude: '#BA131A', chatgpt: '#2f6db5', fireflies: '#1f9e89' };                                       // séries --s1, --s2, --s4

const plural = (n, one, many) => (n > 1 ? many : one);

const L10N = {
  fr: {
    locale: 'fr-FR',
    months: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
    app: 'Supervision des licences IA',
    units: { claude: 'requêtes', chatgpt: 'M tokens', fireflies: 'réunions' },
    levels: { rouge: 'Inactif · 2 mois ou plus', orange: 'Pas utilisé ce mois-ci', jaune: 'Utilise peu' },
    tiles: ['Licences concernées', 'Inactives 2 mois+', 'Sans usage ce mois', 'Utilisent peu'],
    headers: ['Personne', 'Usage du mois', 'Situation'],
    testBanner: "Message de test : il n'a été envoyé qu'à vous, pas au CEO.",
    footer: 'Captivea · Message automatique, ne pas répondre',
    pdfNote: 'Le détail est aussi joint à ce message en PDF, à télécharger ou à transférer.',
    subject: (test, few, country, n) => `${test ? '[TEST] ' : ''}Licences IA ${few ? 'peu ou pas utilisées' : 'inutilisées'} — ${country} (${n} ${plural(n, 'licence', 'licences')})`,
    title: (country, n, few) => `${country} : ${n} ${plural(n, 'licence IA payée', 'licences IA payées')} ${few ? plural(n, 'peu ou pas utilisée', 'peu ou pas utilisées') : 'sans usage'}`,
    meta: (months, date) => `Relevé : ${months} · généré le ${date}`,
    intro: few => `Ces personnes ont une licence IA (Claude, ChatGPT ou Fireflies) mais ne s'en servent ${few ? 'pas ou très peu' : 'pas'}. Une licence non utilisée reste facturée chaque mois. Nous n'en connaissons pas la raison : le mieux est d'en parler directement avec elles.`,
    cardSub: (month, n) => `${month} · ${n} ${plural(n, 'licence', 'licences')}`,
    pdfTitle: (few, country) => `Licences IA ${few ? 'peu ou pas utilisées' : 'inutilisées'} — ${country}`,
    pdfFile: (slug, month) => `licences-ia-${slug}-${month}.pdf`,
  },
  en: {
    locale: 'en-US',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    app: 'AI license monitoring',
    units: { claude: 'requests', chatgpt: 'M tokens', fireflies: 'meetings' },
    levels: { rouge: 'Inactive · 2+ months', orange: 'Not used this month', jaune: 'Low usage' },
    tiles: ['Licenses concerned', 'Inactive 2+ months', 'No usage this month', 'Low usage'],
    headers: ['Person', 'Monthly usage', 'Status'],
    testBanner: 'Test message: it was sent only to you, not to the CEO.',
    footer: 'Captivea · Automated message, please do not reply',
    pdfNote: 'The details are also attached to this message as a PDF, to download or forward.',
    subject: (test, few, country, n) => `${test ? '[TEST] ' : ''}AI licenses ${few ? 'barely used or unused' : 'unused'} — ${country} (${n} ${plural(n, 'license', 'licenses')})`,
    title: (country, n, few) => `${country}: ${n} paid AI ${plural(n, 'license', 'licenses')} ${few ? 'barely used or unused' : 'unused'}`,
    meta: (months, date) => `Report: ${months} · generated on ${date}`,
    intro: few => `These people have an AI license (Claude, ChatGPT or Fireflies) but ${few ? 'use it little or not at all' : 'do not use it'}. An unused license is still billed every month. We don't know the reason: the best is to check with them directly.`,
    cardSub: (month, n) => `${month} · ${n} ${plural(n, 'license', 'licenses')}`,
    pdfTitle: (few, country) => `AI licenses ${few ? 'barely used or unused' : 'unused'} — ${country}`,
    pdfFile: (slug, month) => `ai-licenses-${slug}-${month}.pdf`,
  },
};
const dict = lang => L10N[lang] || L10N.fr;

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const monthLabel = (m, lang) => { const [y, mm] = String(m).split('-'); const name = dict(lang).months[Number(mm) - 1]; return name ? `${name} ${y}` : String(m); };
// Chiffres d'usage : ChatGPT (millions de tokens) avec une décimale, les autres entiers — mêmes décimales dans toute la colonne.
const fmtUsage = (tool, v, lang) => new Intl.NumberFormat(dict(lang).locale, tool === 'chatgpt' ? { minimumFractionDigits: 1, maximumFractionDigits: 1 } : { maximumFractionDigits: 0 }).format(v);

// Nom affiché : celui du rapport, sinon déduit de l'adresse (« david.vignon@… » → « David Vignon »).
// Une adresse sans séparateur (« pgi@… ») n'a pas de nom lisible : on garde l'adresse seule.
function personName(item) {
  const given = String(item.name || '').trim();
  if (given) return given;
  const local = String(item.email || '').split('@')[0];
  if (!/[._-]/.test(local)) return '';
  const words = local.split(/[._-]+/).map(w => w.replace(/\d+/g, '')).filter(Boolean);
  return words.length < 2 ? '' : words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
const initials = name => {
  const w = String(name).split(/\s+/).filter(Boolean);
  return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
};

// Polices Nunito (incorporées au PDF) : chargées une fois ; si les fichiers manquent, Helvetica.
let FONTS;
function fonts() {
  if (FONTS !== undefined) return FONTS;
  try {
    const dir = path.join(__dirname, 'fonts');
    FONTS = { 400: TtfFont.load(path.join(dir, 'Nunito-Regular.ttf')), 700: TtfFont.load(path.join(dir, 'Nunito-Bold.ttf')), 800: TtfFont.load(path.join(dir, 'Nunito-ExtraBold.ttf')) };
  } catch (_) { FONTS = null; }
  return FONTS;
}

function buildPdf({ country, items, lang, test = false, now = new Date() }) {
  const t = dict(lang), pdf = new Pdf({ fonts: fonts() });
  const L = 36, R = PAGE.w - 36, BOTTOM = PAGE.h - 56;
  const few = items.some(x => x.level === 'jaune'), n = items.length;
  const C = { ink: CHARTE.ink, muted: CHARTE.muted };
  let y = 0;

  const card = (x, top, w, h) => { pdf.roundRect(x, top, w, h, 12, CHARTE.line); pdf.roundRect(x + 0.75, top + 0.75, w - 1.5, h - 1.5, 11.25, CHARTE.white); };
  const newPage = () => {
    pdf.addPage();
    pdf.rect(0, 0, PAGE.w, PAGE.h, CHARTE.paper);
    pdf.rect(0, 0, PAGE.w, 57, CHARTE.white);
    pdf.text(L, 36.5, 'Captivea', { size: 22.5, bold: 800, color: CHARTE.brand, spacing: -0.4 });
    const x = L + pdf.width('Captivea', 22.5, 800, -0.4) + 12;
    pdf.rect(x, 14.5, 0.75, 21, CHARTE.line);
    pdf.text(x + 12, 32.5, t.app, { size: 11.25, bold: 700, color: C.ink });
    pdf.gradientBar(0, 54, PAGE.w, 3, '#ba181d', '#e4575d');
    y = 81;
  };

  newPage();
  if (test) {
    pdf.roundRect(L, y, R - L, 20, 10, '#fff4d6');
    pdf.text(L + 12, y + 13.2, t.testBanner, { size: 8.5, color: '#7a4b00' });
    y += 32;
  }
  // Titre et ligne de référence
  for (const line of pdf.wrap(t.title(country, n, few), R - L, 21, 800)) { pdf.text(L, y + 19.5, line, { size: 21, bold: 800, color: C.ink, spacing: -0.2 }); y += 25.2; }
  y += 4.5;
  const months = [...new Set(items.map(x => monthLabel(x.month, lang)))].join(', ');
  pdf.text(L, y + 9.5, t.meta(months, now.toLocaleDateString(t.locale, { day: 'numeric', month: 'long', year: 'numeric' })), { size: 9.75, color: C.muted });
  y += 13 + 16.5;

  // Tuiles de chiffres : libellé en haut, chiffre calé en bas
  const count = lv => items.filter(x => x.level === lv).length;
  const tiles = [[t.tiles[0], n, C.ink], [t.tiles[1], count('rouge'), KPI.rouge], [t.tiles[2], count('orange'), KPI.orange]];
  if (few) tiles.push([t.tiles[3], count('jaune'), KPI.jaune]);
  const gap = 9, tw = (R - L - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach(([label, value, color], i) => {
    const x = L + i * (tw + gap);
    card(x, y, tw, 69);
    pdf.text(x + 12, y + 18, pdf.fit(label.toUpperCase(), tw - 20, 7.9, 800), { size: 7.9, bold: 800, color: C.muted, spacing: 0.45 });
    pdf.text(x + 12, y + 55, String(value), { size: 28.5, bold: 800, color });
  });
  y += 69 + 16.5;

  // Explication
  for (const line of pdf.wrap(t.intro(few), 480, 10.1)) { pdf.text(L, y + 11.4, line, { size: 10.1, color: C.muted }); y += 15.7; }
  y += 16.5;

  // Une carte par outil ; elle se poursuit sur la page suivante si besoin.
  const HEAD_H = 55.4, ROW_H = 42.75, X0 = L + 15, INNER = R - L - 30;
  const colUsage = X0 + (INNER - 112.5 - 142.5 - 18) + 9, colStatus = colUsage + 112.5 + 9;
  const numRight = colUsage + 69, unitX = colUsage + 73.5, personW = colUsage - 9 - (X0 + 25.5 + 9);
  for (const tool of [...new Set(items.map(x => x.tool))]) {
    const rows = items.filter(x => x.tool === tool), head = rows[0];
    let idx = 0;
    while (idx < rows.length) {
      if (y + HEAD_H + ROW_H + 10 > BOTTOM) { newPage(); continue; }
      const fit = Math.max(1, Math.floor((BOTTOM - y - HEAD_H - 8) / ROW_H));
      const chunk = rows.slice(idx, idx + fit);
      const h = HEAD_H + chunk.length * ROW_H + 4.5;
      card(L, y, R - L, h);
      const cy0 = y + 13.5 + 8.3;                                  // milieu de la ligne de titre
      pdf.roundRect(X0, cy0 - 4.1, 8.25, 8.25, 3, DOT[tool] || C.muted);
      pdf.text(X0 + 15.75, cy0 + 4.5, head.toolLabel + (idx ? ' (…)' : ''), { size: 12.75, bold: 800, color: C.ink });
      const sub = t.cardSub(monthLabel(head.month, lang), rows.length);
      pdf.text(R - 15 - pdf.width(sub, 9.4), cy0 + 3.3, sub, { size: 9.4, color: C.muted });
      const hy = y + 39.1;                                         // en-tête des colonnes
      const hs = { size: 7.9, bold: 800, color: C.muted, spacing: 0.45 };
      pdf.text(X0, hy + 7.5, t.headers[0].toUpperCase(), hs);
      pdf.text(numRight - pdf.width(t.headers[1].toUpperCase(), 7.9, 800, 0.45), hy + 7.5, t.headers[1].toUpperCase(), hs);
      pdf.text(colStatus, hy + 7.5, t.headers[2].toUpperCase(), hs);
      pdf.line(X0, y + HEAD_H - 0.8, R - 15, CHARTE.line, 0.75);
      chunk.forEach((r, i) => {
        const top = y + HEAD_H + i * ROW_H, cy = top + 21;
        const name = personName(r);
        pdf.roundRect(X0, cy - 12.75, 25.5, 25.5, 12.75, CHARTE.tint);
        const ini = name ? initials(name) : '@';
        pdf.text(X0 + 12.75 - pdf.width(ini, 9, 800) / 2, cy + 3.2, ini, { size: 9, bold: 800, color: CHARTE.brand });
        const tx = X0 + 25.5 + 9;
        if (name) {
          pdf.text(tx, cy - 2.1, pdf.fit(name, personW, 10.9, 700), { size: 10.9, bold: 700, color: C.ink });
          pdf.text(tx, cy + 10, pdf.fit(r.email, personW, 9), { size: 9, color: C.muted });
        } else {
          pdf.text(tx, cy + 3.8, pdf.fit(r.email, personW, 10.9), { size: 10.9, color: C.ink });
        }
        const val = fmtUsage(r.tool, r.usage, lang);
        pdf.text(numRight - pdf.width(val, 12, 800), cy + 4.2, val, { size: 12, bold: 800, color: C.ink });
        pdf.text(unitX, cy + 4.2, t.units[r.tool] || r.unit, { size: 8.6, color: C.muted });
        const [fg, bg] = PILL[r.level], label = t.levels[r.level];
        pdf.roundRect(colStatus, cy - 7.75, pdf.width(label, 9, 800) + 18, 15.5, 7.75, bg);
        pdf.text(colStatus + 9, cy + 3.2, label, { size: 9, bold: 800, color: fg });
        pdf.line(X0, top + ROW_H, R - 15, CHARTE.rowLine, 0.6);
      });
      y += h + 16.5;
      idx += chunk.length;
      if (idx < rows.length) newPage();
    }
  }

  // Pied de page numéroté sur chaque page
  const total = pdf.pages.length;
  for (let i = 0; i < total; i++) {
    pdf.usePage(i);
    pdf.line(L, PAGE.h - 40, R, CHARTE.line, 0.75);
    pdf.text(L, PAGE.h - 22, t.footer, { size: 8.6, color: C.muted });
    const p = `Page ${i + 1}/${total}`;
    pdf.text(R - pdf.width(p, 8.6), PAGE.h - 22, p, { size: 8.6, color: C.muted });
  }
  const month = items.map(x => x.month).sort().pop();
  return { buffer: pdf.toBuffer({ title: t.pdfTitle(few, country), created: now }), name: t.pdfFile(slug(country), month) };
}

// Rédige l'e-mail d'un pays. Tout texte venant des rapports est échappé. lang : 'fr' | 'en'.
function buildEmail({ country, items, test = false, withPdf = false, lang = 'fr', now = new Date() }) {
  const t = dict(lang), n = items.length, few = items.some(x => x.level === 'jaune');
  const subject = t.subject(test, few, country, n);
  const title = t.title(country, n, few);
  const sections = [...new Set(items.map(x => x.tool))].map(tool => {
    const rows = items.filter(x => x.tool === tool), head = rows[0];
    return `<h3 style="margin:24px 0 8px;font-size:15px;color:${CHARTE.ink}">${escapeHtml(head.toolLabel)} <span style="font-weight:400;color:${CHARTE.muted};font-size:12px">· ${escapeHtml(t.cardSub(monthLabel(head.month, lang), rows.length))}</span></h3>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
<tr style="text-align:left;color:${CHARTE.muted};font-size:11px;text-transform:uppercase;letter-spacing:.4px"><th style="padding:6px 8px;border-bottom:1px solid ${CHARTE.line}">${escapeHtml(t.headers[0])}</th><th style="padding:6px 8px;border-bottom:1px solid ${CHARTE.line}">${escapeHtml(t.headers[1])}</th><th style="padding:6px 8px;border-bottom:1px solid ${CHARTE.line}">${escapeHtml(t.headers[2])}</th></tr>
${rows.map(r => `<tr><td style="padding:7px 8px;border-bottom:1px solid ${CHARTE.rowLine};color:${CHARTE.ink}">${personName(r) ? `<strong>${escapeHtml(personName(r))}</strong><br>` : ''}<span style="color:${CHARTE.muted}">${escapeHtml(r.email)}</span></td><td style="padding:7px 8px;border-bottom:1px solid ${CHARTE.rowLine};color:${CHARTE.ink};white-space:nowrap"><strong>${escapeHtml(fmtUsage(r.tool, r.usage, lang))}</strong> <span style="color:${CHARTE.muted}">${escapeHtml(t.units[r.tool] || r.unit)}</span></td><td style="padding:7px 8px;border-bottom:1px solid ${CHARTE.rowLine}"><span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;color:${PILL[r.level][0]};background:${PILL[r.level][1]}">${escapeHtml(t.levels[r.level])}</span></td></tr>`).join('\n')}
</table>`;
  }).join('\n');
  const html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px 12px;background:${CHARTE.paper};font-family:Nunito,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${CHARTE.line}">
<tr><td style="padding:20px 28px;border-bottom:3px solid #E4575D"><span style="color:${CHARTE.brand};font-size:24px;font-weight:800">Captivea</span><span style="color:${CHARTE.line};font-size:22px"> &nbsp;|&nbsp; </span><span style="color:${CHARTE.ink};font-size:14px;font-weight:700">${escapeHtml(t.app)}</span></td></tr>
<tr><td style="padding:26px 28px">
${test ? `<p style="margin:0 0 14px;padding:8px 12px;border-radius:8px;background:#fff4d6;color:#7a4b00;font-size:12px">${escapeHtml(t.testBanner)}</p>` : ''}
<p style="margin:0 0 6px;font-size:18px;font-weight:800;color:${CHARTE.ink}">${escapeHtml(title)}</p>
<p style="margin:0;font-size:13px;line-height:1.6;color:${CHARTE.muted}">${escapeHtml(t.intro(few))}</p>
${withPdf ? `<p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:${CHARTE.muted}">${escapeHtml(t.pdfNote)}</p>` : ''}
${sections}
</td></tr>
<tr><td style="background:#faf9f9;border-top:1px solid ${CHARTE.line};padding:14px 28px;text-align:center"><span style="color:${CHARTE.muted};font-size:11px">${escapeHtml(t.footer)}</span></td></tr>
</table></td></tr></table></body></html>`;
  const text = [title, '',
    ...items.map(r => `- ${r.toolLabel} (${monthLabel(r.month, lang)}) : ${personName(r) ? `${personName(r)} <${r.email}>` : r.email} — ${fmtUsage(r.tool, r.usage, lang)} ${t.units[r.tool] || r.unit} — ${t.levels[r.level]}`),
    '', ...(withPdf ? [t.pdfNote] : []), t.footer].join('\n');
  if (!withPdf) return { subject, html, text };
  const pdf = buildPdf({ country, items, lang, test, now });
  return { subject, html, text, pdf: pdf.buffer, pdfName: pdf.name };
}

// Langue de l'alerte d'un pays : réglage enregistré (colonne « Langue » de l'onglet Alertes), sinon français pour
// France, Suisse et Luxembourg, et anglais pour toutes les autres sociétés — y compris une société ajoutée plus tard.
const DEFAULT_FR = /\b(france|suisse|switzerland|luxembourg)\b/i;
const defaultLang = country => (DEFAULT_FR.test(String(country)) ? 'fr' : 'en');
const langFor = (settings, country) => { const l = settings && settings.languages && settings.languages[country]; return l === 'en' || l === 'fr' ? l : defaultLang(country); };

module.exports = { buildEmail, buildPdf, personName, langFor, defaultLang, LEVELS };
