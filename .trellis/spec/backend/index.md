# Backend Development Guidelines — 已废弃 (DEPRECATED)

> ⚠️ **本层已废弃**：2026-08 完成 Tauri 迁移后，Rust/Axum 后端（`backend/`）已被移除。
> 业务逻辑全部迁移到 `frontend/src/core/`（TypeScript），系统能力由 `src-tauri/`（Tauri 2 Rust 壳）提供。

---

## 迁移后的对应关系

| 旧 backend（Rust + Axum） | 新位置 |
|---|---|
| `services.rs`（平台/字幕/Whisper/LLM） | `frontend/src/core/`（platform/subtitle/whisper/llm） |
| `summarize.rs`（PocketFlow 工作流 + HTML 渲染） | `frontend/src/core/workflow/` + `render/` |
| `utils.rs`（时间戳/XML 解析） | `frontend/src/core/transcript/` + `subtitle/parse.ts` |
| `main.rs`（Axum HTTP 服务） | `src-tauri/`（Tauri 2 壳，无 HTTP 服务） |

## 新规范入口

- TS 核心层约定：`frontend` 层 spec（component / hook / state / type-safety）
- Tauri 壳约定：见 `src-tauri/src/commands.rs`（命令边界：run_external / save_file / 模型 / 产物目录）
- 依赖注入契约：`frontend/src/core/types.ts` 的 `SummarizeDeps`

---

**Language**: 本目录文档沿用既有中文注释风格。
