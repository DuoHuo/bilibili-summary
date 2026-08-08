# Journal - Morgan Woods (Part 1)

> AI development session journal
> Started: 2026-08-08

---


## 2026-08-08 — GUI 重构：macOS 磨砂玻璃分层布局 (08-08-gui-glass-relayout)

- 参照用户提供的深色 macOS 应用截图，整站从 cream 单列布局重构为 sidebar + 主工作区的分层玻璃布局。
- 关键决策：不启用 Tauri 原生 transparent/vibrancy（跨平台风险），磨砂感由 CSS `.glass/.glass-strong/.ambient-bg` 分层实现；主题翻转只改 `index.css` token 值，组件类名零改动。
- 设置从 Dialog 改为侧边栏独立视图；UrlForm 增加 hero/compact 双形态；首页 hero = 问候 + 输入卡 + 模式卡。
- 新增 DEV-only `?qa` 钩子注入合成结果用于视觉 QA（生产 tree-shake）。
- 验证：tsc / vitest 78 通过 / cargo check 通过 / agent-browser 截图四视图（首页、结果、设置、弹窗）。
- 沉淀：`.trellis/spec/frontend/design-tokens.md`（深色玻璃 token 与布局壳约定）。
- 未 commit（用户级规则：不主动 git 提交）。
