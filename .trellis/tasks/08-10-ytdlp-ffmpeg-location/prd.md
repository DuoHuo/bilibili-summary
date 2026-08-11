# yt-dlp ffmpeg 路径传递 + ffprobe 下载

## Goal

修复 yt-dlp 后处理（音频转 wav）失败：`ERROR: Postprocessing: ffprobe and ffmpeg not found`。

根因（由 `08-10-log-file-sink` task 的诊断日志暴露）：
- `downloadAudioWithYtdlp` 调用 yt-dlp 时未传 `--ffmpeg-location`，yt-dlp 仅查系统 PATH 找 ffmpeg/ffprobe
- 应用已下载 `binaries/ffmpeg-aarch64-apple-darwin`（缓存可用），但 yt-dlp 不知道其路径
- 系统 PATH 无 ffmpeg/ffprobe；evermeet.cx 的 ffmpeg 包不含 ffprobe

## User Value

- `subtitleSource=audio`（强制音频转写）场景下，yt-dlp 后处理不再因缺 ffmpeg/ffprobe 失败
- 无需用户手动 `brew install ffmpeg`（应用自带二进制即可）

## 演进：根因深化与统一决策树重构

排障过程中诊断日志层层揭示真因（体现了落盘系统的价值）：
1. **表层**：`ffprobe and ffmpeg not found`
2. `--ffmpeg-location` 未传 → 加传递 ✓
3. ffmpeg 是未解压的 zip → 魔数嗅探解压 ✓
4. **真因**（args 诊断日志揭示）：`--ffmpeg-location` 传了，但缓存文件名 `ffmpeg-aarch64-apple-darwin` 带平台后缀，yt-dlp 在目录里按标准名 `ffmpeg`/`ffprobe` 查找 → 找不到

**重构方案（取代初版 brew-only）**：统一二进制解析决策树，对所有程序/平台一致——
- `resolve_binary(app, program)`：① PATH ② app 缓存（**标准名，无平台后缀**）③ 下载存标准名
- `resolve_via_brew`：仅 whisper-cli 特殊（macOS 无官方预编译包）走 Homebrew
- 缓存名从 `{program}-{triple}` 改为 `{program}`，对齐 yt-dlp 的查找约定
- `check_external_binary` 缓存查询同步改为标准名

这样：有 brew 的用户 PATH 命中（用系统稳定版）；没 brew 的用户下载兜底（标准名，yt-dlp 能找到）；不强制 brew，不踩文件名坑，逻辑 DRY。

## Confirmed Facts（代码证据）

### 现状缺口
- `frontend/src/core/whisper/download.ts::downloadAudioWithYtdlp`：yt-dlp 参数无 `--ffmpeg-location`；`deps` 仅 `Pick<SummarizeDeps, "runner"|"isFile"|"writeFile"|"onProgress">`，缺 ffmpeg 路径解析能力
- `downloadVideoWithYtdlp`（截图下载）同样无 `--ffmpeg-location`（合并 mp4 也需 ffmpeg）
- `src-tauri/src/commands.rs::external_binary_url`：有 `ffmpeg` 映射（evermeet），**无 `ffprobe` 映射**；evermeet 提供独立 `https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip`
- `ensure_external_binary` 已能下载 ffmpeg 到 `binaries/ffmpeg-{triple}`，但 download.ts 未调用它、未传给 yt-dlp
- 诊断日志证据（`app.log`）：
  ```
  "code":"WHISPER.YTDLP_DOWNLOAD_FAILED",
  "context":{"exitCode":1,
    "stdoutTail":"[download] 100% of 4.12MiB ...",  // 下载成功
    "stderrTail":"ERROR: Postprocessing: ffprobe and ffmpeg not found. ..."}
  ```

### 依赖现状
- `SummarizeDeps` 已有 `resolveModelPath`（whisper 模型解析），但**无 ffmpeg 路径解析**字段
- `tauriRunner` 桥接层透传 args 给 Rust `run_external`，加 `--ffmpeg-location <path>` 即可生效

## Requirements

### R1：ffprobe 下载映射
- `commands.rs::external_binary_url` 增加 `ffprobe` 映射（各平台，与 ffmpeg 同源 evermeet / BtbN / linux64）
- 单测覆盖 ffprobe 各平台 URL（与现有 `external_binary_tests::url_mapping_covers_platforms` 同构）

### R2：ffmpeg/ffprobe 路径解析注入 SummarizeDeps
- `SummarizeDeps` 新增 `resolveFfmpegPath?: () => Promise<string>`（可选，未提供时 yt-dlp 走系统 PATH 作 fallback）
- 或复用 `ensure_external_binary`：在 `tauri.ts` 暴露 `resolveFfmpegPath`，调 `ensure_external_binary("ffmpeg")` + `ensure_external_binary("ffprobe")`，返回 ffmpeg 所在目录
- `lib/api.ts::tauriDeps` 注入 `resolveFfmpegPath`

### R3：download.ts 传 `--ffmpeg-location`
- `downloadAudioWithYtdlp` / `downloadVideoWithYtdlp`：
  - 若 `deps.resolveFfmpegPath` 可用 → 解析 ffmpeg 目录，参数加 `--ffmpeg-location <dir>`
  - 未提供时 fallback（不传，走系统 PATH——保持测试兼容）
- `deps` Pick 类型加 `resolveFfmpegPath?`

### R4：测试
- `download.test.ts`：新增用例——`resolveFfmpegPath` 返回路径时，runner 收到的 args 含 `--ffmpeg-location <dir>`
- 既有用例（无 `resolveFfmpegPath`）不传该参数，行为不变

## Acceptance Criteria

- [x] AC1：`external_binary_url` 含 `ffprobe` 各平台映射（evermeet mac / BtbN win / linux64），单测覆盖
- [x] AC2：`SummarizeDeps` 新增可选 `resolveFfmpegPath`，`tauri.ts::resolveFfmpegPath` 调 `ensure_external_binary("ffmpeg")+"ffprobe"` 返回 binaries 目录，`tauriDeps` 注入
- [x] AC3：`downloadAudioWithYtdlp`/`downloadVideoWithYtdlp` 在 `resolveFfmpegPath` 可用时传 `--ffmpeg-location <dir>`，单测断言参数序列；未提供/解析失败时 fallback 不传（单测覆盖）
- [x] AC4：`pnpm --filter ./frontend check` + `pnpm --filter ./frontend test` + `cd src-tauri && cargo test` 全绿（前端 175 测试 + Rust 9 测试）
- [ ] AC5：手动验证（`tauri dev`）：`subtitleSource=audio` 触发下载，yt-dlp 后处理成功生成 wav（不再报 ffmpeg not found）

## Out of Scope

- ffmpeg/ffprobe 下载失败的重试 UI（ensure_external_binary 既有逻辑足够）
- `run_external` stdout/stderr 无界内存累积（既有设计问题，不修）
- 系统已装 ffmpeg 时的优先级调整（sidecar→PATH→缓存 既有顺序保持）
