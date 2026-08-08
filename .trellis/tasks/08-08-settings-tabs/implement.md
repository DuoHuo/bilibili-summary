# Implement: 设置页 Tabs 分区重构

## 有序检查清单

1. **settings-panel.tsx**（主体重构）
   - import 增加 `Tabs/TabsList/TabsTrigger/TabsContent`（`@/components/ui/tabs`）
   - `SettingsViewProps` 新增 `initialTab?: "account" | "model" | "processing"`
   - 外层 `<div>` 内改为 `<Tabs defaultValue={initialTab ?? "account"}>` + `<TabsList>`（账号/模型/内容处理）+ 三个 `<TabsContent>`
   - **account Tab**：`Section「B 站账号」`（现登录 Section 内容 + 说明文案微调）+ `Section「Cookie」`（从字幕抓取迁入，Label/Textarea/说明原文保留）
   - **model Tab**：`Section「AI」`（现 AI 区块原样：apiKey/baseUrl/model）
   - **processing Tab**：`Section「转写与生成」`（Whisper 语言 + 截图标注，ToggleRow 原样）
   - 清理不再使用的 import（如 Globe、Camera、Languages 按实际保留；Cookie 图标移到 account）
2. **App.tsx**（引导定位）
   - 新增 state：`const [settingsInitialTab, setSettingsInitialTab] = useState<"account" | "model" | "processing">("account")`
   - `handleSubmit` 未填 API Key 分支：`setSettingsInitialTab("model"); setView("settings")`
   - `SettingsView` 传 `key={settingsInitialTab}`（强制重挂载应用 initialTab）+ `initialTab={settingsInitialTab}`
3. **验证**：`pnpm --filter ./frontend test` + `pnpm --filter ./frontend check`
4. **手工 QA**：`pnpm dev` → 设置页三 Tab 切换 → 未填 API Key 提交跳模型 Tab → 登录/退出正常 → Cookie 手动粘贴生效 → Whisper/截图开关正常

## 验证命令

```bash
pnpm --filter ./frontend test
pnpm --filter ./frontend check
```

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚 |
|---|---|---|
| `settings-panel.tsx` | 主体重构，改动最大 | git 还原该文件即可（提交后工作区干净） |
| `App.tsx` | 仅加 state + 2 处传参 | 删除 settingsInitialTab 相关 3 处 |

## start 前检查

- [x] prd.md（用户已确认方向 + Cookie 决策）
- [x] design.md / implement.md
- [ ] 最终规划总结已呈现，用户明确批准
