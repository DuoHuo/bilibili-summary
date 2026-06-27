use anyhow::{anyhow, Result};
use axum::{extract::State, http::StatusCode, Json};
use chrono::Local;
use pocketflow_rs::{build_flow, Context, Node, ProcessResult, ProcessState};
use pulldown_cmark::{html, Options, Parser};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{path::PathBuf, sync::Arc};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::services::{
  build_prompt,
  call_llm,
  detect_platform,
  download_video_with_ytdlp,
  format_transcript_source,
  generate_screenshot,
  merge_transcript_segments,
  summarize_bilibili,
  summarize_youtube,
  transcribe_with_whisper,
  Platform,
  TranscriptSegment,
  TranscriptSource,
  TIMESTAMP_MERGE_THRESHOLD_SECS
};
use crate::utils::{extract_screenshot_markers, format_transcript_with_timestamps};

// 应用级状态：统一复用 HTTP 客户端
#[derive(Clone)]
pub struct AppState {
  pub http: Client
}

// 请求体：前端提交的视频地址与模型配置
#[derive(Deserialize)]
pub struct SummarizeRequest {
  pub url: String,
  pub api_key: String,
  pub model: Option<String>,
  pub base_url: Option<String>,
  pub prompt: Option<String>,
  pub cookie: Option<String>,
  pub stt_language: Option<String>,
  pub screenshot: Option<bool>,
  pub mode: Option<String>
}

// 响应体：结构化摘要 + Markdown/HTML
#[derive(Serialize, Deserialize)]
pub struct SummarizeResponse {
  pub run_id: String,
  pub title: String,
  pub summary: String,
  pub markdown: String,
  pub html: String,
  pub html_subtitle: Option<String>,
  pub html_stamp: Option<String>,
  pub transcript: Option<String>,
  pub transcript_segments: Option<Vec<TranscriptSegment>>,
  pub transcript_source: Option<TranscriptSource>
}

// 错误响应结构
#[derive(Serialize)]
pub struct ErrorResponse {
  pub message: String
}

// 摘要接口入口：调用 PocketFlow 工作流并返回响应
pub async fn summarize(
  State(_state): State<Arc<AppState>>,
  Json(payload): Json<SummarizeRequest>
) -> std::result::Result<Json<SummarizeResponse>, (StatusCode, Json<ErrorResponse>)> {
  info!("🧭 summarize 请求: url={}", payload.url);
  if let Some(model) = payload.model.as_deref() {
    info!("🧭 summarize 模型: {}", model);
  }
  if let Some(base_url) = payload.base_url.as_deref() {
    info!("🧭 summarize base_url: {}", base_url);
  }
  if let Some(language) = payload.stt_language.as_deref() {
    info!("🧭 summarize stt_language: {}", language);
  }
  if payload.cookie.is_some() {
    info!("🧭 summarize cookie: 已提供");
  } else {
    info!("🧭 summarize cookie: 未提供");
  }
  if payload.screenshot.unwrap_or(false) {
    info!("🧭 summarize screenshot: 已启用");
  }

  let flow = build_summary_flow();
  let run_id = Uuid::new_v4().to_string();
  let context = build_flow_context(&payload, &run_id)
    .map_err(|err| error_response(&err.to_string()))?;
  let result = flow
    .run(context)
    .await
    .map_err(|err| {
      error!("❌ summarize 流程失败: {}", err);
      error_response(&err.to_string())
    })?;
  let response: SummarizeResponse = serde_json::from_value(result)
    .map_err(|err| {
      error!("❌ summarize 响应解析失败: {}", err);
      error_response("解析流程结果失败")
    })?;

  info!("✅ summarize 完成: title={}", response.title);
  Ok(Json(response))
}

fn error_response(message: &str) -> (StatusCode, Json<ErrorResponse>) {
  // 统一错误输出为 400 + message
  (
    StatusCode::BAD_REQUEST,
    Json(ErrorResponse {
      message: message.to_string()
    })
  )
}

fn resolve_run_dir(run_id: &str) -> Result<PathBuf> {
  let base = std::env::var("OUTPUT_DIR").unwrap_or_else(|_| "output".to_string());
  let run_dir = PathBuf::from(base).join(run_id);
  std::fs::create_dir_all(&run_dir).map_err(|err| anyhow!(err))?;
  Ok(run_dir)
}

fn write_output_files(
  run_dir: &PathBuf,
  run_id: &str,
  markdown: &str,
  html: &str,
  transcript: &str
) -> Result<()> {
  std::fs::write(run_dir.join(format!("summary_{run_id}.md")), markdown)
    .map_err(|err| anyhow!(err))?;
  std::fs::write(run_dir.join(format!("summary_{run_id}.html")), html)
    .map_err(|err| anyhow!(err))?;
  std::fs::write(run_dir.join(format!("transcript_{run_id}.txt")), transcript)
    .map_err(|err| anyhow!(err))?;
  Ok(())
}

fn strip_markdown_title(markdown: &str) -> String {
  let mut lines = markdown.lines();
  let mut result = Vec::new();
  let mut skipped_title = false;
  while let Some(line) = lines.next() {
    if !skipped_title && line.trim_start().starts_with("# ") {
      skipped_title = true;
      // skip an optional blank line right after the title
      if let Some(next) = lines.next() {
        if !next.trim().is_empty() {
          result.push(next);
        }
      }
      continue;
    }
    result.push(line);
  }
  result.join("\n").trim().to_string()
}

fn render_markdown_html(
  title: &str,
  markdown: &str,
  subtitle: Option<&str>,
  stamp: Option<&str>
) -> String {
  let subtitle = subtitle
    .map(|value| value.to_string())
    .unwrap_or_else(|| {
      std::env::var("SUMMARY_HTML_SUBTITLE")
        .unwrap_or_else(|_| "东方简约信纸 · SiriusX Summary".to_string())
    });
  let stamp = stamp
    .map(|value| value.to_string())
    .unwrap_or_else(|| std::env::var("SUMMARY_HTML_STAMP").unwrap_or_else(|_| "摘要".to_string()));
  let mut options = Options::empty();
  options.insert(Options::ENABLE_STRIKETHROUGH);
  options.insert(Options::ENABLE_TABLES);
  options.insert(Options::ENABLE_TASKLISTS);
  let parser = Parser::new_ext(markdown, options);
  let mut output = String::new();
  html::push_html(&mut output, parser);
  format!(
    r#"<!doctype html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title} - SiriusX Summary</title>
    <link
      href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {{
        color-scheme: light;
        --ink: #2d2a24;
        --paper: #f7f1e3;
        --edge: #d8c9aa;
        --accent: #b0894f;
      }}
      * {{
        box-sizing: border-box;
      }}
      body {{
        margin: 0;
        min-height: 100vh;
        padding: 48px 20px;
        font-family: "Noto Serif SC", "Songti SC", serif;
        background: radial-gradient(circle at top, rgba(255, 255, 255, 0.8), transparent 55%),
          linear-gradient(145deg, #fdf9f0, #efe3c8),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='%23cdbb99' fill-opacity='0.12'%3E%3Cpath d='M8 16c8 10 24 2 30 12 4 6-6 14-1 20 5 6 16 0 22 8 6 8-2 14-8 18-6 4-10 10-7 16'/%3E%3Cpath d='M60 8c6 10 18 6 26 14 6 6 0 12 6 18 6 6 18 0 20 10 2 8-10 10-16 14-6 4-8 12-4 18'/%3E%3Cpath d='M20 80c8 8 18 0 26 10 6 8-2 14 2 20 4 6 14 4 22 10'/%3E%3Cpath d='M86 72c6 8 16 4 20 12 4 8-4 12-8 18'/%3E%3C/g%3E%3Cg fill='%23a48f69' fill-opacity='0.08'%3E%3Ccircle cx='18' cy='32' r='1.5'/%3E%3Ccircle cx='44' cy='54' r='1.2'/%3E%3Ccircle cx='70' cy='26' r='1.4'/%3E%3Ccircle cx='92' cy='58' r='1.1'/%3E%3Ccircle cx='36' cy='92' r='1.3'/%3E%3Ccircle cx='64' cy='88' r='1.1'/%3E%3C/g%3E%3C/svg%3E");
        color: var(--ink);
      }}
      article {{
        max-width: 880px;
        margin: 0 auto;
        background: linear-gradient(180deg, rgba(255, 252, 245, 0.96), rgba(244, 234, 214, 0.95)),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'%3E%3Cg stroke='%23c7b08b' stroke-opacity='0.2' stroke-width='1'%3E%3Cpath d='M8 20c12 14 30 6 42 16 10 8-2 18 8 26 10 8 28 2 38 12 10 10-2 18-10 24' fill='none'/%3E%3Cpath d='M60 10c8 14 24 10 34 20 8 8 0 16 10 24 10 8 26 2 30 14' fill='none'/%3E%3Cpath d='M24 92c10 10 22 2 32 12 8 10-2 18 6 26' fill='none'/%3E%3C/g%3E%3Cg fill='%23bfa37a' fill-opacity='0.12'%3E%3Ccircle cx='28' cy='40' r='1.4'/%3E%3Ccircle cx='78' cy='52' r='1.2'/%3E%3Ccircle cx='112' cy='34' r='1.1'/%3E%3Ccircle cx='44' cy='120' r='1.3'/%3E%3Ccircle cx='96' cy='118' r='1.2'/%3E%3C/g%3E%3C/svg%3E");
        border: 1px solid var(--edge);
        box-shadow: 0 28px 50px rgba(80, 60, 30, 0.18);
        padding: 36px 40px 48px;
        position: relative;
      }}
      article::before {{
        content: "";
        position: absolute;
        inset: 16px;
        border: 1px dashed rgba(176, 137, 79, 0.35);
        pointer-events: none;
      }}
      header {{
        border-bottom: 1px solid var(--edge);
        padding-bottom: 16px;
        margin-bottom: 24px;
      }}
      h1 {{
        margin: 0 0 8px;
        font-family: "Ma Shan Zheng", "Noto Serif SC", serif;
        font-size: 32px;
        letter-spacing: 2px;
        color: #402c1f;
      }}
      .subtitle {{
        font-size: 14px;
        color: #6f5a3d;
      }}
      h2 {{
        margin: 26px 0 10px;
        font-size: 18px;
        color: #4b3a25;
        display: inline-block;
        padding: 4px 12px;
        border-left: 3px solid var(--accent);
        background: rgba(176, 137, 79, 0.08);
      }}
      p {{
        line-height: 1.9;
        margin: 0 0 12px;
      }}
      ul, ol {{
        margin: 0 0 12px 20px;
        padding: 0;
        line-height: 1.9;
      }}
      pre {{
        margin: 12px 0 0;
        padding: 16px;
        background: #fbf6ea;
        border-left: 3px solid var(--accent);
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "Noto Serif SC", "Songti SC", serif;
        line-height: 1.8;
      }}
      img {{
        max-width: 100%;
        border-radius: 12px;
        border: 1px solid rgba(176, 137, 79, 0.25);
      }}
      .stamp {{
        position: absolute;
        top: 32px;
        right: 32px;
        width: 72px;
        height: 72px;
        border: 2px solid var(--accent);
        color: var(--accent);
        display: grid;
        place-items: center;
        font-family: "Ma Shan Zheng", "Noto Serif SC", serif;
        transform: rotate(8deg);
      }}
    </style>
  </head>
  <body>
    <article>
      <div class="stamp">{stamp}</div>
      <header>
        <h1>{title}</h1>
        <div class="subtitle">{subtitle}</div>
      </header>
      {body}
    </article>
  </body>
</html>"#,
    title = title,
    subtitle = subtitle,
    stamp = stamp,
    body = output
  )
}

fn format_bilingual(cn: &str, en: &str) -> String {
  let cn = cn.trim();
  let en = en.trim();
  if cn.is_empty() && en.is_empty() {
    return String::new();
  }
  if en.is_empty() {
    return cn.to_string();
  }
  if cn.is_empty() {
    return en.to_string();
  }
  format!("{cn} / {en}")
}

#[derive(Deserialize)]
struct HtmlLabelResponse {
  subtitle_cn: String,
  subtitle_en: String,
  stamp_cn: String,
  stamp_en: String
}

async fn generate_html_labels(
  api_key: &str,
  model: Option<&str>,
  base_url: Option<&str>,
  title: &str,
  summary: &str
) -> Result<(String, String)> {
  let prompt = format!(
    "你是资深内容编辑，请基于视频标题与摘要生成一组用于网页的短文本。\n\n标题：{title}\n摘要：{summary}\n\n请输出严格 JSON 格式，字段如下：\n{{\n  \"subtitle_cn\": \"20字以内中文副标题\",\n  \"subtitle_en\": \"12词以内英文副标题\",\n  \"stamp_cn\": \"4字以内中文印章\",\n  \"stamp_en\": \"2-4词英文印章\"\n}}\n\n要求：\n- 与视频内容强相关\n- 文案要精炼、有记忆点\n- 仅输出 JSON，不要添加其它文字\n",
    title = title,
    summary = summary
  );
  let client = Client::builder().user_agent("SiriusX Summary/0.1").build()?;
  let response = call_llm(&client, api_key, model, base_url, &prompt)
    .await
    .map_err(|err| anyhow!(err))?;
  let parsed: HtmlLabelResponse = serde_json::from_str(&response)
    .map_err(|err| anyhow!("解析 HTML 文案失败: {err}"))?;
  let subtitle = format_bilingual(&parsed.subtitle_cn, &parsed.subtitle_en);
  let stamp = format_bilingual(&parsed.stamp_cn, &parsed.stamp_en);
  Ok((subtitle, stamp))
}

// PocketFlow 状态机：控制字幕、转写、总结等分支
#[derive(Debug, Clone, PartialEq, Default)]
enum WorkflowState {
  #[default]
  Default,
  PlatformReady,
  SubtitleReady,
  NeedWhisper,
  WhisperDone,
  PromptReady,
  SummaryReady
}

impl ProcessState for WorkflowState {
  // 兜底状态用于 PocketFlow 默认边
  fn is_default(&self) -> bool {
    matches!(self, WorkflowState::Default)
  }

  // 状态转为条件字符串，驱动边路由
  fn to_condition(&self) -> String {
    match self {
      WorkflowState::Default => "default".to_string(),
      WorkflowState::PlatformReady => "platform_ready".to_string(),
      WorkflowState::SubtitleReady => "subtitle_ready".to_string(),
      WorkflowState::NeedWhisper => "need_whisper".to_string(),
      WorkflowState::WhisperDone => "whisper_done".to_string(),
      WorkflowState::PromptReady => "prompt_ready".to_string(),
      WorkflowState::SummaryReady => "summary_ready".to_string()
    }
  }
}

// 构建 PocketFlow 流程：定义节点与状态迁移
fn build_summary_flow() -> pocketflow_rs::Flow<WorkflowState> {
  build_flow!(
    start: ("detect_platform", DetectPlatformNode),
    nodes: [
      ("fetch_subtitle", FetchSubtitleNode),
      ("whisper_transcribe", WhisperTranscribeNode),
      ("build_prompt", BuildPromptNode),
      ("call_llm", CallLlmNode),
      ("assemble_response", AssembleResponseNode)
    ],
    edges: [
      ("detect_platform", "fetch_subtitle", WorkflowState::PlatformReady),
      ("fetch_subtitle", "build_prompt", WorkflowState::SubtitleReady),
      ("fetch_subtitle", "whisper_transcribe", WorkflowState::NeedWhisper),
      ("whisper_transcribe", "build_prompt", WorkflowState::WhisperDone),
      ("build_prompt", "call_llm", WorkflowState::PromptReady),
      ("call_llm", "assemble_response", WorkflowState::SummaryReady)
    ]
  )
}

// 构建 Flow 上下文：把请求字段写入流程共享数据
fn build_flow_context(request: &SummarizeRequest, run_id: &str) -> Result<Context> {
  let mut context = Context::new();
  let run_dir = resolve_run_dir(run_id)?;
  context.set("url", json!(request.url));
  context.set("api_key", json!(request.api_key));
  context.set("model", json!(request.model));
  context.set("base_url", json!(request.base_url));
  context.set("prompt", json!(request.prompt));
  context.set("cookie", json!(request.cookie));
  context.set("stt_language", json!(request.stt_language));
  context.set("screenshot", json!(request.screenshot.unwrap_or(false)));
  // 模式：summary | fulltext | timestamp | custom，缺省 summary
  let mode = request.mode.as_deref()
    .filter(|s| matches!(*s, "summary" | "fulltext" | "timestamp" | "custom"))
    .unwrap_or("summary");
  context.set("mode", json!(mode));
  context.set("run_id", json!(run_id));
  context.set("run_dir", json!(run_dir.to_string_lossy().to_string()));
  Ok(context)
}

// 从 Context 读取必填字符串
fn context_required_string(context: &Context, key: &str) -> Result<String> {
  context
    .get(key)
    .and_then(|value| value.as_str())
    .map(|value| value.to_string())
    .ok_or_else(|| anyhow!("缺少字段: {key}"))
}

// 读取可选字符串字段
fn context_optional_string(context: &Context, key: &str) -> Option<String> {
  context.get(key).and_then(|value| value.as_str()).map(|value| value.to_string())
}

// 读取字幕片段数组
fn context_optional_segments(context: &Context, key: &str) -> Option<Vec<TranscriptSegment>> {
  let value = context.get(key)?;
  serde_json::from_value::<Vec<TranscriptSegment>>(value.clone()).ok()
}

// 读取字幕来源
fn context_optional_source(context: &Context, key: &str) -> Option<TranscriptSource> {
  let value = context.get(key)?;
  serde_json::from_value::<TranscriptSource>(value.clone()).ok()
}

// 读取可选布尔字段
fn context_optional_bool(context: &Context, key: &str) -> bool {
  context
    .get(key)
    .and_then(|value| value.as_bool())
    .unwrap_or(false)
}

fn context_required_path(context: &Context, key: &str) -> Result<PathBuf> {
  let value = context_required_string(context, key)?;
  Ok(PathBuf::from(value))
}

// 写入字幕信息到 Context
fn set_transcript_context(
  context: &mut Context,
  transcript_text: &str,
  transcript_segments: Vec<TranscriptSegment>,
  transcript_source: TranscriptSource
) {
  context.set("transcript_text", json!(transcript_text));
  context.set("transcript_segments", json!(transcript_segments));
  context.set("transcript_source", json!(transcript_source));
}

// 节点：平台识别
struct DetectPlatformNode;

#[async_trait::async_trait]
impl Node for DetectPlatformNode {
  type State = WorkflowState;

  // 执行平台识别，返回平台标识
  async fn execute(&self, context: &Context) -> Result<serde_json::Value> {
    let url = context_required_string(context, "url")?;
    let platform = detect_platform(&url).map_err(|err| anyhow!(err))?;
    let platform_label = match platform {
      Platform::Bilibili => "bilibili",
      Platform::Youtube => "youtube"
    };

    Ok(json!({
      "platform": platform_label
    }))
  }

  // 将平台结果写回 Context，推动流程流转
  async fn post_process(
    &self,
    context: &mut Context,
    result: &Result<serde_json::Value>
  ) -> Result<ProcessResult<WorkflowState>> {
    match result {
      Ok(value) => {
        let platform = value
          .get("platform")
          .and_then(|item| item.as_str())
          .ok_or_else(|| anyhow!("平台识别失败"))?;
        context.set("platform", json!(platform));
        Ok(ProcessResult::new(WorkflowState::PlatformReady, "platform_ready".to_string()))
      }
      Err(err) => Err(anyhow!(err.to_string()))
    }
  }
}

// 节点：拉取字幕与标题
struct FetchSubtitleNode;

#[async_trait::async_trait]
impl Node for FetchSubtitleNode {
  type State = WorkflowState;

  // 根据平台拉取字幕与视频标题
  async fn execute(&self, context: &Context) -> Result<serde_json::Value> {
    let platform = context_required_string(context, "platform")?;
    let url = context_required_string(context, "url")?;
    info!("📥 FetchSubtitleNode 请求: platform={}, url={}", platform, url);
    let client = Client::builder().user_agent("SiriusX Summary/0.1").build()?;
    let (title, transcript) = match platform.as_str() {
      "bilibili" => summarize_bilibili(&client, &url).await.map_err(|err| anyhow!(err))?,
      "youtube" => summarize_youtube(&client, &url).await.map_err(|err| anyhow!(err))?,
      _ => return Err(anyhow!("暂不支持该平台"))
    };

    if let Some(transcript) = transcript {
      info!("✅ FetchSubtitleNode 已获取字幕: title={}", title);
      return Ok(json!({
        "title": title,
        "has_transcript": true,
        "transcript_text": transcript.text,
        "transcript_segments": transcript.segments,
        "transcript_source": transcript.source
      }));
    }

    warn!("⚠️ FetchSubtitleNode 无字幕: title={}", title);
    Ok(json!({
      "title": title,
      "has_transcript": false
    }))
  }

  // 有字幕则直接进入总结分支，无字幕进入 Whisper 分支
  async fn post_process(
    &self,
    context: &mut Context,
    result: &Result<serde_json::Value>
  ) -> Result<ProcessResult<WorkflowState>> {
    match result {
      Ok(value) => {
        let title = value
          .get("title")
          .and_then(|item| item.as_str())
          .ok_or_else(|| anyhow!("视频标题解析失败"))?;
        context.set("title", json!(title));

        let has_transcript = value
          .get("has_transcript")
          .and_then(|item| item.as_bool())
          .unwrap_or(false);
        if has_transcript {
          let transcript_text = value
            .get("transcript_text")
            .and_then(|item| item.as_str())
            .ok_or_else(|| anyhow!("字幕解析失败"))?;
          let transcript_segments = value
            .get("transcript_segments")
            .cloned()
            .ok_or_else(|| anyhow!("字幕片段缺失"))?;
          let transcript_source = value
            .get("transcript_source")
            .cloned()
            .ok_or_else(|| anyhow!("字幕来源缺失"))?;
          let segments = serde_json::from_value::<Vec<TranscriptSegment>>(transcript_segments)?;
          let source = serde_json::from_value::<TranscriptSource>(transcript_source)?;
          set_transcript_context(context, transcript_text, segments, source);
          return Ok(ProcessResult::new(WorkflowState::SubtitleReady, "subtitle_ready".to_string()));
        }

        Ok(ProcessResult::new(WorkflowState::NeedWhisper, "need_whisper".to_string()))
      }
      Err(err) => Err(anyhow!(err.to_string()))
    }
  }
}

// 节点：Whisper 转写
struct WhisperTranscribeNode;

#[async_trait::async_trait]
impl Node for WhisperTranscribeNode {
  type State = WorkflowState;

  // 字幕缺失时触发转写
  async fn execute(&self, context: &Context) -> Result<serde_json::Value> {
    let url = context_required_string(context, "url")?;
    let cookie = context_optional_string(context, "cookie");
    let stt_language = context_optional_string(context, "stt_language");
    let run_dir = context_required_path(context, "run_dir")?;
    info!(
      "🎙️ WhisperTranscribeNode 请求: url={}, cookie={}, stt_language={}",
      url,
      if cookie.is_some() { "已提供" } else { "未提供" },
      stt_language.as_deref().unwrap_or("未设置")
    );
    let transcript = transcribe_with_whisper(
      &url,
      cookie.as_deref(),
      stt_language.as_deref(),
      &run_dir
    )
      .await
      .map_err(|err| anyhow!(err))?;

    info!(
      "✅ WhisperTranscribeNode 转写完成: segments={}",
      transcript.segments.len()
    );
    Ok(json!({
      "transcript_text": transcript.text,
      "transcript_segments": transcript.segments,
      "transcript_source": transcript.source
    }))
  }

  // 将转写结果写回上下文
  async fn post_process(
    &self,
    context: &mut Context,
    result: &Result<serde_json::Value>
  ) -> Result<ProcessResult<WorkflowState>> {
    match result {
      Ok(value) => {
        let transcript_text = value
          .get("transcript_text")
          .and_then(|item| item.as_str())
          .ok_or_else(|| anyhow!("字幕解析失败"))?;
        let transcript_segments = value
          .get("transcript_segments")
          .cloned()
          .ok_or_else(|| anyhow!("字幕片段缺失"))?;
        let transcript_source = value
          .get("transcript_source")
          .cloned()
          .ok_or_else(|| anyhow!("字幕来源缺失"))?;
        let segments = serde_json::from_value::<Vec<TranscriptSegment>>(transcript_segments)?;
        let source = serde_json::from_value::<TranscriptSource>(transcript_source)?;
        set_transcript_context(context, transcript_text, segments, source);
        Ok(ProcessResult::new(WorkflowState::WhisperDone, "whisper_done".to_string()))
      }
      Err(err) => Err(anyhow!(err.to_string()))
    }
  }
}

// 节点：生成提示词
struct BuildPromptNode;

#[async_trait::async_trait]
impl Node for BuildPromptNode {
  type State = WorkflowState;

  // 结合标题与字幕生成模型提示词
  async fn execute(&self, context: &Context) -> Result<serde_json::Value> {
    let title = context_required_string(context, "title")?;
    let segments = context_optional_segments(context, "transcript_segments")
      .ok_or_else(|| anyhow!("缺少字段: transcript_segments"))?;
    let custom_prompt = context_optional_string(context, "prompt");
    let screenshot = context_optional_bool(context, "screenshot");
    let mode = context_optional_string(context, "mode").unwrap_or_else(|| "summary".to_string());
    // timestamp 模式按段一行送入 LLM 做 1:1 修正；其余模式保留时间戳前缀
    let transcript_text = if mode == "timestamp" {
      segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
    } else {
      format_transcript_with_timestamps(&segments)
    };
    if custom_prompt.is_some() {
      info!("🧾 BuildPromptNode 使用自定义 prompt: title={}", title);
    } else {
      info!("🧾 BuildPromptNode 使用默认 prompt: title={}", title);
    }
    let prompt = build_prompt(&title, &transcript_text, custom_prompt.as_deref(), screenshot);

    Ok(json!({
      "prompt": prompt
    }))
  }

  // 写回提示词以供后续调用模型
  async fn post_process(
    &self,
    context: &mut Context,
    result: &Result<serde_json::Value>
  ) -> Result<ProcessResult<WorkflowState>> {
    match result {
      Ok(value) => {
        let prompt = value
          .get("prompt")
          .and_then(|item| item.as_str())
          .ok_or_else(|| anyhow!("提示词生成失败"))?;
        context.set("prompt_text", json!(prompt));
        Ok(ProcessResult::new(WorkflowState::PromptReady, "prompt_ready".to_string()))
      }
      Err(err) => Err(anyhow!(err.to_string()))
    }
  }
}

// 节点：调用 LLM 生成摘要
struct CallLlmNode;

#[async_trait::async_trait]
impl Node for CallLlmNode {
  type State = WorkflowState;

  // 调用大模型生成摘要文本
  async fn execute(&self, context: &Context) -> Result<serde_json::Value> {
    let api_key = context_required_string(context, "api_key")?;
    let model = context_optional_string(context, "model");
    let base_url = context_optional_string(context, "base_url");
    let prompt = context_required_string(context, "prompt_text")?;
    let title = context_required_string(context, "title")?;
    let transcript_text = context_required_string(context, "transcript_text")?;
    let _transcript_source = context_optional_source(context, "transcript_source")
      .ok_or_else(|| anyhow!("字幕来源缺失"))?;

    info!(
      "🤖 CallLlmNode 请求: model={}, base_url={}, prompt_len={}",
      model.as_deref().unwrap_or("默认"),
      base_url.as_deref().unwrap_or("默认"),
      prompt.len()
    );
    let client = Client::builder().user_agent("SiriusX Summary/0.1").build()?;
    let summary = call_llm(&client, &api_key, model.as_deref(), base_url.as_deref(), &prompt)
      .await
      .map_err(|err| anyhow!(err))?;
    let mode = context_optional_string(context, "mode").unwrap_or_else(|| "summary".to_string());
    let mut final_segments: Option<Vec<TranscriptSegment>> = None;
    if mode == "timestamp" {
      // timestamp 模式：LLM 已按行 1:1 修正文本，与原 segment 时间戳对齐
      let corrected_lines: Vec<&str> = summary
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect();
      let original_segments = context_optional_segments(context, "transcript_segments")
        .ok_or_else(|| anyhow!("timestamp 模式需要 transcript_segments"))?;
      let corrected_segments: Vec<TranscriptSegment> = original_segments
        .iter()
        .enumerate()
        .map(|(i, seg)| TranscriptSegment {
          start: seg.start,
          end: seg.end,
          text: corrected_lines
            .get(i)
            .map(|s| s.to_string())
            .unwrap_or_else(|| seg.text.clone())
        })
        .collect();
      let merged = merge_transcript_segments(corrected_segments, TIMESTAMP_MERGE_THRESHOLD_SECS);
      info!(
        "⏱️ timestamp 模式合并完成: {} 段 → {} 段",
        original_segments.len(),
        merged.len()
      );
      final_segments = Some(merged);
    }

    let mut html_subtitle = None;
    let mut html_stamp = None;
    match generate_html_labels(
      &api_key,
      model.as_deref(),
      base_url.as_deref(),
      &title,
      &summary
    )
    .await
    {
      Ok((subtitle, stamp)) => {
        if !subtitle.trim().is_empty() {
          html_subtitle = Some(subtitle);
        }
        if !stamp.trim().is_empty() {
          html_stamp = Some(stamp);
        }
      }
      Err(err) => {
        warn!("⚠️ HTML 文案生成失败: {}", err);
      }
    }

    let summary_text = if mode == "timestamp" {
      // 展示给用户的 summary 改写为 [mm:ss-mm:ss] 文本 块
      final_segments
        .as_ref()
        .map(|segs| {
          segs
            .iter()
            .map(|s| {
              format!(
                "[{:02}:{:02}-{:02}:{:02}] {}",
                (s.start as u64) / 60,
                (s.start as u64) % 60,
                (s.end as u64) / 60,
                (s.end as u64) % 60,
                s.text
              )
            })
            .collect::<Vec<_>>()
            .join("\n\n")
        })
        .unwrap_or_else(|| summary.clone())
    } else {
      summary
    };
    info!("✅ CallLlmNode 生成摘要完成: length={}", summary_text.len());
    Ok(json!({
      "summary": summary_text,
      "transcript_segments_merged": final_segments,
      "html_subtitle": html_subtitle,
      "html_stamp": html_stamp
    }))
  }

  // 写回摘要文本
  async fn post_process(
    &self,
    context: &mut Context,
    result: &Result<serde_json::Value>
  ) -> Result<ProcessResult<WorkflowState>> {
    match result {
      Ok(value) => {
        let summary = value
          .get("summary")
          .and_then(|item| item.as_str())
          .ok_or_else(|| anyhow!("模型总结失败"))?;
        let html_subtitle = value
          .get("html_subtitle")
          .and_then(|item| item.as_str())
          .map(|text| text.to_string());
        let html_stamp = value
          .get("html_stamp")
          .and_then(|item| item.as_str())
          .map(|text| text.to_string());
        context.set("summary", json!(summary));
        if let Some(html_subtitle) = html_subtitle {
          context.set("html_subtitle", json!(html_subtitle));
        }
        if let Some(html_stamp) = html_stamp {
          context.set("html_stamp", json!(html_stamp));
        }
        if let Some(merged) = value.get("transcript_segments_merged") {
          if !merged.is_null() {
            context.set("transcript_segments_merged", merged.clone());
          }
        }
        Ok(ProcessResult::new(WorkflowState::SummaryReady, "summary_ready".to_string()))
      }
      Err(err) => Err(anyhow!(err.to_string()))
    }
  }
}

// 节点：组装最终响应
struct AssembleResponseNode;

#[async_trait::async_trait]
impl Node for AssembleResponseNode {
  type State = WorkflowState;

  // 汇总摘要、字幕并生成 Markdown/HTML
  async fn execute(&self, context: &Context) -> Result<serde_json::Value> {
    let run_id = context_required_string(context, "run_id")?;
    let title = context_required_string(context, "title")?;
    let summary = context_required_string(context, "summary")?;
    let url = context_required_string(context, "url")?;
    let transcript_text = context_required_string(context, "transcript_text")?;
    let cookie = context_optional_string(context, "cookie");
    let run_dir = context_required_path(context, "run_dir")?;
    let transcript_segments = context_optional_segments(context, "transcript_segments_merged")
      .or_else(|| context_optional_segments(context, "transcript_segments"))
      .ok_or_else(|| anyhow!("字幕片段缺失"))?;
    let transcript_source = context_optional_source(context, "transcript_source")
      .ok_or_else(|| anyhow!("字幕来源缺失"))?;
    let screenshot = context_optional_bool(context, "screenshot");
    let html_subtitle = context_optional_string(context, "html_subtitle");
    let html_stamp = context_optional_string(context, "html_stamp");
    info!(
      "🧩 AssembleResponseNode 组装响应: title={}, segments={}",
      title,
      transcript_segments.len()
    );
    let timestamp_value = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let formatted_transcript = format_transcript_with_timestamps(&transcript_segments);
    let mut markdown = format!(
      "# {title}\n\n## 摘要\n\n{summary}\n\n## 视频信息\n\n- 视频地址: {url}\n- 生成时间: {time}\n\n## 字幕来源\n\n{source}\n\n## 字幕内容\n\n{transcript}",
      title = title,
      summary = summary,
      url = url,
      time = timestamp_value,
      source = format_transcript_source(transcript_source),
      transcript = formatted_transcript
    );
    if screenshot {
      let markers = extract_screenshot_markers(&markdown);
      if !markers.is_empty() {
        let video_dir = run_dir.join("resources");
        let video_path = download_video_with_ytdlp(&url, cookie.as_deref(), &video_dir)
          .map_err(|err| anyhow!(err))?;
        let screenshot_dir = run_dir.join("screenshots");
        let image_base = format!("/output/{run_id}/screenshots", run_id = run_id);
        for (index, (marker, timestamp)) in markers.iter().enumerate() {
          let image_path = generate_screenshot(&video_path, &screenshot_dir, *timestamp, index)
            .map_err(|err| anyhow!(err))?;
          let filename = image_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| anyhow!("截图文件名解析失败"))?;
          let image_url = format!("{}/{}", image_base.trim_end_matches('/'), filename);
          markdown = markdown.replacen(marker, &format!("![]({})", image_url), 1);
        }
      }
    }
    let stripped_markdown = strip_markdown_title(&markdown);
    let html = render_markdown_html(
      &title,
      &stripped_markdown,
      html_subtitle.as_deref(),
      html_stamp.as_deref()
    );
    write_output_files(&run_dir, &run_id, &markdown, &html, &transcript_text)?;

    let response = SummarizeResponse {
      run_id,
      title,
      summary,
      markdown,
      html,
      html_subtitle,
      html_stamp,
      transcript: Some(transcript_text),
      transcript_segments: Some(transcript_segments),
      transcript_source: Some(transcript_source)
    };

    Ok(serde_json::to_value(response)?)
  }

  // 响应写回 Context 作为最终输出
  async fn post_process(
    &self,
    context: &mut Context,
    result: &Result<serde_json::Value>
  ) -> Result<ProcessResult<WorkflowState>> {
    match result {
      Ok(value) => {
        context.set("result", value.clone());
        Ok(ProcessResult::new(WorkflowState::Default, "response_ready".to_string()))
      }
      Err(err) => Err(anyhow!(err.to_string()))
    }
  }
}
