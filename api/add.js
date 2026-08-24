// Vercel 函数:知识库投喂接口
// 部署后:网站的 add.html 同域 POST /api/add,不跳转、无 CORS
// 流程:验口令 → 调 DeepSeek 生成词条(分类+解释+关联)→ 写入 GitHub 仓库 concepts/<topic>/<slug>.md
// 词条生成核心逻辑在 scripts/concept-gen.mjs(与 GitHub Actions 共享)
import { generateConcept, TOPICS } from '../scripts/concept-gen.mjs';

export const config = { runtime: 'nodejs' };

const OWNER = process.env.OWNER || 'syingwang1-dotcom';
const REPO = process.env.REPO || 'knowledge-base';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const ADD_SECRET = process.env.ADD_SECRET || '';
const LLM_KEY = process.env.DEEPSEEK_API_KEY || '';
const LLM_BASE = process.env.LLM_BASE || 'https://api.deepseek.com/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function gh(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      ...(opts.headers || {}),
    },
  });
}

async function listExistingSlugs() {
  try {
    const res = await gh('/git/trees/main?recursive=1');
    if (!res.ok) return [];
    const data = await res.json();
    const slugs = [];
    for (const item of data.tree || []) {
      if (item.path.startsWith('concepts/') && item.path.endsWith('.md')) {
        const base = item.path.split('/').pop().replace(/\.md$/, '');
        if (base) slugs.push(base);
      }
    }
    return slugs;
  } catch { return []; }
}

function conceptMd(c, sourceNote) {
  const today = new Date().toISOString().slice(0, 10);
  const md = [
    '---',
    `name: ${c.name}`,
    `aliases: [${c.aliases.join(', ')}]`,
    `topic: ${c.topic}`,
    `related: [${c.related.join(', ')}]`,
    `sources: [${sourceNote}]`,
    `created: ${today}`,
    `updated: ${today}`,
    '---',
    '',
    c.body,
    '',
  ].join('\n');
  return md;
}

async function writeConceptFile(file, content) {
  let sha = null;
  const get = await gh(`/contents/${file}`);
  if (get.ok) { const d = await get.json(); sha = d.sha; }
  const res = await gh(`/contents/${file}`, {
    method: 'PUT',
    body: JSON.stringify({ message: `add: ${file}`, content: toBase64(content), sha: sha || undefined }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error('GitHub write ' + res.status + ': ' + t.slice(0, 200)); }
  return res;
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ ok: false, error: '仅支持 POST' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: '请求格式错误' }, 400); }

  if (!ADD_SECRET || body.secret !== ADD_SECRET) return json({ ok: false, error: '投喂口令不正确' }, 401);

  const term = String(body.term || '').trim();
  if (!term) return json({ ok: false, error: '请填写专业术语' }, 400);
  const context = String(body.context || '').trim();

  if (!GITHUB_TOKEN || !LLM_KEY) return json({ ok: false, error: '后端未配置完成(缺 GitHub token 或 DeepSeek key)' }, 500);

  try {
    const existing = await listExistingSlugs();
    const c = await generateConcept({ term, context, existingSlugs: existing, apiKey: LLM_KEY, base: LLM_BASE, model: LLM_MODEL });
    const file = `concepts/${c.topic}/${c.slug}.md`;
    await writeConceptFile(file, conceptMd(c, '网站投喂'));
    return json({
      ok: true,
      name: c.name,
      topic: c.topic,
      topicLabel: TOPICS[c.topic],
      slug: c.slug,
      related: c.related.length,
      file,
      url: `/concepts/${encodeURIComponent(c.slug)}.html`,
    });
  } catch (e) {
    return json({ ok: false, error: '生成失败: ' + e.message }, 500);
  }
}
