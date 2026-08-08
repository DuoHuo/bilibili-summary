# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

Frontend 包含两层：**UI 组件层**（React + shadcn/ui，`src/components`、`src/lib`）与 **TS 核心层**（纯业务逻辑，`src/core`）。核心层经 Tauri 迁移后替代原 Rust 后端，见 [Core Layer Guidelines](./core-guidelines.md)。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Core Layer](./core-guidelines.md) | TS 核心层约定（依赖注入 / 分层 / 测试） | Filled |
| [Design Tokens](./design-tokens.md) | 深色 macOS 玻璃主题 token / 玻璃原语 / 布局壳约定 | Filled |
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | To fill |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, global state, server state | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
