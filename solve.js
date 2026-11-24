// Faster drop-in for makefun-site 1.0.0 — written from the README + reference
// behaviour, reimplemented (not copied) for speed. Pure JS, no dependencies.
// Per-run caches only: run() creates all state fresh, nothing is shared
// between cases.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ESCAPABLE = '\\`*_[]()#+-.!>';
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---- text ---------------------------------------------------------------
function esc(s) {
  // Fast HTML escape: scan for the first special char, then build parts.
  let i = 0, n = s.length, out = null;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) break;
    i++;
  }
  if (i === n) return s;
  out = [s.slice(0, i)];
  for (; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) out.push('&amp;');
    else if (c === 60) out.push('&lt;');
    else if (c === 62) out.push('&gt;');
    else if (c === 34) out.push('&quot;');
    else if (c === 39) out.push('&#39;');
    else {
      // accumulate a run of plain chars
      let j = i + 1;
      while (j < n) {
        const d = s.charCodeAt(j);
        if (d === 38 || d === 60 || d === 62 || d === 34 || d === 39) break;
        j++;
      }
      out.push(s.slice(i, j));
      i = j - 1;
    }
  }
  return out.join('');
}

function makeSlugify() {
  const cache = new Map();
  const MARKS = /\p{M}/gu;
  return function slugify(text) {
    let v = cache.get(text);
    if (v !== undefined) return v;
    let plain = text, ascii = true;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) >= 128) { ascii = false; break; }
    if (!ascii) plain = text.normalize('NFKD').replace(MARKS, '');
    let out = '', gap = false;
    if (ascii) {
      for (let i = 0; i < plain.length; i++) {
        const c = plain.charCodeAt(i);
        let keep = -1;
        if (c >= 65 && c <= 90) keep = c + 32;
        else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
        if (keep === -1) { gap = out.length > 0; continue; }
        if (gap) out += '-';
        gap = false;
        out += String.fromCharCode(keep);
      }
    } else {
      for (const ch of plain) {
        let keep = null;
        if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
        else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
        if (keep === null) { gap = out.length > 0; continue; }
        if (gap) out += '-';
        gap = false;
        out += keep;
      }
    }
    out = out.slice(0, 64).replace(/-+$/, '');
    v = out === '' ? 'untitled' : out;
    cache.set(text, v);
    return v;
  };
}

function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) { taken.add(slug); return slug; }
  let n = 2, out;
  do { out = slug + '-' + n++; } while (taken.has(out));
  taken.add(out);
  return out;
}

function longDate(date) {
  return Number(date.slice(8, 10)) + ' ' + MONTHS[Number(date.slice(5, 7)) - 1] + ' ' + date.slice(0, 4);
}

function isWS(c) {
  return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 133 || c === 160 ||
    c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f ||
    c === 0x205f || c === 0x3000 || c === 0xfeff;
}
function wordsOf(text) {
  const m = text.match(/\S+/g);
  return m === null ? 0 : m.length;
}

// ---- front matter -------------------------------------------------------
const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const LINE_RE = /^([a-z_]+):(?: (.*))?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}
function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n; i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}
function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: 'key "' + key + '": ' + s.error } : s;
    }
    case 'date': {
      const m = DATE_RE.exec(raw);
      const y = m ? Number(m[1]) : 0, mo = m ? Number(m[2]) : 0, d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo))
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG_RE.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG_RE.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: 'unknown key "' + key + '"' };
  }
}
function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) { const c = line.charCodeAt(i); if (c !== 32 && c !== 9) return false; }
  return true;
}
// Returns { data, bodyLines } or { error }. bodyLines is lines after the closing ---.
function parseFrontMatter(lines) {
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i] === '---') { close = i; break; }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (isBlankLine(line) || line.charCodeAt(0) === 35) continue;
    const m = LINE_RE.exec(line);
    if (!m) return { error: 'line ' + (i + 1) + ' is not "key: value"' };
    const key = m[1];
    const raw = (m[2] === undefined ? '' : m[2]).replace(/[ \t]+$/, '');
    if (KEYS.indexOf(key) === -1) return { error: 'unknown key "' + key + '"' };
    if (Object.hasOwn(data, key)) return { error: 'key "' + key + '" is given twice' };
    if (raw === '') return { error: 'key "' + key + '" has no value' };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, bodyLines: lines.slice(close + 1) };
}

// ---- markdown -----------------------------------------------------------
function trimLine(line) {
  let a = 0, b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}
function fenceOpen(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let i = 3;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  const lang = line.slice(3, i);
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
  return i === line.length ? lang : null;
}
function fenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) { const c = line.charCodeAt(i); if (c !== 32 && c !== 9) return false; }
  return true;
}
// Returns { depth, text } or null.
function headingOf(line) {
  let n = 0;
  while (n < 6 && line.charCodeAt(n) === 35) n++;
  if (n === 0) return null;
  const c = line.charCodeAt(n);
  if (c !== 32 && c !== 9) return null;
  const text = trimLine(line.slice(n));
  return text === '' ? null : { depth: n, text };
}
function isHR(line) {
  if (line !== '---' && line !== '***') {
    if (line.length < 3) return false;
    const p = line.slice(0, 3);
    if (p !== '---' && p !== '***') return false;
    for (let i = 3; i < line.length; i++) { const c = line.charCodeAt(i); if (c !== 32 && c !== 9) return false; }
    return true;
  }
  return true;
}
function endsParagraph(line) {
  return isBlankLine(line) || fenceOpen(line) !== null || headingOf(line) !== null || isHR(line);
}
function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s.charCodeAt(j) === 92 && j + 1 < s.length && ESCAPABLE.indexOf(s[j + 1]) !== -1) { j++; continue; }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < s.length && ESCAPABLE.indexOf(s[j + 1]) !== -1) { j++; continue; }
    if (c !== 42) continue;
    if (s.charCodeAt(j + 1) === 42) { j++; continue; }
    return j;
  }
  return -1;
}
function hasWS(s) {
  for (let i = 0; i < s.length; i++) if (isWS(s.charCodeAt(i))) return true;
  return false;
}
// Inline render; returns a string. env: { link(target) }
const INLINE_SPECIAL = /[\\`*\[&<>"']/;
function inline(s, env) {
  if (!INLINE_SPECIAL.test(s)) return s;
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 92 && i + 1 < n && ESCAPABLE.indexOf(s[i + 1]) !== -1) {
      const ch = s[i + 1];
      out += ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : ch === "'" ? '&#39;' : ch;
      i += 2; continue;
    }
    if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) { out += '<code>' + esc(s.slice(i + 1, j)) + '</code>'; i = j + 1; }
      else { out += '`'; i++; }
      continue;
    }
    if (c === 42) {
      if (s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) { out += '<strong>' + inline(s.slice(i + 2, j), env) + '</strong>'; i = j + 2; }
        else { out += '**'; i += 2; }
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) { out += '<em>' + inline(s.slice(i + 1, j), env) + '</em>'; i = j + 1; }
      else { out += '*'; i++; }
      continue;
    }
    if (c === 91) {
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !hasWS(target)) {
        const href = env.link(target);
        out += '<a href="' + esc(href) + '">' + inline(s.slice(i + 1, k), env) + '</a>';
        i = m + 1; continue;
      }
      out += '['; i++; continue;
    }
    if (c === 38) out += '&amp;';
    else if (c === 60) out += '&lt;';
    else if (c === 62) out += '&gt;';
    else if (c === 34) out += '&quot;';
    else if (c === 39) out += '&#39;';
    else {
      let j = i + 1;
      while (j < n) {
        const d = s.charCodeAt(j);
        if (d === 92 || d === 96 || d === 42 || d === 91 || d === 38 || d === 60 || d === 62 || d === 34 || d === 39) break;
        j++;
      }
      out += s.slice(i, j);
      i = j; continue;
    }
    i++;
  }
  return out;
}

function renderMarkdown(lines, env, slugify) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const L = lines.length;
  while (i < L) {
    const line = lines[i];
    if (isBlankLine(line)) { i++; continue; }
    const lang = fenceOpen(line);
    if (lang !== null) {
      i++;
      const parts = ['<pre><code'];
      if (lang !== '') { parts.push(' class="language-', esc(lang), '"'); }
      parts.push('>');
      while (i < L && !fenceClose(lines[i])) { parts.push(esc(lines[i]), '\n'); i++; }
      i++;
      parts.push('</code></pre>');
      blocks.push(parts.join(''));
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueSlug(slugify(heading.text), ids);
      const html = inline(heading.text, env);
      blocks.push('<h' + heading.depth + ' id="' + id + '">' + html + '</h' + heading.depth + '>');
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
      i++; continue;
    }
    if (isHR(line)) { blocks.push('<hr>'); i++; continue; }
    if (line.charCodeAt(0) === 62) {
      const q = [];
      while (i < L && lines[i].charCodeAt(0) === 62) {
        let l = lines[i];
        l = l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1);
        q.push(trimLine(l)); i++;
      }
      const kept = [];
      for (let k = 0; k < q.length; k++) if (q[k] !== '') kept.push(q[k]);
      blocks.push(kept.length === 0 ? '<blockquote>\n</blockquote>' : '<blockquote>\n<p>' + inline(kept.join('\n'), env) + '</p>\n</blockquote>');
      continue;
    }
    // list?
    const c0 = line.charCodeAt(0);
    let isBullet = (c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32;
    let ordered = -1;
    if (!isBullet) {
      let d = 0;
      while (d < 9 && line.charCodeAt(d) >= 48 && line.charCodeAt(d) <= 57) d++;
      if (d > 0 && line.charCodeAt(d) === 46 && line.charCodeAt(d + 1) === 32) ordered = d;
    }
    if (isBullet || ordered !== -1) {
      const isOrd = ordered !== -1;
      const start = isOrd ? Number(line.slice(0, ordered)) : 1;
      const items = [];
      while (i < L) {
        const ln = lines[i];
        let m = null;
        if (isOrd) {
          let d = 0;
          while (d < 9 && ln.charCodeAt(d) >= 48 && ln.charCodeAt(d) <= 57) d++;
          if (d > 0 && ln.charCodeAt(d) === 46 && ln.charCodeAt(d + 1) === 32) m = ln.slice(d + 2);
        } else if ((ln.charCodeAt(0) === 45 || ln.charCodeAt(0) === 42) && ln.charCodeAt(1) === 32) m = ln.slice(2);
        if (m !== null) { items.push([trimLine(m)]); i++; }
        else if (ln.length >= 3 && ln.charCodeAt(0) === 32 && ln.charCodeAt(1) === 32) {
          // CONTINUED: 2+ spaces then a non-whitespace char
          let sp = 0;
          while (sp < ln.length && ln.charCodeAt(sp) === 32) sp++;
          if (sp >= 2 && sp < ln.length && !isWS(ln.charCodeAt(sp))) { items[items.length - 1].push(trimLine(ln)); i++; }
          else break;
        } else break;
      }
      const tag = isOrd ? 'ol' : 'ul';
      const open = isOrd && start !== 1 ? '<ol start="' + start + '">' : '<' + tag + '>';
      const parts = [open, '\n'];
      for (let k = 0; k < items.length; k++) parts.push('<li>', inline(items[k].join('\n'), env), '</li>\n');
      parts.push('</', tag, '>');
      blocks.push(parts.join(''));
      continue;
    }
    // paragraph
    const body = [trimLine(line)];
    i++;
    while (i < L && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push('<p>' + html + '</p>');
  }
  return { html: blocks.length === 0 ? '' : blocks.join('\n') + '\n', toc, excerpt: excerpt === null ? '' : excerpt };
}

// ---- templates ----------------------------------------------------------
class TemplateError extends Error {}
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError('template "' + name + '": ' + JSON.stringify(text) + ' is not a path');
  return text.split('.');
}
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) { text += src.slice(i); break; }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') { text += src.slice(i, open + 1); i = open + 1; continue; }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError('template "' + name + '": a ' + (raw ? '{{{' : '{{') + ' is not closed');
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError('template "' + name + '": a {% is not closed');
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = isBlankLine(src.slice(lineStart, open)) && isBlankLine(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node); stack.push(node); body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node); stack.push(node); body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError('template "' + name + '": an else outside an if');
        top.else = []; body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError('template "' + name + '": an ' + tag + ' with no open ' + tag.slice(3));
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else !== null && parent.else !== undefined ? parent.else : parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError('template "' + name + '": {% ' + tag + ' %} is not a tag');
    }
  }
  if (stack.length > 1) throw new TemplateError('template "' + name + '": a ' + stack[stack.length - 1].kind + ' is not closed');
  return root.body;
}
function lookup(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}
function renderNodes(nodes, scope, ctx, depth, out) {
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    if (n.kind === 'text') out.push(n.text);
    else if (n.kind === 'var') out.push(esc(textOf(lookup(scope, n.path))));
    else if (n.kind === 'raw') out.push(textOf(lookup(scope, n.path)));
    else if (n.kind === 'if') {
      const v = truthy(lookup(scope, n.path));
      const branch = v !== n.not ? n.then : n.else;
      if (branch !== null) renderNodes(branch, scope, ctx, depth, out);
    } else if (n.kind === 'for') {
      const xs = lookup(scope, n.path);
      if (Array.isArray(xs)) {
        const vars = {};
        const loop = { index: 0, first: false, last: false, length: xs.length };
        vars.loop = loop;
        const child = { vars, parent: scope };
        for (let k = 0; k < xs.length; k++) {
          vars[n.name] = xs[k];
          loop.index = k + 1; loop.first = k === 0; loop.last = k === xs.length - 1;
          renderNodes(n.body, child, ctx, depth, out);
        }
      }
    } else if (n.kind === 'include') {
      const t = ctx.templates.get(n.name);
      if (t !== undefined && depth < 8) renderNodes(t, scope, ctx, depth + 1, out);
    }
  }
}

// ---- build --------------------------------------------------------------
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}
const dirOf = (path) => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};
function hasScheme(target) {
  const c0 = target.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < target.length; i++) {
    const c = target.charCodeAt(i);
    if (c === 58) return true;
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)) return false;
  }
  return false;
}

export function run(input) {
  const slugify = makeSlugify();
  const templates = new Map();
  const report = [];
  const tNames = Object.keys(input.templates).sort(byCodeUnits);
  for (let ti = 0; ti < tNames.length; ti++) {
    const name = tNames[ti];
    try { templates.set(name, parseTemplate(name, input.templates[name])); }
    catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const base = input.site.base_url.replace(/\/+$/, '');
  // sources, sorted by path
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  let sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      const text = f.content.replace(/\r\n?/g, '\n');
      sources.push({ path: f.path, lines: text.split('\n') });
    } else statics.push(f);
  }
  // front matter + checks
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.lines);
    if ('error' in fm) { report.push('refused ' + s.path + ': ' + fm.error); continue; }
    s.data = fm.data;
    s.bodyLines = fm.bodyLines;
    s.body = fm.bodyLines.join('\n');
    s.post = s.path.startsWith('posts/');
    let own;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) { report.push('refused ' + s.path + ': ' + own + '/ is the generator\'s own'); continue; }
    if (s.post && !Object.hasOwn(s.data, 'date')) { report.push('refused ' + s.path + ': a post needs a date'); continue; }
    const layout = s.data.layout !== undefined ? s.data.layout : (s.post ? 'post' : 'page');
    if (!templates.has(layout)) { report.push('refused ' + s.path + ': layout "' + layout + '" is no template that parses'); continue; }
    s.layout = layout;
    if (s.data.draft === true) { report.push('draft ' + s.path); continue; }
    kept.push(s);
  }
  sources = kept;
  // permalinks
  const taken = new Map();
  const bySource = new Map();
  for (const s of sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) { set = new Set(dir === '' ? ['posts', 'tags', 'page'] : []); taken.set(dir, set); }
    const slug = uniqueSlug(s.data.slug !== undefined ? s.data.slug : slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : dir + '/' + slug;
    s.url = base + '/' + s.outDir + '/';
    bySource.set(s.path, s);
  }
  // markdown
  const staticPaths = new Set();
  for (const f of statics) staticPaths.add(f.path);
  const broken = new Set();
  const linkCache = new Map();
  for (const s of sources) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (hasScheme(target) || target.charCodeAt(0) === 47 || target.charCodeAt(0) === 35) return target;
        const ck = dir + '\n' + target;
        let r = linkCache.get(ck);
        if (r === undefined) {
          const hash = target.indexOf('#');
          const rel = hash === -1 ? target : target.slice(0, hash);
          const frag = hash === -1 ? '' : target.slice(hash);
          const path = rel === '' ? null : resolvePath(dir, rel);
          if (path !== null && bySource.has(path)) r = bySource.get(path).url + frag;
          else if (path !== null && staticPaths.has(path)) r = base + '/' + path + frag;
          else r = null;
          linkCache.set(ck, r);
        }
        if (r === null) { broken.add('broken-link ' + s.path + ' -> ' + target); return target; }
        return r;
      },
    };
    const md = renderMarkdown(s.bodyLines, env, slugify);
    s.html = md.html; s.toc = md.toc; s.excerpt = md.excerpt;
  }
  // collections
  const posts = [];
  for (const s of sources) if (s.post) posts.push(s);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }
  // tags
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    const tags = s.data.tags !== undefined ? s.data.tags : [];
    for (const name of tags) {
      const sl = slugify(name);
      if (seen.has(sl)) continue;
      seen.add(sl); out.push(name);
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) { tag = { name, slug, url: base + '/tags/' + slug + '/', posts: [] }; bySlug.set(slug, tag); }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of sources) {
    if (s.post) continue;
    s.tagRefs = [];
    for (const name of ownTags(s)) {
      const slug = slugify(name);
      const t = bySlug.get(slug);
      s.tagRefs.push(t !== undefined ? t : { name, slug, url: '', posts: [] });
    }
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
  // cards / pages (cached per source)
  const linkOf = (s) => s === null ? null : { title: s.data.title, url: s.url, date: s.data.date !== undefined ? s.data.date : '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) };
  const cards = new Map();
  for (const p of posts) {
    const cardTags = p.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url }));
    cards.set(p, {
      title: p.data.title, url: p.url, date: p.data.date !== undefined ? p.data.date : '',
      date_long: p.data.date === undefined ? '' : longDate(p.data.date),
      summary: p.data.summary !== undefined ? p.data.summary : '', excerpt: p.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordsOf(p.body) / 200)), tags: cardTags,
    });
    p.cardTags = cardTags;
  }
  const cardOf = (s) => {
    if (s.post) return cards.get(s);
    if (s.card === undefined) {
      s.card = {
        title: s.data.title, url: s.url, date: s.data.date !== undefined ? s.data.date : '',
        date_long: s.data.date === undefined ? '' : longDate(s.data.date),
        summary: s.data.summary !== undefined ? s.data.summary : '', excerpt: s.excerpt,
        reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
        tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
      };
    }
    return s.card;
  };
  const pageOf = (s) => {
    if (s.pageView === undefined) {
      const card = cardOf(s);
      s.pageView = {
        title: card.title, url: card.url, date: card.date, date_long: card.date_long,
        summary: card.summary, excerpt: card.excerpt, reading_minutes: card.reading_minutes, tags: card.tags,
        slug: s.slug, content: s.html,
        toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
        newer: linkOf(s.newer !== undefined && s.newer !== null ? s.newer : null),
        older: linkOf(s.older !== undefined && s.older !== null ? s.older : null),
        is_post: s.post,
      };
    }
    return s.pageView;
  };
  // layouts
  const output = {};
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const ctx = { templates };
  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const out = [];
    renderNodes(nodes, { vars: { site, tags: allTags, recent, ...vars }, parent: null }, ctx, 0, out);
    return out.join('');
  };
  for (const s of sources) output[s.outDir + '/index.html'] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? base + '/' : base + '/page/' + k + '/');
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output['tags/' + t.slug + '/index.html'] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push('shadowed ' + f.path + ': a built page has its path');
    else output[f.path] = f.content;
  }
  const lines = [...report, ...broken].sort(byCodeUnits);
  const nPages = sources.filter((s) => !s.post).length;
  lines.push('built ' + nPages + ' pages, ' + posts.length + ' posts, ' + tags.length + ' tags and ' + statics.length + ' static files');
  output['build-report.txt'] = lines.join('\n') + '\n';
  return output;
}
