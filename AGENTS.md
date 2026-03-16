# SiriusX Summary - Agent Development Guide

## Project Overview

**SiriusX Summary** 是一个前后端可部署的摘要应用，前端采用 React + Vite，后端采用 Rust + Axum。

- **Frontend**: React + Vite
- **Backend**: Rust + Axum
- **Package Manager**: pnpm

## Build Commands

```bash
# Install dependencies
pnpm install

# Development - starts dev server with hot reload
pnpm dev

# Build production version
pnpm build
```

## Project Structure

```
frontend/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   └── style.css
└── index.html

backend/
├── src/
│   ├── main.rs
│   ├── summarize.rs
│   ├── services.rs
│   └── utils.rs
└── Cargo.toml
```

## Code Style Guidelines

### TypeScript

- **Strict mode**: Enabled
- **No semicolons**: Use ASI (Automatic Semicolon Insertion)
- **Double quotes**: For strings
- **No trailing commas**
- **2-space indentation**

### Imports

Sorted by `@ianvs/prettier-plugin-sort-imports`:

1. Node.js built-in modules
2. Third-party modules
3. `@plasmo/*` packages
4. `@plasmohq/*` packages
5. `~/*` project imports (path alias for root)
6. Relative imports `./` and `../`

Example:
```typescript
import { useEffect, useState } from "react"
```

## Harness 对齐

- Harness 记录目录：`docs/harness/records/`
- 任务收尾提醒（Harness 同步）：完成改动后执行 `harness-doc-sync`
