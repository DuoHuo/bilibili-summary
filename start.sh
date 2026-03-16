#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ 缺少命令: $cmd"
    exit 1
  fi
}

require_cmd pnpm
require_cmd cargo

if [ ! -d "$FRONTEND_DIR" ]; then
  echo "❌ 未找到 frontend 目录: $FRONTEND_DIR"
  exit 1
fi

if [ ! -d "$BACKEND_DIR" ]; then
  echo "❌ 未找到 backend 目录: $BACKEND_DIR"
  exit 1
fi

echo "✅ 安装前端依赖"
(
  cd "$FRONTEND_DIR"
  pnpm install
)

echo "✅ 构建后端依赖"
(
  cd "$BACKEND_DIR"
  cargo build
)

echo "✅ 启动后端服务"
(
  cd "$BACKEND_DIR"
  cargo run
) &
BACKEND_PID=$!

cleanup() {
  echo "⚠️ 正在停止后端服务 (pid=$BACKEND_PID)"
  kill "$BACKEND_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "✅ 启动前端开发服务器"
(
  cd "$FRONTEND_DIR"
  pnpm dev
)
