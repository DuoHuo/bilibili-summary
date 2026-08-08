# 设置页重构：Tabs 分区导航

## Goal

将设置页从「三个平铺 Section」重构为 **Tabs 分区导航**（账号 / 模型 / 内容处理），解决区块职责混杂与 Cookie 概念重复问题，并为未来设置项增长留出扩展空间。

## User Value

- 设置项按关注域分组，找配置不再需要滚动整页
- Cookie 归位「账号」Tab，消除"登录自动填充"与"手动输入"两处重复概念
- 未来新增设置（输出、代理等）有清晰的归属位置

## Confirmed Facts（代码证据）

### 当前结构
- `frontend/src/components/settings-panel.tsx`：三个平铺 `Section`——「登录」（profile/onLogin/onLogout）、「AI」（apiKey/baseUrl/model）、「字幕抓取」（Cookie + Whisper 语言 + 截图标注混杂）
- props：`config / onChange / profile / onLogin / onLogout`
- 设置自动保存：`App.tsx` 的 `patchConfig` + `saveConfig` effect

### 现成组件与依赖
- **Tabs 组件已存在**：`frontend/src/components/ui/tabs.tsx`（@radix-ui/react-tabs，`Tabs/TabsList/TabsTrigger/TabsContent`）——零新依赖
- 现有 `Section` 布局原语可复用为各 Tab 内部结构
- 图标库 lucide 已有 `UserRound / Sparkles / Globe / Camera / Languages / Cookie / LogOut`

### 现有交互约束
- `App.tsx` `handleSubmit`：未填 API Key 时 `setView("settings")`（仅切视图，无 Tab 定位）——重构后若默认 Tab 非「模型」，用户会找不到 API Key 输入
- 登录弹窗由 `App.tsx` 持有（`loginOpen`），设置页只接收 `onLogin` 回调——重构不改变该边界

## Requirements

- [ ] R1：设置页改为 Tabs 分区导航，三个 Tab：「账号」「模型」「内容处理」
- [ ] R2：「账号」Tab = B 站登录区块（头像/昵称/UID/退出）+ **Cookie 手动输入**（从字幕抓取归位）
- [ ] R3：「模型」Tab = API Key / Base URL / 模型（现「AI」区块原样迁入）
- [ ] R4：「内容处理」Tab = Whisper 语言 + 截图标注（从字幕抓取拆出）
- [ ] R5：未填 API Key 跳设置时自动定位到「模型」Tab（保留现有引导行为，`initialTab` 支持）
- [ ] R6：Tab 内部仍用现有 `Section` 结构，视觉与玻璃主题一致
- [ ] R7：登录/退出交互不变（onLogin/onLogout 回调沿用）
- [ ] R8：「模型」Tab 新增「测试连接」按钮：发最小 chat 请求验证 baseUrl + API Key + 模型配置，显示成功/失败状态

## Acceptance Criteria

- [ ] AC1：设置页顶部可见三个 Tab（账号 / 模型 / 内容处理），切换正常
- [ ] AC2：「账号」Tab 含登录区块与 Cookie 输入框；手动粘贴 Cookie 仍可用于字幕抓取
- [ ] AC3：「模型」Tab 与原「AI」区块字段一致（API Key / Base URL / 模型）
- [ ] AC4：「内容处理」Tab 含 Whisper 语言与截图标注
- [ ] AC5：首页未填 API Key 提交 → 跳设置并落在「模型」Tab
- [ ] AC6：登录、退出、自动保存行为无回归（原功能不动）
- [ ] AC7：「模型」Tab 点击「测试连接」，配置有效时显示成功（含模型名），无效时显示失败原因（HTTP 状态/错误详情）

## Out of Scope

- 不改设置数据模型（`UserConfig` 结构）
- 不新增设置项（仅重组布局）
- 不做折叠/搜索等替代导航
- 不重构「内容处理」之外的业务逻辑（whisper/screenshot 行为不变）

## 设计决策（详见 design.md）

- **导航形态**：Tabs 分区（现成组件，零依赖）
- **Cookie 归位**：「账号」Tab（用户已确认）
- **Tab 顺序**：账号 / 模型 / 内容处理
- **引导定位**：`SettingsView` 增加 `initialTab` prop（App 跳设置时传 "model"）
