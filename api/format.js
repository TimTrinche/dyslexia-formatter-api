// api/format.js — Vercel Serverless Function (CommonJS)

const DOUBLE_CONS = ["bb","cc","dd","ff","gg","ll","mm","nn","pp","qq","rr","ss","tt","zz"];
const CONSONANTS = "bcdfghjklmnpqrstvwxzçBCDFGHJKLMNPQRSTVWXZÇ";

// 1. Compter les syllabes (groupes de voyelles)
function countSyllables(word) {
  const matches = word.toLowerCase().match(/[aeiouy]+/g);
  return matches ? matches.length : 1;
}

// 2. Calcul de l'indice Flesch
function fleschReadingEase(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim());
  const words = text.match(/\w+/g) || [];
  const numSentences = sentences.length;
  const numWords = words.length;
  const totalSyllables = words.reduce((s, w) => s + countSyllables(w), 0);
  if (!numSentences || !numWords) return 0;
  const score = 206.835 - 1.015 * (numWords / numSentences) - 84.6 * (totalSyllables / numWords);
  return Math.round(score * 100) / 100;
}

// 3. Ajuster la lisibilité [74 ; 82]
function adjustReadability(text, lower = 74, upper = 82) {
  if (!text) return text;
  const score = fleschReadingEase(text);
  if (score >= lower && score <= upper) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const newSentences = [];
  for (const sent of sentences) {
    const trimmed = sent.trim();
    if (!trimmed) continue;
    const sScore = fleschReadingEase(trimmed);
    if (sScore >= lower && sScore <= upper) {
      newSentences.push(trimmed);
    } else {
      let parts = trimmed.split(/,\s*/);
      if (parts.length <= 1) {
        const words = trimmed.split(/\s+/);
        const mid = Math.floor(words.length / 2);
        parts = [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
      }
      parts.forEach(p => {
        const part = p.trim();
        if (part) newSentences.push(part);
      });
    }
  }
  return newSentences.join(" ");
}

// 4. Gaussienne asymétrique
const sigmaR = 3.74;
const sigmaL = 2.41;
function gaussianAsym(x) {
  const sigma = x >= 0 ? sigmaR : sigmaL;
  return Math.exp(-(x * x) / (2 * sigma * sigma));
}

// 5. Découper en syllabes tout en gardant les espaces et ponctuation
function tokenizeToSyllables(text) {
  const tokens = [];
  const re = /\w+|[^\w\s]|\s+/gu;
  const syllRe = /[^aeiouyAEIOUY]*[aeiouyAEIOUY]+(?:[^aeiouyAEIOUY]+(?=[aeiouyAEIOUY])|)/g;
  const matches = text.matchAll(re);
  for (const m of matches) {
    const tok = m[0];
    if (/^\s+$/.test(tok) || /[^\w\s]/.test(tok)) {
      tokens.push({ type: "sep", text: tok });
    } else {
      const parts = tok.match(syllRe) || [tok];
      parts.forEach(syl => tokens.push({ type: "syll", text: syl }));
    }
  }
  return tokens;
}

// 6. Brownien discret pour tailles de blocs
function randn() {
  // Génère une loi normale (Box–Muller)
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function brownianBlockSizes(nBlocks, base = 21, minSize = 4, maxSize = 12) {
  const sizes = [base];
  let W = 0;
  for (let i = 2; i <= nBlocks; i++) {
    W += randn();
    let raw = Math.floor(base - Math.abs(W));
    if (raw < minSize) raw = minSize;
    if (raw > maxSize) raw = maxSize;
    sizes.push(raw);
  }
  return sizes;
}

// 7. Mettre en gras selon Brownien + Gaussienne
function formatSyllables(tokens) {
  const syllIdxs = tokens.map((t, i) => (t.type === "syll" ? i : null)).filter(i => i !== null);
  const total = syllIdxs.length;
  const nBlocks = Math.ceil(total / 2);
  const sizes = brownianBlockSizes(nBlocks);
  let idx = 0;
  sizes.forEach(size => {
    const block = syllIdxs.slice(idx, idx + size);
    const center = Math.floor(block.length / 2);
    block.forEach((tok_i, pos) => {
      if (gaussianAsym(pos - center) > 0.8) {
        tokens[tok_i].text = `**${tokens[tok_i].text}**`;
      }
    });
    idx += size;
  });
  return tokens.map(t => t.text).join("");
}

// 8. Pipeline principal
function processText(text) {
  const adjusted = adjustReadability(text);
  const tokens = tokenizeToSyllables(adjusted);
  return formatSyllables(tokens);
}

// Conversion du Markdown **...** en HTML <strong>...</strong>
function toHtml(markdown) {
  return markdown.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

// Convertit des lettres ASCII en gras Unicode (accents et ponctuation restent inchangés)
function toUnicodeBold(s) {
  return [...s].map(ch => {
    const code = ch.codePointAt(0);
    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D400 + (code - 65));   // A-Z
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D41A + (code - 97));  // a-z
    if (code >= 48 && code <= 57) return String.fromCodePoint(0x1D7CE + (code - 48));   // 0-9
    return ch;
  }).join("");
}

// Parse JSON body (utile pour Vercel)
function parseJson(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
    });
  });
}

// Handler HTTP pour Vercel
module.exports = async (req, res) => {
  // Autoriser CORS de base si besoin
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST /api/format" });

  const body = await parseJson(req);
  const text = String(body.text || "");
  const result = processText(text);

  const html = toHtml(result);
  const unicode = toUnicodeBold(result.replace(/\*\*/g, "")); // enlève ** avant conversion
  const markdown = result;

  res.status(200).json({ html, unicode, markdown });
};
