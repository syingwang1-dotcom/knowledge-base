# 📚 我的知识库

个人知识消化系统:把播客、报道里听不懂的词,变成能讲给客户听的话。

- **输入**:公众号文章 URL / 随手记的陌生词
- **处理**:提取 → 抽术语 → 小白口吻解释(技术销售腔)
- **沉淀**:结构化、带索引、概念互联的知识库
- **输出**:多页面静态站(部署在 GitHub Pages)

## 结构

```
知识库/
├── concepts/          # 词条源数据(按主题分文件夹),每词一个 .md
│   ├── ai/            # AI / 大模型
│   ├── cloud/         # 云计算
│   ├── sales/         # 销售 / GTM
│   └── business/      # 商业 / 其他
├── scripts/
│   └── build.mjs      # 静态站生成器(零依赖,纯 Node)
├── docs/              # 生成产物(部署到 GitHub Pages 的目录)
└── README.md
```

## 词条格式(concepts/<topic>/<name>.md)

```yaml
---
name: RAG (检索增强生成)
aliases: [检索增强生成]
topic: ai
related: [llm, agent, fine-tuning]   # ← 反链靠这个,用文件名(slug)
sources: [https://mp.weixin.qq.com/...]
created: 2026-08-24
updated: 2026-08-24
---

## 一句话
(10-15 字)

## 大白话解释
(像对完全不懂的人讲)

## 销售话术版
(怎么跟客户/面试官讲)
```

## 如何添加概念(3 步)

1. 在 `concepts/<topic>/` 下新建 `<slug>.md`(按上面格式);
2. 运行 `node scripts/build.mjs`;
3. 站点自动重新生成。

> 加完 2-3 个词条,`related` 记得互相指向,反链才会长成网。

## 全自动投喂(手机/网页都能用)

网站「添加概念」页 → 提交 → 自动生成词条并上线:

```
手机/电脑 → 网站 add.html 投喂表单 → 预填 GitHub Issue([词条] 开头)
  → GitHub Actions 自动:抓取文章 → 调大模型(DeepSeek)生成词条
  → 写入 concepts/ → 重建站点 → 自动上线 → 回帖并关闭 Issue
```

**前提(一次性配置)**:
1. 在 platform.deepseek.com 注册并创建 API key;
2. 仓库 Settings → Secrets and variables → Actions → 新建 `LLM_API_KEY`;
3. 之后任何以 `[词条]` 开头的 Issue 都会被自动处理。

**抓取失败兜底**:复杂页面(反爬/需登录)抓不到时,系统会在 Issue 留言,把正文粘贴到 Issue body 即可。

## 如何部署(GitHub Pages)

```bash
# 1. 首次:在 github.com 创建空仓库 knowledge-base
# 2. 关联远程并推送
git remote add origin git@github.com:syingwang1-dotcom/knowledge-base.git
git push -u origin main
# 3. 仓库 Settings → Pages → Deploy from branch: main, folder: /docs
# 站点地址: https://syingwang1-dotcom.github.io/knowledge-base/
```
