// 词条生成核心逻辑(共享:GitHub Actions 的 auto-ingest 与 Cloudflare Worker 都用它)
// 职责:给一个术语 + 可选背景 → 调 LLM → 自动分类 + 大白话解释 + 关联已有词条 → 返回规范化词条对象
export const TOPICS = { ai: 'AI / 大模型', cloud: '云计算', sales: '销售 / GTM', business: '商业 / 其他' };

export function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[（(][^（）()]*[）)]/g, '')
    .replace(/[^\w一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'concept';
}

export function parseLooseJson(s) {
  let t = String(s).trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(t);
}

export function normalize(raw, existingSlugs) {
  const name = String(raw?.name || '').trim();
  if (!name) throw new Error('LLM 未返回 name');
  const topic = TOPICS[raw?.topic] ? raw.topic : 'ai';
  const slug = slugify(raw?.slug || name);
  const aliases = Array.isArray(raw?.aliases) ? raw.aliases.map(String).slice(0, 6) : [];
  const related = (Array.isArray(raw?.related) ? raw.related.map(String) : []).filter(r => existingSlugs.includes(r)).slice(0, 8);
  const body = String(raw?.body || '').trim();
  if (!body) throw new Error('LLM 未返回 body');
  return { name, slug, topic, aliases, related, body };
}

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

function buildUserPrompt({ term, context, existingSlugs }) {
  return `要解释的词:${term || '(未指定,请从背景中提炼最重要的概念)'}

背景说明(若为空则无):
${context ? context.slice(0, 6000) : '(无)'}

请输出 JSON,字段:
{"name":"规范名称(可含英文)","slug":"英文kebab-case文件名(无英文可用中文)","aliases":["同义词(数组,可空)"],"topic":"ai|cloud|sales|business 四选一","related":["已有概念文件名(数组,只能从下面列表选,没有就空数组)"],"body":"markdown正文(含 ## 一句话 / ## 大白话解释 / ## 销售话术版 三段)"}

已有概念文件名(related 只能选这些):
${existingSlugs.length ? existingSlugs.join('、') : '(还没有任何概念,related 请给空数组)'}`;
}

export async function generateConcept({ term, context, existingSlugs, apiKey, base, model }) {
  const resp = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt({ term, context, existingSlugs }) },
      ],
    }),
  });
  if (!resp.ok) { const t = await resp.text(); throw new Error('LLM ' + resp.status + ': ' + t.slice(0, 300)); }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回空内容');
  return normalize(parseLooseJson(content), existingSlugs);
}
