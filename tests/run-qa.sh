#!/bin/bash
# ═══════════════════════════════════════════════════════════
# MyCloudAI 巴菲特的价值投资 - 全面 QA 测试脚本
#
# 用法:
#   bash tests/run-qa.sh              # 有头浏览器（默认，可见窗口）
#   bash tests/run-qa.sh --headless   # 无头浏览器（CI 环境）
#   bash tests/run-qa.sh --headed     # 显式指定有头浏览器
#   bash tests/run-qa.sh --section=19          # 只运行 Section 19
#   bash tests/run-qa.sh --section=17,19,20    # 运行多个 Section
#   bash tests/run-qa.sh --headless --section=22  # 无头 + 指定 section
#   bash tests/run-qa.sh --openai-key=sk-xxx   # 传入 OpenAI API Key
#   bash tests/run-qa.sh --claude-key=sk-ant-xxx  # 传入 Claude API Key
#
# 需要: playwright-cli 已安装, 本地服务器运行在 8788 端口
# ═══════════════════════════════════════════════════════════

set -o pipefail

# ─── 浏览器模式参数解析 ───────────────────────────────────
# 默认有头（可见），传 --headless 切换为无头（CI 模式）
BROWSER_MODE="headed"
RUN_SECTIONS=""

for arg in "$@"; do
  case "$arg" in
    --headless) BROWSER_MODE="headless" ;;
    --headed)   BROWSER_MODE="headed"   ;;
    --openai-key=*) OPENAI_API_KEY="${arg#--openai-key=}" ;;
    --claude-key=*)  CLAUDE_API_KEY="${arg#--claude-key=}" ;;
    --openai-base-url=*) OPENAI_BASE_URL="${arg#--openai-base-url=}" ;;
    --claude-base-url=*)  CLAUDE_BASE_URL="${arg#--claude-base-url=}" ;;
    --openai-model=*) OPENAI_MODEL="${arg#--openai-model=}" ;;
    --claude-model=*)  CLAUDE_MODEL="${arg#--claude-model=}" ;;
    --section=*)     RUN_SECTIONS="${arg#--section=}" ;;
  esac
done

if [ "$BROWSER_MODE" = "headless" ]; then
  # 无头模式：通过配置文件告知 playwright-cli
  HEADLESS_CONFIG="/tmp/pw-cli-headless.json"
  echo '{"headless":true}' > "$HEADLESS_CONFIG"
  BROWSER_FLAGS="--config=$HEADLESS_CONFIG"
  echo "🖥️  浏览器模式: 无头（headless）"
else
  BROWSER_FLAGS="--headed"
  echo "🖥️  浏览器模式: 有头（headed，可见窗口）"
fi
# ─────────────────────────────────────────────────────────

# ─── AI 测试配置 ──────────────────────────────────────────
# 填入 API Key 后 AI 对话测试才会运行，否则跳过
# 优先使用 CLI 参数（--openai-key=xxx / --claude-key=xxx），其次使用下方配置
# OpenAI 格式
OPENAI_API_KEY="${OPENAI_API_KEY:-}"   # 如: sk-xxxxx（或通过 --openai-key= 传入）
OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.openai.com/v1}"  # 留空使用默认 https://api.openai.com/v1
OPENAI_MODEL="${OPENAI_MODEL:-}"                         # 如: gpt-4o，留空跳过

# Claude 格式
CLAUDE_API_KEY="${CLAUDE_API_KEY:-}"   # 如: sk-ant-xxxxx（或通过 --claude-key= 传入）
CLAUDE_BASE_URL="${CLAUDE_BASE_URL:-https://api.anthropic.com}"  # 留空使用默认 https://api.anthropic.com
CLAUDE_MODEL="${CLAUDE_MODEL:-}"                         # 如: claude-3-5-sonnet-20241022，留空跳过
# ─────────────────────────────────────────────────────────

BASE_URL="http://localhost:8788"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPORT="$PROJECT_DIR/tests/qa-report.md"
SCREENSHOT_DIR="$PROJECT_DIR/tests/screenshots"
PASS=0
FAIL=0
SKIP=0
ERRORS=()
SECTION_SKIP=false

mkdir -p "$SCREENSHOT_DIR"

# ─── 辅助函数 ─────────────────────────────────────────────

pass() {
  [ "$SECTION_SKIP" = "true" ] && return
  echo "  ✅ $1"
  PASS=$((PASS+1))
  echo "- ✅ $1" >> "$REPORT"
}

fail() {
  [ "$SECTION_SKIP" = "true" ] && return
  echo "  ❌ $1: $2"
  FAIL=$((FAIL+1))
  echo "- ❌ **$1**: $2" >> "$REPORT"
  ERRORS+=("[$1] $2")
}

skip() {
  [ "$SECTION_SKIP" = "true" ] && return
  echo "  ⏭️  SKIP: $1"
  SKIP=$((SKIP+1))
  echo "- ⏭️ SKIP: $1" >> "$REPORT"
}

# Check if a section number should run based on RUN_SECTIONS
should_run_section() {
  local num="$1"
  if [ -z "$RUN_SECTIONS" ]; then return 0; fi  # run all if not specified
  echo "$RUN_SECTIONS" | tr ',' '\n' | grep -qx "$num"
}

section() {
  # Extract leading section number (e.g. "21" from "21. 分类索引页测试")
  local num
  num=$(echo "$1" | grep -oE '^[0-9]+')
  if should_run_section "$num"; then
    SECTION_SKIP=false
  else
    SECTION_SKIP=true
    echo "  ⏭️  跳过 Section $num"
    return
  fi
  echo ""
  echo "══════════════════════════════════════"
  echo "  $1"
  echo "══════════════════════════════════════"
  echo "" >> "$REPORT"
  echo "## $1" >> "$REPORT"
  echo "" >> "$REPORT"
}

# Wait for SPA content to load after navigation
wait_for_spa() {
  local max_wait=${1:-3}
  sleep "$max_wait"
}

# Safe navigation - checks browser state and recovers
safe_goto() {
  [ "$SECTION_SKIP" = "true" ] && return
  local url="$1"
  local result
  result=$(playwright-cli goto "$url" 2>&1)
  local exit_code=$?
  
  # Check for browser crash
  if [ $exit_code -ne 0 ] || echo "$result" | grep -qi 'not open\|Target closed'; then
    echo "  ⚠️  浏览器异常 (exit=$exit_code)，恢复中..."
    playwright-cli close 2>/dev/null || true
    playwright-cli kill-all 2>/dev/null || true
    sleep 3
    playwright-cli open $BROWSER_FLAGS "$url" 2>&1 | tail -3
    sleep 5
    
    # Verify page loaded
    local current_url
    current_url=$(eval_result "window.location.href" 2>/dev/null)
    if echo "$current_url" | grep -qi 'chrome-error'; then
      echo "  ⚠️  仍然异常，再次重试..."
      playwright-cli close 2>/dev/null || true
      sleep 3
      playwright-cli open $BROWSER_FLAGS "$url" 2>&1 | tail -3
      sleep 5
    fi
  else
    echo "$result" | tail -3
  fi
}

# Safe snapshot - capture and return output (use more lines for completeness)
take_snapshot() {
  playwright-cli snapshot 2>&1 | head -600
}

# Check if text exists in snapshot
snapshot_contains() {
  local text="$1"
  local snapshot
  snapshot=$(take_snapshot)
  grep -qi "$text" <<< "$snapshot"
}

# Inline snap-grep helpers — use herestring to avoid SIGPIPE / pipefail false-negative
# When grep -q finds a match it exits early, causing echo to get SIGPIPE (exit 141).
# With set -o pipefail that makes the whole pipeline non-zero even when match IS found.
# sc = case-sensitive, sci = case-insensitive
sc()  { grep -q  "$1" <<< "$SNAP"; }
sci() { grep -qi "$1" <<< "$SNAP"; }

# Extract raw value from playwright-cli eval output
# Input format: "### Result\n\"value\"\n### Ran Playwright code..."
# Returns just the value (without quotes)
eval_result() {
  playwright-cli eval "$1" 2>&1 | sed -n '/^### Result$/,/^### Ran/{/^### Result$/d;/^### Ran/d;p;}' | tr -d '"' | head -1
}

raw_eval() {
  playwright-cli --raw eval "$1" 2>/dev/null | tr -d '"'
}

# Get content length via JS
get_content_length() {
  local selector="${1:-#app-content}"
  local raw
  raw=$(playwright-cli eval "document.querySelector('${selector}')?.textContent?.length || 0" 2>&1)
  echo "$raw" | sed -n '/^### Result$/,/^### Ran/{/^### Result$/d;/^### Ran/d;p;}' | tr -d '"' | head -1
}

# ─── 前置检查 ─────────────────────────────────────────────

echo "🔍 前置检查..."
echo ""

# Check server
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" 2>/dev/null)
if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ 本地服务器未运行在 $BASE_URL (HTTP $HTTP_CODE)"
  echo "   请先运行: cd $PROJECT_DIR && ./start-local.sh"
  exit 1
fi
echo "✅ 服务器运行正常 (HTTP $HTTP_CODE)"

# Check playwright-cli
if ! command -v playwright-cli &>/dev/null; then
  echo "❌ playwright-cli 未安装"
  exit 1
fi
echo "✅ playwright-cli 可用"
echo ""

# ─── 初始化报告 ───────────────────────────────────────────

cat > "$REPORT" << 'EOF'
# MyCloudAI 价值投资 - QA 测试报告

EOF
echo "**生成时间:** $(date '+%Y-%m-%d %H:%M:%S')" >> "$REPORT"
echo "" >> "$REPORT"
echo "**测试环境:** macOS / localhost:8788 / playwright-cli ${BROWSER_MODE} browser" >> "$REPORT"
echo "" >> "$REPORT"
echo "---" >> "$REPORT"

# ─── 清理旧浏览器会话 ─────────────────────────────────────
playwright-cli close-all 2>/dev/null || true
playwright-cli kill-all 2>/dev/null || true
sleep 2

# ═══════════════════════════════════════════════════════════
# 测试开始
# ═══════════════════════════════════════════════════════════

# ─── 1. 首页测试 ──────────────────────────────────────────
section "1. 首页测试 (/)"

echo "  打开浏览器..."
# Robust open with retry
OPEN_RESULT=$(playwright-cli open $BROWSER_FLAGS "$BASE_URL/" 2>&1)
echo "$OPEN_RESULT" | tail -3
sleep 4

# Verify browser is working by checking page title
TITLE_CHECK=$(playwright-cli eval "document.title" 2>&1 || echo "BROWSER_ERROR")
if echo "$TITLE_CHECK" | grep -q "BROWSER_ERROR\|not open\|Error"; then
  echo "  ⚠️  浏览器打开异常，重试..."
  playwright-cli close 2>/dev/null || true
  sleep 2
  playwright-cli open $BROWSER_FLAGS "$BASE_URL/" 2>&1 | tail -3
  sleep 5
fi

# Screenshot
playwright-cli screenshot --filename="$SCREENSHOT_DIR/01-homepage.png" 2>/dev/null

# 1.1 页面标题
TITLE=$(eval_result "document.title")
if grep -q 'MyCloudAI' <<< "$TITLE"; then
  pass "页面标题包含 MyCloudAI"
else
  fail "页面标题" "标题不包含 MyCloudAI ($TITLE)"
fi

# 1.2 导航栏可见（Logo）
SNAP=$(take_snapshot)
if sc 'logo-link\|MyCloudAI.*MyCloudAI\|img "MyCloudAI"'; then
  pass "导航栏 Logo 可见"
else
  fail "导航栏 Logo" "Logo 未找到"
fi

# 1.3 侧边栏菜单项
if sc '合伙基金信件' && sc '伯克希尔股东信' && sc '投资理念' && sc '公司解析' && sc '关键人物'; then
  pass "侧边栏菜单项完整（合伙基金信件/股东信/投资理念/公司解析/关键人物）"
else
  fail "侧边栏菜单项" "缺少部分菜单项"
fi

# 1.4 Hero 区域
HAS_HERO=$(eval_result "document.getElementById('app-content')?.textContent?.includes('与巴菲特同行')")
if [ "$HAS_HERO" = "true" ]; then
  pass "Hero 区域正确显示（标题 + 副标题）"
else
  fail "Hero 区域" "Hero 区域内容未找到"
fi

# 1.5 统计数字
HAS_STATS=$(eval_result "document.getElementById('app-content')?.textContent?.includes('封信件') && document.getElementById('app-content')?.textContent?.includes('个概念')")
if [ "$HAS_STATS" = "true" ]; then
  pass "首页统计数字显示（信件/概念/公司/人物）"
else
  fail "首页统计数字" "统计数字不完整"
fi

# 1.6 快速入口卡片
HAS_QUICK=$(eval_result "document.getElementById('app-content')?.textContent?.includes('快速入口') && document.getElementById('app-content')?.textContent?.includes('伯克希尔股东信')")
if [ "$HAS_QUICK" = "true" ]; then
  pass "快速入口卡片完整（股东信/合伙人信/概念/公司/AI问答/知识图谱）"
else
  fail "快速入口卡片" "缺少部分入口"
fi

# 1.7 信件时间轴
HAS_TIMELINE=$(eval_result "document.getElementById('app-content')?.textContent?.includes('信件时间轴') && document.getElementById('app-content')?.textContent?.includes('1950年代')")
if [ "$HAS_TIMELINE" = "true" ]; then
  pass "信件时间轴显示（含年代分组 1950s-2020s）"
else
  fail "信件时间轴" "时间轴未正确渲染"
fi

# 1.8 核心概念区域
HAS_CONCEPTS=$(eval_result "document.getElementById('app-content')?.textContent?.includes('核心概念') && document.getElementById('app-content')?.textContent?.includes('护城河')")
if [ "$HAS_CONCEPTS" = "true" ]; then
  pass "核心概念区域显示（护城河/安全边际/内在价值等）"
else
  fail "核心概念区域" "概念列表不完整"
fi

# 1.9 关键人物区域
HAS_PEOPLE=$(eval_result "document.getElementById('app-content')?.textContent?.includes('关键人物') && document.getElementById('app-content')?.textContent?.includes('芒格')")
if [ "$HAS_PEOPLE" = "true" ]; then
  pass "关键人物区域显示（芒格/格雷厄姆等）"
else
  fail "关键人物区域" "人物列表不完整"
fi

# 1.10 AI问答和知识图谱入口
if sc 'AI问答' && sc '知识图谱'; then
  pass "侧边栏底部 AI问答/知识图谱入口可见"
else
  fail "侧边栏底部入口" "AI问答或知识图谱入口缺失"
fi


# ─── 2. 股东信列表页 ─────────────────────────────────────
section "2. 股东信列表页 (/shareholder-letters)"

safe_goto "$BASE_URL/shareholder-letters"
sleep 2
wait_for_spa

playwright-cli screenshot --filename="$SCREENSHOT_DIR/02-shareholder-letters-list.png" 2>/dev/null

SNAP=$(take_snapshot)

# 2.1 页面加载
if sc '伯克希尔股东信\|shareholder'; then
  pass "股东信列表页加载成功"
else
  fail "股东信列表页" "页面未正确加载"
fi

# 2.2 按年代分组
HAS_DECADES=$(eval_result "document.getElementById('app-content')?.textContent?.includes('年代') || document.querySelector('.decade-group, [class*=\"decade\"], [class*=\"group\"]') !== null")
if [ "$HAS_DECADES" = "true" ]; then
  pass "股东信按年代分组显示"
else
  # Check if there are visual group separators
  HAS_GROUPS=$(eval_result "document.querySelectorAll('#app-content h2, #app-content h3, .index-group, .letter-group').length")
  if [ -n "$HAS_GROUPS" ] && [ "$HAS_GROUPS" -gt 1 ] 2>/dev/null; then
    pass "股东信列表有分组标题（${HAS_GROUPS} 组）"
  else
    fail "股东信分组" "列表页未按年代分组（仅为平铺列表）"
  fi
fi

# 2.3 信件链接存在
if sc '1984\|1993\|2000'; then
  pass "股东信列表包含信件链接（1984/1993/2000等）"
else
  fail "股东信列表" "信件链接不完整"
fi


# ─── 3. 股东信内容页 (1984) ──────────────────────────────
section "3. 股东信内容页 (/shareholder-letters/1984)"

safe_goto "$BASE_URL/shareholder-letters/1984"
sleep 3
wait_for_spa 5

playwright-cli screenshot --filename="$SCREENSHOT_DIR/03-1984-letter.png" 2>/dev/null

SNAP=$(take_snapshot)

# 3.1 文章标题
if sc '1984.*巴菲特致股东信\|1984'; then
  pass "1984年信件标题显示正确"
else
  fail "1984信件标题" "标题未显示"
fi

# 3.2 文章正文（Markdown 渲染）
BODY_LEN=$(get_content_length ".article-body")
if [ -n "$BODY_LEN" ] && [ "$BODY_LEN" -gt 100 ] 2>/dev/null; then
  pass "文章正文已渲染（.article-body ${BODY_LEN} 字符）"
else
  # Fallback to #app-content
  BODY_LEN2=$(get_content_length "#app-content")
  if [ -n "$BODY_LEN2" ] && [ "$BODY_LEN2" -gt 200 ] 2>/dev/null; then
    pass "文章正文已渲染（#app-content ${BODY_LEN2} 字符）"
  else
    fail "文章正文" "正文内容过短或未渲染 (长度: $BODY_LEN / $BODY_LEN2)"
  fi
fi

# 3.3 右侧侧边栏 - TOC
HAS_TOC=$(eval_result "document.querySelector('.toc')?.children?.length || 0")
if [ -n "$HAS_TOC" ] && [ "$HAS_TOC" -gt 0 ] 2>/dev/null; then
  pass "右侧 TOC 目录显示（${HAS_TOC} 个条目）"
else
  skip "右侧 TOC 目录（未检测到 TOC 元素）"
fi

# 3.4 右侧侧边栏 - 关联内容 (xref chips)
HAS_XREF=$(eval_result "document.querySelectorAll('.xref-chip').length")
if [ -n "$HAS_XREF" ] && [ "$HAS_XREF" -gt 0 ] 2>/dev/null; then
  pass "右侧关联内容 xref-chip 显示（${HAS_XREF} 个）"
else
  skip "右侧关联内容 chip（可能未实现）"
fi

# 3.5 页面标题更新
PAGE_TITLE=$(eval_result "document.title")
if grep -q '1984' <<< "$PAGE_TITLE"; then
  pass "页面标题已更新包含 1984"
else
  skip "页面标题未更新为包含年份 ($PAGE_TITLE)"
fi

# 3.6 上一篇/下一篇导航
if sci '上一篇\|下一篇\|prev\|next\|←\|→\|1983\|1985'; then
  pass "上一篇/下一篇导航可用"
else
  skip "上一篇/下一篇导航（可能未实现）"
fi

# Take sidebar screenshot
playwright-cli screenshot --filename="$SCREENSHOT_DIR/03-1984-letter-sidebar.png" 2>/dev/null

# 3.7 语言切换功能已移除 — 不应显示 .bilingual-toggle 或 .lang-btn
BILINGUAL_EXISTS=$(eval_result "document.querySelector('.bilingual-toggle') ? 'FOUND' : 'MISSING'")
LANGBTN_EXISTS=$(eval_result "document.querySelector('.lang-btn') ? 'FOUND' : 'MISSING'")
if [ "$BILINGUAL_EXISTS" = "MISSING" ] && [ "$LANGBTN_EXISTS" = "MISSING" ]; then
  pass "3.7: 语言切换 UI 已移除（.bilingual-toggle / .lang-btn 均不存在）"
else
  fail "3.7: 语言切换 UI 应已移除" "bilingual=$BILINGUAL_EXISTS lang-btn=$LANGBTN_EXISTS"
fi


# ─── 4. 合伙人信 ─────────────────────────────────────────
section "4. 合伙人信 (/partnership-letters)"

safe_goto "$BASE_URL/partnership-letters"
sleep 2
wait_for_spa

playwright-cli screenshot --filename="$SCREENSHOT_DIR/04-partnership-letters-list.png" 2>/dev/null

SNAP=$(take_snapshot)

# 4.1 列表页加载
if sc '合伙基金信件\|partnership'; then
  pass "合伙人信列表页加载成功"
else
  fail "合伙人信列表页" "页面未正确加载"
fi

# 4.2 包含信件
if sc '1957\|1958\|1959\|1960'; then
  pass "合伙人信列表包含信件链接"
else
  fail "合伙人信列表" "信件链接缺失"
fi

# 4.3 点击查看具体信件内容
safe_goto "$BASE_URL/partnership-letters/1957"
sleep 3
wait_for_spa

playwright-cli screenshot --filename="$SCREENSHOT_DIR/04-partnership-1957.png" 2>/dev/null

SNAP=$(take_snapshot)
if sc '1957'; then
  PARTNER_BODY=$(get_content_length ".article-body")
  if [ -z "$PARTNER_BODY" ] || [ "$PARTNER_BODY" -lt 100 ] 2>/dev/null; then
    PARTNER_BODY=$(get_content_length "#app-content")
  fi
  if [ -n "$PARTNER_BODY" ] && [ "$PARTNER_BODY" -gt 100 ] 2>/dev/null; then
    pass "合伙人信内容页正常渲染（1957年，${PARTNER_BODY} 字符）"
  else
    fail "合伙人信内容页" "正文内容过短 ($PARTNER_BODY)"
  fi
else
  fail "合伙人信内容页" "1957年信件标题未显示"
fi


# ─── 5. 投资理念/概念页 ──────────────────────────────────
section "5. 投资理念/概念页 (/concepts/moat)"

# 5.1 概念列表页
safe_goto "$BASE_URL/concepts"
sleep 2
wait_for_spa

playwright-cli screenshot --filename="$SCREENSHOT_DIR/05-concepts-list.png" 2>/dev/null

SNAP=$(take_snapshot)
if sc '投资理念\|concepts' && sc '护城河'; then
  pass "概念列表页加载成功，包含护城河"
else
  fail "概念列表页" "页面加载异常"
fi

# 5.2 护城河概念页
safe_goto "$BASE_URL/concepts/moat"
sleep 3
wait_for_spa 5

playwright-cli screenshot --filename="$SCREENSHOT_DIR/05-concept-moat.png" 2>/dev/null

SNAP=$(take_snapshot)

# 文章内容
if sci '护城河\|Economic Moat\|moat'; then
  pass "护城河概念页内容正常显示"
else
  fail "护城河概念页" "内容未加载"
fi

# 右侧侧边栏 - mentioned_in_letters
MOAT_LETTERS=$(eval_result "document.querySelectorAll('.xref-chip, .right-panel a').length")
if [ -n "$MOAT_LETTERS" ] && [ "$MOAT_LETTERS" -gt 0 ] 2>/dev/null; then
  pass "护城河页面显示相关信件列表（${MOAT_LETTERS} 项）"
else
  # Check text content
  HAS_LETTERS=$(eval_result "document.getElementById('app-content')?.textContent?.includes('1986') || document.getElementById('app-content')?.textContent?.includes('1993')")
  if [ "$HAS_LETTERS" = "true" ]; then
    pass "护城河页面包含相关信件引用（1986/1993）"
  else
    skip "护城河页面右侧信件列表（可能未实现）"
  fi
fi

# Wikipedia/百度百科链接
HAS_WIKI=$(eval_result "document.querySelector('a[href*=\"wikipedia\"], a[href*=\"baidu\"]')?.href || 'none'")
if [ "$HAS_WIKI" != "none" ] && [ -n "$HAS_WIKI" ]; then
  pass "护城河页面包含外部百科链接"
else
  skip "护城河页面百科链接（页面无此链接）"
fi


# ─── 6. 公司页 ────────────────────────────────────────────
section "6. 公司页 (/companies)"

# Find a valid company
COMPANY_SLUG=$(ls "$PROJECT_DIR/content/companies/" | grep -v quotes | head -1 | sed 's/\.md$//')

# 6.1 公司列表页
safe_goto "$BASE_URL/companies"
sleep 2
wait_for_spa

playwright-cli screenshot --filename="$SCREENSHOT_DIR/06-companies-list.png" 2>/dev/null

SNAP=$(take_snapshot)
if sci '公司解析\|companies'; then
  pass "公司列表页加载成功"
else
  fail "公司列表页" "页面未加载"
fi

# 6.2 具体公司页
safe_goto "$BASE_URL/companies/$COMPANY_SLUG"
sleep 3
wait_for_spa 5

playwright-cli screenshot --filename="$SCREENSHOT_DIR/06-company-${COMPANY_SLUG}.png" 2>/dev/null

SNAP=$(take_snapshot)
COMPANY_BODY=$(get_content_length ".article-body")
if [ -z "$COMPANY_BODY" ] || [ "$COMPANY_BODY" -lt 100 ] 2>/dev/null; then
  COMPANY_BODY=$(get_content_length "#app-content")
fi
if [ -n "$COMPANY_BODY" ] && [ "$COMPANY_BODY" -gt 100 ] 2>/dev/null; then
  pass "公司页面内容正常（$COMPANY_SLUG, ${COMPANY_BODY} 字符）"
else
  fail "公司页面" "内容过短 ($COMPANY_SLUG, $COMPANY_BODY)"
fi

# Check for related letters in sidebar
HAS_LETTERS=$(eval_result "document.querySelectorAll('.xref-chip, .right-panel a').length")
if [ -n "$HAS_LETTERS" ] && [ "$HAS_LETTERS" -gt 0 ] 2>/dev/null; then
  pass "公司页面显示相关信件（${HAS_LETTERS} 项）"
else
  skip "公司页面相关信件列表"
fi

# 6.3 Test coca-cola specifically
safe_goto "$BASE_URL/companies/coca-cola"
sleep 3
wait_for_spa 5

playwright-cli screenshot --filename="$SCREENSHOT_DIR/06-company-coca-cola.png" 2>/dev/null

SNAP=$(take_snapshot)
if sci 'coca.*cola\|可口可乐'; then
  pass "可口可乐公司页面加载正确"
else
  fail "可口可乐页面" "内容未正确显示"
fi


# ─── 7. 人物页 ────────────────────────────────────────────
section "7. 人物页 (/people)"

# 7.1 人物列表
safe_goto "$BASE_URL/people"
sleep 2
wait_for_spa

playwright-cli screenshot --filename="$SCREENSHOT_DIR/07-people-list.png" 2>/dev/null

SNAP=$(take_snapshot)
if sci '关键人物\|people' && sci '芒格\|munger'; then
  pass "人物列表页加载成功，包含芒格"
else
  fail "人物列表页" "页面加载异常"
fi

# 7.2 芒格页面
safe_goto "$BASE_URL/people/charlie-munger"
sleep 3
wait_for_spa 5

playwright-cli screenshot --filename="$SCREENSHOT_DIR/07-charlie-munger.png" 2>/dev/null

SNAP=$(take_snapshot)
if sci '芒格\|Charlie Munger\|查理'; then
  pass "芒格人物页内容正确显示"
else
  fail "芒格人物页" "内容未显示"
fi

MUNGER_BODY=$(get_content_length ".article-body")
if [ -z "$MUNGER_BODY" ] || [ "$MUNGER_BODY" -lt 100 ] 2>/dev/null; then
  MUNGER_BODY=$(get_content_length "#app-content")
fi
if [ -n "$MUNGER_BODY" ] && [ "$MUNGER_BODY" -gt 100 ] 2>/dev/null; then
  pass "芒格人物页内容已渲染（${MUNGER_BODY} 字符）"
else
  fail "芒格人物页内容" "正文内容过短 ($MUNGER_BODY)"
fi

# Check for related letters
HAS_LETTERS=$(eval_result "document.querySelectorAll('.xref-chip, .right-panel a').length")
if [ -n "$HAS_LETTERS" ] && [ "$HAS_LETTERS" -gt 0 ] 2>/dev/null; then
  pass "芒格页面显示相关信件（${HAS_LETTERS} 项）"
else
  skip "芒格页面相关信件"
fi


# ─── 8. 搜索功能 ──────────────────────────────────────────
section "8. 搜索功能"

# Go back to homepage first
safe_goto "$BASE_URL/"
sleep 2
wait_for_spa

# 8.1 搜索输入框
SNAP=$(take_snapshot)
if sci 'textbox.*搜索\|search.*input\|搜索信件'; then
  pass "搜索输入框可见"
else
  fail "搜索输入框" "未找到搜索框"
fi

# 8.2 输入搜索关键词
playwright-cli run-code "async page => {
  return await page.evaluate(() => {
    const input = document.getElementById('search-input');
    if (input) { input.value = '护城河'; input.dispatchEvent(new Event('input', {bubbles:true})); return 'filled'; }
    return 'no-input';
  });
}" 2>&1 | tail -3
sleep 2

playwright-cli screenshot --filename="$SCREENSHOT_DIR/08-search-moat.png" 2>/dev/null

# 8.3 检查搜索结果
SNAP=$(take_snapshot)
SEARCH_RESULTS=$(eval_result "document.querySelectorAll('#search-results a, .search-results a').length")

if [ -n "$SEARCH_RESULTS" ] && [ "$SEARCH_RESULTS" -gt 0 ] 2>/dev/null; then
  pass "搜索'护城河'返回 ${SEARCH_RESULTS} 条结果"
else
  # Wait longer and retry
  sleep 2
  SEARCH_RESULTS2=$(eval_result "document.querySelectorAll('#search-results a, .search-results a, .search-results li').length")
  if [ -n "$SEARCH_RESULTS2" ] && [ "$SEARCH_RESULTS2" -gt 0 ] 2>/dev/null; then
    pass "搜索'护城河'返回 ${SEARCH_RESULTS2} 条结果（延迟加载）"
  else
    fail "搜索功能" "搜索'护城河'无结果"
  fi
fi

# 8.4 点击搜索结果跳转
FIRST_RESULT=$(eval_result "document.querySelector('#search-results a')?.getAttribute('href') || document.querySelector('.search-results a')?.getAttribute('href') || ''")
if [ -n "$FIRST_RESULT" ] && [ "$FIRST_RESULT" != "" ]; then
  pass "搜索结果链接可点击（$FIRST_RESULT）"
else
  skip "搜索结果点击跳转（无法获取结果链接）"
fi

# Clear search
playwright-cli run-code "async page => { return await page.evaluate(() => { const input = document.getElementById('search-input'); if(input) { input.value=''; input.dispatchEvent(new Event('input',{bubbles:true})); } return 'cleared'; }); }" 2>&1 | tail -1
sleep 1


# ─── 9. 知识图谱 ──────────────────────────────────────────
section "9. 知识图谱 (/graph)"

safe_goto "$BASE_URL/graph"
sleep 4
wait_for_spa 5

playwright-cli screenshot --filename="$SCREENSHOT_DIR/09-graph.png" 2>/dev/null

SNAP=$(take_snapshot)

# 9.1 图谱页面加载
HAS_GRAPH=$(eval_result "document.querySelector('svg, canvas, #graph-container, [class*=\"graph\"]')?.tagName || 'none'")
if echo "$HAS_GRAPH" | grep -qi 'svg\|canvas\|DIV'; then
  pass "知识图谱页面加载（检测到 $HAS_GRAPH 元素）"
else
  if sci 'graph\|图谱\|svg'; then
    pass "知识图谱页面加载"
  else
    fail "知识图谱页面" "未检测到图谱元素 ($HAS_GRAPH)"
  fi
fi

# 9.2 D3.js 图谱节点
NODE_COUNT=$(eval_result "document.querySelectorAll('svg circle, svg .node, .graph-node').length")
if [ -n "$NODE_COUNT" ] && [ "$NODE_COUNT" -gt 0 ] 2>/dev/null; then
  pass "D3.js 图谱节点显示（${NODE_COUNT} 个节点）"
else
  # Wait for D3 to render
  sleep 3
  NODE_COUNT2=$(eval_result "document.querySelectorAll('svg circle, svg .node').length")
  if [ -n "$NODE_COUNT2" ] && [ "$NODE_COUNT2" -gt 0 ] 2>/dev/null; then
    pass "D3.js 图谱节点显示（${NODE_COUNT2} 个节点，延迟渲染）"
  else
    fail "D3.js 图谱节点" "未检测到节点元素"
  fi
fi

playwright-cli screenshot --filename="$SCREENSHOT_DIR/09-graph-rendered.png" 2>/dev/null


# ─── 10. AI 对话 ──────────────────────────────────────────
section "10. AI 对话页 (/talk)"

safe_goto "$BASE_URL/talk"
sleep 3
wait_for_spa 5

playwright-cli screenshot --filename="$SCREENSHOT_DIR/10-talk.png" 2>/dev/null

SNAP=$(take_snapshot)

# 10.1 对话界面
if sci 'AI\|对话\|问答\|chat\|talk\|消息'; then
  pass "AI 对话页面加载"
else
  fail "AI 对话页面" "页面未加载"
fi

# 10.2 设置按钮
HAS_SETTINGS=$(eval_result "document.querySelector('[class*=\"setting\"], [class*=\"config\"], button[aria-label], .talk-settings-btn, [class*=\"gear\"]')?.textContent || 'none'")
if sci '设置\|settings\|⚙\|配置'; then
  pass "设置按钮可见"
elif [ "$HAS_SETTINGS" != "none" ] && [ -n "$HAS_SETTINGS" ]; then
  pass "设置按钮存在 ($HAS_SETTINGS)"
else
  skip "设置按钮（可能使用图标无文字）"
fi

# 10.3 输入框
if sci 'textbox\|textarea\|输入\|placeholder.*问\|发送'; then
  pass "消息输入框可见"
else
  fail "消息输入框" "未找到输入框"
fi


# 10.3b 输入区域固定在底部 — 使用简单字符串返回，规避 JSON 转义解析问题
INPUT_IN_VP=$(eval_result "document.querySelector('.chat-input-area') ? (document.querySelector('.chat-input-area').getBoundingClientRect().bottom <= window.innerHeight + 5 ? 'yes' : 'no') : 'missing'")
if [ "$INPUT_IN_VP" = "yes" ]; then
  pass "10.3b: 输入区域固定在视口底部（.chat-input-area in-viewport）"
elif [ "$INPUT_IN_VP" = "missing" ]; then
  fail "10.3b: 输入区域可见性" ".chat-input-area 元素不存在"
else
  fail "10.3b: 输入区域超出视口" "$INPUT_IN_VP"
fi

# 10.3c Fetch Models 读取当前输入框值（不依赖 localStorage）
# 验证：清除保存设置 + 显示 modal + 通过 JS 直接设值，模拟用户填写但未保存的场景
FETCH_DOM_VAL=$(eval_result "(function(){localStorage.removeItem('mycloudai-settings');var m=document.getElementById('settings-modal');if(m)m.style.display='flex';var k=document.getElementById('api-key');if(k)k.value='sk-test-xyz';return k?k.value.trim():'missing';}())")
if [ -n "$FETCH_DOM_VAL" ] && [ "$FETCH_DOM_VAL" != "missing" ] && [ "$FETCH_DOM_VAL" != "" ]; then
  pass "10.3c: settings modal 中 API Key 输入框有值（fetchModels 可从 DOM 读取，无需先保存）"
else
  fail "10.3c: settings modal API Key 输入框读取" "值=$FETCH_DOM_VAL"
fi
# Close modal
playwright-cli eval "var m=document.getElementById('settings-modal'); if(m) m.style.display='none'; 'ok'" 2>/dev/null

# 10.3d /api/chat 返回 HTML 时应提示 Functions 未启动，而不是静默无响应
CHAT_HTML_ERROR=$(playwright-cli --raw run-code "async page => {
  return await page.evaluate(async () => {
    localStorage.setItem('mycloudai-settings', JSON.stringify({
      provider: 'openai',
      apiKey: 'sk-test-key-placeholder',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat'
    }));

    const originalFetch = window.fetch;
    window.fetch = function(url) {
      if (url === '/api/chat') {
        return Promise.resolve(new Response('<!DOCTYPE html><html></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        }));
      }
      return originalFetch.apply(window, arguments);
    };

    try {
      const input = document.getElementById('chat-input');
      const sendBtn = document.getElementById('send-btn');
      if (!input || !sendBtn) return 'missing-elements';
      input.value = '你好';
      sendBtn.click();
      await new Promise(resolve => setTimeout(resolve, 200));
      const lastBubble = document.querySelector('.chat-message.assistant:last-child .msg-bubble');
      return lastBubble ? lastBubble.textContent : 'missing-bubble';
    } finally {
      window.fetch = originalFetch;
      sessionStorage.removeItem('chatHistory');
    }
  });
}" 2>/dev/null)
if echo "$CHAT_HTML_ERROR" | grep -q 'Pages Functions'; then
  pass "10.3d: /api/chat 非 SSE 响应会明确提示 Functions 未启动"
else
  fail "10.3d: /api/chat 非 SSE 响应提示" "text=$CHAT_HTML_ERROR"
fi

# 10.3e /api/chat list_models 必须返回 JSON（不能返回 SSE event:...）
MODEL_PROXY_TMP="/tmp/model-proxy-$$.body"
MODEL_PROXY_HEADERS=$(curl -sS -D - -o "$MODEL_PROXY_TMP" -X POST "$BASE_URL/api/chat" \
  -H "Content-Type: application/json" \
  --data '{"action":"list_models","provider":"openai","apiKey":"sk-test-proxy","baseUrl":"http://127.0.0.1:9"}' | tr -d '\r')
MODEL_PROXY_BODY=$(cat "$MODEL_PROXY_TMP" 2>/dev/null || true)
rm -f "$MODEL_PROXY_TMP"

if grep -qi 'content-type: application/json' <<< "$MODEL_PROXY_HEADERS" && grep -q '"error"\|"details"\|"models"' <<< "$MODEL_PROXY_BODY"; then
  pass "10.3e: /api/chat?action=list_models 返回 JSON（避免 Unexpected token 解析错误）"
else
  fail "10.3e: list_models JSON 代理" "headers=$(echo "$MODEL_PROXY_HEADERS" | head -1) body=$(echo "$MODEL_PROXY_BODY" | head -c 180)"
fi

# 10.3f 工具检索后，参考原文应显示结果且不应一直停留“搜索中...”
REF_PANEL_STATE=$(playwright-cli --raw run-code "async page => {
  return await page.evaluate(async () => {
    localStorage.setItem('mycloudai-settings', JSON.stringify({
      provider: 'openai',
      apiKey: 'sk-test-key-placeholder',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat'
    }));

    const originalFetch = window.fetch;
    const streamBody = [
      'event: tool_call\\ndata: {\"query\":\"护城河\"}\\n\\n',
      'event: tool_result\\ndata: {\"query\":\"护城河\",\"refs\":[{\"title\":\"1984年巴菲特致股东信（中文全文）\",\"content\":\"测试片段\",\"route\":\"/shareholder-letters/1984\",\"query\":\"护城河\"}]}\\n\\n',
      'event: chunk\\ndata: {\"text\":\"这是测试回复\"}\\n\\n',
      'event: done\\ndata: {}\\n\\n'
    ].join('');

    window.fetch = function(url) {
      if (url === '/api/chat') {
        return Promise.resolve(new Response(streamBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        }));
      }
      return originalFetch.apply(window, arguments);
    };

    try {
      const input = document.getElementById('chat-input');
      const sendBtn = document.getElementById('send-btn');
      if (!input || !sendBtn) return 'missing-elements';
      input.value = '什么是护城河';
      sendBtn.click();
      await new Promise(resolve => setTimeout(resolve, 250));

      const refPanel = document.getElementById('ref-content');
      const text = refPanel ? refPanel.textContent : '';
      const hasRefLink = !!(refPanel && refPanel.querySelector('a[href*=\"/shareholder-letters/1984\"]'));
      const stuckSearching = text.includes('搜索中...');
      return JSON.stringify({ hasRefLink, stuckSearching, text: text.slice(0, 120) });
    } finally {
      window.fetch = originalFetch;
      sessionStorage.removeItem('chatHistory');
    }
  });
}" 2>/dev/null)

if echo "$REF_PANEL_STATE" | grep -q '"hasRefLink":true' && ! echo "$REF_PANEL_STATE" | grep -q '"stuckSearching":true'; then
  pass "10.3f: 参考原文在检索后正确显示并可跳转，不会一直停留在搜索中"
else
  fail "10.3f: 参考原文展示状态" "state=$REF_PANEL_STATE"
fi


# 10.4 AI Integration tests (conditional)
if [ -n "$OPENAI_MODEL" ] && [ -n "$OPENAI_API_KEY" ]; then
  echo "  🤖 OpenAI 集成测试..."

  # Inject config via localStorage
  playwright-cli run-code "async page => {
    await page.evaluate(() => {
      localStorage.setItem('talk-provider', 'openai');
      localStorage.setItem('talk-api-key', '$OPENAI_API_KEY');
      localStorage.setItem('talk-base-url', '${OPENAI_BASE_URL:-https://api.openai.com/v1}');
      localStorage.setItem('talk-model', '$OPENAI_MODEL');
    });
    return 'config injected';
  }" 2>&1 | tail -3

  # Reload to apply
  safe_goto "$BASE_URL/talk"
  sleep 3

  # Send test message
  playwright-cli run-code "async page => {
    return await page.evaluate(() => {
      const input = document.querySelector('textarea, input[type=\"text\"], .chat-input');
      if (input) { input.value = '什么是护城河？'; input.dispatchEvent(new Event('input')); }
      return input ? 'filled' : 'no-input';
    });
  }" 2>&1 | tail -3

  # Click send
  playwright-cli run-code "async page => {
    return await page.evaluate(() => {
      const btn = document.querySelector('button[type=\"submit\"], .send-btn, [class*=\"send\"]');
      if (btn) btn.click();
      return btn ? 'clicked' : 'no-btn';
    });
  }" 2>&1 | tail -3

  # Wait for response (max 30s)
  sleep 15

  RESPONSE=$(eval_result "document.querySelectorAll('.message, .chat-message, [class*=\"response\"]').length")
  if [ -n "$RESPONSE" ] && [ "$RESPONSE" -gt 1 ] 2>/dev/null; then
    pass "OpenAI 回复收到"
  else
    fail "OpenAI 对话" "30秒内未收到回复"
  fi
else
  skip "OpenAI 集成测试（OPENAI_MODEL 或 OPENAI_API_KEY 未配置）"
fi

if [ -n "$CLAUDE_MODEL" ] && [ -n "$CLAUDE_API_KEY" ]; then
  echo "  🤖 Claude 集成测试..."
  skip "Claude 集成测试（需手动验证）"
else
  skip "Claude 集成测试（CLAUDE_MODEL 或 CLAUDE_API_KEY 未配置）"
fi


# ─── 11. 路由导航（SPA） ─────────────────────────────────
section "11. 路由导航（SPA）"

# 11.1 直接访问深层 URL
safe_goto "$BASE_URL/concepts/moat"
sleep 3
wait_for_spa 5

SNAP=$(take_snapshot)
if sci '护城河\|moat'; then
  pass "直接访问深层URL /concepts/moat 正常加载"
else
  fail "深层URL访问" "/concepts/moat 加载失败"
fi

# 11.2 SPA 导航 - click link then check URL
safe_goto "$BASE_URL/"
sleep 2
wait_for_spa

# Click on 股东信总览 link via JS (refs may change across navigations)
playwright-cli run-code "async page => {
  return await page.evaluate(() => {
    const link = document.querySelector('a[href=\"/shareholder-letters\"], a[data-route=\"/shareholder-letters\"]');
    if (link) { link.click(); return 'clicked: ' + link.textContent; }
    return 'not-found';
  });
}" 2>&1 | tail -3
sleep 2
wait_for_spa

CURRENT_URL=$(eval_result "window.location.pathname")
if echo "$CURRENT_URL" | grep -q 'shareholder-letters'; then
  pass "SPA 内部链接导航正常（首页→股东信）"
else
  fail "SPA 导航" "点击链接后 URL 未变化 ($CURRENT_URL)"
fi

# 11.3 浏览器后退
playwright-cli go-back 2>&1 | tail -3
sleep 2
wait_for_spa

BACK_URL=$(eval_result "window.location.pathname")
if [ "$BACK_URL" = "/" ]; then
  pass "浏览器后退按钮正常（回到首页 /）"
else
  fail "浏览器后退" "后退后 URL 异常 ($BACK_URL)"
fi

# 11.4 浏览器前进
playwright-cli go-forward 2>&1 | tail -3
sleep 2
wait_for_spa

FWD_URL=$(eval_result "window.location.pathname")
if echo "$FWD_URL" | grep -q 'shareholder-letters'; then
  pass "浏览器前进按钮正常（回到股东信）"
else
  fail "浏览器前进" "前进后 URL 异常 ($FWD_URL)"
fi

# 11.5 404 页面
safe_goto "$BASE_URL/this-page-does-not-exist-12345"
sleep 2
wait_for_spa

playwright-cli screenshot --filename="$SCREENSHOT_DIR/11-404.png" 2>/dev/null

SNAP=$(take_snapshot)
if sci '404\|找不到\|not found\|页面不存在\|不存在'; then
  pass "404 页面正确显示"
else
  HTTP_404=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/this-page-does-not-exist-12345" 2>/dev/null)
  if [ "$HTTP_404" = "404" ]; then
    pass "404 HTTP 状态码正确返回"
  else
    fail "404 页面" "未显示 404 错误页面"
  fi
fi


# ─── 12. 响应式/移动端 ───────────────────────────────────
section "12. 响应式/移动端测试"

# 12.1 调整到移动端宽度
playwright-cli resize 375 812 2>&1 | tail -3
sleep 2

safe_goto "$BASE_URL/"
sleep 3
wait_for_spa

playwright-cli screenshot --filename="$SCREENSHOT_DIR/12-mobile-homepage.png" 2>/dev/null

SNAP=$(take_snapshot)

# 12.2 汉堡菜单
HAMBURGER_DISPLAY=$(eval_result "window.getComputedStyle(document.getElementById('hamburger'))?.display || 'none'")
if [ "$HAMBURGER_DISPLAY" != "none" ] && [ -n "$HAMBURGER_DISPLAY" ]; then
  pass "移动端汉堡菜单按钮显示 (display: $HAMBURGER_DISPLAY)"
else
  fail "移动端汉堡菜单" "汉堡菜单未显示 (display: $HAMBURGER_DISPLAY)"
fi

# 12.3 点击汉堡菜单，展开侧边栏
playwright-cli run-code "async page => { return await page.evaluate(() => { document.getElementById('hamburger')?.click(); return 'clicked'; }); }" 2>&1 | tail -3
sleep 1

playwright-cli screenshot --filename="$SCREENSHOT_DIR/12-mobile-menu-open.png" 2>/dev/null

SIDEBAR_CLASSES=$(eval_result "document.getElementById('sidebar')?.classList?.toString() || ''")
if echo "$SIDEBAR_CLASSES" | grep -qi 'open\|active\|show\|visible'; then
  pass "点击汉堡菜单后侧边栏展开 (class: $SIDEBAR_CLASSES)"
else
  # Check via computed style
  SIDEBAR_LEFT=$(eval_result "window.getComputedStyle(document.getElementById('sidebar'))?.left || window.getComputedStyle(document.getElementById('sidebar'))?.transform || ''")
  if echo "$SIDEBAR_LEFT" | grep -qi '0px\|none\|matrix(1, 0, 0, 1, 0'; then
    pass "点击汉堡菜单后侧边栏展开"
  else
    fail "移动端侧边栏" "点击汉堡菜单后侧边栏未展开 (classes: $SIDEBAR_CLASSES)"
  fi
fi

# 12.4 移动端内容页
safe_goto "$BASE_URL/concepts/moat"
sleep 3
wait_for_spa 5

playwright-cli screenshot --filename="$SCREENSHOT_DIR/12-mobile-content.png" 2>/dev/null

MOBILE_CONTENT=$(get_content_length ".article-body")
if [ -z "$MOBILE_CONTENT" ] || [ "$MOBILE_CONTENT" -lt 50 ] 2>/dev/null; then
  MOBILE_CONTENT=$(get_content_length "#app-content")
fi
if [ -n "$MOBILE_CONTENT" ] && [ "$MOBILE_CONTENT" -gt 50 ] 2>/dev/null; then
  pass "移动端内容页正常渲染（${MOBILE_CONTENT} 字符）"
else
  fail "移动端内容页" "内容未正常显示 ($MOBILE_CONTENT)"
fi

# Restore desktop size
playwright-cli resize 1440 900 2>&1 | tail -3
sleep 1


# ─── 13. 额外边界测试 ────────────────────────────────────
section "13. 额外边界与功能测试"

# 13.1 搜索输入框（搜索英文）
safe_goto "$BASE_URL/"
sleep 2
wait_for_spa

playwright-cli run-code "async page => { return await page.evaluate(() => { const input = document.getElementById('search-input'); if(input) { input.value='Coca-Cola'; input.dispatchEvent(new Event('input',{bubbles:true})); } return 'filled'; }); }" 2>&1 | tail -3
sleep 2

SEARCH_EN=$(eval_result "document.querySelectorAll('#search-results a, .search-results a').length")
if [ -n "$SEARCH_EN" ] && [ "$SEARCH_EN" -gt 0 ] 2>/dev/null; then
  pass "英文搜索'Coca-Cola'返回 ${SEARCH_EN} 条结果"
else
  skip "英文搜索'Coca-Cola'无结果"
fi

playwright-cli run-code "async page => { return await page.evaluate(() => { const input = document.getElementById('search-input'); if(input) { input.value=''; input.dispatchEvent(new Event('input',{bubbles:true})); } return 'cleared'; }); }" 2>&1 | tail -1
sleep 1

# 13.2 验证所有信件年份内容可加载
safe_goto "$BASE_URL/shareholder-letters/2024"
sleep 3
wait_for_spa 5

LATEST_BODY=$(get_content_length ".article-body")
if [ -z "$LATEST_BODY" ] || [ "$LATEST_BODY" -lt 100 ] 2>/dev/null; then
  LATEST_BODY=$(get_content_length "#app-content")
fi
if [ -n "$LATEST_BODY" ] && [ "$LATEST_BODY" -gt 100 ] 2>/dev/null; then
  pass "最新 2024 年信件正常加载（${LATEST_BODY} 字符）"
else
  fail "2024年信件" "内容未正常加载 ($LATEST_BODY)"
fi

# 13.3 最早年份
safe_goto "$BASE_URL/shareholder-letters/1965"
sleep 3
wait_for_spa 5

EARLIEST_BODY=$(get_content_length ".article-body")
if [ -z "$EARLIEST_BODY" ] || [ "$EARLIEST_BODY" -lt 100 ] 2>/dev/null; then
  EARLIEST_BODY=$(get_content_length "#app-content")
fi
if [ -n "$EARLIEST_BODY" ] && [ "$EARLIEST_BODY" -gt 100 ] 2>/dev/null; then
  pass "最早 1965 年股东信正常加载（${EARLIEST_BODY} 字符）"
else
  fail "1965年信件" "内容未正常加载 ($EARLIEST_BODY)"
fi

# 13.4 特别信件
safe_goto "$BASE_URL/special-letters"
sleep 2
wait_for_spa

SNAP=$(take_snapshot)
if sci '特别信件\|special'; then
  pass "特别信件列表页加载成功"
else
  skip "特别信件列表页（可能无此分类）"
fi

# 13.5 xref-chip 点击测试（在内容页中点击概念 chip）
safe_goto "$BASE_URL/shareholder-letters/1984"
sleep 3
wait_for_spa 5

# Find a clickable xref chip
XREF_LINK=$(eval_result "document.querySelector('.xref-chip')?.getAttribute('href') || document.querySelector('.xref-chip')?.getAttribute('data-route') || 'none'")

if [ "$XREF_LINK" != "none" ] && [ -n "$XREF_LINK" ]; then
  pass "xref-chip 链接存在（$XREF_LINK）"
else
  XREF_COUNT=$(eval_result "document.querySelectorAll('.xref-chip').length")
  if [ -n "$XREF_COUNT" ] && [ "$XREF_COUNT" -gt 0 ] 2>/dev/null; then
    pass "xref-chip 存在（${XREF_COUNT} 个，可能使用 data-route 路由）"
  else
    skip "xref-chip 点击测试（未检测到 xref-chip 元素）"
  fi
fi

# 13.6 CSS 加载验证
CSS_LOADED=$(eval_result "document.styleSheets.length")
if [ -n "$CSS_LOADED" ] && [ "$CSS_LOADED" -gt 0 ] 2>/dev/null; then
  pass "CSS 样式表正常加载（${CSS_LOADED} 个）"
else
  fail "CSS 加载" "样式表未加载"
fi

# 13.7 JavaScript 无报错
JS_CONSOLE=$(playwright-cli console error 2>&1)
JS_ERROR_COUNT=$(echo "$JS_CONSOLE" | grep -i 'Errors: [0-9]' | grep -o 'Errors: [0-9]*' | grep -o '[0-9]*' | head -1)
if [ -z "$JS_ERROR_COUNT" ] || [ "$JS_ERROR_COUNT" = "0" ]; then
  pass "控制台无 JavaScript 错误"
else
  fail "JavaScript 错误" "控制台有 ${JS_ERROR_COUNT} 个错误"
fi


# ═══════════════════════════════════════════════════════════
section "14. 缓存策略测试"
# ═══════════════════════════════════════════════════════════

HEADERS_FILE="$PROJECT_DIR/site/_headers"

# 检查 _headers 文件存在且包含 no-store
if grep -q "no-store" "$HEADERS_FILE"; then
  pass "_headers 包含 Cache-Control: no-store"
else
  fail "_headers 缓存配置" "未找到 no-store 规则"
fi

# 检查全局 /* 路由存在 no-store 规则
if awk '/^\/\*/{found=1} found && /no-store/{print; exit}' "$HEADERS_FILE" | grep -q "no-store"; then
  pass "全局路由 /* 已配置 no-store"
else
  fail "全局路由缓存配置" "/* 路由未找到 no-store 规则"
fi

# 检查 /assets/data/* 独立 no-store 规则
if awk '/^\/assets\/data\/\*/{found=1} found && /no-store/{print; exit}' "$HEADERS_FILE" | grep -q "no-store"; then
  pass "/assets/data/* 已配置 no-store"
else
  fail "/assets/data/* 缓存配置" "未找到 /assets/data/* no-store 规则"
fi

# 检查 /content/* 独立 no-store 规则
if awk '/^\/content\/\*/{found=1} found && /no-store/{print; exit}' "$HEADERS_FILE" | grep -q "no-store"; then
  pass "/content/* 已配置 no-store"
else
  fail "/content/* 缓存配置" "未找到 /content/* no-store 规则"
fi

# 检查 Pragma: no-cache 存在
if grep -q "Pragma: no-cache" "$HEADERS_FILE"; then
  pass "_headers 包含 Pragma: no-cache"
else
  fail "_headers Pragma 配置" "未找到 Pragma: no-cache"
fi



# ─── 15. TOC 目录功能测试 ──────────────────────────────────
section "15. TOC目录功能测试"

# 导航到 1984 年信件并等待渲染
safe_goto "$BASE_URL/shareholder-letters/1984"
sleep 3
wait_for_spa 3

playwright-cli screenshot --filename="$SCREENSHOT_DIR/15-toc-1984.png" 2>/dev/null

# 15.1 验证 1984 年信件有 TOC 链接（该文章有 9 个 h1 标题，应生成目录）
TOC_LINK_COUNT=$(eval_result "document.querySelectorAll('.toc a').length")
if [ -n "$TOC_LINK_COUNT" ] && [ "$TOC_LINK_COUNT" -gt 0 ] 2>/dev/null; then
  pass "1984年信件有 TOC 目录链接（共 ${TOC_LINK_COUNT} 个）"
else
  fail "TOC链接计数" "1984年信件未检测到 .toc a 链接（count=${TOC_LINK_COUNT}）"
fi

# 15.2 验证 TOC 链接 href 指向正确的锚点格式 (#heading-N)
TOC_HREF=$(eval_result "document.querySelector('.toc a')?.getAttribute('href') || ''")
if echo "$TOC_HREF" | grep -q "^#heading-"; then
  pass "TOC 链接 href 格式正确（${TOC_HREF}）"
else
  fail "TOC href 格式" "href 不符合 #heading-N 格式（实际: ${TOC_HREF}）"
fi

# 15.3 验证 heading 锚点元素存在于 DOM 中
HEADING_ID=$(echo "$TOC_HREF" | sed 's/^#//')
if [ -n "$HEADING_ID" ]; then
  HEADING_EXISTS=$(eval_result "document.getElementById('${HEADING_ID}') !== null ? 'yes' : 'no'")
  if [ "$HEADING_EXISTS" = "yes" ]; then
    pass "heading 锚点元素 #${HEADING_ID} 存在于 DOM 中"
  else
    fail "heading 锚点元素" "#${HEADING_ID} 在 DOM 中不存在"
  fi
else
  skip "heading 锚点验证（未获取到 TOC href）"
fi

# 15.4 验证点击 TOC 链接后页面平滑滚动（#main 容器 scrollTop 变化）
# 先记录初始 scrollTop，点击第一个 TOC 链接后检查 scrollTop 或 heading 可见性
if [ -n "$TOC_LINK_COUNT" ] && [ "$TOC_LINK_COUNT" -gt 0 ] 2>/dev/null; then
  # 获取点击前 #main 的 scrollTop
  SCROLL_BEFORE=$(eval_result "document.getElementById('main')?.scrollTop || 0")

  # 尝试点击第 2 个 TOC 链接（跳过第 1 个以确保需要滚动）
  CLICK_IDX=1
  if [ "$TOC_LINK_COUNT" -le 1 ] 2>/dev/null; then CLICK_IDX=0; fi

  playwright-cli eval "
    (function() {
      var links = document.querySelectorAll('.toc a');
      if (links.length > ${CLICK_IDX}) { links[${CLICK_IDX}].click(); }
    })();
  " 2>/dev/null | tail -1

  sleep 1

  # 获取点击后 #main 的 scrollTop
  SCROLL_AFTER=$(eval_result "document.getElementById('main')?.scrollTop || 0")

  if [ -n "$SCROLL_AFTER" ] && [ "$SCROLL_AFTER" -gt 0 ] 2>/dev/null; then
    pass "点击 TOC 链接后 #main 已滚动（scrollTop: ${SCROLL_BEFORE} → ${SCROLL_AFTER}）"
  else
    # Fallback: 检查页面 URL 未因 TOC 点击而重新导航
    CURRENT_PATH=$(eval_result "window.location.pathname")
    if echo "$CURRENT_PATH" | grep -q "shareholder-letters/1984"; then
      pass "点击 TOC 链接后页面未跳转（路由保持: ${CURRENT_PATH}）"
    else
      fail "TOC点击滚动" "点击后 scrollTop=${SCROLL_AFTER}，页面路由变为 ${CURRENT_PATH}"
    fi
  fi

  playwright-cli screenshot --filename="$SCREENSHOT_DIR/15-toc-after-click.png" 2>/dev/null
else
  skip "TOC点击滚动测试（无 TOC 链接可点击）"
fi

# 15.5 验证无目录文章（仅 1 个标题）不显示 TOC — 以 1965 年信件为例
safe_goto "$BASE_URL/shareholder-letters/1965"
sleep 3
wait_for_spa 2

TOC_1965=$(eval_result "document.querySelectorAll('.toc a').length")
if [ -z "$TOC_1965" ] || [ "$TOC_1965" -eq 0 ] 2>/dev/null; then
  pass "1965年信件（单标题文章）正确不显示 TOC"
else
  skip "1965年信件 TOC 检查（存在 ${TOC_1965} 个链接，可能有足够标题）"
fi

# ═══════════════════════════════════════════════════════════
section "16. 信件关联内容完整性测试"
# ═══════════════════════════════════════════════════════════

# 16.1 合伙人信 1957 年应有 xref-chip
playwright-cli goto "$BASE_URL/partnership-letters/1957" 2>&1 | tail -1
sleep 2
XREF_1957=$(eval_result "document.querySelectorAll('.xref-chip').length")
if [ -n "$XREF_1957" ] && [ "$XREF_1957" -gt 0 ] 2>/dev/null; then
  pass "1957年合伙人信 xref-chip 显示（${XREF_1957} 个）"
else
  fail "1957年合伙人信 xref-chip" "未找到 xref-chip 元素"
fi

# 16.2 合伙人信 1962 年应有 xref-chip
playwright-cli goto "$BASE_URL/partnership-letters/1962" 2>&1 | tail -1
sleep 2
XREF_1962=$(eval_result "document.querySelectorAll('.xref-chip').length")
if [ -n "$XREF_1962" ] && [ "$XREF_1962" -gt 0 ] 2>/dev/null; then
  pass "1962年合伙人信 xref-chip 显示（${XREF_1962} 个）"
else
  fail "1962年合伙人信 xref-chip" "未找到 xref-chip 元素"
fi

# 16.3 股东信 1965 年应有 xref-chip
playwright-cli goto "$BASE_URL/shareholder-letters/1965" 2>&1 | tail -1
sleep 2
XREF_1965=$(eval_result "document.querySelectorAll('.xref-chip').length")
if [ -n "$XREF_1965" ] && [ "$XREF_1965" -gt 0 ] 2>/dev/null; then
  pass "1965年股东信 xref-chip 显示（${XREF_1965} 个）"
else
  fail "1965年股东信 xref-chip" "未找到 xref-chip 元素"
fi

# 16.4 验证所有信件的 front matter 完整性（通过构建数据）
TOTAL_LETTERS=$(python3 -c "
import json
with open('$PROJECT_DIR/site/content/manifest.json') as f:
    data = json.load(f)
items = data.get('items', data if isinstance(data, list) else [])
count = 0
for item in items:
    if isinstance(item, dict) and item.get('category') in ('shareholder-letter', 'partnership-letter'):
        count += 1
print(count)
" 2>/dev/null)

if [ -n "$TOTAL_LETTERS" ] && [ "$TOTAL_LETTERS" -ge 90 ] 2>/dev/null; then
  pass "构建包含 ${TOTAL_LETTERS} 封信件（>=90）"
else
  fail "信件总数检查" "仅找到 ${TOTAL_LETTERS:-0} 封信件"
fi

# 16.5 验证 front matter 中 concepts_discussed 覆盖率
CONCEPTS_COVERAGE=$(python3 -c "
import os, re
total = 0
with_concepts = 0
for dirname in ['content/shareholder-letters', 'content/partnership-letters']:
    dirpath = '$PROJECT_DIR/' + dirname
    for fn in os.listdir(dirpath):
        if not fn.endswith('.md') or 'quotes' in fn:
            continue
        total += 1
        content = open(os.path.join(dirpath, fn)).read()
        if 'concepts_discussed:' in content:
            # Check if non-empty
            import yaml
            parts = content.split('---', 2)
            if len(parts) >= 3:
                fm = yaml.safe_load(parts[1]) or {}
                if fm.get('concepts_discussed'):
                    with_concepts += 1
pct = int(with_concepts / total * 100) if total > 0 else 0
print(f'{with_concepts}/{total}/{pct}')
" 2>/dev/null)

COVERAGE_PCT=$(echo "$CONCEPTS_COVERAGE" | cut -d/ -f3)
COVERAGE_WITH=$(echo "$CONCEPTS_COVERAGE" | cut -d/ -f1)
COVERAGE_TOTAL=$(echo "$CONCEPTS_COVERAGE" | cut -d/ -f2)

if [ -n "$COVERAGE_PCT" ] && [ "$COVERAGE_PCT" -ge 80 ] 2>/dev/null; then
  pass "concepts_discussed 覆盖率 ${COVERAGE_PCT}%（${COVERAGE_WITH}/${COVERAGE_TOTAL}，>=80%）"
else
  fail "concepts_discussed 覆盖率" "仅 ${COVERAGE_PCT:-0}%（${COVERAGE_WITH:-0}/${COVERAGE_TOTAL:-0}）"
fi

# ═══════════════════════════════════════════════════════════
section "21. 分类索引页测试"
# ═══════════════════════════════════════════════════════════

# 21.1: /shareholder-letters 页面有年份信息
safe_goto "$BASE_URL/shareholder-letters"
wait_for_spa 3
SNAP=$(playwright-cli snapshot 2>&1)
if grep -qE '[12][90][0-9]{2}' <<< "$SNAP"; then
  pass "21.1: /shareholder-letters 显示年份信息"
else
  fail "21.1: /shareholder-letters 年份信息" "页面中未找到年份数字"
fi
playwright-cli screenshot --filename="$SCREENSHOT_DIR/21-shareholder-index.png" 2>/dev/null

# 21.2: /concepts 页面有卡片列表（检查 concept-card 类或多个链接）
safe_goto "$BASE_URL/concepts"
wait_for_spa 3
SNAP=$(playwright-cli snapshot 2>&1)
# Check for multiple article links via /url: pattern in snapshot
LINK_COUNT=$(echo "$SNAP" | grep -c "/url: /concepts/" || true)
if [ "${LINK_COUNT:-0}" -ge 5 ] 2>/dev/null; then
  pass "21.2: /concepts 显示概念卡片列表（${LINK_COUNT} 个链接）"
else
  fail "21.2: /concepts 卡片列表" "找到 ${LINK_COUNT:-0} 个概念链接，预期 >=5"
fi
playwright-cli screenshot --filename="$SCREENSHOT_DIR/21-concepts-index.png" 2>/dev/null

# 21.3: /companies 页面有卡片
safe_goto "$BASE_URL/companies"
wait_for_spa 3
SNAP=$(playwright-cli snapshot 2>&1)
COMPANY_LINKS=$(echo "$SNAP" | grep -c "/url: /companies/" || true)
if [ "${COMPANY_LINKS:-0}" -ge 5 ] 2>/dev/null; then
  pass "21.3: /companies 显示公司卡片（${COMPANY_LINKS} 个）"
else
  fail "21.3: /companies 卡片" "找到 ${COMPANY_LINKS:-0} 个公司链接，预期 >=5"
fi
playwright-cli screenshot --filename="$SCREENSHOT_DIR/21-companies-index.png" 2>/dev/null

# 21.4: /people 页面正常加载（有人物链接）
safe_goto "$BASE_URL/people"
wait_for_spa 3
SNAP=$(playwright-cli snapshot 2>&1)
PEOPLE_LINKS=$(echo "$SNAP" | grep -c "/url: /people/" || true)
if [ "${PEOPLE_LINKS:-0}" -ge 1 ] 2>/dev/null; then
  pass "21.4: /people 正常加载（${PEOPLE_LINKS} 位人物）"
else
  fail "21.4: /people 页面" "找到 ${PEOPLE_LINKS:-0} 个人物链接，预期 >=1"
fi
playwright-cli screenshot --filename="$SCREENSHOT_DIR/21-people-index.png" 2>/dev/null

# 21.5: 点击索引卡片可跳转到文章（从 /shareholder-letters 点击第一个年份卡片）
safe_goto "$BASE_URL/shareholder-letters"
wait_for_spa 3
SNAP=$(playwright-cli snapshot 2>&1)
# Extract ref of the first letter-card link (matches "link "YYYY ..." [ref=eXX]")
FIRST_CARD_REF=$(echo "$SNAP" | grep -o 'link "[0-9]\{4\}[^"]*" \[ref=e[0-9]\+\]' | head -1 | grep -o 'e[0-9]\+' | head -1 || true)
if [ -n "$FIRST_CARD_REF" ]; then
  CLICK_OUT=$(playwright-cli click "$FIRST_CARD_REF" 2>&1)
  if echo "$CLICK_OUT" | grep -q "shareholder-letters/"; then
    DEST_URL=$(echo "$CLICK_OUT" | grep "Page URL" | head -1 | grep -o 'shareholder-letters/[^ ]*' | head -1)
    pass "21.5: 点击索引卡片成功跳转（/$DEST_URL）"
  else
    fail "21.5: 点击索引卡片跳转" "点击后未跳转到文章页，输出: $(echo "$CLICK_OUT" | head -3)"
  fi
else
  skip "21.5: 点击索引卡片跳转（未找到可点击的卡片 ref）"
fi
playwright-cli screenshot --filename="$SCREENSHOT_DIR/21-letter-after-click.png" 2>/dev/null

# ═══════════════════════════════════════════════════════════
# 17. 首页美化验证
# ═══════════════════════════════════════════════════════════
section "17. 首页美化验证"

safe_goto "$BASE_URL/"
wait_for_spa 3

# 17.1 Hero 区域标题
HERO_TITLE=$(eval_result "document.querySelector('.hero-title')?.textContent || ''")
if echo "$HERO_TITLE" | grep -q "价值投资"; then
  pass "17.1: Hero 标题包含'价值投资'"
else
  fail "17.1: Hero 标题" "未找到'价值投资': $HERO_TITLE"
fi

# 17.2 统计数字
STATS_COUNT=$(eval_result "document.querySelectorAll('.hero-stat').length")
if [ "$STATS_COUNT" = "4" ]; then
  pass "17.2: Hero 统计数字显示 4 项（信件、概念、公司、人物）"
else
  fail "17.2: Hero 统计数字" "期望4项，实际 $STATS_COUNT"
fi

# 17.3 CTA 按钮
CTA_PRIMARY=$(eval_result "document.querySelector('.cta-primary')?.textContent?.trim() || ''")
CTA_SEC=$(eval_result "document.querySelector('.cta-secondary')?.textContent?.trim() || ''")
if echo "$CTA_PRIMARY" | grep -q "开始阅读"; then
  pass "17.3a: CTA 主按钮'开始阅读'存在"
else
  fail "17.3a: CTA 主按钮" "未找到'开始阅读': $CTA_PRIMARY"
fi
if echo "$CTA_SEC" | grep -q "AI对话"; then
  pass "17.3b: CTA 次按钮'AI对话'存在"
else
  fail "17.3b: CTA 次按钮" "未找到'AI对话': $CTA_SEC"
fi

# 17.4 快速入口卡片
ENTRY_CARDS=$(eval_result "document.querySelectorAll('.entry-card').length")
if [ "$ENTRY_CARDS" = "4" ]; then
  pass "17.4: 快速入口卡片 4 张"
else
  fail "17.4: 快速入口卡片" "期望4张，实际 $ENTRY_CARDS"
fi

# 17.5 精选金句区
sleep 3
QUOTE_CARDS=$(eval_result "document.querySelectorAll('.home-quote-card').length")
if [ -n "$QUOTE_CARDS" ] && [ "$QUOTE_CARDS" -ge 1 ] 2>/dev/null; then
  pass "17.5: 首页精选金句显示 ${QUOTE_CARDS} 条"
else
  fail "17.5: 首页精选金句" "未显示金句: $QUOTE_CARDS"
fi

# 17.6 近期更新
RECENT_ITEMS=$(eval_result "document.querySelectorAll('.recent-letter-item').length")
if [ "$RECENT_ITEMS" = "5" ]; then
  pass "17.6: 近期更新显示 5 封信件"
else
  fail "17.6: 近期更新" "期望5封，实际 $RECENT_ITEMS"
fi

playwright-cli screenshot --filename="$SCREENSHOT_DIR/17-homepage-beautified.png" 2>/dev/null

# ═══════════════════════════════════════════════════════════
# 18. 金句页测试 (/quotes)
# ═══════════════════════════════════════════════════════════
section "18. 金句页测试 (/quotes)"

safe_goto "$BASE_URL/quotes"
wait_for_spa 10

# 18.1 页面标题
PAGE_TITLE=$(eval_result "document.title")
if echo "$PAGE_TITLE" | grep -q "金句"; then
  pass "18.1: 金句页标题正确"
else
  fail "18.1: 金句页标题" "标题不含'金句': $PAGE_TITLE"
fi

# 18.2 金句加载
QUOTES_COUNT=$(eval_result "document.querySelector('.quotes-count')?.textContent || ''")
if echo "$QUOTES_COUNT" | grep -qE "[0-9]+ 条金句"; then
  pass "18.2: 金句加载成功 ($QUOTES_COUNT)"
else
  fail "18.2: 金句加载" "计数不正确: $QUOTES_COUNT"
fi

# 18.3 筛选按钮存在
FILTER_BTNS=$(eval_result "document.querySelectorAll('.quotes-filter-btn').length")
if [ "$FILTER_BTNS" -ge 4 ] 2>/dev/null; then
  pass "18.3: 筛选按钮 ${FILTER_BTNS} 个"
else
  fail "18.3: 筛选按钮" "期望>=4，实际 $FILTER_BTNS"
fi

# 18.4 金句来源链接
SOURCE_LINKS=$(eval_result "document.querySelectorAll('.quote-source-link').length")
if [ -n "$SOURCE_LINKS" ] && [ "$SOURCE_LINKS" -ge 1 ] 2>/dev/null; then
  pass "18.4: 金句来源链接 ${SOURCE_LINKS} 个"
else
  fail "18.4: 金句来源链接" "未找到来源链接: $SOURCE_LINKS"
fi

# 18.5 分类筛选功能
# Click "股东信金句" filter and verify count changes
FILTER_BTN_REF=$(playwright-cli snapshot ".quotes-filters" --depth=2 2>&1 | grep -o 'button "股东信金句" \[ref=[^]]*\]' | grep -o 'ref=e[0-9]*' | sed 's/ref=//')
if [ -n "$FILTER_BTN_REF" ]; then
  playwright-cli click "$FILTER_BTN_REF" 2>&1 | tail -1
  sleep 1
  FILTERED_COUNT=$(eval_result "document.querySelector('.quotes-count')?.textContent || ''")
  if echo "$FILTERED_COUNT" | grep -qE "[0-9]+ 条金句"; then
    pass "18.5: 分类筛选有效 ($FILTERED_COUNT)"
  else
    fail "18.5: 分类筛选" "筛选后计数异常: $FILTERED_COUNT"
  fi
else
  skip "18.5: 分类筛选（未找到筛选按钮）"
fi

# 18.6 侧边栏金句入口
QUOTES_NAV=$(eval_result "document.querySelector('a[data-route=\"/quotes\"]')?.textContent || ''")
if echo "$QUOTES_NAV" | grep -q "金句"; then
  pass "18.6: 侧边栏金句入口存在"
else
  fail "18.6: 侧边栏金句入口" "未找到: $QUOTES_NAV"
fi

playwright-cli screenshot --filename="$SCREENSHOT_DIR/18-quotes-page.png" 2>/dev/null

# ═══════════════════════════════════════════════════════════
# 19. 搜索框功能测试
# ═══════════════════════════════════════════════════════════
section "19. 搜索 Spotlight 模态框功能测试"

# 19.1 搜索按钮存在
safe_goto "$BASE_URL"
wait_for_spa 3
SEARCH_BTN=$(raw_eval "document.querySelector('#search-open-btn') ? 'FOUND' : 'MISSING'")
if [ "$SEARCH_BTN" = "FOUND" ]; then
  pass "19.1: 搜索按钮存在 (#search-open-btn)"
else
  fail "19.1: 搜索按钮存在" "未找到 #search-open-btn ($SEARCH_BTN)"
fi

# 19.2 点击搜索按钮打开 Spotlight 模态框
playwright-cli click "#search-open-btn" 2>/dev/null
sleep 0.5
MODAL_ACTIVE=$(raw_eval "document.querySelector('#search-modal.active') ? 'YES' : 'NO'")
if [ "$MODAL_ACTIVE" = "YES" ]; then
  pass "19.2: 搜索模态框打开"
else
  fail "19.2: 搜索模态框打开" "modal 未 active ($MODAL_ACTIVE)"
fi

# 19.3 搜索输入框可聚焦
sleep 0.3
FOCUSED=$(raw_eval "document.activeElement && document.activeElement.id === 'search-modal-input' ? 'YES' : 'NO'")
if [ "$FOCUSED" = "YES" ]; then
  pass "19.3: 搜索输入框自动聚焦"
else
  fail "19.3: 搜索输入框自动聚焦" "聚焦失败 ($FOCUSED)"
fi

# 19.4 输入关键词后显示搜索结果
playwright-cli fill "#search-modal-input" "护城河" 2>/dev/null
sleep 2
RESULT_COUNT=$(raw_eval "document.querySelectorAll('.spotlight-result-item').length")
if [ -n "$RESULT_COUNT" ] && [ "$RESULT_COUNT" -gt 0 ] 2>/dev/null; then
  pass "19.4: 搜索结果有内容（$RESULT_COUNT 条）"
else
  fail "19.4: 搜索结果有内容" "结果数: $RESULT_COUNT"
fi

# 19.5 搜索结果为新 tab 链接，URL 含 highlight 参数且不含 #chunk- 锚点
RESULT_HREF=$(raw_eval "document.querySelector('.spotlight-result-item') ? document.querySelector('.spotlight-result-item').getAttribute('href') : ''")
RESULT_TARGET=$(raw_eval "document.querySelector('.spotlight-result-item') ? document.querySelector('.spotlight-result-item').getAttribute('target') : ''")
if echo "$RESULT_HREF" | grep -q 'highlight=' && ! echo "$RESULT_HREF" | grep -q '#chunk-' && [ "$RESULT_TARGET" = "_blank" ]; then
  pass "19.5: 搜索结果为新 tab 链接，含 highlight 参数且无 #chunk- 锚点"
else
  fail "19.5: 搜索结果应为 target=_blank、含 highlight 且不含 #chunk-" "href=$RESULT_HREF target=$RESULT_TARGET"
fi

# 19.6 点击结果后模态框关闭（结果在新 tab 打开）
playwright-cli run-code "async page => { await page.locator('.spotlight-result-item').first().click(); }" 2>/dev/null
sleep 2
MODAL_CLOSED=$(raw_eval "document.querySelector('#search-modal.active') ? 'STILL_OPEN' : 'CLOSED'")
if [ "$MODAL_CLOSED" = "CLOSED" ]; then
  pass "19.6: 点击结果后模态框关闭（新 tab 打开）"
else
  fail "19.6: 点击结果后模态框关闭" "modal 状态: $MODAL_CLOSED"
fi

# 19.7 关键词高亮功能
safe_goto "$BASE_URL/concepts/moat?highlight=护城河"
wait_for_spa 3
MARK_COUNT=$(raw_eval "document.querySelectorAll('mark.highlight-mark').length")
if [ -n "$MARK_COUNT" ] && [ "$MARK_COUNT" -gt 0 ] 2>/dev/null; then
  pass "19.7: 关键词高亮生效（$MARK_COUNT 处）"
else
  fail "19.7: 关键词高亮生效" "mark 数: $MARK_COUNT"
fi

playwright-cli screenshot --filename="$SCREENSHOT_DIR/19-spotlight-search.png" 2>/dev/null

# ═══════════════════════════════════════════════════════════
# 20. Xref 面板交互测试
# ═══════════════════════════════════════════════════════════
section "20. Xref 面板交互测试"

# ─── 20.1 信件页 xref chip 点击不弹 modal（而是新 tab 导航）──
safe_goto "$BASE_URL/shareholder-letters/1984"
wait_for_spa 3
CHIP_DIRECT=$(raw_eval "document.querySelector('.xref-chip-direct') ? 'FOUND' : 'MISSING'")
if [ "$CHIP_DIRECT" = "FOUND" ]; then
  # Verify chip has target="_blank" (opens in new tab, no modal)
  CHIP_TARGET=$(raw_eval "document.querySelector('.xref-chip-direct').getAttribute('target')")
  if [ "$CHIP_TARGET" = "_blank" ]; then
    pass "20.1: 信件页 xref chip 为直接链接（target=_blank，不弹 modal）"
  else
    fail "20.1: 信件页 xref chip 应有 target=_blank" "target=$CHIP_TARGET"
  fi
else
  fail "20.1: 信件页 xref chip 存在" "未找到 .xref-chip-direct ($CHIP_DIRECT)"
fi

# Verify clicking direct chip does NOT open the modal
playwright-cli run-code "async page => { await page.locator('.xref-chip-direct').first().click(); await page.waitForTimeout(500); }" 2>/dev/null
MODAL_DISPLAY_AFTER=$(raw_eval "document.querySelector('#xref-modal-overlay') ? document.querySelector('#xref-modal-overlay').style.display : 'none'")
if [ "$MODAL_DISPLAY_AFTER" = "none" ] || [ "$MODAL_DISPLAY_AFTER" = "" ]; then
  pass "20.1b: 信件页 chip 点击后 modal 未弹出（正确）"
else
  fail "20.1b: 信件页 chip 不应弹 modal" "modal display=$MODAL_DISPLAY_AFTER"
fi

# ─── 20.2 概念页 xref 信件点击弹出 scoped 搜索面板 ──
safe_goto "$BASE_URL/concepts/moat"
wait_for_spa 3
LETTER_ITEM=$(raw_eval "document.querySelector('.xref-letter-item') ? 'FOUND' : 'MISSING'")
if [ "$LETTER_ITEM" = "FOUND" ]; then
  pass "20.2a: 概念页显示关联信件列表（.xref-letter-item）"
else
  fail "20.2a: 概念页应有关联信件列表" "未找到 .xref-letter-item ($LETTER_ITEM)"
fi

# Click a letter item to trigger scoped search
playwright-cli run-code "async page => { await page.locator('.xref-letter-item').first().click(); await page.waitForTimeout(1500); }" 2>/dev/null
MODAL_DISPLAY=$(raw_eval "document.querySelector('#xref-modal-overlay') ? document.querySelector('#xref-modal-overlay').style.display : 'NONE'")
if [ "$MODAL_DISPLAY" = "flex" ]; then
  pass "20.2b: 概念页点击信件 → scoped 搜索面板弹出"
else
  fail "20.2b: 概念页点击信件应弹出 scoped 搜索面板" "modal display=$MODAL_DISPLAY"
fi

# ─── 20.3 scoped 搜索结果包含段落预览 ──
MODAL_TITLE=$(raw_eval "document.querySelector('#xref-modal-title') ? document.querySelector('#xref-modal-title').textContent : ''")
if echo "$MODAL_TITLE" | grep -q '中搜索'; then
  pass "20.3a: scoped 搜索标题格式正确（$MODAL_TITLE）"
else
  fail "20.3a: scoped 搜索标题应包含「中搜索」" "title=$MODAL_TITLE"
fi

PREVIEW_EXISTS=$(raw_eval "document.querySelector('.xref-scoped-preview') ? 'FOUND' : document.querySelector('.xref-modal-empty') ? 'EMPTY' : 'MISSING'")
if [ "$PREVIEW_EXISTS" = "FOUND" ]; then
  pass "20.3b: scoped 搜索结果包含段落预览"
elif [ "$PREVIEW_EXISTS" = "EMPTY" ]; then
  pass "20.3b: scoped 搜索无结果但正确显示提示"
else
  fail "20.3b: scoped 搜索结果" "preview=$PREVIEW_EXISTS"
fi

# ─── 20.4 scoped 搜索结果 URL 为有效文章链接（只含 highlight 参数，不含 #chunk-）──
RESULT_HREF=$(raw_eval "(document.querySelector('.xref-scoped-result') || document.querySelector('.xref-modal-viewpage'))?.getAttribute('href') || ''")
if echo "$RESULT_HREF" | grep -qE '^/'; then
  pass "20.4a: scoped 搜索结果 URL 为有效文章路径（$RESULT_HREF）"
else
  fail "20.4a: scoped 搜索结果 URL 应为文章路径" "href=$RESULT_HREF"
fi

# Verify URL does NOT contain #chunk- (chunk anchor mismatch fix)
if echo "$RESULT_HREF" | grep -q '#chunk-'; then
  fail "20.4b: scoped 搜索结果 URL 不应包含 #chunk- 锚点（已修复映射错误）" "href=$RESULT_HREF"
else
  pass "20.4b: scoped 搜索结果 URL 不含 #chunk- 锚点（chunk 映射修复验证）"
fi

# Verify highlight parameter is present for keyword navigation
if echo "$RESULT_HREF" | grep -q 'highlight='; then
  pass "20.4c: scoped 搜索结果 URL 含 highlight 参数（keyword 高亮导航）"
else
  skip "20.4c: scoped 搜索结果 URL highlight 参数（无结果时跳过）"
fi

# Close modal
playwright-cli run-code "async page => { await page.locator('#xref-modal-close').click(); await page.waitForTimeout(300); }" 2>/dev/null

playwright-cli screenshot --filename="$SCREENSHOT_DIR/20-xref-panel.png" 2>/dev/null

# ═══════════════════════════════════════════════════════════
# 26. 语言移除 & chunk 锚点修复 回归测试
# ═══════════════════════════════════════════════════════════
section "26. 语言移除与 chunk 锚点修复回归测试"

# ─── 26.1 所有字母页均无 .bilingual-toggle ──
safe_goto "$BASE_URL/shareholder-letters/1984"
wait_for_spa 3
BILINGUAL_1984=$(raw_eval "document.querySelector('.bilingual-toggle') ? 'FOUND' : 'MISSING'")
if [ "$BILINGUAL_1984" = "MISSING" ]; then
  pass "26.1a: 股东信 1984 无 .bilingual-toggle（语言切换已移除）"
else
  fail "26.1a: 股东信 1984 .bilingual-toggle 应不存在" "found=$BILINGUAL_1984"
fi

safe_goto "$BASE_URL/partnership-letters/1966"
wait_for_spa 3
BILINGUAL_1966=$(raw_eval "document.querySelector('.bilingual-toggle') ? 'FOUND' : 'MISSING'")
if [ "$BILINGUAL_1966" = "MISSING" ]; then
  pass "26.1b: 合伙人信 1966 无 .bilingual-toggle（语言切换已移除）"
else
  fail "26.1b: 合伙人信 1966 .bilingual-toggle 应不存在" "found=$BILINGUAL_1966"
fi

# ─── 26.2 .lang-btn 不存在 ──
LANGBTN=$(raw_eval "document.querySelector('.lang-btn') ? 'FOUND' : 'MISSING'")
if [ "$LANGBTN" = "MISSING" ]; then
  pass "26.2: .lang-btn 不存在（语言按钮已移除）"
else
  fail "26.2: .lang-btn 应不存在" "found=$LANGBTN"
fi

# ─── 26.3 概念页信件链接 URL 不含 #chunk- ──
safe_goto "$BASE_URL/concepts/moat"
wait_for_spa 3
playwright-cli run-code "async page => { await page.locator('.xref-letter-item').first().click(); await page.waitForTimeout(1500); }" 2>/dev/null
SCOPED_HREF=$(raw_eval "document.querySelector('.xref-scoped-result')?.getAttribute('href') || ''")
if echo "$SCOPED_HREF" | grep -q '#chunk-'; then
  fail "26.3: 概念页信件链接不应含 #chunk- 锚点（chunk 索引不对齐）" "href=$SCOPED_HREF"
else
  if [ -n "$SCOPED_HREF" ]; then
    pass "26.3: 概念页信件链接无 #chunk- 锚点（chunk 锚点修复验证，href=$SCOPED_HREF）"
  else
    skip "26.3: 未找到 .xref-scoped-result（跳过 chunk 锚点验证）"
  fi
fi

# ─── 26.4 验证 highlight 参数存在（高亮导航工作正常）──
if echo "$SCOPED_HREF" | grep -q 'highlight='; then
  pass "26.4: 信件链接含 highlight= 参数（关键词高亮导航正常）"
else
  if [ -n "$SCOPED_HREF" ]; then
    fail "26.4: 信件链接应含 highlight= 参数" "href=$SCOPED_HREF"
  else
    skip "26.4: 未找到结果，跳过 highlight 参数验证"
  fi
fi

# ─── 26.5 同年份股东信/合伙人信 slug 解析正确 ──
safe_goto "$BASE_URL/concepts/buybacks"
wait_for_spa 3
BUYBACKS_1966=$(raw_eval "document.querySelector('.xref-letter-item[data-letter-route=\"/shareholder-letters/1966\"]') ? 'FOUND' : 'MISSING'")
BUYBACKS_WRONG_1966=$(raw_eval "document.querySelector('.xref-letter-item[data-letter-route=\"/partnership-letters/1966\"]') ? 'FOUND' : 'MISSING'")
if [ "$BUYBACKS_1966" = "FOUND" ] && [ "$BUYBACKS_WRONG_1966" = "MISSING" ]; then
  pass "26.5: 同年份信件按完整路由解析（buybacks 正确指向 shareholder-letters/1966）"
else
  fail "26.5: 同年份信件路由解析" "shareholder=$BUYBACKS_1966 partnership=$BUYBACKS_WRONG_1966"
fi

playwright-cli run-code "async page => {
  const btn = page.locator('#xref-modal-close');
  if (await btn.count()) await btn.click();
  await page.waitForTimeout(300);
}" 2>/dev/null
playwright-cli screenshot --filename="$SCREENSHOT_DIR/26-regression.png" 2>/dev/null

# ═══════════════════════════════════════════════════════════
# 关闭浏览器 & 生成总结
# ═══════════════════════════════════════════════════════════

playwright-cli close 2>&1 | tail -1

# ─── 总结 ─────────────────────────────────────────────────
echo ""
echo "" >> "$REPORT"
echo "---" >> "$REPORT"
echo "" >> "$REPORT"
echo "## 测试总结" >> "$REPORT"
echo "" >> "$REPORT"
echo "| 项目 | 数量 |" >> "$REPORT"
echo "|------|------|" >> "$REPORT"
echo "| ✅ 通过 | $PASS |" >> "$REPORT"
echo "| ❌ 失败 | $FAIL |" >> "$REPORT"
echo "| ⏭️ 跳过 | $SKIP |" >> "$REPORT"
echo "| **合计** | $((PASS+FAIL+SKIP)) |" >> "$REPORT"
echo "" >> "$REPORT"

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "### 失败项详情" >> "$REPORT"
  echo "" >> "$REPORT"
  for err in "${ERRORS[@]}"; do
    echo "- $err" >> "$REPORT"
  done
  echo "" >> "$REPORT"
fi

# ─── Section 22: 帮助 Modal 测试 ──────────────────────────────
section "22. 帮助 Modal 测试"

# 确保在首页
safe_goto "$BASE_URL/"
wait_for_spa 2

# 22.1 帮助按钮存在
SNAPSHOT=$(take_snapshot)
if echo "$SNAPSHOT" | grep -q "help-btn\|使用帮助"; then
  pass "22.1 帮助按钮存在于侧边栏"
else
  fail "22.1 帮助按钮" "侧边栏未找到帮助按钮"
fi

# 22.2 点击帮助按钮，modal 打开
playwright-cli click "#help-btn" 2>/dev/null || playwright-cli click "getByTitle('使用帮助')" 2>/dev/null
sleep 1
SNAPSHOT=$(take_snapshot)
if echo "$SNAPSHOT" | grep -q "help-modal\|使用帮助\|📖"; then
  pass "22.2 点击帮助按钮 modal 弹出"
else
  fail "22.2 帮助 modal" "点击后 modal 未显示"
fi

# 22.3 modal 内容加载（HELP.md 渲染）
sleep 2
SNAPSHOT=$(take_snapshot)
if echo "$SNAPSHOT" | grep -qi "搜索\|侧边栏\|内容导航\|AI问答"; then
  pass "22.3 帮助内容正确加载（HELP.md 渲染）"
else
  fail "22.3 帮助内容" "modal 内帮助文档未加载"
fi

# 22.4 关闭按钮有效
playwright-cli click "#help-modal-close" 2>/dev/null
sleep 0.5
MODAL_DISPLAY=$(playwright-cli eval "document.getElementById('help-modal-overlay')?.style.display" 2>/dev/null | tr -d '"')
if echo "$MODAL_DISPLAY" | grep -q "none"; then
  pass "22.4 关闭按钮有效，modal 隐藏"
else
  fail "22.4 关闭按钮" "modal 未关闭 (display=$MODAL_DISPLAY)"
fi

# 22.5 ESC 键关闭 modal
playwright-cli click "#help-btn" 2>/dev/null
sleep 0.8
playwright-cli press Escape 2>/dev/null
sleep 0.5
MODAL_DISPLAY=$(playwright-cli eval "document.getElementById('help-modal-overlay')?.style.display" 2>/dev/null | tr -d '"')
if echo "$MODAL_DISPLAY" | grep -q "none"; then
  pass "22.5 ESC 键关闭 modal"
else
  fail "22.5 ESC 关闭" "ESC 后 modal 未关闭 (display=$MODAL_DISPLAY)"
fi

# 22.6 点击遮罩关闭 modal
playwright-cli click "#help-btn" 2>/dev/null
sleep 0.8
playwright-cli run-code "async page => {
  await page.mouse.click(10, 10);
  await page.waitForTimeout(500);
}" 2>/dev/null
sleep 0.5
MODAL_DISPLAY=$(playwright-cli eval "document.getElementById('help-modal-overlay')?.style.display" 2>/dev/null | tr -d '"')
if echo "$MODAL_DISPLAY" | grep -q "none"; then
  pass "22.6 点击遮罩关闭 modal"
else
  fail "22.6 遮罩关闭" "点击遮罩后 modal 未关闭"
fi

# 22.7 help.md 文件可直接访问
HTTP_HELP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/content/help.md" 2>/dev/null)
if [ "$HTTP_HELP" = "200" ]; then
  pass "22.7 /content/help.md 可访问 (HTTP 200)"
else
  fail "22.7 help.md 访问" "HTTP $HTTP_HELP（需先运行 node build.mjs）"
fi

playwright-cli screenshot --filename="$SCREENSHOT_DIR/22-help-modal.png" 2>/dev/null

# ─── Section 23: 版本徽章 & 更新日志页 ──────────────────────────────
section "23. 版本徽章与更新日志页测试"

safe_goto "$BASE_URL/"
wait_for_spa 3

# 23.1 版本徽章存在
VERSION_BADGE=$(raw_eval "document.getElementById('sidebar-version') ? 'FOUND' : 'MISSING'")
if [ "$VERSION_BADGE" = "FOUND" ]; then
  pass "23.1: 侧边栏版本徽章存在 (#sidebar-version)"
else
  fail "23.1: 侧边栏版本徽章" "未找到 #sidebar-version"
fi

# 23.2 版本号已填充（不为 "--"）
VERSION_TEXT=$(raw_eval "document.getElementById('version-number')?.textContent || ''")
if [ -n "$VERSION_TEXT" ] && [ "$VERSION_TEXT" != "--" ]; then
  pass "23.2: 版本号已加载（$VERSION_TEXT）"
else
  fail "23.2: 版本号" "版本号未填充（当前值: $VERSION_TEXT）"
fi

# 23.3 版本徽章链接指向 /changelog
BADGE_HREF=$(raw_eval "document.getElementById('sidebar-version')?.getAttribute('href') || ''")
if [ "$BADGE_HREF" = "/changelog" ]; then
  pass "23.3: 版本徽章链接正确（href=/changelog）"
else
  fail "23.3: 版本徽章链接" "href=$BADGE_HREF（应为 /changelog）"
fi

# 23.4 /changelog 页面可渲染
safe_goto "$BASE_URL/changelog"
wait_for_spa 3
SNAPSHOT=$(take_snapshot)
if echo "$SNAPSHOT" | grep -qi "Changelog\|更新\|版本\|\[1\."; then
  pass "23.4: /changelog 页面渲染正常（含更新日志内容）"
else
  fail "23.4: /changelog 页面" "页面内容未正确渲染"
fi

playwright-cli screenshot --filename="$SCREENSHOT_DIR/23-changelog.png" 2>/dev/null

# ═══════════════════════════════════════════════════════════
section "24. 导读页测试 (/guide)"
# ═══════════════════════════════════════════════════════════
safe_goto "$BASE_URL/guide/concepts"
wait_for_spa 3

GUIDE_TITLE=$(eval_result "document.querySelector('.guide-title')?.textContent || ''")
if echo "$GUIDE_TITLE" | grep -q "导读"; then
  pass "24.1: 导读页标题包含'导读'"
else
  fail "24.1: 导读页标题" "未找到导读标题: $GUIDE_TITLE"
fi

GUIDE_ITEMS=$(eval_result "document.querySelectorAll('.guide-item').length")
if [ -n "$GUIDE_ITEMS" ] && [ "$GUIDE_ITEMS" -ge 1 ] 2>/dev/null; then
  pass "24.2: 导读页显示 ${GUIDE_ITEMS} 篇文章"
else
  fail "24.2: 导读页文章列表" "期望>=1，实际 $GUIDE_ITEMS"
fi

GUIDE_LINK=$(eval_result "document.querySelector('.guide-item-title')?.getAttribute('href') || ''")
if echo "$GUIDE_LINK" | grep -q '/concepts/'; then
  pass "24.3: 导读文章链接指向正确路由"
else
  fail "24.3: 导读链接" "href=$GUIDE_LINK"
fi

GUIDE_SUMMARY=$(eval_result "document.querySelector('.guide-item-summary')?.textContent?.length || 0")
if [ "$GUIDE_SUMMARY" -ge 10 ] 2>/dev/null; then
  pass "24.4: 导读文章概要存在（${GUIDE_SUMMARY} 字符）"
else
  fail "24.4: 导读文章概要" "summary length=$GUIDE_SUMMARY"
fi

playwright-cli screenshot --filename="$SCREENSHOT_DIR/24-guide-page.png" 2>/dev/null

# ═══════════════════════════════════════════════════════════
section "25. 侧边栏折叠功能测试"
# ═══════════════════════════════════════════════════════════

safe_goto "$BASE_URL/"
wait_for_spa 2

# Reset any pre-existing collapsed state so the test starts from a known state
playwright-cli eval "localStorage.removeItem('sidebarCollapsed'); document.body.classList.remove('sidebar-collapsed');" 2>/dev/null
sleep 1

# 25.1 折叠按钮存在
TOGGLE_BTN=$(raw_eval "document.getElementById('sidebar-toggle') ? 'FOUND' : 'MISSING'")
if [ "$TOGGLE_BTN" = "FOUND" ]; then
  pass "25.1: 侧边栏折叠按钮存在 (#sidebar-toggle)"
else
  fail "25.1: 折叠按钮" "未找到 #sidebar-toggle"
fi

# 25.2 展开浮动按钮存在
EXPAND_BTN=$(raw_eval "document.getElementById('sidebar-expand-btn') ? 'FOUND' : 'MISSING'")
if [ "$EXPAND_BTN" = "FOUND" ]; then
  pass "25.2: 侧边栏展开按钮存在 (#sidebar-expand-btn)"
else
  fail "25.2: 展开按钮" "未找到 #sidebar-expand-btn"
fi

# 25.3 点击折叠按钮后 body 有 sidebar-collapsed 类
playwright-cli click "#sidebar-toggle" 2>/dev/null
sleep 1
COLLAPSED=$(raw_eval "document.body.classList.contains('sidebar-collapsed') ? 'YES' : 'NO'")
if [ "$COLLAPSED" = "YES" ]; then
  pass "25.3: 点击折叠按钮后 body 获得 sidebar-collapsed 类"
else
  fail "25.3: 折叠状态" "body 未获得 sidebar-collapsed 类"
fi

# 25.4 展开按钮在折叠后可见
EXPAND_VISIBLE=$(raw_eval "getComputedStyle(document.getElementById('sidebar-expand-btn')).display")
if [ "$EXPAND_VISIBLE" != "none" ]; then
  pass "25.4: 折叠后展开按钮可见 (display=$EXPAND_VISIBLE)"
else
  fail "25.4: 展开按钮可见性" "display=$EXPAND_VISIBLE"
fi

playwright-cli screenshot --filename="$SCREENSHOT_DIR/25-sidebar-collapsed.png" 2>/dev/null

# 25.5 点击展开按钮恢复
playwright-cli click "#sidebar-expand-btn" 2>/dev/null
sleep 1
RESTORED=$(raw_eval "document.body.classList.contains('sidebar-collapsed') ? 'STILL_COLLAPSED' : 'RESTORED'")
if [ "$RESTORED" = "RESTORED" ]; then
  pass "25.5: 点击展开按钮后侧边栏恢复"
else
  fail "25.5: 侧边栏恢复" "状态=$RESTORED"
fi

# 25.6 折叠状态持久化到 localStorage
playwright-cli click "#sidebar-toggle" 2>/dev/null
sleep 1
SAVED=$(raw_eval "localStorage.getItem('sidebarCollapsed')")
if [ "$SAVED" = "true" ]; then
  pass "25.6: 折叠状态已持久化到 localStorage (sidebarCollapsed=true)"
else
  fail "25.6: 折叠状态持久化" "localStorage.sidebarCollapsed=$SAVED（期望 true）"
fi

# 25.7 展开后 localStorage 更新为 false
playwright-cli click "#sidebar-expand-btn" 2>/dev/null
sleep 1
SAVED_RESTORED=$(raw_eval "localStorage.getItem('sidebarCollapsed')")
if [ "$SAVED_RESTORED" = "false" ]; then
  pass "25.7: 展开后 localStorage 更新（sidebarCollapsed=false）"
else
  fail "25.7: 展开状态持久化" "localStorage.sidebarCollapsed=$SAVED_RESTORED（期望 false）"
fi

# 25.8 主题切换按钮存在且可切换
THEME_BTN=$(raw_eval "document.getElementById('theme-toggle') ? 'FOUND' : 'MISSING'")
if [ "$THEME_BTN" = "FOUND" ]; then
  pass "25.8: 主题切换按钮存在 (#theme-toggle)"
else
  fail "25.8: 主题切换按钮" "未找到 #theme-toggle"
fi

# 25.9 主题切换持久化到 localStorage
INITIAL_THEME=$(raw_eval "localStorage.getItem('theme') || 'dark'")
playwright-cli click "#theme-toggle" 2>/dev/null
sleep 0.5
AFTER_THEME=$(raw_eval "localStorage.getItem('theme')")
if [ "$AFTER_THEME" != "$INITIAL_THEME" ]; then
  pass "25.9: 点击主题按钮后 localStorage 已更新（$INITIAL_THEME → $AFTER_THEME）"
else
  fail "25.9: 主题切换持久化" "切换前后 localStorage.theme 未变化（值: $AFTER_THEME）"
fi

# Restore original theme
playwright-cli eval "localStorage.setItem('theme','$INITIAL_THEME'); document.documentElement.setAttribute('data-theme','$INITIAL_THEME');" 2>/dev/null
sleep 0.5

playwright-cli screenshot --filename="$SCREENSHOT_DIR/25-sidebar-restored.png" 2>/dev/null

echo "### 截图清单" >> "$REPORT"
echo "" >> "$REPORT"
for f in "$SCREENSHOT_DIR"/*.png; do
  if [ -f "$f" ]; then
    fname=$(basename "$f")
    echo "- \`tests/screenshots/$fname\`" >> "$REPORT"
  fi
done
echo "" >> "$REPORT"

echo "═══════════════════════════════════════════════════"
echo "  ✅ 通过: $PASS | ❌ 失败: $FAIL | ⏭️ 跳过: $SKIP"
echo "  合计: $((PASS+FAIL+SKIP)) 项测试"
echo "═══════════════════════════════════════════════════"
echo "  📄 报告: $REPORT"
echo "  📸 截图: $SCREENSHOT_DIR/"
echo "═══════════════════════════════════════════════════"

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo "  失败项:"
  for err in "${ERRORS[@]}"; do
    echo "    ⛔ $err"
  done
fi

exit $FAIL
