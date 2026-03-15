use chrono::Local;
use hound::WavReader;
use reqwest::Client;
use std::{fs, path::Path, path::PathBuf, process::Command};
use tempfile::TempDir;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tracing::info;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext};

use crate::models::{
  BiliSubtitleBody,
  BiliSubtitleGroup,
  BiliSubtitleIndexResponse,
  BiliViewResponse,
  OpenAIResponse,
  Platform,
  Transcript,
  TranscriptSegment,
  TranscriptSource,
  YoutubeOEmbed
};
use crate::utils::{format_transcript_with_timestamps, parse_youtube_subtitles_xml};

pub fn detect_platform(url: &str) -> Result<Platform, String> {
  let parsed = url::Url::parse(url).map_err(|_| "无效的链接".to_string())?;
  let host = parsed.host_str().unwrap_or_default();
  if host.contains("bilibili.com") {
    return Ok(Platform::Bilibili);
  }
  if host.contains("youtube.com") || host.contains("youtu.be") {
    return Ok(Platform::Youtube);
  }
  Err("暂不支持该链接，请输入 B 站或 YouTube 视频链接".to_string())
}

pub async fn summarize_bilibili(client: &Client, url: &str) -> Result<(String, Option<Transcript>), String> {
  let video_id = parse_bilibili_id(url).ok_or_else(|| "无效的 B 站链接".to_string())?;
  info!("🔍 解析 B 站链接完成: {}", video_id);

  let (title, cid) = fetch_bilibili_meta(client, &video_id).await?;
  info!("✅ 获取视频信息成功: {} (cid: {})", title, cid);

  let transcript = fetch_bilibili_subtitles(client, &video_id, cid).await?;
  Ok((title, transcript))
}

pub async fn summarize_youtube(client: &Client, url: &str) -> Result<(String, Option<Transcript>), String> {
  let video_id = parse_youtube_id(url).ok_or_else(|| "无效的 YouTube 链接".to_string())?;
  info!("🔍 解析 YouTube 链接完成: {}", video_id);

  let title = fetch_youtube_title(client, url).await?;
  info!("✅ 获取视频信息成功: {}", title);

  let transcript = fetch_youtube_subtitles(client, &video_id).await?;
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
  let url = format!("https://api.bilibili.com/x/web-interface/view?bvid={}", bvid);
  let resp = client
    .get(url)
    .send()
    .await
    .map_err(|_| "获取视频信息失败".to_string())?;

  if !resp.status().is_success() {
    return Err("获取视频信息失败".to_string());
  }

  let data = resp
    .json::<BiliViewResponse>()
    .await
    .map_err(|_| "解析视频信息失败".to_string())?;

  let info = data
    .data
    .ok_or_else(|| "视频信息为空".to_string())?;

  let title = info.title.unwrap_or_else(|| "未命名视频".to_string());
  let cid = info.cid.ok_or_else(|| "视频 CID 不存在".to_string())?;

  Ok((title, cid))
}

async fn fetch_bilibili_subtitles(
  client: &Client,
  bvid: &str,
  cid: u64
) -> Result<Option<Transcript>, String> {
  let url = format!(
    "https://api.bilibili.com/x/player/v2?bvid={}&cid={}",
    bvid, cid
  );
  let resp = client
    .get(url)
    .send()
    .await
    .map_err(|_| "获取字幕索引失败".to_string())?;

  if !resp.status().is_success() {
    return Err("获取字幕索引失败".to_string());
  }

  let data = resp
    .json::<BiliSubtitleIndexResponse>()
    .await
    .map_err(|_| "解析字幕索引失败".to_string())?;

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
    .map_err(|_| "获取字幕内容失败".to_string())?;

  if !body_resp.status().is_success() {
    return Err("获取字幕内容失败".to_string());
  }

  let body = body_resp
    .json::<BiliSubtitleBody>()
    .await
    .map_err(|_| "解析字幕内容失败".to_string())?;

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
  let endpoint = format!("https://www.youtube.com/oembed?url={}&format=json", url);
  let resp = client
    .get(endpoint)
    .send()
    .await
    .map_err(|_| "获取 YouTube 标题失败".to_string())?;

  if !resp.status().is_success() {
    return Err("获取 YouTube 标题失败".to_string());
  }

  let data = resp
    .json::<YoutubeOEmbed>()
    .await
    .map_err(|_| "解析 YouTube 标题失败".to_string())?;

  Ok(data.title.unwrap_or_else(|| "未命名视频".to_string()))
}

async fn fetch_youtube_subtitles(client: &Client, video_id: &str) -> Result<Option<Transcript>, String> {
  let languages = ["zh-Hans", "zh", "en"];
  for language in languages {
    if let Some(segments) = fetch_youtube_subtitles_by_language(client, video_id, language, false).await? {
      return Ok(Some(Transcript {
        text: format_transcript_with_timestamps(&segments),
        segments,
        source: TranscriptSource::Subtitle
      }));
    }
    if let Some(segments) = fetch_youtube_subtitles_by_language(client, video_id, language, true).await? {
      return Ok(Some(Transcript {
        text: format_transcript_with_timestamps(&segments),
        segments,
        source: TranscriptSource::Subtitle
      }));
    }
  }
  Ok(None)
}

async fn fetch_youtube_subtitles_by_language(
  client: &Client,
  video_id: &str,
  language: &str,
  use_asr: bool
) -> Result<Option<Vec<TranscriptSegment>>, String> {
  let asr_suffix = if use_asr { "&kind=asr" } else { "" };
  let url = format!(
    "https://video.google.com/timedtext?lang={}&v={}&fmt=srv3{}",
    language, video_id, asr_suffix
  );
  let resp = client
    .get(url)
    .send()
    .await
    .map_err(|_| "获取 YouTube 字幕失败".to_string())?;

  if !resp.status().is_success() {
    return Ok(None);
  }

  let xml = resp
    .text()
    .await
    .map_err(|_| "解析 YouTube 字幕失败".to_string())?;

  let segments = parse_youtube_subtitles_xml(&xml);
  if segments.is_empty() {
    Ok(None)
  } else {
    Ok(Some(segments))
  }
}

pub async fn transcribe_with_whisper(
  url: &str,
  cookie: Option<&str>,
  language: Option<&str>
) -> Result<Transcript, String> {
  let resources_dir = PathBuf::from("resources");
  fs::create_dir_all(&resources_dir)
    .map_err(|_| "创建资源目录失败".to_string())?;
  let audio_path = download_audio_with_ytdlp(url, cookie, &resources_dir)?;
  let segments = transcribe_audio_segments(&audio_path, language).await?;
  if segments.is_empty() {
    return Err("Whisper 转写结果为空".to_string());
  }

  Ok(Transcript {
    text: format_transcript_with_timestamps(&segments),
    segments,
    source: TranscriptSource::Whisper
  })
}

fn download_audio_with_ytdlp(url: &str, cookie: Option<&str>, output_dir: &Path) -> Result<PathBuf, String> {
  let output_template = output_dir
    .join("audio.%(ext)s")
    .to_string_lossy()
    .to_string();

  let mut cookie_path: Option<PathBuf> = None;
  let mut cookie_header: Option<String> = None;
  if let Some(cookie_value) = cookie {
    let trimmed = cookie_value.trim();
    if !trimmed.is_empty() {
      if trimmed.contains('=') && trimmed.contains(';') {
        cookie_header = Some(trimmed.to_string());
      } else {
        cookie_path = Some(PathBuf::from(trimmed));
      }
    }
  }

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

  if let Some(path) = cookie_path {
    command.arg("--cookies").arg(path);
  }

  if let Some(header_value) = cookie_header {
    command.arg("--add-header").arg(format!("Cookie: {header_value}"));
  }

  let status = command
    .status()
    .map_err(|_| "调用 yt-dlp 失败，请确认已安装".to_string())?;

  if !status.success() {
    return Err("下载音频失败，请检查 yt-dlp 输出".to_string());
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

async fn transcribe_audio_segments(
  path: &Path,
  language: Option<&str>
) -> Result<Vec<TranscriptSegment>, String> {
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
  let models_dir = PathBuf::from("models");
  fs::create_dir_all(&models_dir)
    .map_err(|_| "创建 models 目录失败".to_string())?;
  let model_path = models_dir.join("ggml-base.bin");
  if model_path.exists() {
    return Ok(model_path);
  }

  download_whisper_model(&model_path).await?;

  if model_path.exists() {
    Ok(model_path)
  } else {
    Err("下载 Whisper 模型失败".to_string())
  }
}

async fn download_whisper_model(model_path: &Path) -> Result<(), String> {
  let url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
  let response = Client::new()
    .get(url)
    .send()
    .await
    .map_err(|_| "下载 Whisper 模型失败".to_string())?;

  if !response.status().is_success() {
    return Err("下载 Whisper 模型失败".to_string());
  }

  let bytes = response
    .bytes()
    .await
    .map_err(|_| "读取 Whisper 模型失败".to_string())?;
  let mut file = File::create(model_path)
    .await
    .map_err(|_| "保存 Whisper 模型失败".to_string())?;
  file
    .write_all(&bytes)
    .await
    .map_err(|_| "写入 Whisper 模型失败".to_string())?;

  Ok(())
}

pub fn build_prompt(title: &str, transcript: &str, custom_prompt: Option<&str>) -> String {
  if let Some(custom) = custom_prompt {
    return custom
      .replace("{{title}}", title)
      .replace("{{transcript}}", transcript);
  }

  format!(
    "你是一位擅长整理视频的助手。请根据以下内容生成一份结构化总结，并保留关键时间戳：\n\n标题：{title}\n\n字幕：\n{transcript}\n\n总结要求：\n1. 200-400 字\n2. 列出 3-5 个关键要点\n3. 保留关键时间戳（如 01:23）\n4. 用中文输出\n",
    title = title,
    transcript = transcript
  )
}

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
    .map_err(|_| "调用模型失败".to_string())?;

  let status = resp.status();
  let text = resp
    .text()
    .await
    .map_err(|_| "解析模型响应失败".to_string())?;

  if !status.is_success() {
    return Err("模型调用失败".to_string());
  }

  let data: crate::models::OpenAIResponse = serde_json::from_str(&text)
    .map_err(|_| "解析模型响应失败".to_string())?;

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

pub fn format_transcript_source(source: TranscriptSource) -> &'static str {
  match source {
    TranscriptSource::Subtitle => "平台字幕",
    TranscriptSource::Whisper => "本地 Whisper 转写"
  }
}
