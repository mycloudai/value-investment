# MyCloudAI 价值投资 · 项目自定义指令

---

## ⚠️ 每次完成任务前的强制检查清单（AI 必须全部执行）

无论任务大小，**提交代码前必须逐项完成**：

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | **更新 `CHANGELOG.md`** | 顶部插入新版本条目（semver 格式，见下方规范） |
| 2 | **更新 `package.json` 版本号** | 与 CHANGELOG 保持一致 |
| 3 | **新增/更新测试用例** | 在 `tests/run-qa.sh` 中覆盖新功能/修复点 |
| 4 | **检查并更新 `HELP.md`** | 交互逻辑、快捷键、页面、按钮有变化时必须同步 |
| 5 | **运行相关 Section 测试验证** | `bash tests/run-qa.sh --headless --section=N` 确认无新增失败项 |

> ❌ 缺少任何一项都是不完整的交付，必须补齐后再结束任务。

---

## 项目背景

MyCloudAI 价值投资是一个专注于巴菲特投资理念的学习网站，可部署在 **Cloudflare Pages**。

核心定位：

- 收录巴菲特从 1956 年至 2024 年的所有合伙人信件与股东信（共 95 封）
- 收录 49 个投资概念、61 家公司解析、7 位关键人物
- 提供基于 Nuwa-Skill 框架的「与巴菲特对话」AI 功能
- 网站名称：**MyCloudAI - 价值投资**，副标题：与巴菲特同行，读懂价值投资

---

## 架构速览

```
value-investment/
├── content/                  # ★ 唯一内容来源（MD 文件）
│   ├── shareholder-letters/  # 60 封股东信（1965–2024）
│   ├── partnership-letters/  # 35 封合伙人信（1956–1970）
│   ├── special-letters/      # 3 封特别信件
│   ├── concepts/             # 49 个投资概念
│   ├── companies/            # 61 家公司（含 Wikipedia/百度百科链接）
│   ├── people/               # 7 位关键人物
│   └── skills/
│       └── buffett-skill.md  # ★ 巴菲特 AI Skill（Nuwa-Skill 格式，唯一源）
├── site/                     # Cloudflare Pages 部署目录
│   ├── index.html            # SPA 入口（唯一 HTML）
│   ├── _redirects            # /* /index.html 200（SPA 路由）
│   ├── assets/
│   │   ├── css/style.css     # 全局样式（蓝色主题 + 明暗切换）
│   │   ├── js/
│   │   │   ├── app.js        # SPA 路由 + 6 个页面渲染器
│   │   │   └── talk.js       # AI 对话前端逻辑
│   │   ├── data/             # Build 产物（search-index、graph-data 等）
│   │   └── icons/            # mycloudai.png 系列图标
│   └── content/              # Build 时从 content/ 复制过来（勿手动修改）
├── functions/
│   └── api/
│       ├── chat.js           # ★ Cloudflare Pages Function（Agentic Loop）
│       └── _buffett-skill.js # Build 产物（从 buffett-skill.md 编译）
├── tests/
│   ├── run-qa.sh             # ★ Playwright 测试脚本（有头浏览器）
│   ├── qa-report.md          # 最新测试报告
│   └── screenshots/          # 测试截图
├── data/                     # 原始数据（quotes yml 等）
├── scripts/                  # 工具脚本（cross-ref、reorganize-quotes 等）
├── build.mjs                 # ★ 构建脚本（生成 manifest、索引、编译 Skill）
├── start-local.sh            # 本地启动脚本
└── wrangler.toml             # Cloudflare Pages 配置
```

---

## 关键设计原则

### 1. MD 是唯一内容来源

- **绝对不要**在两处维护同一内容
- 所有文章内容只存在于 `content/` 下的 `.md` 文件
- `site/content/` 是 build 产物，由 `node build.mjs` 生成，**不要手动修改**
- 新增页面 = 在对应目录下新增 `.md` 文件，build 后自动可访问

### 2. MD Front Matter 规范

每个 MD 文件必须有 YAML front matter：

```yaml
---
title: "文章标题"
category: "shareholder-letter | partnership-letter | concept | company | person"
slug: "url-friendly-name"
year: 1984 # 仅信件需要
tags:
  - "标签1"
  - "标签2"
# 信件专有字段：
concepts_discussed:
  - "concept-slug"
companies_mentioned:
  - "company-slug"
people_mentioned:
  - "person-slug"
# 概念/公司/人物专有字段：
mentioned_in_letters:
  - "shareholder-letters/1984"
  - "partnership-letters/1962"
# 公司和人物额外字段：
wikipedia: "https://..."
baidu_baike: "https://..."
---
```

### 3. 金句与摘抄

金句/精选内容维护在**同目录下**的 `{slug}-quotes.md` 文件，这是**唯一来源**。
例如：`content/shareholder-letters/1984-quotes.md`

**⚠️ 重要：`data/quotes.yml` 和 `data/scraped-quotes.yml` 是已归档的历史文件，请勿编辑。**
- 这两个文件是一次性迁移脚本（`scripts/reorganize-quotes.py`）的输入，现已完成使命
- `build.mjs` 直接从 `{slug}-quotes.md` 生成 `site/assets/data/quotes-data.json`，不读取任何 YAML
- 新增或修改金句 → 只编辑 `content/{category}/{slug}-quotes.md`

**金句文件格式：**
```markdown
---
title: "1984 精选金句"
category: "quotes"
source_slug: "1984"
source_category: "shareholder-letters"
---

> 金句内容一

> 金句内容二
```

### 4. Buffett Skill 架构

- `content/skills/buffett-skill.md` = Nuwa-Skill 格式认知操作系统（心智模型 + Agentic Protocol）
- `functions/api/chat.js` = 服务端 Agentic Loop（AI 自主决定何时调用 `search_buffett_knowledge` 工具）
- **不使用 RAG 预加载**：AI 根据 Skill 的 Agentic Protocol 主动决定是否检索原文
- 前端 `talk.js` 只负责收发消息，所有 Skill 逻辑在服务端

### 5. CSS 主题系统

- 使用 CSS 变量（`:root` 深色，`[data-theme="light"]` 浅色）
- **所有颜色必须通过 CSS 变量**，禁止 hardcode 颜色值
- 明暗切换按钮在 sidebar footer，preference 存 localStorage

---

## 阅读顺序（快速上手）

1. **了解项目全貌** → 阅读本文件 + `README.md`
2. **了解网站功能** → `site/index.html`（SPA 壳） + `site/assets/js/app.js`（路由 + 渲染）
3. **了解内容结构** → `content/shareholder-letters/1984.md`（典型信件示例）
4. **了解 AI 功能** → `content/skills/buffett-skill.md`（Skill 定义） + `functions/api/chat.js`（服务端）
5. **了解构建流程** → `build.mjs`（完整注释）
6. **了解测试** → `tests/run-qa.sh`（Playwright 测试脚本）

---

## 开发工作流

### 本地启动

```bash
./start-local.sh          # 自动 build + 启动 wrangler pages dev（端口 8788）
./start-local.sh 3000     # 自定义端口
```

### 构建

```bash
node build.mjs
```

构建产物：`site/content/`（MD 复制）、`manifest.json`、`search-index.json`、`graph-data.json`、`server-search-index.json`、`_buffett-skill.js`、`buffett-skill.json`

### 新增内容页面

1. 在对应 `content/{category}/` 下新建 `.md` 文件（填写完整 front matter）
2. 运行 `node build.mjs`
3. 页面自动可访问，无需改任何代码

---

## 内容修改后的关联审查（重要）

### 修改任何 MD 文件内容后，必须执行：

1. **审查受影响页面的 front matter 关联字段**
   - 若修改的是**信件**（shareholder/partnership/special-letter）：检查 `concepts_discussed`、`companies_mentioned`、`people_mentioned` 是否需要增删
   - 若修改的是**概念/公司/人物**：检查 `mentioned_in_letters`、`related_concepts`、`related_companies` 是否仍然准确

2. **反向检查关联方**
   - 若在信件中新增/删除了对某概念或公司的讨论，需同步更新该概念/公司 MD 的 `mentioned_in_letters`
   - 若新增了一篇信件，需将其 slug 添加到所有涉及概念、公司、人物的 `mentioned_in_letters` 列表中

3. **运行交叉引用更新脚本**
   ```bash
   node scripts/cross-ref.mjs   # 重新生成 data/cross-references.json
   node build.mjs               # 重新构建（更新 manifest、search-index 等）
   ```

4. **检查金句文件**
   - 若修改了信件内容，检查同目录下的 `{slug}-quotes.md` 是否需要同步更新
   - 若新增了经典引用，及时添加到对应的 `{slug}-quotes.md`

> **原则**：内容是一张网，改一处需检查四周。关联字段不准确会导致右侧关联面板显示错误内容。

---

## 版本号与 Changelog 规范（重要）

项目遵循 [语义化版本 semver](https://semver.org/lang/zh-CN/)，版本号格式 `MAJOR.MINOR.PATCH`：

| 类型 | 触发条件 | 示例 |
|------|---------|------|
| **PATCH** x.y.**Z** | Bug 修复、样式微调、内容补充、文档更新 | TOC 修复、新增金句 |
| **MINOR** x.**Y**.0 | 新增功能、新页面、新路由、重大 UI 变更 | 新增索引页、搜索重构 |
| **MAJOR** **X**.0.0 | 破坏性架构变更、路由重构、构建系统重写 | 更换框架、重写路由 |

### 每次提交前必须完成以下两步：

**1. 更新 `package.json` 版本号**
```json
{ "version": "1.2.0" }
```

**2. 在 `CHANGELOG.md` 顶部插入新版本条目**

格式严格遵循：
```markdown
## [x.y.z] - YYYY-MM-DD

### 新增
- 简洁描述新增内容

### 修复
- 简洁描述修复内容

### 变更
- 简洁描述行为变更（非 breaking）

### 移除
- 简洁描述移除内容
```

> 只写有变化的分类，没有变化的分类直接省略。

### 其他注意事项

- 版本号会通过 `build.mjs` 注入 manifest，并**自动显示在网站侧边栏底部**，无需手动改 HTML
- `CHANGELOG.md` 是项目根目录的唯一版本历史来源，build 时会同步到 `site/content/changelog.md`（build 产物，已 gitignore）
- `HELP.md` 是网站内嵌帮助文档，与 `CHANGELOG.md` 同在项目根目录，build 时同步到 `site/content/help.md`
- 不允许空版本条目（没有任何变更内容就不要新建版本）

### 帮助文档更新规则（重要）

**每次以下情况发生时，必须检查并按需更新 `HELP.md`：**

- 新增功能、页面或路由
- 修改现有功能的交互逻辑（点击行为、导航方式等）
- 新增或修改快捷键、按钮
- 修改 AI 问答的使用方式或配置项

**`HELP.md` 结构：**
- 所有功能说明写在对应章节下
- 表格优先（比长段落更易读）
- 行为变更后对应行/列必须同步修改

---

## 测试规范（重要）

> ⚠️ **提醒**：测试、HELP.md、CHANGELOG 三项均为强制要求，见文件顶部检查清单。

### 每次新增功能或修复 bug 必须：

1. **在 `tests/run-qa.sh` 中新增对应测试用例**
   - 遵循文件中已有的 `pass/fail/skip/section` 函数格式
   - 测试用例要覆盖：正常流程、边界情况、UI 显示
   - 使用 playwright-cli 进行浏览器自动化验证（参考 `.claude/skills/playwright-cli/SKILL.md`）

2. **运行测试并确认通过**

   ```bash
   # 先启动本地服务器
   ./start-local.sh &
   sleep 5
   # 运行测试
   bash tests/run-qa.sh
   ```

3. **查看测试报告**
   - 报告输出到 `tests/qa-report.md`
   - 截图保存到 `tests/screenshots/`
   - 确认无新增失败项

4. **测试工具**：Playwright CLI（**有头浏览器，用户可看到测试过程**）

   **⚠️ 必须显式传 `--headed` flag，否则 playwright-cli 默认无头！**

   ```bash
   playwright-cli open --headed http://localhost:8788  # 弹出真实 Chrome 窗口
   playwright-cli snapshot        # 查看页面结构（必须在每次 goto 后调用）
   playwright-cli click e5        # 点击元素（用 snapshot 中的 ref）
   playwright-cli fill e3 "text"  # 填写输入框
   playwright-cli screenshot --filename=tests/screenshots/feature.png
   playwright-cli close           # 关闭浏览器
   ```

   完整用法参考：`.claude/skills/playwright-cli/SKILL.md`

   **测试脚本支持两种模式：**
   ```bash
   bash tests/run-qa.sh              # 默认有头（可见窗口）
   bash tests/run-qa.sh --headless   # 无头（CI 环境）
   bash tests/run-qa.sh --headed     # 显式有头
   ```

   新增测试用例时，所有 `playwright-cli open` 调用必须使用脚本中的 `$BROWSER_FLAGS` 变量（而非硬编码 `--headed`），以支持参数切换：
   ```bash
   playwright-cli open $BROWSER_FLAGS "$BASE_URL/some-route"
   ```

**AI启动测试脚本使用无头浏览器**：AI 在完成功能后运行测试时，应使用 `--headless` 模式（不打开可见窗口）。用户手动测试时使用默认有头模式。

```bash
# AI 完成功能后验证（无头）
bash tests/run-qa.sh --headless --section=19  # 只运行相关 section

# 用户手动验证（有头，可见窗口）
bash tests/run-qa.sh --section=19
```

**指定 Section 运行**：每次完成功能更新后，只运行受影响的 section，不需要跑全套测试：
- 修改搜索功能 → `--section=19`
- 修改 xref 面板 → `--section=20`
- 修改首页 → `--section=17`
- 修改帮助 modal → `--section=22`
- 修改版本徽章/更新日志 → `--section=23`
- 修改侧边栏折叠 → `--section=25`

**传入 AI API Key**：通过 CLI 参数传入，无需修改脚本：
```bash
bash tests/run-qa.sh --openai-key=sk-xxx
bash tests/run-qa.sh --claude-key=sk-ant-xxx
```

### AI 对话测试

`tests/run-qa.sh` 支持通过 CLI 参数传入 API Key（优先），也可在脚本顶部配置区填写：

```bash
# CLI 参数方式（推荐，无需修改脚本）
bash tests/run-qa.sh --openai-key=sk-xxx    # 测试 OpenAI 格式
bash tests/run-qa.sh --claude-key=sk-ant-xxx  # 测试 Claude 格式

# 脚本顶部配置区（备用）
OPENAI_API_KEY=""   # 填入后测试 OpenAI 格式
CLAUDE_API_KEY=""   # 填入后测试 Claude 格式
```

---

## 部署

### Cloudflare Pages

```bash
npx wrangler pages deploy site/ --project-name=value-investment
```

需要在 Cloudflare Dashboard 配置：`compatibility_flags = ["nodejs_compat"]`

### 重要文件

- `site/_redirects`：`/* /index.html 200`（SPA 路由必须）
- `wrangler.toml`：Pages 配置

---

## 代码规范

- **JS**：vanilla ES5/ES6，不引入框架，保持轻量
- **CSS**：所有颜色通过 CSS 变量；移动端断点 `≤1100px` 隐藏 right-panel
- **MD**：YAML front matter 必须完整；金句放 `{slug}-quotes.md`
- **注释**：只对需要解释的复杂逻辑写注释，不写废话注释
- **Agent 工作**：前台（主对话）不做实际代码修改，派 agent 处理；简单 bash/备份操作除外

---

## 已知外部依赖

| 库          | 版本 | 用途                      | 加载方式       |
| ----------- | ---- | ------------------------- | -------------- |
| marked.js   | CDN  | MD → HTML 渲染            | `<script>` CDN |
| Fuse.js     | CDN  | 客户端全文搜索            | `<script>` CDN |
| D3.js       | CDN  | 知识图谱可视化            | `<script>` CDN |
| gray-matter | npm  | build 时解析 front matter | `node_modules` |

---

## GitHub

开源地址：`https://github.com/mycloudai/value-investment`
