// Lecture d'un classeur .xlsx sans dépendance (zlib de Node + analyse du XML), même approche que le
// nœud n8n « Données dashboard ». Lecture seule : renvoie les onglets et leurs lignes.
// Le fichier vient de SharePoint, donc il est traité comme non fiable : taille, nombre d'entrées et
// taille décompressée sont bornés (protection contre une « bombe » zip).
const zlib = require('zlib');

const LIMITS = { fileBytes: 20 * 1024 * 1024, entries: 200, entryBytes: 50 * 1024 * 1024 };

function bad(message) {
  const e = new Error(message);
  e.xlsx = true;
  return e;
}

function unzip(buf) {
  if (buf.length > LIMITS.fileBytes) throw bad('Classeur trop volumineux');
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw bad('Le fichier n\'est pas un classeur Excel valide');
  const total = buf.readUInt16LE(e + 10);
  if (total > LIMITS.entries) throw bad('Classeur invalide (trop d\'entrées)');
  let p = buf.readUInt32LE(e + 16);
  const files = new Map();
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad('Classeur illisible (répertoire zip)');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const loc = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nl);
    if (loc + 30 > buf.length) throw bad('Classeur illisible (entrée hors fichier)');
    const start = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
    const raw = buf.subarray(start, start + csize);
    if (method === 0) files.set(name, Buffer.from(raw));
    else if (method === 8) {
      try { files.set(name, zlib.inflateRawSync(raw, { maxOutputLength: LIMITS.entryBytes })); }
      catch (_) { throw bad('Classeur illisible (données compressées invalides)'); }
    }
    p += 46 + nl + xl + cl;
  }
  return files;
}

const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');
const attr = (tag, a) => { const m = tag.match(new RegExp(`\\s${a}="([^"]*)"`)); return m ? m[1] : null; };
const textOf = x => [...String(x).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1])).join('');
const colIndex = L => [...L].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// → [{ name, rows: [[cellule, …], …] }]
function readWorkbook(buf) {
  const files = unzip(buf);
  const txt = n => (files.get(n) || Buffer.from('')).toString('utf8');
  const shared = files.has('xl/sharedStrings.xml')
    ? [...txt('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]))
    : [];
  const rels = txt('xl/_rels/workbook.xml.rels').match(/<Relationship\b[^>]*\/?>/g) || [];
  return (txt('xl/workbook.xml').match(/<sheet\b[^>]*\/?>/g) || []).map(tag => {
    const rid = (tag.match(/\s[\w-]+:id="([^"]*)"/) || [])[1];
    const rel = rels.find(r => attr(r, 'Id') === rid);
    const target = rel ? attr(rel, 'Target') : '';
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const rows = [...txt(path).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(rm => {
      const r = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = cm[1], inner = cm[2] || '', ref = (a.match(/\sr="([A-Z]+)\d+"/) || [])[1];
        if (!ref) continue;
        const t = (a.match(/\st="([^"]*)"/) || [])[1], v = (inner.match(/<v>([^<]*)<\/v>/) || [])[1];
        const col = colIndex(ref);
        if (col > 200) continue; // colonne aberrante : ignorée (évite un tableau géant)
        r[col] = t === 'inlineStr' ? textOf(inner)
          : t === 's' ? (shared[Number(v)] ?? '')
          : v === undefined ? ''
          : (t === 'str' || t === 'e' || t === 'b') ? unesc(v) : Number(v);
      }
      return r;
    });
    return { name: unesc(attr(tag, 'name') || ''), rows };
  });
}

module.exports = { readWorkbook };
