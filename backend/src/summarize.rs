use anyhow::{anyhow, Result};
use axum::{extract::State, http::StatusCode, Json};
use chrono::Local;
use pocketflow_rs::{build_flow, Context, Node, ProcessResult, ProcessState};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tracing::{error, info, warn};

use crate::services::{
  build_prompt,
  call_llm,
  detect_platform,
  format_transcript_source,
  summarize_bilibili,
  summarize_youtube,
  transcribe_with_whisper,
  Platform,
  TranscriptSegment,
  TranscriptSource
};
use crate::utils::format_transcript_with_timestamps;

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
  pub stt_language: Option<String>
}

// 响应体：结构化摘要 + Markdown/HTML
#[derive(Serialize, Deserialize)]
pub struct SummarizeResponse {
  pub title: String,
  pub summary: String,
  pub markdown: String,
  pub html: String,
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

  let flow = build_summary_flow();
  let context = build_flow_context(&payload);
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
fn build_flow_context(request: &SummarizeRequest) -> Context {
  let mut context = Context::new();
  context.set("url", json!(request.url));
  context.set("api_key", json!(request.api_key));
  context.set("model", json!(request.model));
  context.set("base_url", json!(request.base_url));
  context.set("prompt", json!(request.prompt));
  context.set("cookie", json!(request.cookie));
  context.set("stt_language", json!(request.stt_language));
  context
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
    info!(
      "🎙️ WhisperTranscribeNode 请求: url={}, cookie={}, stt_language={}",
      url,
      if cookie.is_some() { "已提供" } else { "未提供" },
      stt_language.as_deref().unwrap_or("未设置")
    );
    let transcript = transcribe_with_whisper(&url, cookie.as_deref(), stt_language.as_deref())
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
    let transcript_text = context_required_string(context, "transcript_text")?;
    let custom_prompt = context_optional_string(context, "prompt");
    if custom_prompt.is_some() {
      info!("🧾 BuildPromptNode 使用自定义 prompt: title={}", title);
    } else {
      info!("🧾 BuildPromptNode 使用默认 prompt: title={}", title);
    }
    let prompt = build_prompt(&title, &transcript_text, custom_prompt.as_deref());

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

    info!("✅ CallLlmNode 生成摘要完成: length={}", summary.len());
    Ok(json!({
      "summary": summary
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
        context.set("summary", json!(summary));
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
    let title = context_required_string(context, "title")?;
    let summary = context_required_string(context, "summary")?;
    let url = context_required_string(context, "url")?;
    let transcript_text = context_required_string(context, "transcript_text")?;
    let transcript_segments = context_optional_segments(context, "transcript_segments")
      .ok_or_else(|| anyhow!("字幕片段缺失"))?;
    let transcript_source = context_optional_source(context, "transcript_source")
      .ok_or_else(|| anyhow!("字幕来源缺失"))?;
    info!(
      "🧩 AssembleResponseNode 组装响应: title={}, segments={}",
      title,
      transcript_segments.len()
    );
    let timestamp_value = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let formatted_transcript = format_transcript_with_timestamps(&transcript_segments);
    let markdown = format!(
      "# {title}\n\n## 摘要\n\n{summary}\n\n## 视频信息\n\n- 视频地址: {url}\n- 生成时间: {time}\n\n## 字幕来源\n\n{source}\n\n## 字幕内容\n\n{transcript}",
      title = title,
      summary = summary,
      url = url,
      time = timestamp_value,
      source = format_transcript_source(transcript_source),
      transcript = formatted_transcript
    );
    let html = format!(
      "<article class=\"summary\">\n  <h1>{title}</h1>\n  <section>\n    <h2>摘要</h2>\n    <p>{summary}</p>\n  </section>\n  <section class=\"meta\">\n    <h2>视频信息</h2>\n    <ul>\n      <li><strong>视频地址</strong> {url}</li>\n      <li><strong>生成时间</strong> {time}</li>\n    </ul>\n  </section>\n  <section>\n    <h2>字幕来源</h2>\n    <p>{source}</p>\n  </section>\n  <section>\n    <h2>字幕内容</h2>\n    <pre>{transcript}</pre>\n  </section>\n</article>",
      title = title,
      summary = summary,
      url = url,
      time = timestamp_value,
      source = format_transcript_source(transcript_source),
      transcript = formatted_transcript
    );

    let response = SummarizeResponse {
      title,
      summary,
      markdown,
      html,
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
