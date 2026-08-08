# Implement: 结果 Tab 懒生成

## 有序检查清单

### 1. core 层：workflow 拆分（core/workflow/index.ts）
- [ ] 拆 `prepareTranscript(input, deps)`：detect → subtitle/whisper → 返回 `{ title, transcript }`；落盘 `transcript_{runId}.txt`
- [ ] 拆 `generateMode(input, deps)`：build_prompt → call_llm → timestamp 对齐/合并 → render → 落盘 `{runId}/{mode}.md` / `.html`；screenshot 逻辑迁入
- [ ] 删除 `runSummarize`（确认无残留引用后）
- [ ] `core/types.ts`：`SummarizeRequest` 拆为 PrepareRequest / GenerateModeRequest（或复用字段）；`Stage` 复用

### 2. 桥接层（lib/api.ts）
- [ ] `prepareTranscript` / `generateMode` 的 Tauri deps 注入（ensureDir 已在）
- [ ] 删除 postSummarize 旧入口（或保留兼容 shim）

### 3. 会话模型（lib/sessions.ts）
- [ ] `ModeStatus` / `ModeEntry` / `SessionMeta` 重构（modes 记录）
- [ ] `isSessionMeta` 更新 + 旧记录迁移（legacy mode → modes 快照）
- [ ] `useSessionManager`：
  - `start(url)` → 创建 preparing session → `prepareTranscript` → ready
  - `generate(runId, mode)` → 标记 running → `generateMode` → done；错误 → error
  - `cancelMode(runId, mode)` → killExternal(`${runId}:${mode}`) + 标记
  - `cancel(runId)` → 整体（prepare 中）
  - 产物读取：`readModeOutput(session, mode)`（`{mode}.md` fallback `summary_{id}.md`）
- [ ] sessions.json 持久化不变

### 4. 进程 id（core/types.ts + lib/tauri.ts）
- [ ] `SummarizeDeps.runner` 的 `id`：generateMode 传 `${runId}:${mode}`（scopedDeps 包装在 generateMode 内完成）
- [ ] 进度事件路由：`summary://progress` 按复合 id 过滤（tauriRunner 已按 id 匹配）

### 5. UI
- [ ] 新组件 `components/mode-result-tabs.tsx`：4 Tab + pending/running/done/error 状态渲染；`onGenerate(mode)` / `onCancel(mode)` / `onEditCustom` props
- [ ] `ResultPanel` 微调（props 兼容）
- [ ] `App.tsx`：首页移除 MODE_CARDS；提交 → start(url)；结果区换 ModeResultTabs；preparing 进度展示；自定义模板弹窗接线
- [ ] `settings-panel` 不动

### 6. 验证
- [ ] `pnpm --filter ./frontend test`（更新 workflow/sessions 相关测试：prepare/generate 拆分、guard 迁移）
- [ ] `pnpm --filter ./frontend check`
- [ ] 手工 QA：提交 URL → prepare → 4 Tab 懒生成 → 取消单模式 → 重启恢复 → 旧 session 回看

## 验证命令

```bash
pnpm --filter ./frontend test
pnpm --filter ./frontend check
```

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚 |
|---|---|---|
| `core/workflow/index.ts` | 流水线拆分，最大改动 | 保留 runSummarize 快照分支 |
| `lib/sessions.ts` | SessionMeta 重构 + guard 迁移 | guard 兼容旧结构，字段可选 |
| `App.tsx` | 状态机重构（activeResult → modes） | ModeResultTabs 纯新增，App 可回退 |
| `components/mode-result-tabs.tsx` | 新组件 | 直接删除 |

## start 前检查

- [x] prd.md（懒生成语义 + 4 Tab 已确认）
- [x] design.md / implement.md
- [ ] jsonl 清单
- [ ] 最终规划总结已呈现，用户批准
