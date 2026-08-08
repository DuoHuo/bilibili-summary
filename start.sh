#!/usr/bin/env bash
# start.sh — 启动 Tauri 桌面应用（等价 make dev）。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ 缺少命令: $cmd"
    exit 1
  fi
}

require_cmd pnpm

if [ ! -d "$FRONTEND_DIR" ]; then
  echo "❌ 未找到 frontend 目录: $FRONTEND_DIR"
  exit 1
fi

if [ ! -f "$FRONTEND_DIR/node_modules/.bin/tauri" ]; then
  echo "ℹ️  未找到 tauri CLI，先安装依赖…"
  (cd "$FRONTEND_DIR" && pnpm install)
fi

echo "✅ 启动 Tauri 桌面应用（首次编译 Rust 壳可能需要几分钟）"
(
  cd "$FRONTEND_DIR"
  pnpm tauri dev
)
