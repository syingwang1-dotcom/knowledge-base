// 自动词条生成器(在 GitHub Actions 中运行)
// 输入(环境变量):ISSUE_TITLE / ISSUE_BODY / ISSUE_NUMBER / ISSUE_URL / LLM_API_KEY
// 流程:解析 Issue → (body 为 URL 则抓取文章) → 调 LLM 生成词条 → 写入 concepts/<topic>/<slug>.md → 回帖并关闭 Issue
// 依赖:Node 18+(全局 fetch)、gh CLI(GitHub Actions 自带)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const CONCEPTS_DIR = path.join(ROOT, 'concepts');

const LLM_KEY = process.env.LLM_API_KEY || '';
const LLM_BASE = process.env.LLM_BASE || 'https://api.deepseek.com/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';

const TITLE = process.env.ISSUE_TITLE || '';
const BODY = (process.env.ISSUE_BODY || '').trim();
const NUMBER = process.env.ISSUE_NUMBER || '?';

const TOPICS = { ai: 'AI / 大模型', cloud: '云计算', sales: '销售 / GTM', business: '商业 / 其他' };
const SITE_URL = 'https://syingwang1-dotcom.github.io/knowledge-base';

const log = (...a) => console.log('[ingest]', ...a);

// ── GitHub 回帖/关单 ────────────────────────────────────
async function ghComment(msg) {
  try { execSync(`gh issue comment ${NUMBER} --body ${JSON.stringify(msg)}`, { stdio: 'ignore' }); }
  catch (e) { log('回帖失败(忽略):', e.message); }
}
async function ghClose() {
  try { execSync(`gh issue close ${NUMBER}`, { stdio: 'ignore' }); }
  catch (e) { log('关单失败(忽略):', e.message); }
}

// ── 工具 ────────────────────────────────────────────────
function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[（(][^（）()]*[）)]/g, '')          // 去掉括号
    .replace(/[^\w一-鿿]+/g, '-')          // 空格/符号 → -
    .replace(/^-+|-+$/g, '');
  return s || 'concept';
}

function listConceptSlugs() {
  const slugs = [];
  for (const d of fs.readdirSync(CONCEPTS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(CONCEPTS_DIR, d.name))) {
      if (f.endsWith('.md')) slugs.push(f.replace(/\.md$/, ''));
    }
  }
  return slugs;
}

function parseLooseJson(s) {
  let t = String(s).trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(t);
}

// 注:URL 自动抓取已按用户要求暂缓(公众号/链接反爬复杂)。当前聚焦:术语 → 分类 → 解释 → 关联。

// ── 调 LLM 生成词条 ────────────────────────────────────
const SYSTEM_PROMPT = `你是「我的知识库」的词条作者。用户是零基础的技术销售新人(目标岗位:云和大模型大客户销售)。你的任务:把专业概念写成结构清晰、小白能懂、销售能用的词条。

硬性要求:
- "大白话解释":像对一个完全不懂技术的朋友讲,可打比方,不要堆术语;
- "销售话术版":像对客户/面试官讲,给一句可以直接说的话,体现"把技术翻译成生意价值";
- "topic" 四选一,务必准确:AI 技术/模型/算力 → ai;云服务/部署/云形态 → cloud;销售方法论/销售术语 → sales;商业指标/其他 → business;
- "related" 是从已有概念中挑真正相关的 1-5 个建立关联(这是本产品区别于普通问答 AI 的核心价值,务必认真挑,只选确实相关的,不要硬凑;确实没有就空数组);
- 如果用户给了背景说明,以它为主要事实来源,但用自己的话写,不要摘抄;
- body 用 markdown,只允许 ## 三级以内标题、无序列表、加粗、引用,分三段:## 一句话 / ## 大白话解释 / ## 销售话术版(可再加 ## 备注);
- 每个词条 300-600 字;
- 只输出一个合法 JSON 对象,不要输出任何其他文字。`;

function buildUserPrompt({ term, context, sourceUrl, existing }) {
  return `要解释的词:${term || '(未指定,请从下面的参考内容中自动提炼最重要的概念)'}

参考内容(若为空则无):
${context ? context.slice(0, 6000) : '(无)'}

来源链接:${sourceUrl || '(无)'}

请输出 JSON,字段:
{"name":"规范名称(可含英文)","slug":"英文kebab-case文件名(无英文可用中文)","aliases":["同义词(数组,可空)"],"topic":"ai|cloud|sales|business 四选一","related":["已有概念文件名(数组,只能从下面列表选,没有就空数组)"],"body":"markdown正文(含 ## 一句话 / ## 大白话解释 / ## 销售话术版 三段)"}

已有概念文件名(related 只能选这些):
${existing.length ? existing.join('、') : '(还没有任何概念,related 请给空数组)'}`;
}

async function genConcept({ term, context, sourceUrl }) {
  const existing = listConceptSlugs();
  const resp = await fetch(LLM_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt({ term, context, sourceUrl, existing }) },
      ],
    }),
  });
  if (!resp.ok) { const t = await resp.text(); throw new Error('LLM ' + resp.status + ': ' + t.slice(0, 300)); }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回空内容');
  const p = parseLooseJson(content);

  const name = String(p?.name || '').trim();
  if (!name) throw new Error('LLM 未返回 name');
  const topic = TOPICS[p?.topic] ? p.topic : 'ai';
  const slug = slugify(p?.slug || name);
  const aliases = Array.isArray(p?.aliases) ? p.aliases.map(String).slice(0, 6) : [];
  const related = (Array.isArray(p?.related) ? p.related.map(String) : []).filter(r => existing.includes(r)).slice(0, 8);
  const body = String(p?.body || '').trim();
  if (!body) throw new Error('LLM 未返回 body');
  return { name, slug, topic, aliases, related, body };
}

// ── 写入词条文件 ────────────────────────────────────────
function writeConcept({ name, slug, topic, aliases, related, body, sourceUrl, sourceNote }) {
  const dir = path.join(CONCEPTS_DIR, topic);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, slug + '.md');
  const today = new Date().toISOString().slice(0, 10);
  const sources = [];
  if (sourceUrl) sources.push(sourceUrl);
  if (sourceNote) sources.push(sourceNote);
  const md = [
    '---',
    `name: ${name}`,
    `aliases: [${aliases.join(', ')}]`,
    `topic: ${topic}`,
    `related: [${related.join(', ')}]`,
    `sources: [${sources.join(', ')}]`,
    `created: ${today}`,
    `updated: ${today}`,
    '---',
    '',
    body,
    '',
  ].join('\n');
  fs.writeFileSync(file, md);
  return file;
}

// ── 主流程 ──────────────────────────────────────────────
async function main() {
  if (!TITLE.startsWith('[词条]')) { log('非词条 Issue,跳过'); return; }
  if (!LLM_KEY) {
    await ghComment('⚠️ 仓库未配置 `LLM_API_KEY` secret,无法自动生成词条。请管理员在仓库 Settings → Secrets and variables → Actions 添加。');
    return;
  }

  // 术语优先:标题 = [词条] 术语名;body = 可选背景说明(当前不做 URL 抓取)
  let term = TITLE.replace(/^\[词条\]\s*/, '').trim();
  let context = BODY.replace(/^https?:\/\/\S+/i, '').trim();
  if (!term && !context) {
    await ghComment('请至少提供一个专业术语:标题用 `[词条] 术语名`,或在 body 里写术语。');
    return;
  }
  if (!term) term = context.split('\n')[0].trim();
  if (term.length > 40) term = term.slice(0, 40);
  log('术语:', term, '| 背景长度:', context.length);

  let c;
  try { c = await genConcept({ term, context, sourceUrl: '' }); }
  catch (e) { await ghComment(`⚠️ 生成失败:${e.message}`); return; }

  const file = writeConcept({ ...c, sourceUrl: '', sourceNote: `Issue #${NUMBER}` });
  log('已写入', file);
  await ghComment(
    `✅ 已生成词条 **${c.name}**(主题:${TOPICS[c.topic]},已关联 ${c.related.length} 个相关概念)\n\n文件:\`${file}\`\n站点链接:${SITE_URL}/concepts/${encodeURIComponent(c.slug)}.html\n\n站点会自动重建,稍后刷新即可看到。`
  );
  await ghClose();
}

main().catch(e => { log('致命错误:', e); });
