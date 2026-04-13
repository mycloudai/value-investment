#!/bin/bash
# ─────────────────────────────────────────────────────────
#  MyCloudAI 价值投资 — 本地开发启动脚本
#  用法: ./start-local.sh [port]
#  默认端口: 8788
# ─────────────────────────────────────────────────────────

set -e

PORT=${1:-8788}
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   MyCloudAI 价值投资 · 本地启动              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. 检查 Node.js ──────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "❌ 未找到 node，请先安装 Node.js"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# ── 2. 安装依赖（如果需要）──────────────────────────────
if [ ! -d "$ROOT/node_modules" ]; then
  echo "📦 安装依赖..."
  npm install --prefix "$ROOT"
fi

# ── 3. 构建项目 ──────────────────────────────────────────
echo ""
echo "🔨 构建中..."
cd "$ROOT"
node build.mjs
echo "✅ 构建完成"

# ── 4. 启动本地服务器 ────────────────────────────────────
echo ""
echo "🚀 启动本地服务器 → http://localhost:$PORT"
echo "   按 Ctrl+C 停止"
echo ""

# 优先使用 wrangler（支持 Pages Functions / API 路由）
if command -v wrangler &>/dev/null; then
  echo "📡 使用 wrangler pages dev（支持 /api/* Functions）"
  echo "   ⚠️  AI 对话功能需要本地配置 API Key（在页面设置中填入）"
  echo ""
  wrangler pages dev "$ROOT/site" --port="$PORT"

elif npx --no-install wrangler version &>/dev/null 2>&1; then
  echo "📡 使用 npx wrangler pages dev（支持 /api/* Functions）"
  echo ""
  npx wrangler pages dev "$ROOT/site" --port="$PORT"

else
  echo "⚠️  未找到 wrangler，使用内置 SPA 服务器（tests/serve.mjs）"
  echo "   注意：/api/chat 接口不可用，AI 对话功能将无法测试"
  echo "   安装 wrangler: npm install -g wrangler"
  echo ""
  PORT=$PORT node "$ROOT/tests/serve.mjs"
fi
