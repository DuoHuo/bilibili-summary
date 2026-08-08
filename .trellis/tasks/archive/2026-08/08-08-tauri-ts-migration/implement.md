# Tauri 2 + TypeScript 单栈 GUI 迁移 — 实施计划

## 阶段总览

| 阶段 | 目标 | 交付物 |
|---|---|---|
| P0 | 基线建立 | fixture 样本、vitest 脚手架、Tauri 2 项目骨架、双栈并存 |
| P1 | TS 核心层 | `src/core/` 全部模块 + 单元测试 |
| P2 | Tauri 集成 | Rust 壳 commands、plugins、sidecar 解析、进度事件 |
| P3 | 前端改造 | lib 层替换、App.tsx 接入 workflow、设置持久化迁移 |
| P4 | 打包 / CD | 三平台构建、sidecar 二进制分发脚本 |
| P5 | 清理收尾 | 移除 backend/、更新 Makefile/README、spec 更新 |

每个阶段独立 commit，可单独 revert。

---

## P0 — 基线建立

**P0.1 提取 fixture 样本**
- 从真实调用（或手工构造）收集：B站 `view` API JSON、B站字幕 JSON、YouTube timedtext XML、B站/YouTube 页面 HTML（og:title）、LLM 响应 JSON、`render_markdown_html` 产物 HTML。
- 存 `frontend/src/core/__fixtures__/`。
- **对照基准**：运行现有 Rust 后端（`make dev`）对每个样本跑一遍，把输出（markdown / html / segments）落盘为 golden 文件。

**P0.2 测试脚手架**
- `frontend` 引入 `vitest`；`package.json` 加 `"test": "vitest run"`。
- 验证：`pnpm test` 空跑通过。

**P0.3 Tauri 2 项目骨架**
- `pnpm create tauri-app` 或手动初始化 `src-tauri/`（Tauri 2.x）。
- 配置 `tauri.conf.json`：identifier、窗口尺寸、`withGlobalTauri` 关闭（用 npm 包）、CSP（允许 connect-src 到第三方 API 域名 + plugin-http）。
- 引入 plugins：`tauri-plugin-http`、`tauri-plugin-store`、`tauri-plugin-dialog`、`tauri-plugin-opener`、`tauri-plugin-shell`（或自研 command 替代 shell）。
- 验证：`pnpm tauri dev` 打开窗口显示现有前端。

**P0.4 双栈并存确认**
- 现有 web 版仍可跑（`make dev`），作为行为对照基准，直到 P5 移除。

---

## P1 — TS 核心层（`frontend/src/core/`）

顺序按依赖：类型 → 纯函数 → 网络模块 → 编排。

**P1.1 类型与契约**
- `core/types.ts`：`Platform`、`Transcript`、`TranscriptSegment`、`TranscriptSource`、`SummarizeRequest`、`SummarizeResult`、`SummarizeError`（复用/扩展 `lib/types.ts`）。
- 测试：类型编译（`tsc --noEmit`）。

**P1.2 纯逻辑模块（无网络，先行）**
- `platform/parse.ts`：`parseBilibiliId` / `parseYoutubeId`（BV 段 / watch / shorts / youtu.be）。
- `transcript/merge.ts`：`mergeTranscriptSegments`（15s 阈值贪心）。
- `transcript/format.ts`：`formatTranscriptWithTimestamps`。
- `subtitle/parse.ts`：YouTube timedtext XML 解析（移植 quick-xml 逻辑）。
- `render/markdown.ts`：`buildOutputMarkdown` / `stripMarkdownTitle`。
- `render/markers.ts`：`extractScreenshotMarkers`。
- `llm/prompt.ts`：四模式模板构建（复用 `lib/prompts.ts` 常量）。
- 测试：每个模块 vitest 用例 + fixture 对照 golden。

**P1.3 网络模块（依赖注入 HTTP client）**
- `platform/detect.ts`：host 判断。
- `subtitle/bilibili.ts`：view API → title/cid；字幕 API（cookie、UA/Referer）。
- `subtitle/youtube.ts`：og:title + timedtext（语言选择）。
- `llm/client.ts`：`callLlm` + `resolveEndpoint`（base_url 解析、默认 gpt-4o-mini）。
- 测试：mock HTTP client（返回 fixture JSON/XML），断言解析结果与 golden 一致。

**P1.4 子进程编排模块（依赖注入 runner）**
- `whisper/audio.ts`：`buildWhisperAudioName` + yt-dlp 下载参数。
- `whisper/cookies.ts`：cookie 串 → Netscape 临时文件 / 文件路径。
- `whisper/model.ts`：模型路径解析（委托 Rust command）。
- `whisper/index.ts`：`transcribeWithWhisper`（yt-dlp → ffmpeg → whisper-cli → segments）。
- `render/screenshots.ts`：截图标记 → ffmpeg 截图。
- 测试：fake runner 注入，断言命令序列与参数。

**P1.5 工作流编排**
- `workflow/index.ts`：`runSummarize(input, deps)` 状态机（detect → fetch_subtitle → [whisper] → build_prompt → llm → render → done），`deps.onProgress` 上报阶段。
- 测试：全链路 fake deps 端到端跑通（字幕路径 + whisper 路径两条）。

**P1.6 回归对照**
- 用 golden 文件对每条路径的输出做断言：markdown / html 与 Rust 版一致（HTML 渲染在 P1.7）。
- 验证：`pnpm test` 全绿。

**P1.7 HTML 渲染**
- `render/html.ts`：引入 `marked`，移植「东方简约信纸」模板，与 golden HTML 逐字节对照；差异落在允许白名单（如字体 URL、时间戳格式）则记录到 `core/render/README.md`，否则修正。

---

## P2 — Tauri 集成（`src-tauri/`）

**P2.1 Rust 壳 commands**
- `run_external`：spawn 外部二进制（sidecar 解析 → PATH 回退），stdout 逐行 event 回传，返回 exit_code/stdout/stderr。
- `ensure_whisper_model`：定位 / 下载 ggml-base.bin 到 app data 模型目录。
- `save_file`：原生另存为 + 写入内容。
- `resolve_output_dir`：app data `output/{run_id}/` 定位与创建。
- 验证：`cargo check` + 从前端 invoke 冒烟。

**P2.2 进度事件**
- Rust → JS：`summary://progress`（stage/detail/percent）。
- 测试：前端收到 yt-dlp 下载进度行事件。

**P2.3 sidecar 解析**
- `run_external` 内实现：`tauri::process::Command` sidecar（若资源存在）→ PATH 查找。
- 验证：`which yt-dlp` 路径可用；打包后 sidecar 路径可用。

**P2.4 plugins 接线**
- http / store / dialog / opener 在 `tauri::Builder` 注册，权限配置写入 `capabilities/`。

---

## P3 — 前端改造

**P3.1 桥接层 `lib/tauri.ts`**
- `httpFetch`（plugin-http 封装，API 与 `fetch` 兼容）、`invokeExternal`、`onProgress`、`saveFile`、`resolveOutputDir`。

**P3.2 替换 `lib/api.ts`**
- `postSummarize` → 组装 deps（httpFetch + runExternal + onProgress）调用 `runSummarize`。
- `SummarizeError` 语义保留（message / responseText）。

**P3.3 替换 `lib/config.ts`**
- IndexedDB → plugin-store；保留 `UserConfig` 校验与 `transcript → timestamp` 迁移。
- App.tsx `loadConfig` / `saveConfig` 调用点同步更新。

**P3.4 App.tsx 接入**
- 结果区「下载」→ `save_file`；「直链」→ 打开产物目录。
- 进度事件 → UI 阶段提示（保留现有 loading 阻塞，可后续增强进度条，YAGNI）。
- 验证：`pnpm tauri dev` 全流程（B站字幕路径 + YouTube 路径）。

**P3.5 配置迁移**
- 首次启动检测旧 IndexedDB 配置（可选，若同机升级）；或直接全新存储（当前用户少，倾向直接迁移 store，低风险）。

---

## P4 — 打包 / CD（GitHub Actions）

**P4.1 CI workflow（`.github/workflows/ci.yml`）**
- 触发：push + pull_request；matrix：ubuntu / macos / windows。
- Steps：pnpm install → `pnpm test` → `pnpm build` → `cargo check`（src-tauri）。
- 验证：三平台 CI 绿（tsc + vitest + vite + cargo check 全部通过）。

**P4.2 sidecar 二进制分发脚本（`scripts/fetch-binaries.sh`）**
- 单一脚本，本地打包与 CI 共用（DRY）；按 target-triple 下载并重命名到 `src-tauri/binaries/`；幂等（已存在跳过）。
- 来源验证点：yt-dlp latest release / BtbN FFmpeg-Builds / whisper.cpp releases（确认 `whisper-bin-{arch}.zip` 三平台命名）。
- 验证：本机跑脚本后 `ls src-tauri/binaries/` 出现 `{name}-{target-triple}` 文件。

**P4.3 CD workflow（`.github/workflows/release.yml`）**
- 触发：tag（`v*`）+ workflow_dispatch。
- Matrix：ubuntu（x64）/ windows（x64）/ macos（x64 + arm64 双 target）。
- Steps：setup → fetch-binaries → `tauri-apps/tauri-action`（build + GitHub Release 上传安装包）→ artifacts 上传。
- 验证：本地 tag 推送后 Release 出现三平台安装包；或手动 workflow_dispatch 触发验证。

**P4.4 三平台构建验证**
- `pnpm tauri build`（对应平台）产物包含 sidecar，`run_external` 能解析。
- 安装包冒烟：安装后启动、字幕路径可用。

**P4.5 发布检查**
- Release 产物列表完整（各平台安装包 + sidecar）；体积记录；签名（延后，记录到 README 发布清单）。

---

## P5 — 清理收尾

- 移除 `backend/`（A6：Rust 业务逻辑全部移除；git 历史保留可回滚）。
- 更新根 `Makefile` / `start.sh` / `README.md`（Tauri 命令、依赖准备、环境变量说明）。
- `.trellis/spec/backend/` 标记废弃或改写为「Tauri 壳规范」；`frontend` spec 增补 core 层约定。
- 记录 harness 变更到 `docs/harness/records/`。

---

## 验证命令清单

```bash
# P0/P1
cd frontend && pnpm test                # vitest 全绿
cd frontend && pnpm build               # tsc + vite build 通过
# P2
cd src-tauri && cargo check
# P3/P4
pnpm tauri dev                          # 全流程冒烟
pnpm tauri build                        # 三平台打包（对应平台）
# P4 额外
bash scripts/fetch-binaries.sh           # 拉取 sidecar 二进制（本地复现 CI）
gh workflow run release.yml             # 手动触发 CD（可选）
# 回归对照（P5 前保留）
make dev                                # 旧 web 版对照基准
```

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚策略 |
|---|---|---|
| `backend/src/services.rs` | 核心逻辑迁移源 | fixture 化后，P5 才删除 |
| `backend/src/summarize.rs` | HTML 模板 / 工作流 | golden 对照，逐字节验证 |
| `frontend/src/lib/api.ts` | 替换点 | P3.2 单 commit，可 revert |
| `frontend/src/lib/config.ts` | 存储迁移 | P3.3 单 commit，可 revert |
| `src-tauri/` | 新增，无既有冲突 | 全新增，无回滚负担 |

## `task.py start` 前检查

- [ ] P0-P5 顺序清晰，依赖无环
- [ ] fixture / golden 已明确收集方式（P0.1）
- [ ] whisper.cpp release URL 验证点列入 P4.2
- [ ] GitHub Actions（ci.yml / release.yml / fetch-binaries.sh）已列入 P4
- [ ] 未承诺超出 PRD 范围的功能
- [ ] sub-agent 模式则填充 implement.jsonl / check.jsonl
