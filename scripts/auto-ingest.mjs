// 自动词条生成器(在 GitHub Actions 中运行)—— 处理标题以 [词条] 开头的 Issue
// 输入(环境变量):ISSUE_TITLE / ISSUE_BODY / ISSUE_NUMBER / LLM_API_KEY
// 流程:解析 Issue → 调 LLM 生成词条(分类+解释+关联)→ 写入 concepts/<topic>/<slug>.md → 回帖并关闭 Issue
// 词条生成核心逻辑在 scripts/concept-gen.mjs(与 Cloudflare Worker 共享)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { generateConcept, TOPICS } from './concept-gen.mjs';

const ROOT = process.cwd();
const CONCEPTS_DIR = path.join(ROOT, 'concepts');

const LLM_KEY = process.env.LLM_API_KEY || '';
const LLM_BASE = process.env.LLM_BASE || 'https://api.deepseek.com/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';

const TITLE = process.env.ISSUE_TITLE || '';
const BODY = (process.env.ISSUE_BODY || '').trim();
const NUMBER = process.env.ISSUE_NUMBER || '?';

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

function writeConcept({ name, slug, topic, aliases, related, body, sourceNote }) {
  const dir = path.join(CONCEPTS_DIR, topic);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, slug + '.md');
  const today = new Date().toISOString().slice(0, 10);
  const md = [
    '---',
    `name: ${name}`,
    `aliases: [${aliases.join(', ')}]`,
    `topic: ${topic}`,
    `related: [${related.join(', ')}]`,
    `sources: [${sourceNote}]`,
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
  try {
    c = await generateConcept({ term, context, existingSlugs: listConceptSlugs(), apiKey: LLM_KEY, base: LLM_BASE, model: LLM_MODEL });
  } catch (e) { await ghComment(`⚠️ 生成失败:${e.message}`); return; }

  const file = writeConcept({ ...c, sourceNote: `Issue #${NUMBER}` });
  log('已写入', file);
  await ghComment(
    `✅ 已生成词条 **${c.name}**(主题:${TOPICS[c.topic]},已关联 ${c.related.length} 个相关概念)\n\n文件:\`${file}\`\n站点链接:${SITE_URL}/concepts/${encodeURIComponent(c.slug)}.html\n\n站点会自动重建,稍后刷新即可看到。`
  );
  await ghClose();
}

main().catch(e => { log('致命错误:', e); });
