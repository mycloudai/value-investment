# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范：

- **MAJOR**（主版本）：内容结构、路由或架构发生破坏性变更
- **MINOR**（次版本）：新增功能、新页面、重大 UI 变更
- **PATCH**（修订版）：Bug 修复、内容补充、样式微调

> **规范要求**：每次提交前必须更新此文件并同步更新 `package.json` 中的 `version` 字段。

---

## [1.14.0] - 2026-04-14

### 移除
- **语言选择功能彻底移除**：信件页（股东信/合伙人信/特别信件）不再显示中文/English/对照切换栏及英文单词气泡翻译。项目目前不支持多语言，相关 UI、客户端逻辑（`initBilingualToggle`、`injectBilingualToggle`、`processEnglishWords`、`showWordTooltip` 等函数）及对应 CSS 一并删除，核心信件渲染保持不变。(`site/assets/js/app.js`、`site/assets/css/style.css`)
- **HELP.md 双语阅读章节移除**：与移除功能一致，删除「🌐 双语阅读」及「英文单词翻译」说明小节。

### 修复
- **AI 设置首次获取模型报未填写**：`fetchModels()` 不再只读 `localStorage`，首次打开设置时直接读取当前表单中的 API Key、Base URL、Provider 和 Model，保存前也能立即拉取模型列表。(`site/assets/js/talk.js`)
- **兼容接口模型列表改走站内代理**：OpenAI 兼容提供商的模型列表不再从浏览器直接请求第三方 `/models`，而是通过 `/api/chat` 代理，并在后端按通用规则尝试 `.../models` 与 `.../v1/models`，减少 CORS、网关和版本路径差异导致的失败。(`site/assets/js/talk.js`、`functions/api/chat.js`)
- **AI 对话“没有反应”问题**：当前端拿到的 `/api/chat` 响应其实是 HTML 页面或其他非 SSE 内容时，会明确提示本地站点未以 Pages Functions 模式启动，而不再悄悄显示空白回复。(`site/assets/js/talk.js`)
- **AI 聊天输入框初始不在底部**：将对话页主区域高度约束到剩余视口，并让 `#app-content` / `.talk-container` / `.talk-body` 正确传递 `flex` 高度，避免页面额外滚动导致输入框首屏不可见；移动端同步保留满屏高度。(`site/assets/css/style.css`)
- **Spotlight 搜索跳转段落不准**：顶部搜索结果不再拼接错误的 `#chunk-N` 锚点，统一改为 `?highlight=` 高亮跳转，避免服务端字符分块编号与客户端 DOM 段落编号不一致时滚到错误位置。(`site/assets/js/search.js`)
- **概念页「致股东信」链接跳转位置不准**：右侧面板点击关联信件链接后，URL 中曾携带 `#chunk-N` 锚点，该编号取自服务端搜索索引的按字符分块序号（400 字/块），与客户端渲染时按块级元素（`p`/`blockquote`/`ul`/`ol`/`table`/`pre`）递增的 `id="chunk-N"` 编号完全不对应，导致页面滚动到与关键词无关的段落。**根本原因**：`buildServerSearchIndex`（`build.mjs`）使用字符偏移分块，`renderContent`（`app.js`）使用 DOM 元素编号，两套计数系统互不兼容。**修复方案**：`showScopedSearchModal` 构造 URL 时移除 `#chunk-N` 锚点，仅保留 `?highlight=keyword` 参数；`applyHighlightFromURL` 在无锚点时自动高亮所有匹配词并滚动到第一个 `<mark>` 元素，始终精准定位。(`site/assets/js/app.js`)
- **同年份信件路由解析修复**：概念/公司/人物页在渲染「致股东信」关联列表时，`buildCrossRefPanel` 先将 `"shareholder-letters/1966"` 拆分为裸 slug `"1966"`，再调用 `resolveSlugs(["1966"])`，导致 manifest 中先出现的同年份信件（如 `partnership-letters/1966`）被错误匹配。修复：改为传入完整路径 `"shareholder-letters/1966"`，`resolveSlugs` 通过 `targetRoute` 精确匹配，彻底消除年份重名冲突。(`site/assets/js/app.js`)

---

## [1.13.0] - 2026-04-13

### 新增
- 信件页双语切换：中文 / English / 对照（左右并排）三种模式
- 英文单词点击翻译：单击弹出中文释义，🔊 按钮朗读发音（MyMemory + Web Speech API）
- 语言偏好按文章保存（sessionStorage）

### 变更
- build.mjs 过滤 `-en.md` 和 `-quotes-en.md` 文件，不纳入导航和金句展示

---

## [1.12.0] - 2026-04-13

### 新增
- README 开源项目介绍（截图预览、功能列表、部署指南）
- `CONTENT_GUIDE.md` 内容贡献指南
- `docs/screenshots/` 5 张功能截图

### 修复
- Help 弹窗点击内部内容意外关闭（`.help-modal-content` → `.help-modal`）
- `/changelog` 页面 fetch 缺失 `r.ok` 检查，404 时渲染乱码
- Help 弹窗 fetch 缺失 `r.ok` 检查
- 搜索结果标题双重 `escapeHtml` 导致特殊字符显示乱码
- 搜索索引加载失败时回调函数未调用，导致搜索无响应
- 图谱页多次导航时 `resize` 事件监听器重复绑定（内存泄漏）
- CSS `--accent` 变量未定义，侧边栏展开按钮背景透明

---

## [1.11.0] - 2025-07-19

### 新增

- **全站 `summary` 字段**：为 `content/` 下全部 215 篇 MD 文件的 YAML front matter 新增 `summary` 字段
  - 覆盖分类：股东信（60篇）、合伙人信（35篇）、特别信件（3篇）、概念（49篇）、公司（61篇）、人物（7篇）
  - 不影响 `-quotes.md` 文件
  - 中文摘要，100-250字，概述文章核心内容
- **导读页 `/guide/:category`**：新增各分类文章导读列表页面
  - 支持路由：`/guide/shareholder-letters`、`/guide/partnership-letters`、`/guide/concepts`、`/guide/companies`、`/guide/people`
  - 每篇文章以「年份 · 标题 — 概要」形式展示，点击标题跳转至文章
  - CSS 类：`.guide-layout`、`.guide-title`、`.guide-item`、`.guide-item-summary` 等
- **侧边栏「导读」区域**：在 `nav.js` 中新增导读导航链接分组（含 `.sidebar-section-title` 样式标题）
- **manifest 包含 `summary`**：`build.mjs` 的 `generateManifest()` 现将 `summary` 字段写入 `manifest.items` 和 `manifest.nav` 条目
- **搜索索引包含 `summary`**：`buildServerSearchIndex()` 将 title + summary + body 联合建索引，提升搜索质量
- **帮助文档更新**：`HELP.md` 新增「导读功能」章节说明

### 变更

- `build.mjs` `readAllDocs()`：新增 `summary: frontmatter.summary || ''` 字段读取
- `tests/run-qa.sh`：新增 Section 24 导读页测试（4项断言）

---

## [1.10.0] - 2025-07-16

### 新增

- **侧边栏版本徽章**：在侧边栏底部 theme-toggle 按钮上方新增版本徽章
  - 显示当前版本号（从 `manifest.json` 动态加载，由 `build.mjs` 注入）
  - 点击徽章导航至 `/changelog` 更新日志页
  - CSS 类 `.sidebar-version` + `.version-label`（monospace 字体）
- **`/changelog` 路由**：新增更新日志页面
  - 获取并渲染 `/content/changelog.md`（即项目根目录 `CHANGELOG.md`）
  - 使用 marked.js 渲染 Markdown，含返回首页链接
- **`manifest.version` 字段**：`build.mjs` 在生成 `manifest.json` 时注入 `package.json` 版本号
- **GitHub Actions CI**（`.github/workflows/qa.yml`）：
  - 在 `push`/`PR` 到 `main` 分支时自动运行无头 QA 测试
  - 支持通过 GitHub Secrets 传入 AI API Key
  - 上传测试报告和截图为 Artifact（保留 7 天）
- **测试脚本 CLI 参数增强**（`tests/run-qa.sh`）：
  - `--openai-key=VALUE`：设置 OpenAI API Key
  - `--claude-key=VALUE`：设置 Claude API Key
  - `--section=N` / `--section=17,19,20`：只运行指定 section，加速单功能验证
- **Section 过滤机制**：`section()` 函数自动提取编号并设置 `SECTION_SKIP`；`pass()`/`fail()`/`skip()`/`safe_goto()` 均尊重 `SECTION_SKIP` 状态
- **Section 23 测试**：版本徽章 & 更新日志页面的 4 项 QA 用例

### 修复

- **测试 20.4**：更新 xref scoped 搜索结果 URL 判断逻辑——从检查 `highlight=` 参数改为检查路径以 `/` 开头（因现版本搜索直接开启文章，无需 highlight 参数）

---

## [1.9.0] - 2025-07-15

### 新增

- **Homepage 居中布局**：新增 `homepage-layout` CSS 类，首页内容（hero、快速入口、金句、近期更新、时间轴、概念、人物）在宽屏下居中显示，解决之前左对齐的问题
  - `#app-content` 添加 `width: 100%; box-sizing: border-box` 基础样式
  - `.home-container` 的 `max-width` + `margin: 0 auto` 现在正确生效
- **平板断点（960px）**：新增 `@media (max-width: 960px)` 响应式断点
  - hero 标题缩小至 2.2rem，入口卡片保持 2 列
  - 公司/人物/概念网格自适应列宽
  - 分类索引和引言页面收窄内边距
- **小屏手机断点（480px）**：新增 `@media (max-width: 480px)` 响应式断点
  - hero 标题 1.7rem、统计数字 1.3rem，CTA 按钮缩小
  - 信件卡片、人物卡片、公司卡片切换为单列
  - 文章页、索引页、引言页内边距进一步收窄至 16px
  - 时间轴标签和项目缩小

### 变更

- **移动端断点（768px）大幅增强**：原有 768px 断点新增 30+ 条规则
  - 首页：section 内边距 20px、入口卡片单列、金句网格单列、概念标签缩小
  - 索引页：信件卡片 2 列、公司卡片 2 列、人物卡片单列
  - 引言页：filter 按钮自动换行、引用块内边距缩小
  - 图谱/对话页：header 左移为汉堡按钮留空、图例自动换行
  - 文章页：`content-layout` 内边距调整为 60px 20px 40px
- `app.js` 中 `renderHomepage()` 的 `content.className` 从 `''` 改为 `'homepage-layout'`

### 修复

- 首页在大屏幕上不再左对齐，`#app-content` 添加 `width: 100%` 使子元素的 `margin: 0 auto` 生效
- 公司卡片在平板宽度（768px）从单列调整为双列，避免浪费空间

---

## [1.8.1] - 2025-07-15

### 修复

- **QA 测试 1.6**：快速入口卡片检查文本从已过期的「股东信总览」更正为「伯克希尔股东信」
- **QA 测试 19.6**：搜索结果点击使用 `.first()` 定位器，避免多元素 strict mode 错误导致点击失败、模态框未关闭
- **QA 测试 20.4**：`raw_eval` 表达式移除 `var` 声明，改用可选链单表达式，修复 `SyntaxError: Unexpected token 'var'`
- **scoped 搜索结果 URL 缺少 highlight 参数**：`.xref-scoped-result` 链接增加 `?highlight=关键词#chunk-N` 参数，与 `.xref-modal-viewpage` 保持一致
- **帮助 Modal 遮罩关闭（QA 22.6）**：overlay 点击判断从 `e.target === overlay` 改为 `!e.target.closest('.help-modal-content')`，修复 playwright click 命中内层元素时遮罩无法关闭的问题

## [1.8.0] - 2025-07-15

### 新增

- **Spotlight 搜索模态框**：搜索 UI 从 header 下拉框重构为全屏 Spotlight/Modal 样式
  - 点击 header 搜索按钮或按 `⌘K` / `Ctrl+K` 打开搜索模态框
  - 半透明遮罩 + 居中弹窗，自动聚焦输入框
  - 实时搜索、结果高亮、键盘导航（↑↓ 选择、Enter 跳转、ESC 关闭）
  - 搜索结果含标题、摘要片段、分类标签和年份
- **SPA 内导航**：搜索结果点击后通过 `Router.navigate()` 在应用内跳转，不再打开新标签页
  - 自动关闭模态框 → SPA 导航 → `applyHighlightFromURL()` 高亮关键词
  - 解决了之前 `target="_blank"` 导致的 404 问题

### 变更

- 移除旧版 header 搜索栏 (`#header-search-input`, `#header-search-dropdown`) 及相关 CSS
- `Router.navigate()` 支持携带 `?query=…&hash=#…` 参数，正确传递 highlight 上下文
- 移动端搜索按钮直接打开 Spotlight 模态框（取代之前展开 header 的方式）
- 更新 QA 测试 Section 19 以匹配新搜索模态框 DOM 结构

---

## [1.7.1] - 2025-07-15

### 修复

- **xref 面板交互行为分离**：信件页 xref chip 点击行为改为直接在新 tab 打开对应概念/公司/人物页面（不再弹窗）
- **概念/公司/人物页 xref 行为**：关联信件改为列表形式，点击信件触发 scoped 搜索弹窗，显示该信件中包含关键词的段落预览
- **scoped 搜索结果跳转**：点击段落结果新 tab 打开信件，URL 携带 `?highlight=关键词#chunk-N`，自动高亮并定位

### 变更

- `search.js` 暴露 `window._serverSearchIndex` 供 xref scoped 搜索复用
- 实体页 xref 面板由 chip 样式改为列表样式，悬停显示搜索图标提示

---

## [1.7.0] - 2026-04-13

### 新增

- **内嵌帮助系统**：侧边栏底部新增「?」帮助按钮，点击弹出帮助 modal
- **`HELP.md`**：项目根目录，与 `CHANGELOG.md` 同级，维护完整使用帮助文档
- **帮助 modal**：支持 ESC 键关闭、点击遮罩关闭、关闭按钮，使用 `marked.js` 渲染 MD
- **`build.mjs` 文档同步**：每次构建自动将 `HELP.md` / `CHANGELOG.md` 复制到 `site/content/`，可通过路由访问
- **Section 22 测试**：7 项帮助 modal 测试用例（按钮存在、弹出、内容加载、三种关闭方式、文件可访问）
- **AI instruction 更新**：新增帮助文档更新规则，每次功能变更必须检查并按需更新 `HELP.md`

---

## [1.6.0] - 2026-04-14

### 新增

- **全局搜索框**：搜索框移至顶部 header，居中显示，支持段落级全文搜索
- **段落级搜索结果**：基于 `server-search-index.json`（644 个分块）进行搜索，显示文章标题 + 命中段落预览（高亮关键词），去重后最多显示 10 条
- **搜索结果新 Tab 打开**：点击搜索结果在新标签页打开，URL 携带 `?highlight=关键词#chunk-N`
- **文章内关键词高亮**：渲染文章时检查 URL 的 `highlight` 参数，用 `<mark>` 标签高亮匹配文字并自动滚动到首个高亮位置
- **移动端搜索图标**：≤768px 时搜索框收缩为右上角搜索图标按钮，点击展开 header 搜索
- **xref chip 搜索弹窗**：右侧面板的概念/公司/人物 chip 点击后弹出模态窗口，显示「{关键词}」出现在哪些文章中，每条结果显示文章标题 + 类别 badge，点击在新 Tab 打开
- **xref 弹窗完整页面链接**：弹窗底部提供"查看完整页面 →"链接，直接跳转到 chip 对应的详情页
- **构建增强**：`build.mjs` manifest.json 新增 `concepts_discussed`、`companies_mentioned`、`people_mentioned`、`mentioned_in_letters` 交叉引用字段；服务端搜索索引新增 `chunkIndex` 和 `slug` 字段
- **文章段落锚点**：渲染文章时自动为段落级元素注入 `id="chunk-N"` 锚点，支持从搜索结果精确跳转
- **QA 测试**：新增 Section 19（搜索框功能验证）和 Section 20（xref chip 弹窗验证）

### 变更

- 搜索索引加载使用 `cache: 'no-store'`，不缓存搜索数据
- xref chip 点击行为从直接导航改为弹出搜索弹窗

## [1.5.0] - 2026-04-14

### 新增

- **分类索引页增强**：六大分类（股东信、合伙人信、特别信件、投资理念、公司解析、关键人物）均升级为富信息索引页
- **股东信/合伙人信**：顶部统计卡片（总数、年份跨度、范围）+ 按年代分组的卡片网格，每张卡片显示年份和标题
- **特别信件**：大卡片布局，显示标题 + front matter 中的 description 简介
- **投资理念**：标签云（按频率加权）+ 核心/非核心概念卡片网格，显示简介和出现信件数
- **公司解析**：卡片网格，显示公司名、关系标签、行业标签、Wikipedia 外链
- **关键人物**：大型人物卡片，含首字母头像、职位、简介、标签
- **构建增强**：`build.mjs` 中 manifest 条目新增 `description`、`tags`、`wikipedia`、`letter_count`、`role`、`relationship`、`importance` 等字段
- **新增 CSS**：索引页专用样式全部使用 CSS 变量，支持明暗主题切换，含移动端响应式布局
- **QA 测试 Section 21**：新增分类索引页自动化测试（21.1–21.5）

---

## [1.3.0] - 2026-04-14

### 新增

- **首页美化**：全新 Hero 区域设计（大标题 + 副标题 + 统计数字 + CTA 按钮）
- **快速入口卡片**：4 张分类卡片（股东信、合伙人信、理念、知识图谱），含 emoji、简介和数量 badge
- **首页精选金句**：从 153 个金句文件中随机精选 5 条展示，异步加载
- **首页近期更新**：按年份倒序显示最新 5 封信件
- **金句展示页**（`/quotes` 路由）：汇总展示巴菲特金句，支持按分类筛选（股东信/合伙人信/概念/公司/人物）
- **文章金句区块**：文章底部自动加载对应 `{slug}-quotes.md`，以特殊样式展示"📝 相关金句"
- **侧边栏金句入口**：在 AI 问答旁新增"📝 金句"导航链接
- **构建增强**：`build.mjs` 在 manifest.json 中新增 `quotesFiles` 字段，收录 153 个金句文件元数据
- **QA 测试**：新增 Section 17（首页美化验证）和 Section 18（金句页验证）

---

## [1.1.0] - 2026-04-13


### 新增

- **Changelog 页面**：网站内可查看版本历史，版本号显示在侧边栏底部
- **版本号规范**：建立语义化版本机制，版本号贯穿所有页面底部
- **无缓存策略**：`_headers` 全站 `Cache-Control: no-store`，数据文件和内容文件单独配置，确保每次访问获取最新内容
- **TOC 点击跳转修复**：修复全局路由拦截导致 TOC 锚点无法滚动的 bug，改为容器内平滑滚动
- **TOC 覆盖率**：标题少于 2 个的文章正确不显示目录（合理行为）
- **`.playwright-cli/` gitignore**：playwright-cli 快照等临时产物不再进入版本控制
- **`__pycache__/` gitignore**：Python 编译缓存加入忽略列表
- **暂存区清理**：移除所有误入暂存区的 build 产物（`.wrangler/`、`site/content/`、`tests/screenshots/` 等）

### 修复

- TOC 锚点点击被全局路由器拦截，导致重新渲染页面而非滚动到对应段落
- `.wrangler/` 临时文件被重复写入 `.gitignore`（清理重复项）

---

## [1.0.0] - 2026-04-12

### 初始发布

- **内容库**：215 篇 MD 文件（巴菲特股东信、合伙人信、特别信件、理念、公司、人物）
- **蓝色主题 SPA**：Cloudflare Pages 部署，单页应用路由
- **AI 问答**：基于 Buffett Skill（nuwa-skill 格式），支持 OpenAI / Claude API，SSE 流式输出
- **知识图谱**：D3.js 力导向图，展示内容间关联关系
- **右侧交叉引用面板**：文章页展示相关概念、公司、人物；概念/公司/人物页展示出现的信件
- **搜索功能**：BM25 全文搜索，215 篇文章 644 个分块
- **明暗主题切换**：侧边栏底部一键切换，持久化到 localStorage
- **获取模型列表**：AI 设置弹窗支持从 API 动态拉取模型列表
- **153 个金句文件**：`{slug}-quotes.md` 与原文件同目录，483 条巴菲特金句
- **139 篇文章元数据增强**：前置元数据含 tags、交叉引用、Wikipedia/百度百科链接
- **mycloudai 品牌图标**：favicon、apple-touch-icon、侧边栏 logo 统一使用 mycloudai-small.png
- **GitHub 链接**：侧边栏底部链接到 https://github.com/mycloudai/value-investment
- **项目自定义指令**：`.github/copilot-instructions.md` 262 行，覆盖架构规范、测试规范、内容规范
- **QA 测试套件**：`tests/run-qa.sh` playwright-cli 有头浏览器，56 个测试用例

---

## 版本更新指南

### 何时更新

| 变更类型 | 版本提升 | 示例 |
|---------|---------|------|
| 新增页面、路由、功能模块 | MINOR | 新增索引页、搜索重构 |
| Bug 修复、样式微调、内容补充 | PATCH | 修复 TOC 滚动、新增金句 |
| 架构重构、破坏性路由变更 | MAJOR | 重写路由系统、更换构建工具 |

### 更新步骤

1. 修改 `package.json` 中的 `version` 字段
2. 在 `CHANGELOG.md` 顶部插入新版本条目（格式：`## [x.y.z] - YYYY-MM-DD`）
3. 分类填写 `### 新增` / `### 修复` / `### 变更` / `### 移除`
4. 运行构建确认版本号在侧边栏正确显示
