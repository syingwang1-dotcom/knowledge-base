// 知识库投喂后端(Cloudflare Worker)
// POST /api/add { term, context, secret } → 校验口令 → 调 LLM 生成词条 → 直接写入 GitHub 仓库 concepts/<topic>/<slug>.md
// 词条生成核心逻辑在 scripts/concept-gen.mjs(与 GitHub Actions 共享)
import { generateConcept, TOPICS } from '../scripts/concept-gen.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function gh(env, path, opts = {}) {
  return fetch(`https://api.github.com/repos/${env.OWNER}/${env.REPO}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      ...(opts.headers || {}),
    },
  });
}

async function listExistingSlugs(env) {
  try {
    const res = await gh(env, '/git/trees/main?recursive=1');
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

function conceptMd(c, env, sourceNote) {
  const today = new Date().toISOString().slice(0, 10);
  const sources = [sourceNote].filter(Boolean);
  return [
    '---',
    `name: ${c.name}`,
    `aliases: [${c.aliases.join(', ')}]`,
    `topic: ${c.topic}`,
    `related: [${c.related.join(', ')}]`,
    `sources: [${sources.join(', ')}]`,
    `created: ${today}`,
    `updated: ${today}`,
    '---',
    '',
    c.body,
    '',
  ].join('\n');
}

async function writeConceptFile(env, file, content) {
  let sha = null;
  const get = await gh(env, `/contents/${file}`);
  if (get.ok) { const d = await get.json(); sha = d.sha; }
  const res = await gh(env, `/contents/${file}`, {
    method: 'PUT',
    body: JSON.stringify({ message: `add: ${file}`, content: toBase64(content), sha: sha || undefined }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error('GitHub write ' + res.status + ': ' + t.slice(0, 200)); }
  return res;
}

async function handleAdd(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: '请求格式错误' }, 400); }

  if (!env.ADD_SECRET || body.secret !== env.ADD_SECRET) return json({ ok: false, error: '投喂口令不正确' }, 401);

  const term = String(body.term || '').trim();
  if (!term) return json({ ok: false, error: '请填写专业术语' }, 400);
  const context = String(body.context || '').trim();

  if (!env.GITHUB_TOKEN || !env.DEEPSEEK_API_KEY) {
    return json({ ok: false, error: '后端未配置完成(缺 GitHub token 或 DeepSeek key)' }, 500);
  }

  try {
    const existing = await listExistingSlugs(env);
    const c = await generateConcept({
      term, context, existingSlugs: existing,
      apiKey: env.DEEPSEEK_API_KEY,
      base: env.LLM_BASE || 'https://api.deepseek.com/chat/completions',
      model: env.LLM_MODEL || 'deepseek-chat',
    });
    const file = `concepts/${c.topic}/${c.slug}.md`;
    await writeConceptFile(env, file, conceptMd(c, env, '网站投喂'));
    return json({
      ok: true,
      name: c.name,
      topic: c.topic,
      topicLabel: TOPICS[c.topic],
      slug: c.slug,
      related: c.related.length,
      file,
      url: `https://syingwang1-dotcom.github.io/${env.REPO}/concepts/${encodeURIComponent(c.slug)}.html`,
    });
  } catch (e) {
    return json({ ok: false, error: '生成失败: ' + e.message }, 500);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/api/add' && request.method === 'POST') return handleAdd(request, env);
    if (url.pathname === '/api/ping') return json({ ok: true, msg: 'pong' });
    return json({ ok: true, msg: '知识库 API 运行中。POST /api/add 投喂词条' });
  },
};
