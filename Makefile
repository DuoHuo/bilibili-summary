# Video Summary — top-level orchestration of the React frontend + Rust backend.
# Default target prints help. All targets are phony.

.DEFAULT_GOAL := help
MAKEFLAGS += --no-print-directory

FRONTEND_DIR  := frontend
BACKEND_DIR   := backend
BACKEND_PORT  ?= 8787
FRONTEND_PORT ?= 5173
VITE_API_BASE ?= http://localhost:$(BACKEND_PORT)

COLOR_CMD   := \033[36m
COLOR_RESET := \033[0m

.PHONY: help install install-frontend install-backend \
        dev dev-frontend dev-backend \
        build build-frontend build-backend \
        run run-frontend run-backend \
        test test-frontend test-backend check \
        clean clean-frontend clean-backend

help: ## Show this help
	@printf "Usage: make $(COLOR_CMD)<target>$(COLOR_RESET) [VAR=value]\n\n"
	@awk 'BEGIN { FS = ":.*##" } \
		/^[a-zA-Z][a-zA-Z0-9_-]*:.*##/ { \
			printf "  %s%-18s%s %s\n", "$(COLOR_CMD)", $$1, "$(COLOR_RESET)", $$2 \
		}' $(MAKEFILE_LIST)

# ── Setup ──

install: install-frontend install-backend ## Install all dependencies

install-frontend: ## pnpm install (frontend)
	cd $(FRONTEND_DIR) && pnpm install

install-backend: ## cargo fetch (backend)
	cd $(BACKEND_DIR) && cargo fetch

# ── Development ──

dev: ## Run frontend + backend in parallel (Ctrl-C stops both)
	@trap 'kill 0' INT TERM EXIT; \
	$(MAKE) -s dev-backend & \
	$(MAKE) -s dev-frontend & \
	wait

dev-frontend: ## Vite dev server on $(FRONTEND_PORT)
	cd $(FRONTEND_DIR) && VITE_API_BASE=$(VITE_API_BASE) pnpm dev

dev-backend: ## cargo run, Axum binds $(BACKEND_PORT)
	cd $(BACKEND_DIR) && OUTPUT_DIR=output cargo run

# ── Production build ──

build: build-backend build-frontend ## Build both for release

build-frontend: ## tsc + vite build into frontend/dist
	cd $(FRONTEND_DIR) && pnpm build

build-backend: ## cargo build --release into backend/target/release
	cd $(BACKEND_DIR) && cargo build --release

# ── Production run (after build) ──

run: run-backend run-frontend ## Run both release artifacts (parallel)

run-frontend: ## vite preview on $(FRONTEND_PORT)
	cd $(FRONTEND_DIR) && pnpm preview --port $(FRONTEND_PORT) --strictPort

run-backend: ## Run backend/target/release/video-summary-backend
	cd $(BACKEND_DIR) && ./target/release/video-summary-backend

# ── Test / Check ──

test: test-backend test-frontend ## Run whatever tests exist (sparse, see AGENTS.md)

test-backend: ## cargo test (currently zero tests)
	cd $(BACKEND_DIR) && cargo test

test-frontend: ## tsc type-check via pnpm build
	cd $(FRONTEND_DIR) && pnpm build

check: ## Fast type-check, no emit (cargo check + tsc --noEmit)
	cd $(BACKEND_DIR) && cargo check
	cd $(FRONTEND_DIR) && npx tsc --noEmit

# ── Clean ──

clean: clean-frontend clean-backend ## Remove all build artifacts

clean-frontend: ## Remove frontend/dist and Vite cache
	rm -rf $(FRONTEND_DIR)/dist $(FRONTEND_DIR)/node_modules/.vite

clean-backend: ## cargo clean
	cd $(BACKEND_DIR) && cargo clean
