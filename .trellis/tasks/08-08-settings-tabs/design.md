# Design: 设置页 Tabs 分区重构

## 架构

```
SettingsView（组件保持不变，内部重构）
├── Tabs.Root（defaultValue: initialTab ?? "account"）
│   ├── TabsList: 账号 | 模型 | 内容处理
│   ├── TabsContent[account]     → Section「B 站账号」：登录区块（现有）+ Cookie 手动输入（迁移）
│   ├── TabsContent[model]       → Section「AI」：apiKey / baseUrl / model（现「AI」区块原样）
│   └── TabsContent[processing]  → Section「转写与生成」：Whisper 语言 + 截图标注（拆出）
```

- 边界不变：`SettingsView` props 仍为 `config / onChange / profile / onLogin / onLogout`，**新增可选 `initialTab`**
- 登录弹窗/退出逻辑全部在 App.tsx，设置页只转发回调
- 数据模型 `UserConfig` 不动；`onChange` 局部 patch 语义不变

## 关键决策

| 决策 | 内容 | 理由 |
|---|---|---|
| 导航形态 | Tabs（@radix-ui/react-tabs 现成） | 零新依赖，设置跨域清晰 |
| Cookie 归位 | 「账号」Tab | 用户确认；与登录态同属账号身份 |
| Tab 顺序 | 账号 / 模型 / 内容处理 | 账号为入口，模型为高频配置 |
| initialTab | `SettingsView` 可选 prop，App 跳设置传 "model" | 保留现有"未填 API Key 引导"行为 |
| 内部结构 | 各 Tab 内复用现有 `Section` 原语 | 视觉一致，最小改动 |

## 组件结构调整

- `settings-panel.tsx`：外层包 `<Tabs>`，三个 `<TabsContent>`；原「登录」Section 保留在 account Tab（说明文案微调：Cookie 归位后提示"登录后自动填充，也可手动粘贴"）；「AI」Section 迁入 model Tab（标题不变）；「字幕抓取」Section 拆分为：Cookie 输入 → account Tab，Whisper 语言 + 截图标注 → processing Tab
- `App.tsx`：`handleSubmit` 未填 API Key 分支改为 `setView("settings")` + `setSettingsTab("model")`（新增 state 或直接传给 SettingsView）；需在退出设置视图时重置？——不重置（保持上次 Tab 位置，体验更好）

## 状态管理

- Tab 激活状态：`SettingsView` 内部 `useState`（`defaultValue` 用 initialTab）
- App 侧若需"跳设置定位 Tab"：App 持有 `settingsInitialTab` state，`setView("settings")` 时设置；SettingsView 通过 `key={settingsInitialTab}` 或受控 `value` 应用——**推荐非受控 + initialTab + key 强制重挂载**（简单，避免双写状态源）

## 兼容性

- 不触碰 `UserConfig` 结构 / `isUserConfig` guard
- 不触碰登录链路（LoginDialog、biliAuth、core/auth）
- 不触碰 multi-session（sessions、workflow）
- 纯 UI 层重组，回滚 = 还原 settings-panel 与 App 的 3 处改动

## 风险

| 项 | 说明 |
|---|---|
| 未填 API Key 引导 | initialTab 机制确保落在「模型」Tab |
| Tab 状态丢失 | 切视图（settings→home→settings）时 SettingsView 重挂载回默认 Tab；若需保持，后续用 App state 提升（本期不做，YAGNI） |
| Cookie 语义变化 | Cookie 从「字幕抓取」移到「账号」，手动粘贴行为不变（config.cookie 同一字段） |
