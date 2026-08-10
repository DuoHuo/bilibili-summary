---
name: bilibili summary — Dark macOS Glass
version: alpha
description: 深色分层玻璃主题。near-black 画布 + 白色 alpha 玻璃面板 + hairline 描边 + coral 强调，衬线 display 编辑式排版。
colors:
  canvas: "#131315"
  surface-soft: rgba(255, 255, 255, 0.05)
  surface-card: rgba(255, 255, 255, 0.08)
  surface-cream-strong: rgba(255, 255, 255, 0.12)
  surface-dark: "#0b0b0c"
  surface-dark-elevated: "#232326"
  surface-dark-soft: "#1a1a1d"
  hairline: rgba(255, 255, 255, 0.09)
  hairline-soft: rgba(255, 255, 255, 0.05)
  ink: "#f4f2ed"
  body-strong: "#e8e6e1"
  body: "#c9c7c2"
  muted: "#9b9994"
  muted-soft: "#75736d"
  primary: "#cc785c"
  primary-active: "#a9583e"
  primary-disabled: "#3a3835"
  on-primary: "#ffffff"
  on-dark: "#f4f2ed"
  on-dark-soft: "#a09d96"
  accent-teal: "#5db8a6"
  accent-amber: "#e8a55a"
  success: "#5db872"
  warning: "#d4a017"
  error: "#e06c6c"
typography:
  display-xl:
    fontFamily: Cormorant Garamond
    fontSize: clamp(40px, 6vw, 64px)
    fontWeight: "500"
    lineHeight: 1.05
    letterSpacing: -1.5px
  display-lg:
    fontFamily: Cormorant Garamond
    fontSize: clamp(32px, 4.5vw, 48px)
    fontWeight: "500"
    lineHeight: 1.1
    letterSpacing: -1px
  display-md:
    fontFamily: Cormorant Garamond
    fontSize: clamp(26px, 3.2vw, 36px)
    fontWeight: "500"
    lineHeight: 1.15
    letterSpacing: -0.5px
  display-sm:
    fontFamily: Cormorant Garamond
    fontSize: 28px
    fontWeight: "500"
    lineHeight: 1.2
    letterSpacing: -0.3px
  caption-uppercase:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: "500"
    lineHeight: 1.4
    letterSpacing: 1.5px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: "400"
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: "400"
  label-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: "500"
  code:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: "400"
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 9999px
spacing:
  unit: 4px
  card-padding: 32px
  card-gap: 32px
  form-gap: 16px
  sidebar-x: 12px
  sidebar-x-wide: 20px
  nav-item-y: 8px
  mode-card-padding: 16px
components:
  glass-card:
    backgroundColor: rgba(255, 255, 255, 0.04)
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    border: 1px solid "{colors.hairline}"
  glass-card-raised:
    backgroundColor: rgba(255, 255, 255, 0.04)
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    border: 1px solid "{colors.hairline}"
    padding: "{spacing.card-padding}"
    boxShadow: 0 8px 32px rgba(0, 0, 0, 0.35)
  sidebar-button:
    textColor: "{colors.muted}"
    rounded: "{rounded.lg}"
    padding: 8px 12px
    typography: "{typography.body-sm}"
  sidebar-button-active:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    height: 40px
    padding: 0 20px
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: 40px
    padding: 0 20px
    border: 1px solid "{colors.hairline}"
  input:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    border: 1px solid "{colors.hairline}"
  input-hero:
    height: 48px
    rounded: "{rounded.xl}"
    paddingLeft: 44px
  input-compact:
    height: 36px
    rounded: "{rounded.lg}"
    paddingLeft: 36px
  tabs-list:
    backgroundColor: "{colors.surface-soft}"
    rounded: "{rounded.md}"
    padding: 4px
  tabs-trigger-active:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    boxShadow: 0 1px 2px rgba(0, 0, 0, 0.1)
  segmented-active:
    backgroundColor: "{colors.surface-cream-strong}"
    textColor: "{colors.ink}"
  mode-card:
    backgroundColor: rgba(255, 255, 255, 0.04)
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    border: 1px solid "{colors.hairline}"
    padding: "{spacing.mode-card-padding}"
  mode-card-active:
    borderColor: rgba(204, 120, 92, 0.6)
    backgroundColor: "{colors.surface-card}"
  session-status-running:
    backgroundColor: "{colors.muted-soft}"
  session-status-done:
    backgroundColor: "{colors.success}"
  session-status-error:
    backgroundColor: "{colors.error}"
---

## Brand & Style

bilibili summary 是**深色、分层、玻璃质感**的 macOS 桌面壳：near-black 画布（`#131315`，带一点暖意而非纯黑）+ 白色 alpha 玻璃面板 + hairline 描边 + coral 强调。

品牌声音是**编辑式排版 + 深色玻璃**的结合：display 标题用衬线（Cormorant Garamond 替代 Copernicus）weight 500 + 负字距，读起来像刊物栏目；正文 Inter 无衬线 400。深色玻璃是衬线标题的舞台——玻璃折射 ambient 光晕，coral 是克制的高电压时刻。

### Key Characteristics
- Near-black 画布 + 白色 alpha 玻璃层（5/8/12% 三步 = hover/active/raised）。
- Coral 稀缺使用：主 CTA、激活态、时间戳标记。
- 衬线 display + 负字距，无衬线正文，编辑式排版。
- 侧边栏 + 主工作区双栏玻璃壳；macOS Overlay 标题栏预留红绿灯位。
- 阴影克制：唯一深阴影 `0 8px 32px rgba(0,0,0,0.35)`；层次来自玻璃层差。

## Colors

调色板根植于**深色中性 + 单一 coral 强调**。

- **Canvas (`{colors.canvas}`)：** 近黑画布，应用底色。
- **Surface 层：** 组件背景从 `rgba(255,255,255,0.05)`（soft，hover 底/TabsList）→ `0.08`（card，激活态）→ `0.12`（cream-strong，最强抬升）。`surface-dark*` 是内嵌代码/弹层的实色深底。
- **Hairline（`{colors.hairline}`）：** 所有边框/分隔线用 white alpha 9%，视觉是一层"抬升"而非墨线。
- **Text：** 亮字族——`ink` 暖白标题、`body`/`muted`/`muted-soft` 三级降级。
- **Primary（`{colors.primary}` — `#cc785c`）：** 唯一交互强调色。禁用态用深色化 `#3a3835`，不在深色壳上放浅色禁用块。
- **Semantic：** `success` 状态点/成功提示、`error` 校验失败、`warning` 少见。`accent-teal`/`accent-amber` 仅状态与徽标。

## Typography

**衬线 display + Inter body**，分界不可打破。

- **Hierarchy：** `display-xl`（首页问候 h1，clamp 40→64px）→ `display-lg`/`md`/`sm`（section/设置标题）→ `caption-uppercase`（Section 小标题，12px 500 + 1.5px 字距）。
- **Display：** 衬线 500 + 负字距（-0.3 到 -1.5px）是品牌声音；没有负字距的衬线标题失去编辑气质。weight 以 400 为原则基准，深色玻璃下允许 500 补偿对比度（实现取 500），绝不超 500。
- **Body：** Inter 400 为主，标签/强调 500；说明文字统一 `text-xs muted`（`body-sm`）。
- **Legibility：** 深色玻璃上正文 14px 默认（桌面紧凑布局），输入框 16px。

## Layout & Spacing

**固定侧边栏 + 弹性主区的玻璃壳**，4px 基准网格。

- **Shell：** 侧边栏 `w-[232px]`（glass-strong + `border-r hairline`），内部自上而下：`h-12` 拖拽区（macOS `pl-[70px]` 让出红绿灯）→ 品牌行（SpikeMark + 衬线 wordmark）→ 导航（SidebarButton）→ 会话列表 → 底部状态行（绿点 + "本地引擎就绪 · v0.1.0"）。
- **Rhythm：** 玻璃卡内边距 32px、区块间距 32px、表单字段间距 16px；侧边栏 `px-3`（12px）/`px-5`（20px）。
- **Content width：** Home hero `max-w-[880px]`（`pt-[8vh]` 垂直呼吸）、结果视图 `max-w-[1000px]`、设置 `max-w-2xl`，主区水平居中。
- **Grid：** 模式卡片 `sm:grid-cols-2 lg:grid-cols-4`；设置表单字段 `sm:grid-cols-2`（窄屏回单列）。

## Elevation & Depth

**层次来自玻璃 alpha 差 + hairline 抬升，阴影仅一处。**

| Level | Treatment | Use |
|---|---|---|
| Ambient | `.ambient-bg` 固定径向光晕，`pointer-events-none`，壳根部唯一实例 | 玻璃折射的光源 |
| Flat | 画布，无边框 | 主工作区底、拖拽条 |
| Glass | `rgba(255,255,255,0.04)` + `blur(20px) saturate(150%)` + `border-hairline` | 表单卡、模式卡、设置页卡 |
| Glass strong | 更高 alpha + 同 blur | 侧边栏 |
| Raised | Glass + `card-shadow`（`0 8px 32px rgba(0,0,0,0.35)`） | 主要功能卡 |
| Surface-dark | `surface-dark*` 实色深底 | 代码/转写内容、弹层 |

- **Edge：** 每个玻璃面必须 1px `hairline` 边框。
- **Shadow：** 极克制——仅 `card-shadow` 一处，分离层次而不显重。
- **Forbidden：** 深色壳内不放不透明浅色面板（杀死玻璃分层）。

## Shapes

有机、克制的圆角体系。

- **Cards：** `rounded-xl`（16px）玻璃容器；设置卡 `rounded-2xl`（16px）。
- **Action：** 按钮/输入框 `rounded-md`（8px）；hero 输入框 `rounded-xl`（16px）；compact 输入框 `rounded-lg`（12px）。
- **Details：** `rounded-[7px]` 分段内项微调、`rounded-pill` 徽章/头像圆。
- **Icons：** lucide 线性图标（`size-4` 常规、`size-3.5` 紧凑）；头像 40px 圆（加载失败回退首字符占位 `bg-surface-soft`）；二维码白底 `rounded-lg border-hairline`。

## Components

### Glass Containers
玻璃卡：`.glass`（4% white + blur20 saturate150）+ `border-hairline` + `rounded-2xl`；主功能卡叠加 `card-shadow`。**glass utility 本身不含边框圆角，必须显式配对。**

### UrlForm
- **hero**（首页空闲态）：输入框 `h-12 rounded-xl pl-11`（左侧 Search 图标）+ **生成按钮同行**（`h-12 rounded-xl px-6`）；自定义入口由下方模式卡片提供（不重复）。
- **compact**（结果页工具栏）：`h-9 rounded-lg pl-9 text-sm` + ModeSegmented（摘要/全文/时间戳分段）+ 「自定义」ghost 按钮 + 生成按钮 `h-9 rounded-lg px-5`。
- 生成中显示转圈 + "生成中…"。

### Mode Cards
4 张（摘要/全文/时间戳/自定义），`glass rounded-xl border p-4`；激活 `border-primary/60 bg-surface-card` + coral 图标；默认 `border-hairline hover:bg-surface-soft`。

### Buttons
- **primary**：`bg-primary text-on-primary h-10 rounded-md px-5 text-sm`；active `primary-active`。
- **secondary**：`bg-canvas text-ink border-hairline`（画布底 + hairline 描边）。
- **ghost / destructive / dark / link**：按场景（次要行内 / 删除 / 深底 / 文本链接）。

### SettingsView（Tabs 分区）
顶部 Tabs（`TabsList bg-surface-soft p-1 rounded-md`，激活 Trigger `bg-canvas text-ink shadow-sm`）：「账号 / 模型 / 内容处理」；每个 Tab 独立玻璃卡，内部用 `Section`（caption-uppercase 小标题 + hairline 延伸线）分组。账号卡含 B 站登录（头像/昵称/UID/退出）+ Cookie 输入；模型卡含 API Key/Base URL/模型 + 「测试连接」（结果 success/error 色）；内容处理卡含 Whisper 语言分段（选中 `surface-cream-strong`）+ 截图标注 Switch。

### Dialogs
`DialogContent max-h-[90vh] overflow-y-auto p-8`；Header（Title + Description）+ 内容 + Footer（secondary 取消 + primary 确认）。LoginDialog 内嵌二维码 + 轮询状态（muted）+ 错误态（`text-error` + 重试）。

### SessionList / Toaster
侧边栏会话列表：卡片式行（`rounded-xl` + `border-hairline`，激活态 `border-primary/60 bg-surface-card`）+ 状态色点（running `muted-soft` 呼吸动效 / ready `success` / error `error`）+ 标题；整卡可点选中，不再展示状态文字（悬浮 title 提示）。hover 时卡片右侧浮现单一操作图标：running 显示取消，否则显示删除。sonner toast：成功绿 / 错误红 + 描述行。

## Do's and Don'ts

### Do
- 面板一律 `.glass` + `border-hairline` + 圆角；深色壳上不放不透明浅色块。
- Coral 只用于主 CTA / 激活态 / 时间戳；激活态 `border-primary/60` + `bg-surface-card`。
- display 衬线 400–500 + 负字距；正文 Inter；代码 JetBrains Mono。
- 分隔用 `hairline`（white alpha 9%），不用实色灰线。
- 状态用 token 色点（success/error/muted），不自造颜色。
- 说明文字统一 `text-xs muted`；标签 `text-sm font-medium`。

### Don't
- 不内联 hex（改 `index.css` 的 `@theme` token）。
- 不在深色壳内放不透明 `bg-canvas` 面板（杀死玻璃分层）。
- 不引入新品牌色（无紫卡/绿区块；teal/amber 仅状态徽标）。
- 不在玻璃面板上叠多余阴影（只有 card-shadow 一处）。
- 不用无衬线做 display、不加粗衬线 display 超 500。
- 不连续两段同一表面——层次交替（画布 → glass → 抬升卡）。

## Iteration Guide

1. 一次只动一个组件，参考其 token 名（`button-primary`、`glass-card`、`mode-card`）。
2. 变体（-active / -disabled / -hover）作为独立 component 条目，不叠加样式堆。
3. 用 `{token.refs}` 引用，绝不内联 hex——改色只改 front matter 与 `index.css`。
4. 只记录 Default 与 Active/Pressed 态，不记录 hover 细节（由 `transition-colors` 统一）。
5. display 保持衬线 400–500 + 负字距；body 保持 Inter 400。分界不可打破。
6. 深色玻璃三件套：canvas + glass/hairline + coral。不引入第四种表面色调。
7. 拿不准强调时：更大的衬线 display，而不是更粗的字重。
8. 新增组件前先确认现成 primitives（Section / ToggleRow / Tabs / glass 卡）可复用——KISS。
