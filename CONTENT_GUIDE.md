# 内容贡献指南

本指南面向希望为「巴菲特价值投资」开源网站贡献内容的协作者。无论你是研究者、译者还是爱好者，只要遵循本指南的规范，即可轻松新增信件、概念、公司或人物条目，**无需修改任何代码**。

---

## 目录

1. [简介](#1-简介)
2. [快速开始](#2-快速开始)
3. [内容类型说明](#3-内容类型说明)
4. [Front Matter 字段说明](#4-front-matter-字段说明)
5. [金句文件规范](#5-金句文件规范)
6. [交叉引用维护](#6-交叉引用维护)
7. [构建与验证](#7-构建与验证)
8. [常见错误](#8-常见错误)

---

## 1. 简介

### 什么是内容贡献

本项目的所有展示内容（信件、概念、公司、人物、金句）均以 **Markdown 文件**的形式存储于 `content/` 目录中。网站由构建脚本 `node build.mjs` 自动将这些文件转换为网页。

**新增一个 Markdown 文件 = 网站上新增一个页面**，不需要触碰任何 HTML、JavaScript 或 CSS 代码。

### 谁可以贡献

- **内容研究者**：翻译或整理巴菲特信件原文、撰写概念解读
- **投资爱好者**：补充公司背景信息、摘录经典金句
- **中英文编辑**：校对已有内容的翻译质量与准确性

### 内容规模（当前）

| 类型 | 数量 | 范围 |
|------|------|------|
| 股东信 | 60 封 | 1965–2025 |
| 合伙人信 | 35 封 | 1956–1970 |
| 特别信件 | 3 封 | 专题信件 |
| 投资概念 | 49 个 | — |
| 公司 | 61 家 | — |
| 关键人物 | 7 位 | — |

---

## 2. 快速开始

### 本地环境准备

```bash
# 1. 克隆仓库
git clone <repo-url>
cd value-investment

# 2. 安装依赖（仅需一次）
npm install

# 3. 确认构建正常
node build.mjs
```

### 新增一篇文章的完整流程

以新增「1966年合伙人信」为例：

#### 第一步：创建主内容文件

在 `content/partnership-letters/` 目录下新建 `1966-annual.md`：

```markdown
---
title: "1966年合伙人信（年度）"
category: "partnership-letter"
slug: "1966-annual"
year: 1966
summary: "本封信讨论了市场高估值环境下的投资策略调整。"
tags:
  - "市场先生"
  - "估值"
concepts_discussed:
  - "margin-of-safety"
companies_mentioned:
  - "berkshire-hathaway"
people_mentioned:
  - "charlie-munger"
---

## 正文

此处填写信件内容……
```

#### 第二步：创建金句文件（可选）

新建 `content/partnership-letters/1966-annual-quotes.md`，摘录本封信中的经典语句。

#### 第三步：更新交叉引用

```bash
# 自动更新关联概念/公司/人物的 mentioned_in_letters 字段
node scripts/cross-ref.mjs
```

#### 第四步：构建验证

```bash
node build.mjs
```

#### 第五步：本地预览

```bash
bash start-local.sh
# 浏览器访问 http://localhost:8788
```

#### 第六步：提交 Pull Request

```bash
git add content/
git commit -m "content: 新增1966年合伙人年度信"
git push origin your-branch
```

---

## 3. 内容类型说明

`content/` 目录结构如下：

```
content/
├── shareholder-letters/    # 股东信：{year}.md + {year}-quotes.md
├── partnership-letters/    # 合伙人信：{year}-{descriptor}.md + -quotes.md
├── special-letters/        # 特别信件：{slug}.md + {slug}-quotes.md
├── concepts/               # 投资概念：{slug}.md + {slug}-quotes.md
├── companies/              # 公司：{slug}.md + {slug}-quotes.md
├── people/                 # 人物：{slug}.md + {slug}-quotes.md
└── skills/
    └── buffett-skill.md    # AI 技能文件（Nuwa-Skill 格式，勿随意修改）
```

---

### 3.1 股东信（Shareholder Letters）

**文件路径**：`content/shareholder-letters/{year}.md`

```yaml
---
title: "1984年致股东信"
category: "shareholder-letter"
slug: "1984"
year: 1984
summary: "本封信深入阐释了内在价值与账面价值的区别，并首次系统介绍了保险浮存金概念。"
tags:
  - "内在价值"
  - "保险浮存金"
concepts_discussed:
  - "intrinsic-value"
  - "float"
companies_mentioned:
  - "berkshire-hathaway"
  - "geico"
people_mentioned:
  - "charlie-munger"
---

## 正文

……
```

---

### 3.2 合伙人信（Partnership Letters）

**文件路径**：`content/partnership-letters/{year}-{descriptor}.md`

`{descriptor}` 通常为 `annual`（年度总结）或 `semi-annual`（半年报）等。

```yaml
---
title: "1966年合伙人信（年度）"
category: "partnership-letter"
slug: "1966-annual"
year: 1966
summary: "在市场高估值背景下，巴菲特调整了投资策略，减少了套利仓位。"
tags:
  - "市场估值"
  - "套利"
concepts_discussed:
  - "margin-of-safety"
companies_mentioned:
  - "berkshire-hathaway"
people_mentioned: []
---

## 正文

……
```

---

### 3.3 特别信件（Special Letters）

**文件路径**：`content/special-letters/{slug}.md`

用于不属于年度股东信或合伙人信的专题信件，例如致员工信、致收购方信等。

```yaml
---
title: "致伯克希尔员工的一封信"
category: "special-letter"
slug: "letter-to-employees"
year: 2023
summary: "巴菲特就企业文化与长期主义致伯克希尔全体员工。"
tags:
  - "企业文化"
concepts_discussed: []
companies_mentioned:
  - "berkshire-hathaway"
people_mentioned: []
---

## 正文

……
```

---

### 3.4 投资概念（Concepts）

**文件路径**：`content/concepts/{slug}.md`

```yaml
---
title: "内在价值"
category: "concept"
slug: "intrinsic-value"
summary: "内在价值是一项业务在其剩余生命周期内可产生的预期现金流的折现值。"
tags:
  - "估值"
  - "核心概念"
mentioned_in_letters:
  - "shareholder-letters/1984"
  - "shareholder-letters/1992"
related_concepts:
  - "margin-of-safety"
  - "book-value"
---

## 定义

……

## 巴菲特的阐释

……
```

---

### 3.5 公司（Companies）

**文件路径**：`content/companies/{slug}.md`

> ⚠️ **必须**提供 `wikipedia` 和 `baidu_baike` 两个外链字段。

```yaml
---
title: "苹果公司"
category: "company"
slug: "apple"
summary: "全球最大科技公司之一，伯克希尔哈撒韦最大持仓股。"
tags:
  - "科技"
  - "消费电子"
wikipedia: "https://en.wikipedia.org/wiki/Apple_Inc."
baidu_baike: "https://baike.baidu.com/item/苹果公司"
mentioned_in_letters:
  - "shareholder-letters/2016"
  - "shareholder-letters/2017"
---

## 公司简介

……

## 巴菲特与苹果

……
```

---

### 3.6 人物（People）

**文件路径**：`content/people/{slug}.md`

> ⚠️ **必须**提供 `wikipedia` 和 `baidu_baike` 两个外链字段。

```yaml
---
title: "查理·芒格"
category: "person"
slug: "charlie-munger"
summary: "伯克希尔哈撒韦副主席，巴菲特长达数十年的商业伙伴，多元思维模型的倡导者。"
wikipedia: "https://en.wikipedia.org/wiki/Charlie_Munger"
baidu_baike: "https://baike.baidu.com/item/查理·芒格"
mentioned_in_letters:
  - "shareholder-letters/1978"
  - "shareholder-letters/1984"
---

## 人物简介

……

## 与巴菲特的合作

……
```

---

## 4. Front Matter 字段说明

### 4.1 信件类型通用字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 页面标题，中文 |
| `category` | string | ✅ | 固定值：`shareholder-letter` / `partnership-letter` / `special-letter` |
| `slug` | string | ✅ | URL 标识符，小写加连字符，如 `1984` 或 `1966-annual` |
| `year` | integer | ✅ | 信件年份 |
| `summary` | string | ✅ | 一句话摘要，用于列表页和 SEO |
| `tags` | string[] | 推荐 | 主题标签，便于检索 |
| `concepts_discussed` | string[] | 推荐 | 引用概念的 slug 列表 |
| `companies_mentioned` | string[] | 推荐 | 提及公司的 slug 列表 |
| `people_mentioned` | string[] | 推荐 | 提及人物的 slug 列表 |

### 4.2 概念字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 概念名称 |
| `category` | string | ✅ | 固定值：`concept` |
| `slug` | string | ✅ | URL 标识符 |
| `summary` | string | ✅ | 一句话定义 |
| `tags` | string[] | 推荐 | 分类标签 |
| `mentioned_in_letters` | string[] | 推荐 | 引用此概念的信件路径，格式：`shareholder-letters/1984` |
| `related_concepts` | string[] | 可选 | 相关概念 slug 列表 |

### 4.3 公司字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 公司名称（中文） |
| `category` | string | ✅ | 固定值：`company` |
| `slug` | string | ✅ | URL 标识符 |
| `summary` | string | ✅ | 一句话描述 |
| `tags` | string[] | 推荐 | 行业标签 |
| `wikipedia` | string | ✅ | 英文维基百科链接 |
| `baidu_baike` | string | ✅ | 百度百科链接 |
| `mentioned_in_letters` | string[] | 推荐 | 引用此公司的信件路径 |

### 4.4 人物字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 人物姓名（中文） |
| `category` | string | ✅ | 固定值：`person` |
| `slug` | string | ✅ | URL 标识符 |
| `summary` | string | ✅ | 一句话描述 |
| `wikipedia` | string | ✅ | 英文维基百科链接 |
| `baidu_baike` | string | ✅ | 百度百科链接 |
| `mentioned_in_letters` | string[] | 推荐 | 引用此人物的信件路径 |

### 4.5 Slug 命名规范

| 规则 | 正确示例 | 错误示例 |
|------|----------|----------|
| 全小写 | `intrinsic-value` | `Intrinsic-Value` |
| 用连字符分隔单词 | `charlie-munger` | `charlie_munger` |
| 不含空格或特殊字符 | `bank-of-america` | `bank of america` |
| 年份直接用数字 | `1984` | `year-1984` |
| 合伙人信加描述词 | `1966-annual` | `1966_annual` |

---

## 5. 金句文件规范

每个内容文件都可以配套一个金句文件，用于在「金句展示」页面和侧边栏中展示经典语录。

### 文件命名

| 主文件 | 金句文件 |
|--------|----------|
| `shareholder-letters/1984.md` | `shareholder-letters/1984-quotes.md` |
| `concepts/intrinsic-value.md` | `concepts/intrinsic-value-quotes.md` |
| `companies/apple.md` | `companies/apple-quotes.md` |
| `people/charlie-munger.md` | `people/charlie-munger-quotes.md` |

### Front Matter 格式

```yaml
---
title: "1984 精选金句"
category: "quotes"
source_slug: "1984"
source_category: "shareholder-letters"
---
```

| 字段 | 说明 |
|------|------|
| `title` | 金句文件标题 |
| `category` | 固定值：`quotes` |
| `source_slug` | 来源文件的 slug（不含路径） |
| `source_category` | 来源文件所在目录名，如 `shareholder-letters`、`concepts`、`companies`、`people` |

### 金句正文格式

每条金句用 Markdown 块引用（`>`）格式书写，条目之间空一行：

```markdown
> 价格是你付出的，价值是你得到的。

> 只有在潮水退去时，你才能看出谁在裸泳。

> 我们喜欢以合理的价格买入优秀的公司，而不是以低廉的价格买入平庸的公司。
```

> 💡 **提示**：金句文件是可选的，但强烈推荐——它们极大丰富了网站的「金句」板块体验。

---

## 6. 交叉引用维护

网站的知识图谱（Knowledge Graph）依赖各内容文件之间的交叉引用保持一致。

### 引用关系图

```
信件 ──concepts_discussed──▶ 概念
信件 ──companies_mentioned──▶ 公司
信件 ──people_mentioned──▶ 人物

概念 ◀──mentioned_in_letters── 信件
公司 ◀──mentioned_in_letters── 信件
人物 ◀──mentioned_in_letters── 信件
```

### 修改内容后的关联审查流程

#### 情形一：新增信件

1. 在信件的 front matter 中填写 `concepts_discussed`、`companies_mentioned`、`people_mentioned`
2. 运行自动交叉引用脚本：
   ```bash
   node scripts/cross-ref.mjs
   ```
   该脚本会自动将新信件的路径追加到对应概念/公司/人物的 `mentioned_in_letters` 字段中。
3. 重新构建：
   ```bash
   node build.mjs
   ```

#### 情形二：新增概念 / 公司 / 人物

1. 在新文件的 front matter 中手动填写 `mentioned_in_letters`（引用该实体的所有信件路径）
2. 确认对应信件文件的 `concepts_discussed` / `companies_mentioned` / `people_mentioned` 中已包含该实体的 slug
3. 运行：
   ```bash
   node scripts/cross-ref.mjs && node build.mjs
   ```

#### 情形三：修改已有条目的 slug

> ⚠️ **高风险操作**：修改 slug 会导致所有引用该 slug 的交叉引用失效，并产生 404 错误。

1. 全局搜索旧 slug，逐一替换所有引用
2. 运行 `node scripts/cross-ref.mjs && node build.mjs`
3. 在浏览器中验证新旧页面跳转是否正常

### 禁止直接编辑的数据文件

| 文件 | 说明 |
|------|------|
| `data/quotes.yml` | 已归档的旧版金句数据，**请勿编辑** |
| `data/scraped-quotes.yml` | 爬取的原始金句存档，**请勿编辑** |
| `data/cross-references.json` | 由 `scripts/cross-ref.mjs` 自动生成，**请勿手动编辑** |

---

## 7. 构建与验证

### 主构建命令

```bash
node build.mjs
```

该命令执行以下操作：

1. 读取 `content/` 下所有 Markdown 文件
2. 解析 front matter 与正文
3. 生成 `site/content/`（HTML 片段）
4. 生成 `site/assets/data/` 下的 JSON 数据文件（搜索索引、知识图谱数据、金句数据等）
5. 编译 `functions/api/_buffett-skill.js`（AI 对话功能所需）

> ⚠️ **注意**：`site/content/` 和 `site/assets/data/*.json` 是**构建产物**，已加入 `.gitignore`，**不要手动修改，也不要提交**。

### 本地预览

```bash
bash start-local.sh
# 在浏览器中打开 http://localhost:8788
```

本地预览使用 Cloudflare Pages 的本地开发环境（`wrangler pages dev`），可完整模拟生产环境，包括 AI 对话功能（需配置 `.dev.vars` 中的 API Key）。

### 构建验证清单

运行 `node build.mjs` 后，请确认：

- [ ] 终端无报错（`ERROR` 或 `WARN` 级别）
- [ ] 新增页面在本地预览中可正常访问
- [ ] 知识图谱页面正确显示新实体及其关联
- [ ] 搜索功能可找到新内容
- [ ] 金句页面显示新增金句（如有）

---

## 8. 常见错误

### ❌ 错误一：直接修改 `site/content/` 中的文件

**问题**：`site/content/` 是构建产物目录，每次运行 `node build.mjs` 都会被完全覆盖。在此目录中的任何修改都会在下次构建后丢失。

**正确做法**：**永远只编辑 `content/` 目录**下的源文件。

---

### ❌ 错误二：忘记运行 `node build.mjs`

**问题**：修改 `content/` 后未重新构建，导致网站展示的仍是旧内容。

**正确做法**：每次内容变更后，必须运行 `node build.mjs` 才能使变更生效。

---

### ❌ 错误三：Slug 包含大写字母、空格或下划线

**问题**：Slug 会直接用于 URL，非法字符会导致页面无法访问或路由错误。

**错误示例**：`Intrinsic_Value`、`charlie munger`

**正确示例**：`intrinsic-value`、`charlie-munger`

---

### ❌ 错误四：公司/人物条目缺少外链字段

**问题**：`companies` 和 `people` 类型的条目必须包含 `wikipedia` 和 `baidu_baike` 字段，缺失会导致构建警告或页面信息不完整。

**正确做法**：创建公司/人物条目时，务必同时填写两个外链字段。

---

### ❌ 错误五：手动编辑 `data/cross-references.json`

**问题**：该文件由 `node scripts/cross-ref.mjs` 自动生成，手动修改会在下次运行脚本后被覆盖，且可能引入格式错误。

**正确做法**：通过修改各内容文件的 front matter 字段来维护交叉引用，然后运行脚本自动生成。

---

### ❌ 错误六：提交构建产物到 Git

**问题**：以下文件/目录已在 `.gitignore` 中声明为构建产物，不应提交：

```
site/content/
site/assets/data/manifest.json
site/assets/data/search-index.json
site/assets/data/graph-data.json
site/assets/data/server-search-index.json
site/assets/data/buffett-skill.json
site/assets/data/quotes-data.json
functions/api/_buffett-skill.js
data/cross-references.json
```

**正确做法**：只提交 `content/` 目录下的源文件，以及必要的配置文件变更。

---

### ❌ 错误七：在 `.gitignore` 中使用行内注释

**问题**：`.gitignore` 不支持行内注释（即 `node_modules/ # 依赖目录` 这种写法会将 `# 依赖目录` 视为路径的一部分）。

**正确做法**：注释单独占一行，以 `#` 开头：

```gitignore
# 依赖目录
node_modules/
```

---

## 附录：快速参考卡

```
新增内容完整流程
────────────────────────────────────────────
1. 在 content/{type}/ 下新建 {slug}.md
2. 填写 front matter（参考本指南第3节）
3. 编写正文内容
4. （可选）新建 {slug}-quotes.md 添加金句
5. 运行: node scripts/cross-ref.mjs
6. 运行: node build.mjs
7. 运行: bash start-local.sh → 浏览器验证
8. git add content/ && git commit && git push
────────────────────────────────────────────

文件来源规则
  ✅ 编辑: content/          ← 唯一内容源
  ❌ 禁止: site/content/     ← 构建产物，会被覆盖
  ❌ 禁止: data/cross-references.json ← 自动生成
  ❌ 禁止: data/quotes.yml   ← 已归档
```
