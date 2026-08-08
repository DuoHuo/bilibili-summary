# Video Summary — Tauri 2 + TypeScript 桌面应用编排。
# 默认目标打印帮助。所有目标均为 phony。

.DEFAULT_GOAL := help
MAKEFLAGS += --no-print-directory

FRONTEND_DIR := frontend
TAURI_CLI    := $(FRONTEND_DIR)/node_modules/.bin/tauri

COLOR_CMD   := \033[36m
COLOR_RESET := \033[0m

.PHONY: help install install-frontend \
        dev build \
        test test-frontend check \
        fetch-binaries \
        clean clean-frontend

help: ## Show this help
	@printf "Usage: make $(COLOR_CMD)<target>$(COLOR_RESET) [VAR=value]\n\n"
	@awk 'BEGIN { FS = ":.*##" } \
		/^[a-zA-Z][a-zA-Z0-9_-]*:.*##/ { \
			printf "  %s%-18s%s %s\n", "$(COLOR_CMD)", $$1, "$(COLOR_RESET)", $$2 \
		}' $(MAKEFILE_LIST)

# ── Setup ──

install: install-frontend ## Install all dependencies
install-frontend: ## pnpm install (frontend)
	cd $(FRONTEND_DIR) && pnpm install

# ── Development ──

dev: ## Run Tauri dev (opens desktop window)
	cd $(FRONTEND_DIR) && pnpm tauri dev

# ── Production build ──

build: ## tsc + vite build + tauri bundle (native installers)
	cd $(FRONTEND_DIR) && pnpm tauri build

# ── Test / Check ──

test: test-frontend ## Run frontend unit tests (vitest)
test-frontend: ## vitest run
	cd $(FRONTEND_DIR) && pnpm test

check: ## Fast type-check + rust check (tsc --noEmit + cargo check)
	cd $(FRONTEND_DIR) && npx tsc --noEmit
	cd src-tauri && cargo check

# ── External binaries (打包前调用) ──

fetch-binaries: ## 拉取 yt-dlp / ffmpeg / whisper-cli 为 Tauri sidecar
	bash scripts/fetch-binaries.sh

# ── Clean ──

clean: clean-frontend ## Remove frontend build artifacts
clean-frontend: ## Remove frontend/dist and Vite cache
	rm -rf $(FRONTEND_DIR)/dist $(FRONTEND_DIR)/node_modules/.vite
