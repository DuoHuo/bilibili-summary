# Design — GUI 重构：macOS 磨砂玻璃分层布局

## 布局架构

```
┌───────────────┬────────────────────────────────┐
│ aside (glass) │  drag strip (h-12, 可拖拽)      │
│ ● ● ● 留白    ├────────────────────────────────┤
│ brand         │  view = home:                  │
│ nav:          │    无结果 → Hero(问候+输入卡+模式卡)│
│  新摘要        │    有结果 → 紧凑工具条+ResultPanel │
│  设置         │  view = settings:              │
│ ─────────     │    SettingsView(滚动)           │
│ 底部: 版本/状态│                                 │
└───────────────┴────────────────────────────────┘
```

- `App.tsx` 持有 `view: "home" | "settings"` 状态；sidebar 导航切换。
- 主工作区背景 = 深色 canvas + 两枚低饱和径向环境光（珊瑚/青），固定不滚动；内容层在其上滚动，玻璃面板 backdrop-blur 折射环境光 → 分层磨砂感。

## 主题 token 翻转（核心手段）

只改 `index.css` 的 `@theme` token **值**，名字与组件类名不动：

| token | 旧（cream） | 新（dark glass） |
|---|---|---|
| canvas | #faf9f5 | #131315（近黑） |
| surface-soft | #f5f0e8 | rgba(255,255,255,.05) |
| surface-card | #efe9de | rgba(255,255,255,.07) |
| surface-cream-strong | #e8e0d2 | rgba(255,255,255,.10) |
| surface-dark* | 深棕黑 | #0b0b0c / 提亮 elevated |
| ink | #141413 | #f4f2ed（亮字） |
| body / body-strong | 深灰 | #c9c7c2 / #e6e4df |
| muted / muted-soft | 灰 | #9b9994 / #77756f |
| hairline(-soft) | 米色 | rgba(255,255,255,.08/.05) |
| on-primary / on-dark | 白/米 | 不变 |

新增工具类：`.glass`（bg white/4% + backdrop-blur-xl + hairline 边框）、`.glass-strong`、`.ambient-bg`（径向渐变层）。shadcn 桥接 `:root` 变量无需改名，自动跟随。

## 组件级改动

- `App.tsx`：重写 shell；删除旧 header/输入条结构；sidebar + main；hero / 结果态 / 设置视图三态渲染。
- `url-form.tsx`：新增 `variant: "hero" | "compact"`。hero = 卡片内大输入框 + 底部行（模式分段 + 自定义按钮）；compact = 单行工具条。
- `result-panel.tsx`：`Frame` 改玻璃卡片（rounded-2xl + .glass）；空态/加载态文案与图标保留，颜色走 token。
- `settings-panel.tsx`：去 Dialog 壳，导出 `SettingsView`（max-w-2xl 居中滚动页），内部 Section/ToggleRow 复用。
- `custom-prompt-dialog.tsx`：不动（Dialog 深色自动适配）。
- `tauri.conf.json`：width 1180 / minWidth 900。

## 兼容与回滚

- 纯前端改动；core/lib 零触碰。回滚 = 单 commit 前状态（git 未提交，可用 diff 恢复）。
- 浏览器可预览（Tauri API 均有 catch 兜底），用 vite + 截图做视觉 QA。
