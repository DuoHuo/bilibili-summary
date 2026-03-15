use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct AppState {
  pub http: reqwest::Client
}

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

#[derive(Serialize)]
pub struct SummarizeResponse {
  pub title: String,
  pub summary: String,
  pub markdown: String,
  pub transcript: Option<String>,
  pub transcript_segments: Option<Vec<TranscriptSegment>>,
  pub transcript_source: Option<TranscriptSource>
}

#[derive(Serialize)]
pub struct ErrorResponse {
  pub message: String
}

#[derive(Clone, Copy)]
pub enum Platform {
  Bilibili,
  Youtube
}

#[derive(Serialize, Clone)]
pub struct TranscriptSegment {
  pub start: f64,
  pub end: f64,
  pub text: String
}

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptSource {
  Subtitle,
  Whisper
}

#[derive(Clone)]
pub struct Transcript {
  pub text: String,
  pub segments: Vec<TranscriptSegment>,
  pub source: TranscriptSource
}

#[derive(Deserialize)]
pub struct BiliViewResponse {
  pub data: Option<BiliViewData>
}

#[derive(Deserialize)]
pub struct BiliViewData {
  pub title: Option<String>,
  pub cid: Option<u64>
}

#[derive(Deserialize)]
pub struct BiliSubtitleIndexResponse {
  pub data: Option<BiliSubtitleIndexData>
}

#[derive(Deserialize)]
pub struct BiliSubtitleIndexData {
  pub subtitle: Option<BiliSubtitleGroup>
}

#[derive(Deserialize)]
pub struct BiliSubtitleGroup {
  pub subtitles: Option<Vec<BiliSubtitleItem>>,
  pub ai_subtitle: Option<BiliSubtitleItem>
}

#[derive(Deserialize)]
pub struct BiliSubtitleItem {
  pub subtitle_url: Option<String>
}

#[derive(Deserialize)]
pub struct BiliSubtitleBodyEntry {
  pub content: Option<String>,
  pub from: Option<f64>,
  pub to: Option<f64>
}

#[derive(Deserialize)]
pub struct BiliSubtitleBody {
  pub body: Option<Vec<BiliSubtitleBodyEntry>>
}

#[derive(Deserialize)]
pub struct YoutubeOEmbed {
  pub title: Option<String>
}

#[derive(Deserialize)]
pub struct OpenAIResponse {
  pub choices: Vec<OpenAIChoice>
}

#[derive(Deserialize)]
pub struct OpenAIChoice {
  pub message: OpenAIMessage
}

#[derive(Serialize, Deserialize)]
pub struct OpenAIMessage {
  pub role: String,
  pub content: String
}
