# render 模块说明

## HTML 产物渲染差异白名单

`render/html.ts` 用 `marked`（GFM）替代 Rust 的 `pulldown-cmark`。两者语义等价，
仅存在格式化差异，已通过 `html.test.ts` 的 golden 对照（`normalizeWhitespace`）验证：

| 差异 | Rust pulldown-cmark | TS marked | 影响 |
|---|---|---|---|
| 表格标签换行 | 紧凑单行 `<table><thead><tr>...` | 多行缩进 | 无（浏览器渲染一致） |
| 模板首尾换行 | 无 | 已对齐（去首行换行） | 无 |

`__fixtures__/golden-html.html` 为 Rust 版 `render_markdown_html` 的固定输出样本，
改动模板或渲染器时用它做回归对照。
