# bilibili summary

输入一条 B 站 / YouTube 链接，自动生成结构化视频摘要。**Tauri 2 桌面 GUI**：核心业务逻辑全部 TypeScript（`frontend/src/core/`），Rust 仅保留极薄系统能力壳（子进程 / 文件 / 对话框）。

- **UI**: React 18 + Vite + TypeScript 5.9 + Tailwind v4 + shadcn/ui
- **核心层**: TypeScript（平台识别 / 字幕抓取 / Whisper 转录 / LLM 调用 / Markdown·HTML 渲染）
- **壳**: Tauri 2（Rust，仅 spawn 外部二进制 + 文件系统 + 原生对话框）
- **跨平台**: Windows / macOS / Linux
- **CI/CD**: GitHub Actions（CI 三平台检查；CD 打 tag 发布三平台安装包 + sidecar）

> 设计参考 [BibiGPT-v1](https://github.com/JimmyLv/BibiGPT-v1) 与 [BiliNote](https://github.com/JefferyHcool/BiliNote)；视觉系统见 [`DESIGN.md`](./DESIGN.md)（cream canvas + coral primary + 深色 surface）。

## 功能概览

- 支持 Bilibili / YouTube 链接（自动识别平台）
- 优先抓取官方字幕，无字幕时回退到本地 Whisper 转录
- OpenAI 兼容接口（默认 `gpt-4o-mini`，可改 `base_url` 接 DeepSeek 等）
- 四模式：摘要 / 全文 / 时间戳 / 自定义模板（token `{{title}}` / `{{transcript}}`）
- 结构化 Markdown + HTML（"东方简约信纸"模板）产物，原生"另存为"导出
- 配置持久化到应用数据目录（重启保留）

## 目录结构

```
bilibili-summary/
├── frontend/                 # React + Vite + Tailwind + shadcn/ui
│   └── src/
│       ├── core/             # TS 核心层（纯逻辑，可单测，依赖注入）
│       │   ├── platform/     # URL 解析 / 平台识别
│       │   ├── subtitle/     # B站 / YouTube 字幕抓取与解析
│       │   ├── transcript/   # 时间戳格式化 / 15s 段合并
│       │   ├── whisper/      # yt-dlp 下载 / whisper-cli 转写 / cookie
│       │   ├── llm/          # 提示词构建 / OpenAI 兼容调用
│       │   ├── render/       # Markdown 组装 / HTML 模板 / 截图标记
│       │   ├── workflow/     # 摘要流水线编排（状态机）
│       │   └── __fixtures__/ # 回归测试样本
│       ├── components/       # UI 组件
│       └── lib/              # tauri 桥接 / api / config / prompts / types
├── src-tauri/                # Tauri 2 Rust 壳
│   ├── src/commands.rs       # run_external / save_file / 模型 / 产物目录
│   └── tauri.conf.json
├── .github/workflows/        # release.yml（tag 触发的打包发布）
├── package.json              # 根 workspace（pnpm dev / build / test / clean）
├── pnpm-workspace.yaml       # workspace 配置（frontend）
└── DESIGN.md                 # 设计系统规范
```

## 快速开始

### 依赖准备

| 工具 | 用途 | 安装 |
| --- | --- | --- |
| Node ≥ 20 + pnpm | 前端 | https://nodejs.org + `npm i -g pnpm` |
| Rust (stable) | Tauri 壳 | https://rustup.rs |
| yt-dlp | 音频/视频下载（Whisper / 截图路径） | `brew install yt-dlp` |
| ffmpeg | 音频转码 / 视频截图 | `brew install ffmpeg` |
| whisper-cli | 本地转录（whisper.cpp） | 见下方说明 |

> Windows 用户可用 `choco install yt-dlp ffmpeg`；Linux 用户用 `apt install yt-dlp ffmpeg`。
> 外部二进制（yt-dlp / ffmpeg / whisper-cli）运行时按需下载到应用数据目录，不随包安装（设置页「引擎」Tab 可检测/下载）。

Whisper 模型（`ggml-base.bin`）首次转录时自动下载到应用数据目录，无需手动准备。

### 启动（推荐）

```bash
pnpm install   # 首次：安装全部依赖（含 tauri CLI）
pnpm dev       # 打开桌面窗口
```


### 常用命令（根目录执行）

```bash
pnpm dev             # 启动桌面应用（tauri dev）
pnpm build           # 打包生成安装包（tauri build）
pnpm test            # vitest 单元测试
pnpm check           # tsc --noEmit + cargo check
pnpm run clean        # 清理构建产物（frontend/dist + src-tauri/target）
```

## 使用流程

1. 打开桌面应用，点击右上「设置」填入 API Key（必填），可按需填 Base URL、模型、Cookie、提示词等
2. 粘贴 B 站 / YouTube 链接，选择模式（摘要 / 全文 / 时间戳 / 自定义），点击「生成」
3. 在结果区切换 摘要 / 字幕 / 原始 Markdown，复制或「另存为」`.md` / `.html`
4. 产物自动保存到本地产物目录（`.md` / `.html` / `.txt`），可一键打开

## 外部二进制与打包（CD）

- **开发期**：yt-dlp / ffmpeg / whisper-cli 从系统 PATH 查找。
- **运行期**：yt-dlp / ffmpeg / whisper-cli 首次使用时按需下载到应用数据目录（设置页「引擎」Tab 可检测 / 下载）。
- **已知限制**：whisper.cpp 官方 releases 不提供 macOS arm64 预编译 CLI——macOS arm64 由 Homebrew（`brew install whisper-cpp`）提供。

## GitHub Actions

| Workflow | 触发 | 内容 |
| --- | --- | --- |
| `release.yml` | tag `v*` | 三平台（含 macOS 双架构）打包 + GitHub Release 发布 |

打 tag 示例：

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## 许可与致谢

灵感来自 [BibiGPT-v1](https://github.com/JimmyLv/BibiGPT-v1) 与 [BiliNote](https://github.com/JefferyHcool/BiliNote)。视觉设计参照 Anthropic Claude 的暖色编辑风格（详见 `DESIGN.md`）。
