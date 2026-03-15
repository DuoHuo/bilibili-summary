use axum::{extract::State, http::StatusCode, Json};
use chrono::Local;
use tracing::info;

use crate::models::{
  AppState,
  ErrorResponse,
  Platform,
  SummarizeRequest,
  SummarizeResponse
};
use crate::services::{
  build_prompt,
  call_llm,
  detect_platform,
  format_transcript_source,
  summarize_bilibili,
  summarize_youtube,
  transcribe_with_whisper
};
use crate::utils::format_transcript_with_timestamps;

pub async fn summarize(
  State(state): State<std::sync::Arc<AppState>>,
  Json(payload): Json<SummarizeRequest>
) -> Result<Json<SummarizeResponse>, (StatusCode, Json<ErrorResponse>)> {
  let platform = detect_platform(&payload.url).map_err(|err| error_response(&err))?;
  let (title, mut transcript) = match platform {
    Platform::Bilibili => summarize_bilibili(&state.http, &payload.url)
      .await
      .map_err(|err| error_response(&err))?,
    Platform::Youtube => summarize_youtube(&state.http, &payload.url)
      .await
      .map_err(|err| error_response(&err))?
  };

  if transcript.is_none() {
    info!("⚠️ 未找到字幕，开始使用本地 Whisper 转写");
    transcript = Some(
      transcribe_with_whisper(
        &payload.url,
        payload.cookie.as_deref(),
        payload.stt_language.as_deref()
      )
        .await
        .map_err(|err| error_response(&err))?
    );
  }

  let transcript = transcript.ok_or_else(|| error_response("字幕与转写均失败"))?;
  info!(
    "✅ 字幕准备完成，来源: {:?}，长度: {}",
    transcript.source,
    transcript.text.len()
  );

  let prompt = build_prompt(&title, &transcript.text, payload.prompt.as_deref());
  info!("🧠 已生成提示词，长度: {}", prompt.len());

  let summary = call_llm(
    &state.http,
    &payload.api_key,
    payload.model.as_deref(),
    payload.base_url.as_deref(),
    &prompt
  )
  .await
  .map_err(|err| error_response(&err))?;
  info!("✅ 模型总结生成完成，长度: {}", summary.len());

  let formatted_transcript = format_transcript_with_timestamps(&transcript.segments);
  let markdown = format!(
    "# {title}\n\n## 摘要\n\n{summary}\n\n## 视频信息\n\n- 视频地址: {url}\n- 生成时间: {time}\n\n## 字幕来源\n\n{source}\n\n## 字幕内容\n\n{transcript}",
    title = title,
    summary = summary,
    url = payload.url,
    time = Local::now().format("%Y-%m-%d %H:%M:%S"),
    source = format_transcript_source(transcript.source),
    transcript = formatted_transcript
  );

  Ok(Json(SummarizeResponse {
    title,
    summary,
    markdown,
    transcript: Some(transcript.text),
    transcript_segments: Some(transcript.segments),
    transcript_source: Some(transcript.source)
  }))
}

fn error_response(message: &str) -> (StatusCode, Json<ErrorResponse>) {
  (
    StatusCode::BAD_REQUEST,
    Json(ErrorResponse {
      message: message.to_string()
    })
  )
}
