// 知识库静态站生成器
// 用法: node scripts/build.mjs   (从 ~/知识库 根目录运行)
// 读取 concepts/**/*.md → 生成 docs/ 下的多页面静态站
// 无需任何第三方依赖,纯 Node 标准库
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB = path.resolve(__dirname, '..');
const CONCEPTS_DIR = path.join(KB, 'concepts');
const OUT_DIR = path.join(KB, 'docs');
const NOW = '2026-08-24';

// ── 主题配置 ──────────────────────────────────────────────
const TOPICS = {
  ai:      { label: 'AI / 大模型', desc: '大模型、Token、RAG、Agent 与算力落地' },
  cloud:   { label: '云计算',      desc: '云分层、MaaS、GPU 云与私有化部署' },
  sales:   { label: '销售 / GTM',  desc: '大客户销售的方法、术语与销售漏斗' },
  business:{ label: '商业 / 其他', desc: '商业指标与日常遇到的陌生词' },
};

// ── 工具函数 ──────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseFrontmatter(raw) {
  const lines = raw.split('\n');
  const fm = {};
  let body = raw;
  if (lines[0].trim() === '---') {
    let i = 1;
    while (i < lines.length && lines[i].trim() !== '---') {
      const m = lines[i].match(/^([\w-]+):\s*(.*)$/);
      if (m) fm[m[1]] = m[2].trim();
      i++;
    }
    body = lines.slice(i + 1).join('\n');
  }
  // 数组字段: [a, b]
  for (const k of ['aliases', 'related', 'sources']) {
    if (fm[k]) {
      const v = fm[k].trim();
      fm[k] = v.startsWith('[') && v.endsWith(']')
        ? v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
        : [v];
    } else fm[k] = [];
  }
  return { fm, body };
}

function mdToHtml(text) {
  let html = '';
  let inUl = false;
  for (const ln of text.split('\n')) {
    let m = ln.match(/^##\s+(.*)$/);
    if (m) { if (inUl) { html += '</ul>'; inUl = false; } html += `<h2>${inline(m[1])}</h2>`; continue; }
    m = ln.match(/^###\s+(.*)$/);
    if (m) { if (inUl) { html += '</ul>'; inUl = false; } html += `<h3>${inline(m[1])}</h3>`; continue; }
    if (/^[-*]\s+/.test(ln)) { if (!inUl) { html += '<ul>'; inUl = true; } html += `<li>${inline(ln.replace(/^[-*]\s+/, ''))}</li>`; continue; }
    if (ln.trim() === '') { if (inUl) { html += '</ul>'; inUl = false; } continue; }
    if (inUl) { html += '</ul>'; inUl = false; }
    if (ln.trim().startsWith('> ')) { html += `<blockquote>${inline(ln.trim().slice(2))}</blockquote>`; continue; }
    html += `<p>${inline(ln)}</p>`;
  }
  if (inUl) html += '</ul>';
  return html;
}

function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  return s;
}

function extractSummary(body) {
  const m = body.match(/^##\s+一句话\s*\n+([^\n]+)/m);
  return m ? m[1].trim() : '';
}

// ── 样式 ──────────────────────────────────────────────────
const CSS = `
:root{--bg:#0f1115;--card:#171a22;--card2:#1d212c;--text:#e5e7eb;--muted:#9aa3b2;--accent:#60a5fa;--green:#34d399;--orange:#fb923c;--border:#262b38;--radius:12px}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7;font-size:16px}
.wrap{max-width:900px;margin:0 auto;padding:0 20px}
header.sitehead{background:var(--card);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10}
.head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:14px 0}
.brand{font-size:18px;font-weight:700;color:var(--text);text-decoration:none}
.nav{display:flex;flex-wrap:wrap;gap:6px}
.nav a{padding:5px 12px;border-radius:999px;color:var(--muted);text-decoration:none;font-size:14px;transition:.15s}
.nav a:hover{color:var(--text);background:var(--card2)}
.nav a.active{background:var(--accent);color:#0b1220;font-weight:600}
main{padding:28px 0 60px}
h1{font-size:26px;margin:8px 0 14px}
h2{font-size:20px;margin:30px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--border)}
h3{font-size:17px;margin:20px 0 8px}
p{margin:10px 0}
ul{margin:10px 0 10px 22px}
li{margin:5px 0}
a{color:var(--accent)}
code{background:var(--card2);padding:2px 6px;border-radius:5px;font-size:.9em}
blockquote{border-left:3px solid var(--accent);background:var(--card);padding:10px 14px;border-radius:8px;margin:12px 0;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.chip{display:inline-block;padding:3px 11px;border-radius:999px;font-size:13px;background:var(--card2);color:var(--muted);border:1px solid var(--border);text-decoration:none}
.chip.topic{background:rgba(96,165,250,.14);color:var(--accent);border-color:transparent}
.meta{color:var(--muted);font-size:13px;margin-bottom:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px;text-decoration:none;color:var(--text);transition:.15s}
.card:hover{border-color:var(--accent);transform:translateY(-2px)}
.card h3{font-size:16px;margin:0 0 6px}
.card p{color:var(--muted);font-size:14px;margin:0}
.hero{background:linear-gradient(135deg,rgba(96,165,250,.12),rgba(52,211,153,.08));border:1px solid var(--border);border-radius:var(--radius);padding:26px;margin-bottom:24px}
.hero h1{margin:0 0 8px}
.hero p{color:var(--muted);margin:0}
.search{width:100%;padding:12px 16px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:15px;margin:14px 0}
.search:focus{outline:none;border-color:var(--accent)}
#results{margin-top:6px}
.result{display:block;padding:10px 12px;border-radius:8px;color:var(--text);text-decoration:none;border:1px solid var(--border);background:var(--card);margin-bottom:8px}
.result:hover{border-color:var(--accent)}
.result .t{font-weight:600}
.result .s{color:var(--muted);font-size:13px;margin-top:2px}
.sec-title{font-size:18px;font-weight:600;margin:26px 0 12px}
.foot{color:var(--muted);font-size:13px;padding:20px 0 40px;border-top:1px solid var(--border)}
`;

// ── 页面壳 ────────────────────────────────────────────────
function navHtml(prefix, active) {
  const items = [['', '首页'], ...Object.entries(TOPICS).map(([k, v]) => [k, v.label])];
  return items.map(([k, label]) =>
    `<a class="${k === active ? 'active' : ''}" href="${prefix}${k === '' ? 'index.html' : `topics/${k}.html`}">${label}</a>`
  ).join('');
}

function page(title, prefix, active, content) {
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · 我的知识库</title><style>${CSS}</style></head>
<body>
<header class="sitehead"><div class="wrap head">
  <a class="brand" href="${prefix}index.html">📚 我的知识库</a>
  <nav class="nav">${navHtml(prefix, active)}</nav>
</div></header>
<main class="wrap">${content}</main>
<footer class="wrap foot">由 <code>scripts/build.mjs</code> 生成 · 更新于 ${NOW} · 个人学习用</footer>
</body></html>`;
}

// ── 读取并解析概念 ────────────────────────────────────────
function loadConcepts() {
  const out = [];
  for (const topic of Object.keys(TOPICS)) {
    const dir = path.join(CONCEPTS_DIR, topic);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      const { fm, body } = parseFrontmatter(raw);
      out.push({
        slug: f.replace(/\.md$/, ''),
        name: fm.name || f.replace(/\.md$/, ''),
        aliases: fm.aliases || [],
        topic,
        topicLabel: TOPICS[topic].label,
        related: fm.related || [],
        sources: fm.sources || [],
        created: fm.created || NOW,
        updated: fm.updated || NOW,
        summary: extractSummary(body),
        body,
      });
    }
  }
  out.sort((a, b) => b.updated.localeCompare(a.updated));
  return out;
}

// ── 生成概念页 ────────────────────────────────────────────
function conceptHtml(c) {
  const rel = s => `../${s}`;
  const aliases = c.aliases.map(a => `<span class="chip">${esc(a)}</span>`).join('');
  const related = c.related.map(r => {
    const target = CONCEPTS.find(x => x.slug === r || x.name === r);
    if (!target) return `<span class="chip">${esc(r)}</span>`;
    return `<a class="chip" href="${rel(`concepts/${target.slug}.html`)}">${esc(target.name)}</a>`;
  }).join('') || '<span class="chip" style="opacity:.5">暂无</span>';
  const sources = c.sources.map(s =>
    /^https?:\/\//.test(s)
      ? `<li><a href="${esc(s)}" target="_blank" rel="noopener">${esc(s)}</a></li>`
      : `<li>${esc(s)}</li>`
  ).join('') || '<li>暂无(整理自日常学习/播客)</li>';

  return `
<div class="chips"><a class="chip topic" href="../../topics/${c.topic}.html">${esc(c.topicLabel)}</a>${aliases}</div>
<h1>${esc(c.name)}</h1>
<div class="meta">收录于 ${c.created} · 更新于 ${c.updated}</div>
${mdToHtml(c.body)}
<div class="sec-title">相关概念</div>
<div class="chips">${related}</div>
<div class="sec-title">来源</div>
<ul class="meta">${sources}</ul>`;
}

// ── 生成主题页 ────────────────────────────────────────────
function topicHtml(topic, list) {
  const cards = list.map(c => `
  <a class="card" href="../concepts/${c.slug}.html">
    <h3>${esc(c.name)}</h3>
    <p>${esc(c.summary)}</p>
  </a>`).join('') || '<p class="meta">该主题暂无词条。</p>';
  return `
<h1>${TOPICS[topic].label}</h1>
<p class="meta">${TOPICS[topic].desc} · 共 ${list.length} 条</p>
<div class="grid">${cards}</div>`;
}

// ── 生成首页 ──────────────────────────────────────────────
function indexHtml(concepts) {
  const topicCards = Object.entries(TOPICS).map(([k, v]) => {
    const n = concepts.filter(c => c.topic === k).length;
    return `<a class="card" href="topics/${k}.html"><h3>${v.label}</h3><p>${v.desc} · ${n} 条</p></a>`;
  }).join('');
  const recent = concepts.slice(0, 8).map(c => `
  <a class="result" href="concepts/${c.slug}.html">
    <div class="t">${esc(c.name)}</div>
    <div class="s">${esc(c.summary)}</div>
  </a>`).join('');

  return `
<div class="hero">
  <h1>📚 我的知识库</h1>
  <p>把播客、报道里听不懂的词,变成我能讲给客户听的话。<br>共 ${concepts.length} 条概念 · ${Object.keys(TOPICS).length} 个主题 · 持续迭代中</p>
  <input class="search" id="search" type="text" placeholder="🔍 搜索概念、别名、一句话说明…">
  <div id="results"></div>
</div>
<div class="sec-title">主题</div>
<div class="grid">${topicCards}</div>
<div class="sec-title">最近更新</div>
${recent}
<script>
const idx = null;
fetch('index.json').then(r=>r.json()).then(data=>{
  const box=document.getElementById('search'), res=document.getElementById('results');
  box.addEventListener('input',()=>{
    const q=box.value.trim().toLowerCase();
    if(!q){res.innerHTML='';return;}
    const hits=data.filter(c=>[c.name,...(c.aliases||[]),c.summary].join(' ').toLowerCase().includes(q)).slice(0,12);
    res.innerHTML=hits.map(c=>'<a class="result" href="concepts/'+c.slug+'.html"><div class="t">'+c.name+'</div><div class="s">'+c.summary+'</div></a>').join('')||'<div class="meta">无结果</div>';
  });
});
</script>`;
}

// ── 生成 index.json ───────────────────────────────────────
function buildIndex(concepts) {
  return concepts.map(c => ({
    name: c.name,
    aliases: c.aliases,
    slug: c.slug,
    topic: c.topic,
    topicLabel: c.topicLabel,
    summary: c.summary,
  }));
}

// ── 主流程 ────────────────────────────────────────────────
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT_DIR, 'concepts'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'topics'), { recursive: true });

const CONCEPTS = loadConcepts();

for (const c of CONCEPTS) {
  fs.writeFileSync(path.join(OUT_DIR, 'concepts', `${c.slug}.html`),
    page(`${c.name}`, '../../', c.topic, conceptHtml(c)));
}
for (const t of Object.keys(TOPICS)) {
  const list = CONCEPTS.filter(c => c.topic === t);
  fs.writeFileSync(path.join(OUT_DIR, 'topics', `${t}.html`),
    page(TOPICS[t].label, '../', t, topicHtml(t, list)));
}
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), page('首页', '', '', indexHtml(CONCEPTS)));
fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(buildIndex(CONCEPTS), null, 2));

console.log(`✅ 生成完成:${CONCEPTS.length} 条概念 → ${OUT_DIR}`);
