# 结果 Tab 懒生成：字幕共享 + 多模式产物

## Goal

**字幕/转录只做一次**（下载字幕或 Whisper 转写），UI 改为 **Tab 模式**：同一任务内四种模式（摘要/全文/时间戳/自定义）**全部由用户点击懒生成**，点哪个 Tab 才生成哪个，**不新建 session**。

## User Value

- 一次抓取字幕，多模式复用——不用为每种模式重复下载/转写
- 四种模式都基于**同一份字幕**演化，用户按需点击生成，不浪费 token
- 同一 URL 的多模式产物在同一任务下组织，侧边栏不刷屏

## Confirmed Facts（代码证据）

### 当前模型
- `SessionMeta`（`lib/sessions.ts`）：单 `mode` + 单 `status`——一个 session 只绑定一种模式
- 产物落盘：`{runDir}/summary_{runId}.md` / `.html` / `transcript_{runId}.txt`（`workflow/index.ts:235-237`）
- `ResultPanel`：接收单 `result` + 单 `mode`；内部 Tabs（正文/HTML/字幕）

### 流水线现状
- `runSummarize`（`core/workflow/index.ts`）一次跑完整链路：detect → fetch_subtitle → [whisper] → build_prompt → llm → render
- 阶段进度 `onProgress(stage)`；子进程 `run_external` 带 `id`（run_id）供 kill/进度路由
- `useSessionManager`（`lib/sessions.ts`）+ sessions.json 持久化

### 前端
- `App.tsx`：`activeRunId` + `activeSession` + `readSessionOutput`；`handleSubmit` → `start(url)` 新建 session
- 首页 hero：UrlForm（输入+生成同行）+ 4 张模式卡片（选择后生成）

## Requirements

- [ ] R1：同一 session 支持四模式产物，每模式独立生成状态（未生成/生成中/已完成）
- [ ] R2：**字幕/转录只做一次**：提交 URL 后立即准备字幕（detect → subtitle/whisper），落盘共享 transcript
- [ ] R3：结果区 4 Tab（摘要/全文/时间戳/自定义），**全部懒生成**：点未生成 Tab 才生成该模式（llm + render），点已完成 Tab 直接读盘展示
- [ ] R4：生成中的模式可取消，不影响已完成的模式；字幕/转录保留
- [ ] R5：旧 session（单模式单文件 `summary_{runId}.md`）兼容回看
- [ ] R6：自定义 Tab：未保存模板先弹编辑框 → 保存后生成；有模板直接生成
- [ ] R7：首页移除模式卡片预选（不再生成前选模式），提交 URL 直接进入任务
- [ ] R8：**模式重新生成复用同一 session**：已完成 Tab 提供「重新生成」，覆盖该模式产物（不新建 session）
- [ ] R9：侧边栏移除「再次生成」按钮（多模式后语义不清，模式级重新生成在 Tab 内提供）
- [ ] R10：**状态文案动态化**：不硬编码「生成摘要」——preparing 阶段显示「正在抓取字幕/正在本地转写」等阶段文案，模式生成显示「正在生成{模式}」；侧边栏与结果区共用同一映射
- [ ] R11：**重新生成可选数据源**：重新生成按钮改为下拉（由字幕生成 / 由音频生成）；无字幕视频（transcript_source=whisper）时「由字幕生成」置灰

## Acceptance Criteria

- [ ] AC1：提交 URL → 任务创建 → 字幕准备中（进度可见）→ 准备完成结果页 4 Tab 就绪
- [ ] AC2：点「全文」生成全文（不重新抓字幕）；点「时间戳」「自定义」同理，各自独立
- [ ] AC3：已生成 Tab 点击秒开（读盘），未生成 Tab 显示生成入口
- [ ] AC4：取消某模式生成，其他已完成模式不受影响
- [ ] AC5：重启后各 Tab 状态恢复（已完成读盘、未完成可继续）
- [ ] AC6：旧 session 点击回看正常（按摘要模式展示）

## Out of Scope

- 不改字幕抓取 / Whisper 转写逻辑（仅拆分复用）
- 不做"重新抓字幕"手动刷新（本期）
- 不做多 URL 批量

## 设计决策（详见 design.md）

- **懒生成语义**：提交 URL → prepare（字幕，只一次）→ 4 Tab 全懒生成（用户点击触发 llm+render）
- **产物文件**：`{runDir}/{mode}.md/.html`（每模式独立文件），transcript 共享 `transcript_{runId}.txt`；旧 `summary_{runId}.md` 兼容读取
- **自定义 Tab**：第四个 Tab（用户确认 4 个），模板编辑复用 CustomPromptDialog
- **重新生成**：Tab 内 done 态提供「重新生成」（同 session 覆盖该模式产物）；侧边栏「再次生成」移除
