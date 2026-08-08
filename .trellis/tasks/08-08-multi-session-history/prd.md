# PRD: Multi-session Management with History

## Goal

让 bilibili summary 支持**并发多任务运行**与**历史数据保留**：用户可以同时发起多个摘要任务，各自独立运行并展示进度；每次运行成为一条可回看、可切换、可管理的记录，应用重启后历史仍然可用。

## User Value

- 同时处理多个视频摘要，互不阻塞
- 每次运行形成持久历史，随时回看之前的任何一次摘要
- 会话可继续、可管理（删除等）

## Confirmed Facts (from code inspection)

- 每次运行产物已落盘：`{output}/{run_id}/summary_{run_id}.md` / `.html` / `transcript_{run_id}.txt`（`frontend/src/core/workflow/index.ts:224-226`）
- Whisper 音频下载到 `{runDir}/resources/`（`transcribeWithWhisper` 传 `resourcesDir`，workflow 第 3 步），当前无清理逻辑、天然保留；重跑同一视频会重新下载（无复用机制）
- 截图视频也下载到同一 resources 目录（`downloadVideoWithYtdlp`）
- `SummarizeResult` 目前仅存于 React state（`frontend/src/App.tsx:157` `useState<SummarizeResult | null>`），重启即丢失
- 配置持久化走 Tauri plugin-store：`frontend/src/lib/config.ts`（`user-config.json` / key `active`）
- 导航结构：`view: "home" | "settings"`（`App.tsx`），已有侧边栏（新摘要 / 设置）
- 产物文件读写能力已封装：`readTextFile` / `pathIsFile` / `resolveOutputDir`（`frontend/src/lib/tauri.ts`）
- `run_id` 为 UUID v4（`frontend/src/core/workflow/index.ts:28-30`）
- 进度上报机制已存在：`onProgress(stage, detail)`（`frontend/src/core/types.ts` SummarizeDeps），tauri 桥接层用 `summary://progress` 事件路由（`frontend/src/lib/tauri.ts`）

## Requirements

### R1 并发多任务
- 用户可以同时发起多个摘要任务（每次粘贴一个 URL 发起一个任务）
- 各任务独立运行，互不阻塞；UI 能同时展示多个任务的运行状态与进度
- **不设并发上限、不做排队/拒绝**（用户自行管理，本机应用，任务数由用户自己把控）

### R2 历史数据保留
- 每次运行（成功或失败）持久化为一条 session 记录
- 应用重启后历史列表完整可用
- 每条 session 可回看完整结果（markdown / html / transcript）
- session 记录含元数据（标题、URL、时间、模式、状态、run_id、产物路径）

### R3 会话管理
- 历史列表可查看、可切换
- 单条 session 可删除
- **UI：session 平铺展示，不做文件夹/分组**（新摘要/设置固定入口，session 列表平铺）
- **状态指示：列表项前置色点** — 绿色=成功、灰色=运行中、红色=失败/取消
- **重新生成**：历史项提供再次生成入口，用原 URL + 当前配置发起新任务，生成一条新 session（不改动原记录）
- **取消**：运行中的任务可取消；取消后标记 `cancelled`，留在历史中，不删已下载的音频/产物

### R4 产物与音频缓存
- 每条 session 的产物（md/html/transcript）与音频原文件（wav）都保留
- 音频作为缓存：重新对同一视频生成摘要时，优先复用已有音频，避免重复下载（缓存键待设计）

## Acceptance Criteria

- AC1: 可同时发起多个摘要任务，各自独立运行；一个任务的进度/失败不影响其它任务
- AC2: 每次运行（成功/失败/取消）生成一条 session，重启应用后历史列表完整可用
- AC3: 点击历史项可回看完整结果（markdown / html / transcript），无需重新运行
- AC4: session 列表平铺展示，前置色点标识状态（绿=成功、灰=运行中、红=失败/取消）
- AC5: 单条 session 可删除，删除时同步移除产物目录
- AC6: 历史项可“重新生成”：用原 URL + 当前配置发起新任务，产生独立新 session
- AC7: 运行中任务可取消，取消后标记 cancelled 留在历史中，已下载音频保留
- AC8: 同一视频重新生成时复用已有音频缓存，不重复下载

## Out of Scope

- 并发上限控制/任务排队（用户自行管理）
- 历史搜索/过滤/分页（如需要后续迭代）
- 会话分组/文件夹（明确不做）
- 导出/导入历史
- 服务端同步

## Open Questions

1. ✅ (已定) 多并发 + 历史保留
2. ✅ (已定) 并发无上限，不排队不拒绝，用户自行管理
3. ✅ (已定) session 平铺展示，不做文件夹/分组
4. ✅ (已定) 保留策略：无上限，产物/音频全部保留，仅手动删除（删除时同步删产物目录）
5. ✅ (已定) 产物/音频原文件均保留；音频作为缓存复用
6. ✅ (已定) 支持重新生成：复用原 URL + 当前配置，新 session 独立
7. ✅ (已定) 状态指示用前置色点：绿色=成功、灰色=运行中、红色=失败/取消
8. ✅ (已定) 支持取消：取消后标记 cancelled，留在历史中，不删产物
