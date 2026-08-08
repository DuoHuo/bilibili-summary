#!/usr/bin/env bash
# start.sh — 启动 Tauri 桌面应用（等价 pnpm dev）。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ 缺少命令: $cmd"
    exit 1
  fi
}

require_cmd pnpm

if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  echo "ℹ️  未安装依赖，先执行 pnpm install…"
  (cd "$ROOT_DIR" && pnpm install)
fi

echo "✅ 启动 Tauri 桌面应用（首次编译 Rust 壳可能需要几分钟）"
(
  cd "$ROOT_DIR"
  pnpm dev
)
