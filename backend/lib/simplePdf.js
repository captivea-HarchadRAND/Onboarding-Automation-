// Générateur de PDF minimal, sans dépendance (même esprit que lib/xlsx.js) : pages A4, rectangles (arrondis, dégradé),
// texte en une ligne. Deux modes de police :
//   - polices TrueType INCORPORÉES au fichier (Nunito, licence OFL) : rendu identique partout, largeurs exactes ;
//   - à défaut, Helvetica standard (non incorporée), avec des largeurs estimées.
// Usage : const pdf = new Pdf({ fonts: { 400: TtfFont.load(f1), 700: TtfFont.load(f2), 800: TtfFont.load(f3) } });
//         pdf.addPage(); pdf.rect(…); pdf.text(…); const buffer = pdf.toBuffer({ title }).
// Polices Helvetica : textes convertis en Windows-1252 (accents français, « — », « · », « … », « € »), le reste devient « ? ».

const fs = require('fs');
const zlib = require('zlib');

const PAGE = { w: 595.28, h: 841.89 };   // A4 en points

// ── Police TrueType : lecture des tables utiles à l'incorporation ───────────────────────────────────────
class TtfFont {
  static load(file) { return new TtfFont(fs.readFileSync(file), require('path').basename(file, '.ttf')); }

  constructor(buf, name) {
    this.buf = buf; this.name = name;
    const n = buf.readUInt16BE(4);
    this.t = {};
    for (let i = 0; i < n; i++) { const o = 12 + i * 16; this.t[buf.toString('latin1', o, o + 4)] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) }; }
    for (const k of ['head', 'hhea', 'hmtx', 'maxp', 'cmap']) if (!this.t[k]) throw new Error(`police sans table ${k}`);
    const head = this.t.head.off, hhea = this.t.hhea.off;
    this.upem = buf.readUInt16BE(head + 18);
    this.bbox = [buf.readInt16BE(head + 36), buf.readInt16BE(head + 38), buf.readInt16BE(head + 40), buf.readInt16BE(head + 42)];
    this.ascent = buf.readInt16BE(hhea + 4); this.descent = buf.readInt16BE(hhea + 6);
    this.numMetrics = buf.readUInt16BE(hhea + 34);
    const os2 = this.t['OS/2'];
    this.capHeight = os2 && os2.len >= 90 ? buf.readInt16BE(os2.off + 88) : Math.round(this.ascent * 0.7);
    this.cmap = this.readCmap();
  }

  readCmap() {
    const { off } = this.t.cmap, b = this.buf, n = b.readUInt16BE(off + 2);
    let pick = null;
    for (let i = 0; i < n; i++) {
      const plat = b.readUInt16BE(off + 4 + i * 8), enc = b.readUInt16BE(off + 6 + i * 8), sub = off + b.readUInt32BE(off + 8 + i * 8);
      const fmt = b.readUInt16BE(sub);
      if ((plat === 3 && enc === 10 && fmt === 12) || (!pick && ((plat === 3 && enc === 1) || plat === 0) && (fmt === 4 || fmt === 12))) pick = { sub, fmt };
    }
    if (!pick) throw new Error('police sans table cmap Unicode lisible');
    return pick;
  }

  gid(cp) {
    const b = this.buf, { sub, fmt } = this.cmap;
    if (fmt === 12) {
      const groups = b.readUInt32BE(sub + 12);
      for (let i = 0; i < groups; i++) {
        const o = sub + 16 + i * 12, s = b.readUInt32BE(o), e = b.readUInt32BE(o + 4);
        if (cp >= s && cp <= e) return b.readUInt32BE(o + 8) + (cp - s);
      }
      return 0;
    }
    const segX2 = b.readUInt16BE(sub + 6), segs = segX2 / 2;
    const endO = sub + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
    for (let i = 0; i < segs; i++) {
      if (cp > b.readUInt16BE(endO + i * 2)) continue;
      const start = b.readUInt16BE(startO + i * 2);
      if (cp < start) return 0;
      const delta = b.readInt16BE(deltaO + i * 2), ro = b.readUInt16BE(rangeO + i * 2);
      if (ro === 0) return (cp + delta) & 0xffff;
      const g = b.readUInt16BE(rangeO + i * 2 + ro + (cp - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  }

  advance(gid) {
    const h = this.t.hmtx.off, i = Math.min(gid, this.numMetrics - 1);
    return this.buf.readUInt16BE(h + i * 4);
  }

  // Convertit un texte en identifiants de glyphes. `record` (Map gid → point de code) mémorise ce qui est écrit,
  // pour les largeurs et le ToUnicode du document ; il appartient au document (la police est partagée entre documents).
  glyphs(str, record) {
    const out = [], fallback = this.gid(63);
    for (const ch of String(str ?? '')) {
      let cp = ch.codePointAt(0), g = this.gid(cp);
      if (!g) { g = fallback; cp = 63; }                 // caractère absent de la police : « ? »
      if (record) record.set(g, cp);
      out.push(g);
    }
    return out;
  }

  width(str, size) { return this.glyphs(str).reduce((t, g) => t + this.advance(g), 0) * size / this.upem; }
  scale(v) { return Math.round(v * 1000 / this.upem); }
}

// ── Repli Helvetica (largeurs estimées) ──────────────────────────────────────────────────────────────
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const CP1252 = { 0x2014: 0x97, 0x2013: 0x96, 0x2019: 0x92, 0x2018: 0x91, 0x201c: 0x93, 0x201d: 0x94, 0x2026: 0x85, 0x20ac: 0x80, 0x2022: 0x95 };
const toByte = ch => { const c = ch.codePointAt(0); if (CP1252[c]) return CP1252[c]; return c >= 32 && c <= 255 ? c : 63; };
const helvWidth = (ch, bold) => { const c = toByte(ch); return (c >= 32 && c <= 126 ? W[c - 32] : 556) * (bold ? 1.07 : 1); };
const esc = s => [...String(s)].map(ch => { const b = toByte(ch); return b === 40 || b === 41 || b === 92 ? '\\' + String.fromCharCode(b) : String.fromCharCode(b); }).join('');

const num = n => (Math.round(n * 100) / 100).toString();
const rgb = hex => { const h = String(hex).replace('#', ''); return [0, 2, 4].map(i => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(' '); };
const hex4 = n => n.toString(16).padStart(4, '0');

class Pdf {
  // fonts : { 400: TtfFont, 700: TtfFont, 800: TtfFont } ; sans fonts → Helvetica
  constructor({ fonts = null } = {}) { this.pages = []; this.fonts = fonts; this.used = { F1: new Map(), F2: new Map(), F3: new Map() }; }
  addPage() { this.pages.push([]); this.cur = this.pages.length - 1; return this.cur; }
  usePage(i) { this.cur = i; }                        // pour écrire sur une page déjà créée (pied de page « Page i/n »)
  get page() { return PAGE; }
  get current() { return this.pages[this.cur]; }

  // bold : true → 700, false → 400, ou un poids (400 / 700 / 800)
  weightOf(bold) { return bold === true ? 700 : !bold ? 400 : bold; }
  fontFor(weight) { return this.fonts ? (this.fonts[weight] || this.fonts[700] || this.fonts[400]) : null; }
  fontKey(weight) { return this.fonts ? { 400: 'F1', 700: 'F2', 800: 'F3' }[this.fontFor(weight) === this.fonts[800] ? 800 : this.fontFor(weight) === this.fonts[700] ? 700 : 400] : (weight >= 700 ? 'F2' : 'F1'); }

  // spacing : espacement supplémentaire entre lettres, en points (comme letter-spacing en CSS)
  width(str, size, bold = false, spacing = 0) {
    const w = this.weightOf(bold), f = this.fontFor(w), count = [...String(str ?? '')].length;
    const base = f ? f.width(str, size) : [...String(str)].reduce((t, ch) => t + helvWidth(ch, w >= 700), 0) * size / 1000;
    return base + spacing * count;
  }
  // Coupe avec « … » si le texte dépasse maxW.
  fit(str, maxW, size, bold = false) {
    const s = String(str ?? '');
    if (this.width(s, size, bold) <= maxW) return s;
    let out = '';
    for (const ch of s) { if (this.width(out + ch + '…', size, bold) > maxW) break; out += ch; }
    return out + '…';
  }
  // Découpe un paragraphe en lignes qui tiennent dans maxW.
  wrap(str, maxW, size, bold = false) {
    const lines = []; let line = '';
    for (const word of String(str ?? '').split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && this.width(next, size, bold) > maxW) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  // yTop = ordonnée de la ligne de base, mesurée depuis le HAUT de la page (plus simple pour une mise en page).
  text(x, yTop, str, { size = 10, bold = false, color = '#1e293b', spacing = 0 } = {}) {
    const w = this.weightOf(bold), f = this.fontFor(w), key = this.fontKey(w);
    const body = f ? `<${f.glyphs(str, this.used[key]).map(hex4).join('')}>` : `(${esc(str)})`;
    const tc = spacing ? `${num(spacing)} Tc ` : '';
    this.current.push(`${rgb(color)} rg BT /${key} ${num(size)} Tf ${tc}${num(x)} ${num(PAGE.h - yTop)} Td ${body} Tj ${spacing ? '0 Tc ' : ''}ET`);
  }
  rect(x, yTop, w, h, color) {
    this.current.push(`${rgb(color)} rg ${num(x)} ${num(PAGE.h - yTop - h)} ${num(w)} ${num(h)} re f`);
  }
  // Rectangle à coins arrondis (r >= h/2 donne une pastille). Courbes de Bézier : 0,5523 = cercle approché.
  roundRect(x, yTop, w, h, r, color) {
    r = Math.min(r, w / 2, h / 2);
    const k = r * 0.5523, y = PAGE.h - yTop - h;
    this.current.push([
      `${rgb(color)} rg`,
      `${num(x + r)} ${num(y)} m`, `${num(x + w - r)} ${num(y)} l`,
      `${num(x + w - r + k)} ${num(y)} ${num(x + w)} ${num(y + r - k)} ${num(x + w)} ${num(y + r)} c`,
      `${num(x + w)} ${num(y + h - r)} l`,
      `${num(x + w)} ${num(y + h - r + k)} ${num(x + w - r + k)} ${num(y + h)} ${num(x + w - r)} ${num(y + h)} c`,
      `${num(x + r)} ${num(y + h)} l`,
      `${num(x + r - k)} ${num(y + h)} ${num(x)} ${num(y + h - r + k)} ${num(x)} ${num(y + h - r)} c`,
      `${num(x)} ${num(y + r)} l`,
      `${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c`, 'f',
    ].join('\n'));
  }
  // Dégradé horizontal approché par de fines bandes (pas de dégradé natif dans ce mini générateur).
  gradientBar(x, yTop, w, h, from, to, steps = 48) {
    const a = [0, 2, 4].map(i => parseInt(String(from).replace('#', '').slice(i, i + 2), 16));
    const b = [0, 2, 4].map(i => parseInt(String(to).replace('#', '').slice(i, i + 2), 16));
    for (let i = 0; i < steps; i++) {
      const c = a.map((v, k) => Math.round(v + (b[k] - v) * i / (steps - 1)));
      this.rect(x + (w * i) / steps, yTop, w / steps + 0.4, h, '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''));
    }
  }
  line(x1, yTop, x2, color = '#e2e8f0', thickness = 0.6) {
    this.current.push(`${rgb(color)} RG ${num(thickness)} w ${num(x1)} ${num(PAGE.h - yTop)} m ${num(x2)} ${num(PAGE.h - yTop)} l S`);
  }

  toBuffer({ title = '', author = 'Captivea', created = new Date() } = {}) {
    const objs = [];                                  // objs[i] = contenu de l'objet i + 1 (chaîne « binaire » latin1)
    const add = body => { objs.push(body); return objs.length; };
    const stream = (dict, data) => `<< ${dict} /Length ${data.length} >>\nstream\n${data.toString('latin1')}\nendstream`;
    const catalog = add(''), pagesObj = add('');
    const fontRefs = {};                               // 'F1' → numéro d'objet
    if (!this.fonts) {
      fontRefs.F1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      fontRefs.F2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    } else {
      for (const [key, weight] of [['F1', 400], ['F2', 700], ['F3', 800]]) {
        const f = this.fonts[weight], used = [...this.used[key].entries()].sort((a, b) => a[0] - b[0]);
        if (!f || !used.length) continue;                // police non utilisée dans ce document : non incorporée
        const file = add(stream(`/Filter /FlateDecode /Length1 ${f.buf.length}`, zlib.deflateSync(f.buf, { level: 9 })));
        const bb = f.bbox.map(v => f.scale(v)).join(' ');
        const desc = add(`<< /Type /FontDescriptor /FontName /${f.name} /Flags 32 /FontBBox [${bb}] /ItalicAngle 0 /Ascent ${f.scale(f.ascent)} /Descent ${f.scale(f.descent)} /CapHeight ${f.scale(f.capHeight)} /StemV ${weight >= 800 ? 120 : weight >= 700 ? 100 : 80} /FontFile2 ${file} 0 R >>`);
        const widths = used.map(([g]) => `${g} [${f.scale(f.advance(g))}]`).join(' ');
        const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /CIDToGIDMap /Identity /DW 1000 /W [${widths}] >>`);
        let cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n';
        for (let i = 0; i < used.length; i += 100) {
          const chunk = used.slice(i, i + 100);
          cmap += `${chunk.length} beginbfchar\n${chunk.map(([g, cp]) => `<${hex4(g)}> <${cp > 0xffff ? hex4(0xd800 + ((cp - 0x10000) >> 10)) + hex4(0xdc00 + ((cp - 0x10000) & 0x3ff)) : hex4(cp)}>`).join('\n')}\nendbfchar\n`;
        }
        cmap += 'endcmap CMapName currentdict /CMap defineresource pop end end';
        const toUni = add(stream('', Buffer.from(cmap, 'latin1')));
        fontRefs[key] = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${f.name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUni} 0 R >>`);
      }
    }
    const fontDict = Object.entries(fontRefs).map(([k, n]) => `/${k} ${n} 0 R`).join(' ');
    const kids = [];
    for (const ops of this.pages) {
      const content = add(stream('', Buffer.from(ops.join('\n'), 'latin1')));
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(PAGE.w)} ${num(PAGE.h)}] /Resources << /Font << ${fontDict} >> >> /Contents ${content} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const d = created, p2 = n => String(n).padStart(2, '0');
    const date = `D:${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
    const info = add(`<< /Title (${esc(title)}) /Author (${esc(author)}) /Producer (Captivea) /CreationDate (${date}) >>`);

    let out = '%PDF-1.4\n%âãÏÓ\n';
    const offsets = [];
    objs.forEach((body, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}

module.exports = { Pdf, TtfFont, PAGE };
