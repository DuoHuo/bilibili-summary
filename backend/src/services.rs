use hound::WavReader;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{
  fs,
  path::Path,
  path::PathBuf,
  process::Command,
  time::{SystemTime, UNIX_EPOCH}
};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tracing::{error, info, warn};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext};

// 平台枚举
#[derive(Clone, Copy)]
pub enum Platform {
  Bilibili,
  Youtube
}

// 字幕片段结构
#[derive(Serialize, Deserialize, Clone)]
pub struct TranscriptSegment {
  pub start: f64,
  pub end: f64,
  pub text: String
}

// 字幕来源
#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptSource {
  Subtitle,
  Whisper,
}

// 统一字幕载体
#[derive(Clone)]
pub struct Transcript {
  pub text: String,
  pub segments: Vec<TranscriptSegment>,
  pub source: TranscriptSource
}

// YouTube 标题响应
#[derive(Deserialize)]
pub struct YoutubeOEmbed {
  pub title: Option<String>
}

// OpenAI 响应结构
#[derive(Deserialize)]
pub struct OpenAIResponse {
  pub choices: Vec<OpenAIChoice>
}

#[derive(Deserialize)]
pub struct OpenAIChoice {
  pub message: OpenAIMessage
}

#[derive(Deserialize)]
pub struct OpenAIMessage {
  pub role: String,
  pub content: String
}

use crate::utils::{format_transcript_with_timestamps, parse_youtube_subtitles_xml};

// B 站与 YouTube 字幕抓取/转写相关服务
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

// 平台识别：支持 B 站与 YouTube
pub fn detect_platform(url: &str) -> Result<Platform, String> {
  let parsed = url::Url::parse(url).map_err(|_| "无效的链接".to_string())?;
  let host = parsed.host_str().unwrap_or_default();
  info!("🔍 平台识别: host={}", host);
  if host.contains("bilibili.com") {
    return Ok(Platform::Bilibili);
  }
  if host.contains("youtube.com") || host.contains("youtu.be") {
    return Ok(Platform::Youtube);
  }
  Err("暂不支持该链接，请输入 B 站或 YouTube 视频链接".to_string())
}

// B 站：获取视频标题与字幕
pub async fn summarize_bilibili(client: &Client, url: &str) -> Result<(String, Option<Transcript>), String> {
  let video_id = parse_bilibili_id(url).ok_or_else(|| "无效的 B 站链接".to_string())?;
  info!("🔍 解析 B 站链接完成: {}", video_id);

  let (title, cid) = fetch_bilibili_meta(client, &video_id).await?;
  info!("✅ 获取视频信息成功: {} (cid: {})", title, cid);

  let transcript = fetch_bilibili_subtitles(client, &video_id, cid).await?;
  if transcript.is_some() {
    info!("✅ B 站字幕获取成功: {}", title);
  } else {
    warn!("⚠️ B 站字幕不存在或为空: {}", title);
  }
  Ok((title, transcript))
}

// YouTube：获取视频标题与字幕
pub async fn summarize_youtube(client: &Client, url: &str) -> Result<(String, Option<Transcript>), String> {
  let video_id = parse_youtube_id(url).ok_or_else(|| "无效的 YouTube 链接".to_string())?;
  info!("🔍 解析 YouTube 链接完成: {}", video_id);

  let title = fetch_youtube_title(client, url).await?;
  info!("✅ 获取视频信息成功: {}", title);

  let transcript = fetch_youtube_subtitles(client, &video_id).await?;
  if transcript.is_some() {
    info!("✅ YouTube 字幕获取成功: {}", title);
  } else {
    warn!("⚠️ YouTube 字幕不存在或为空: {}", title);
  }
  Ok((title, transcript))
}

fn parse_bilibili_id(url: &str) -> Option<String> {
  let parsed = url::Url::parse(url).ok()?;
  let path_segments = parsed.path_segments()?.collect::<Vec<_>>();
  path_segments.iter().find_map(|segment| {
    if segment.starts_with("BV") {
      Some(segment.to_string())
    } else {
      None
    }
  })
}

fn parse_youtube_id(url: &str) -> Option<String> {
  let parsed = url::Url::parse(url).ok()?;
  let host = parsed.host_str().unwrap_or_default();
  if host.contains("youtu.be") {
    return parsed.path_segments()?.next().map(|id| id.to_string());
  }
  let path_segments = parsed.path_segments()?.collect::<Vec<_>>();
  if path_segments.first().map(|value| *value) == Some("watch") {
    return parsed
      .query_pairs()
      .find(|(key, _)| key == "v")
      .map(|(_, value)| value.to_string());
  }
  if path_segments.first().map(|value| *value) == Some("shorts") {
    return path_segments.get(1).map(|id| id.to_string());
  }
  None
}

async fn fetch_bilibili_meta(client: &Client, bvid: &str) -> Result<(String, u64), String> {
  // B 站元信息接口
  let url = format!("https://api.bilibili.com/x/web-interface/view?bvid={}", bvid);
  info!("🔗 请求 B 站元信息: {}", url);
  let resp = client
    .get(url)
    .send()
    .await
    .map_err(|err| {
      error!("❌ 获取 B 站视频信息失败: {}", err);
      "获取视频信息失败".to_string()
    })?;

  if !resp.status().is_success() {
    warn!("⚠️ B 站元信息状态异常: {}", resp.status());
    return Err("获取视频信息失败".to_string());
  }

  let data = resp
    .json::<BiliViewResponse>()
    .await
    .map_err(|err| {
      error!("❌ 解析 B 站视频信息失败: {}", err);
      "解析视频信息失败".to_string()
    })?;

  let info = data
    .data
    .ok_or_else(|| {
      warn!("⚠️ B 站视频信息为空");
      "视频信息为空".to_string()
    })?;

  let title = info.title.unwrap_or_else(|| "未命名视频".to_string());
  let cid = info.cid.ok_or_else(|| "视频 CID 不存在".to_string())?;

  Ok((title, cid))
}

async fn fetch_bilibili_subtitles(
  client: &Client,
  bvid: &str,
  cid: u64
) -> Result<Option<Transcript>, String> {
  // B 站字幕索引接口
  let url = format!(
    "https://api.bilibili.com/x/player/v2?bvid={}&cid={}",
    bvid, cid
  );
  info!("🔗 请求 B 站字幕索引: {}", url);
  let resp = client
    .get(url)
    .send()
    .await
    .map_err(|err| {
      error!("❌ 获取字幕索引失败: {}", err);
      "获取字幕索引失败".to_string()
    })?;

  if !resp.status().is_success() {
    warn!("⚠️ B 站字幕索引状态异常: {}", resp.status());
    return Err("获取字幕索引失败".to_string());
  }

  let data = resp
    .json::<BiliSubtitleIndexResponse>()
    .await
    .map_err(|err| {
      error!("❌ 解析字幕索引失败: {}", err);
      "解析字幕索引失败".to_string()
    })?;

  let subtitles_group = data
    .data
    .and_then(|item| item.subtitle)
    .unwrap_or(BiliSubtitleGroup {
      subtitles: None,
      ai_subtitle: None
    });

  let mut subtitle_candidates = subtitles_group.subtitles.unwrap_or_default();
  if subtitle_candidates.is_empty() {
    if let Some(ai_subtitle) = subtitles_group.ai_subtitle {
      subtitle_candidates.push(ai_subtitle);
    }
  }

  if subtitle_candidates.is_empty() {
    return Ok(None);
  }

  let subtitle_url = subtitle_candidates
    .iter()
    .find_map(|item| item.subtitle_url.as_ref())
    .ok_or_else(|| "字幕链接不存在".to_string())?;

  let subtitle_url = if subtitle_url.starts_with("//") {
    format!("https:{}", subtitle_url)
  } else {
    subtitle_url.to_string()
  };

  let body_resp = client
    .get(subtitle_url)
    .send()
    .await
    .map_err(|err| {
      error!("❌ 获取字幕内容失败: {}", err);
      "获取字幕内容失败".to_string()
    })?;

  if !body_resp.status().is_success() {
    warn!("⚠️ B 站字幕内容状态异常: {}", body_resp.status());
    return Err("获取字幕内容失败".to_string());
  }

  let body = body_resp
    .json::<BiliSubtitleBody>()
    .await
    .map_err(|err| {
      error!("❌ 解析字幕内容失败: {}", err);
      "解析字幕内容失败".to_string()
    })?;

  let mut segments = body
    .body
    .unwrap_or_default()
    .iter()
    .filter_map(|item| {
      let text = item.content.as_ref()?.trim();
      if text.is_empty() {
        return None;
      }
      Some(TranscriptSegment {
        start: item.from.unwrap_or(0.0),
        end: item.to.unwrap_or(item.from.unwrap_or(0.0)),
        text: text.to_string()
      })
    })
    .collect::<Vec<_>>();

  if segments.is_empty() {
    warn!("⚠️ B 站字幕解析为空");
    return Ok(None);
  }

  segments.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
  Ok(Some(Transcript {
    text: format_transcript_with_timestamps(&segments),
    segments,
    source: TranscriptSource::Subtitle
  }))
}

async fn fetch_youtube_title(client: &Client, url: &str) -> Result<String, String> {
  // YouTube OEmbed 获取标题
  let endpoint = format!("https://www.youtube.com/oembed?url={}&format=json", url);
  info!("🔗 请求 YouTube 标题: {}", endpoint);
  let resp = client
    .get(endpoint)
    .send()
    .await
    .map_err(|err| {
      error!("❌ 获取 YouTube 标题失败: {}", err);
      "获取 YouTube 标题失败".to_string()
    })?;

  if !resp.status().is_success() {
    warn!("⚠️ YouTube 标题状态异常: {}", resp.status());
    return Err("获取 YouTube 标题失败".to_string());
  }

  let data = resp
    .json::<YoutubeOEmbed>()
    .await
    .map_err(|err| {
      error!("❌ 解析 YouTube 标题失败: {}", err);
      "解析 YouTube 标题失败".to_string()
    })?;

  Ok(data.title.unwrap_or_else(|| "未命名视频".to_string()))
}

async fn fetch_youtube_subtitles(client: &Client, video_id: &str) -> Result<Option<Transcript>, String> {
  // 优先中文，其次英文字幕
  let languages = ["zh-Hans", "zh", "en"];
  for language in languages {
    info!("🔍 尝试 YouTube 字幕语言: {}", language);
    if let Some(segments) = fetch_youtube_subtitles_by_language(client, video_id, language, false).await? {
      info!("✅ YouTube 字幕获取成功: lang={}, asr=false", language);
      return Ok(Some(Transcript {
        text: format_transcript_with_timestamps(&segments),
        segments,
        source: TranscriptSource::Subtitle
      }));
    }
    if let Some(segments) = fetch_youtube_subtitles_by_language(client, video_id, language, true).await? {
      info!("✅ YouTube 字幕获取成功: lang={}, asr=true", language);
      return Ok(Some(Transcript {
        text: format_transcript_with_timestamps(&segments),
        segments,
        source: TranscriptSource::Subtitle
      }));
    }
  }
  warn!("⚠️ 未找到可用的 YouTube 字幕");
  Ok(None)
}

async fn fetch_youtube_subtitles_by_language(
  client: &Client,
  video_id: &str,
  language: &str,
  use_asr: bool
) -> Result<Option<Vec<TranscriptSegment>>, String> {
  // YouTube 字幕接口，use_asr 表示自动字幕
  let asr_suffix = if use_asr { "&kind=asr" } else { "" };
  let url = format!(
    "https://video.google.com/timedtext?lang={}&v={}&fmt=srv3{}",
    language, video_id, asr_suffix
  );
  info!("🔗 请求 YouTube 字幕: {}", url);
  let resp = client
    .get(url)
    .send()
    .await
    .map_err(|err| {
      error!("❌ 获取 YouTube 字幕失败: {}", err);
      "获取 YouTube 字幕失败".to_string()
    })?;

  if !resp.status().is_success() {
    warn!("⚠️ YouTube 字幕状态异常: {}", resp.status());
    return Ok(None);
  }

  let xml = resp
    .text()
    .await
    .map_err(|err| {
      error!("❌ 解析 YouTube 字幕失败: {}", err);
      "解析 YouTube 字幕失败".to_string()
    })?;

  let segments = parse_youtube_subtitles_xml(&xml);
  if segments.is_empty() {
    Ok(None)
  } else {
    Ok(Some(segments))
  }
}

// Whisper 转写入口：下载音频后进行本地转写
pub async fn transcribe_with_whisper(
  url: &str,
  cookie: Option<&str>,
  language: Option<&str>,
  run_dir: &Path
) -> Result<Transcript, String> {
  info!("🎧 Whisper 转写开始: url={}", url);
  let resources_dir = run_dir.join("resources");
  fs::create_dir_all(&resources_dir)
    .map_err(|_| "创建资源目录失败".to_string())?;
  let audio_path = download_audio_with_ytdlp(url, cookie, &resources_dir)?;
  info!("🎧 音频下载完成: {}", audio_path.display());
  let segments = transcribe_audio_segments(&audio_path, language).await?;
  if segments.is_empty() {
    warn!("⚠️ Whisper 转写结果为空");
    return Err("Whisper 转写结果为空".to_string());
  }

  info!("✅ Whisper 转写完成: segments={}", segments.len());
  Ok(Transcript {
    text: format_transcript_with_timestamps(&segments),
    segments,
    source: TranscriptSource::Whisper
  })
}

fn build_whisper_audio_name(url: &str) -> Result<String, String> {
  if let Some(video_id) = parse_bilibili_id(url) {
    return Ok(video_id);
  }
  if let Some(video_id) = parse_youtube_id(url) {
    return Ok(format!("youtube-{video_id}"));
  }
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|_| "生成音频文件名失败".to_string())?
    .as_nanos();
  Ok(format!("audio-{nanos}"))
}

/// 将 cookie 输入解析为 yt-dlp 可用的 `cookies.txt` 文件路径。
///
/// 接受两种形式：
/// - 已存在的 Netscape cookies.txt 文件路径 → 原样返回
/// - `key=value; key=value; ...` 形式的 cookie 串 → 写入临时 Netscape 文件
///
/// 统一走 `--cookies <file>`，规避 `--add-header "Cookie: ..."` 在新版 yt-dlp 中
/// 只附加到媒体下载、不发到元数据 API 的行为（B 站 `playurl` 因此 412）。
fn prepare_ytdlp_cookies(
  url: &str,
  cookie: Option<&str>,
  output_dir: &Path
) -> Result<Option<PathBuf>, String> {
  let Some(value) = cookie.map(str::trim).filter(|s| !s.is_empty()) else {
    return Ok(None);
  };

  // 已存在的文件路径：原样使用
  let candidate = PathBuf::from(value);
  if candidate.is_file() {
    return Ok(Some(candidate));
  }

  // Cookie 串：写入 Netscape 格式
  if !value.contains('=') {
    return Err(format!(
      "cookie 字段既不是已存在的文件，也不是有效的 cookie 字符串: {value}"
    ));
  }

  let domain = url::Url::parse(url)
    .ok()
    .and_then(|u| u.host_str().map(str::to_owned))
    .and_then(|h| {
      let parts: Vec<&str> = h.split('.').collect();
      (parts.len() >= 2).then(|| parts[parts.len() - 2..].join("."))
    })
    .ok_or_else(|| "无法解析 URL 域名".to_string())?;

  let mut content = String::from("# Netscape HTTP Cookie File\n");
  for pair in value.split(';') {
    let Some((name, val)) = pair.trim().split_once('=') else {
      continue;
    };
    content.push_str(&format!(
      ".{domain}\tTRUE\t/\tFALSE\t0\t{}\t{}\n",
      name.trim(),
      val.trim()
    ));
  }

  let cookie_file = output_dir.join("cookies.txt");
  fs::write(&cookie_file, content).map_err(|e| format!("写入 cookie 文件失败: {e}"))?;
  info!("🍪 cookie 已写入临时文件: {}", cookie_file.display());
  Ok(Some(cookie_file))
}

fn download_audio_with_ytdlp(url: &str, cookie: Option<&str>, output_dir: &Path) -> Result<PathBuf, String> {
  // 使用 yt-dlp 拉取音频并转为 16k 单声道 wav
  let output_name = build_whisper_audio_name(url)?;
  let output_template = output_dir
    .join(format!("{output_name}.%(ext)s"))
    .to_string_lossy()
    .to_string();

  let cookie_file = prepare_ytdlp_cookies(url, cookie, output_dir)?;

  let mut command = Command::new("yt-dlp");
  command
    .arg("-x")
    .arg("--audio-format")
    .arg("wav")
    .arg("--audio-quality")
    .arg("0")
    .arg("--postprocessor-args")
    .arg("-ar 16000 -ac 1")
    .arg("-o")
    .arg(output_template)
    .arg(url);

  if let Some(path) = cookie_file {
    command.arg("--cookies").arg(path);
  }

  let status = command
    .status()
    .map_err(|_| "调用 yt-dlp 失败，请确认已安装".to_string())?;

  if !status.success() {
    return Err("下载音频失败，请检查 yt-dlp 输出".to_string());
  }

  let wav_path = output_dir.join(format!("{output_name}.wav"));
  if wav_path.exists() {
    return Ok(wav_path);
  }

  let mut wav_path = None;
  if let Ok(entries) = std::fs::read_dir(output_dir) {
    for entry in entries.flatten() {
      let path = entry.path();
      if path.extension().and_then(|ext| ext.to_str()) == Some("wav") {
        wav_path = Some(path);
        break;
      }
    }
  }

  wav_path.ok_or_else(|| "下载音频失败，未找到 wav 文件".to_string())
}

pub fn download_video_with_ytdlp(
  url: &str,
  cookie: Option<&str>,
  output_dir: &Path
) -> Result<PathBuf, String> {
  let output_name = build_whisper_audio_name(url)?;
  let output_template = output_dir
    .join(format!("{output_name}.%(ext)s"))
    .to_string_lossy()
    .to_string();

  fs::create_dir_all(output_dir).map_err(|_| "创建视频目录失败".to_string())?;
  let cookie_file = prepare_ytdlp_cookies(url, cookie, output_dir)?;

  let mut command = Command::new("yt-dlp");
  command
    .arg("-f")
    .arg("bestvideo+bestaudio/best")
    .arg("--merge-output-format")
    .arg("mp4")
    .arg("-o")
    .arg(output_template)
    .arg(url);

  if let Some(path) = cookie_file {
    command.arg("--cookies").arg(path);
  }

  let status = command
    .status()
    .map_err(|_| "调用 yt-dlp 失败，请确认已安装".to_string())?;

  if !status.success() {
    return Err("下载视频失败，请检查 yt-dlp 输出".to_string());
  }

  let mp4_path = output_dir.join(format!("{output_name}.mp4"));
  if mp4_path.exists() {
    return Ok(mp4_path);
  }

  let mut video_path = None;
  if let Ok(entries) = std::fs::read_dir(output_dir) {
    for entry in entries.flatten() {
      let path = entry.path();
      if path.extension().and_then(|ext| ext.to_str()) == Some("mp4") {
        video_path = Some(path);
        break;
      }
    }
  }

  video_path.ok_or_else(|| "下载视频失败，未找到 mp4 文件".to_string())
}

pub fn generate_screenshot(
  video_path: &Path,
  output_dir: &Path,
  timestamp: u64,
  index: usize
) -> Result<PathBuf, String> {
  fs::create_dir_all(output_dir).map_err(|_| "创建截图目录失败".to_string())?;
  let filename = format!("screenshot_{index:03}_{timestamp}.jpg");
  let output_path = output_dir.join(filename);
  let status = Command::new("ffmpeg")
    .arg("-ss")
    .arg(timestamp.to_string())
    .arg("-i")
    .arg(video_path)
    .arg("-frames:v")
    .arg("1")
    .arg("-q:v")
    .arg("2")
    .arg(&output_path)
    .arg("-y")
    .status()
    .map_err(|_| "调用 ffmpeg 失败，请确认已安装".to_string())?;

  if !status.success() {
    return Err("截图失败，请检查 ffmpeg 输出".to_string());
  }

  Ok(output_path)
}

async fn transcribe_audio_segments(
  path: &Path,
  language: Option<&str>
) -> Result<Vec<TranscriptSegment>, String> {
  // 调用 whisper-rs 对音频进行转写
  let model_path = resolve_whisper_model_path().await?;
  let mut reader = WavReader::open(path).map_err(|_| "读取音频失败".to_string())?;
  let spec = reader.spec();
  if spec.channels != 1 || spec.sample_rate != 16000 {
    return Err("音频格式不符合要求，请确保采样率 16000Hz 且单声道".to_string());
  }

  let samples: Vec<f32> = reader
    .samples::<i16>()
    .filter_map(Result::ok)
    .map(|sample| sample as f32 / i16::MAX as f32)
    .collect();

  let ctx = WhisperContext::new_with_params(
    &model_path,
    Default::default()
  )
  .map_err(|_| "加载 Whisper 模型失败".to_string())?;
  let mut state = ctx
    .create_state()
    .map_err(|_| "初始化 Whisper 状态失败".to_string())?;

  let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
  if let Some(language) = language {
    params.set_language(Some(language));
    params.set_translate(false);
  }
  params.set_print_special(false);
  params.set_print_progress(false);
  params.set_print_realtime(false);
  params.set_print_timestamps(false);

  state
    .full(params, &samples)
    .map_err(|_| "Whisper 推理失败".to_string())?;

  let segment_count = state.full_n_segments();
  let mut segments = Vec::new();
  for index in 0..segment_count {
    if let Some(segment) = state.get_segment(index) {
      let start = segment.start_timestamp() as f64 / 100.0;
      let end = segment.end_timestamp() as f64 / 100.0;
      let text = segment
        .to_str_lossy()
        .map_err(|_| "读取 Whisper 片段失败".to_string())?
        .trim()
        .to_string();
      if !text.is_empty() {
        segments.push(TranscriptSegment { start, end, text });
      }
    }
  }

  Ok(segments)
}

async fn resolve_whisper_model_path() -> Result<PathBuf, String> {
  // 本地缓存模型，不存在则下载
  let models_dir = PathBuf::from("models");
  fs::create_dir_all(&models_dir)
    .map_err(|_| "创建 models 目录失败".to_string())?;
  let model_path = models_dir.join("ggml-base.bin");
  if model_path.exists() {
    info!("✅ Whisper 模型已存在: {}", model_path.display());
    return Ok(model_path);
  }

  info!("⬇️ 开始下载 Whisper 模型: {}", model_path.display());
  download_whisper_model(&model_path).await?;

  if model_path.exists() {
    info!("✅ Whisper 模型下载完成: {}", model_path.display());
    Ok(model_path)
  } else {
    Err("下载 Whisper 模型失败".to_string())
  }
}

async fn download_whisper_model(model_path: &Path) -> Result<(), String> {
  // 远程下载 Whisper 模型
  let url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
  info!("⬇️ 请求 Whisper 模型: {}", url);
  let response = Client::new()
    .get(url)
    .send()
    .await
    .map_err(|err| {
      error!("❌ 下载 Whisper 模型失败: {}", err);
      "下载 Whisper 模型失败".to_string()
    })?;

  if !response.status().is_success() {
    warn!("⚠️ Whisper 模型下载状态异常: {}", response.status());
    return Err("下载 Whisper 模型失败".to_string());
  }

  let bytes = response
    .bytes()
    .await
    .map_err(|err| {
      error!("❌ 读取 Whisper 模型失败: {}", err);
      "读取 Whisper 模型失败".to_string()
    })?;
  let mut file = File::create(model_path)
    .await
    .map_err(|err| {
      error!("❌ 保存 Whisper 模型失败: {}", err);
      "保存 Whisper 模型失败".to_string()
    })?;
  file
    .write_all(&bytes)
    .await
    .map_err(|err| {
      error!("❌ 写入 Whisper 模型失败: {}", err);
      "写入 Whisper 模型失败".to_string()
    })?;

  Ok(())
}

pub fn build_prompt(
  title: &str,
  transcript: &str,
  custom_prompt: Option<&str>,
  screenshot: bool
) -> String {
  // 支持自定义模板注入 title/transcript
  if let Some(custom) = custom_prompt {
    let mut prompt = custom
      .replace("{{title}}", title)
      .replace("{{transcript}}", transcript);
    if screenshot {
      prompt.push_str("\n\n8. **Screenshot placeholders**: If a section involves visual demonstrations, code walkthroughs, UI interactions, or any content where visuals aid understanding, insert a screenshot cue at the end of that section:\n- Format: `*Screenshot-[mm:ss]`\n- Only use it when truly helpful.\n");
    }
    return prompt;
  }

  let mut prompt = format!(
    "你是一位擅长整理视频的助手。请根据以下内容生成一份结构化总结，并保留关键时间戳：\n\n标题：{title}\n\n字幕：\n{transcript}\n\n总结要求：\n1. 200-400 字\n2. 列出 3-5 个关键要点\n3. 保留关键时间戳（如 01:23）\n4. 用中文输出\n",
    title = title,
    transcript = transcript
  );
  if screenshot {
    prompt.push_str("\n8. **Screenshot placeholders**: If a section involves visual demonstrations, code walkthroughs, UI interactions, or any content where visuals aid understanding, insert a screenshot cue at the end of that section:\n- Format: `*Screenshot-[mm:ss]`\n- Only use it when truly helpful.\n");
  }
  prompt
}

// 调用 OpenAI 兼容接口生成摘要
pub async fn call_llm(
  client: &Client,
  api_key: &str,
  model: Option<&str>,
  base_url: Option<&str>,
  prompt: &str
) -> Result<String, String> {
  let (endpoint, default_model) = resolve_endpoint(base_url)?;

  let model = model.unwrap_or(default_model);
  let body = serde_json::json!({
    "model": model,
    "messages": [
      { "role": "system", "content": "你是专业视频内容总结助手" },
      { "role": "user", "content": prompt }
    ]
  });

  let resp = client
    .post(&endpoint)
    .bearer_auth(api_key)
    .json(&body)
    .send()
    .await
    .map_err(|err| {
      error!("❌ 调用模型失败: {}", err);
      "调用模型失败".to_string()
    })?;

  let status = resp.status();
  let text = resp
    .text()
    .await
    .map_err(|err| {
      error!("❌ 解析模型响应失败: {}", err);
      "解析模型响应失败".to_string()
    })?;

  if !status.is_success() {
    error!("❌ 模型返回错误: status={}, body={}", status, text);
    return Err("模型调用失败".to_string());
  }

  let data: OpenAIResponse = serde_json::from_str(&text)
    .map_err(|err| {
      error!("❌ 解析模型响应 JSON 失败: {}", err);
      "解析模型响应失败".to_string()
    })?;

  let content = data
    .choices
    .first()
    .map(|choice| choice.message.content.trim().to_string())
    .unwrap_or_else(|| "模型未返回内容".to_string());

  Ok(content)
}

fn resolve_endpoint(base_url: Option<&str>) -> Result<(String, &'static str), String> {
  if let Some(base_url) = base_url {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
      return Err("自定义端点不能为空".to_string());
    }
    return Ok((format!("{}/chat/completions", trimmed), "gpt-4o-mini"));
  }

  Ok(("https://api.openai.com/v1/chat/completions".to_string(), "gpt-4o-mini"))
}

/// Timestamp 模式：贪心合并相邻 segment 直到累计时长达到阈值。
/// 见 `docs/superpowers/specs/2026-06-27-three-modes-design.md` §4.3 Step 2。
pub(crate) const TIMESTAMP_MERGE_THRESHOLD_SECS: f64 = 15.0;

pub(crate) fn merge_transcript_segments(
  segments: Vec<TranscriptSegment>,
  target_duration_secs: f64
) -> Vec<TranscriptSegment> {
  if segments.is_empty() {
    return vec![];
  }
  let mut chunks: Vec<TranscriptSegment> = Vec::new();
  let mut cur = segments[0].clone();
  for next in segments.into_iter().skip(1) {
    if next.end - cur.start < target_duration_secs {
      cur.text.push(' ');
      cur.text.push_str(&next.text);
      cur.end = next.end;
    } else {
      chunks.push(std::mem::replace(&mut cur, next));
    }
  }
  chunks.push(cur);
  chunks
}

pub fn format_transcript_source(source: TranscriptSource) -> &'static str {
  // 字幕来源文本化
  match source {
    TranscriptSource::Subtitle => "平台字幕",
    TranscriptSource::Whisper => "本地 Whisper 转写",
  }
}
#[cfg(test)]
mod tests {
  use super::*;

  fn seg(start: f64, end: f64, text: &str) -> TranscriptSegment {
    TranscriptSegment { start, end, text: text.to_string() }
  }

  #[test]
  fn merge_empty_returns_empty() {
    assert!(merge_transcript_segments(vec![], 15.0).is_empty());
  }

  #[test]
  fn merge_single_short_segment_kept_as_is() {
    let result = merge_transcript_segments(vec![seg(0.0, 2.0, "你好")], 15.0);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].start, 0.0);
    assert_eq!(result[0].end, 2.0);
    assert_eq!(result[0].text, "你好");
  }

  #[test]
  fn merge_single_segment_over_threshold_kept_as_is() {
    let result = merge_transcript_segments(vec![seg(0.0, 20.0, "长段")], 15.0);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].end, 20.0);
    assert_eq!(result[0].text, "长段");
  }

  #[test]
  fn merge_concatenates_until_threshold_reached() {
    // A(0-3) B(3-7) C(7-12) D(12-18)
    // 加 B: 7-0=7 < 15 → merge AB(0-7)
    // 加 C: 12-0=12 < 15 → merge ABC(0-12)
    // 加 D: 18-0=18 ≥ 15 → push ABC, cur=D(12-18)
    // 末尾 push D
    let inputs = vec![
      seg(0.0, 3.0, "A"),
      seg(3.0, 7.0, "B"),
      seg(7.0, 12.0, "C"),
      seg(12.0, 18.0, "D")
    ];
    let result = merge_transcript_segments(inputs, 15.0);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].start, 0.0);
    assert_eq!(result[0].end, 12.0);
    assert_eq!(result[0].text, "A B C");
    assert_eq!(result[1].start, 12.0);
    assert_eq!(result[1].end, 18.0);
    assert_eq!(result[1].text, "D");
  }

  #[test]
  fn merge_last_chunk_can_be_short() {
    // A(0-5) B(5-10) C(10-15) D(15-17)
    // 加 B: 10-0=10 < 15 → merge AB(0-10)
    // 加 C: 15-0=15 ≥ 15 → push AB, cur=C(10-15)
    // 加 D: 17-10=7 < 15 → merge CD(10-17)
    let inputs = vec![
      seg(0.0, 5.0, "A"),
      seg(5.0, 10.0, "B"),
      seg(10.0, 15.0, "C"),
      seg(15.0, 17.0, "D")
    ];
    let result = merge_transcript_segments(inputs, 15.0);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].text, "A B");
    assert_eq!(result[1].text, "C D");
  }
}
