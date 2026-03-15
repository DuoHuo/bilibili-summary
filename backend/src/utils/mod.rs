use quick_xml::{events::Event, Reader};

use crate::models::TranscriptSegment;

pub fn format_transcript_with_timestamps(segments: &[TranscriptSegment]) -> String {
  segments
    .iter()
    .map(|segment| {
      format!(
        "[{}-{}] {}",
        format_timestamp(segment.start),
        format_timestamp(segment.end),
        segment.text
      )
    })
    .collect::<Vec<_>>()
    .join("\n")
}

pub fn format_timestamp(seconds: f64) -> String {
  let total_seconds = seconds.max(0.0).round() as u64;
  let minutes = total_seconds / 60;
  let remaining = total_seconds % 60;
  format!("{:02}:{:02}", minutes, remaining)
}

pub fn parse_youtube_subtitles_xml(xml: &str) -> Vec<TranscriptSegment> {
  let mut reader = Reader::from_str(xml);
  let mut buf = Vec::new();
  let mut segments = Vec::new();
  let mut current_start = None;
  let mut current_end = None;
  let mut current_text = String::new();

  loop {
    match reader.read_event_into(&mut buf) {
      Ok(Event::Start(event)) if event.name().as_ref() == b"p" => {
        current_text.clear();
        current_start = None;
        current_end = None;
        for attr in event.attributes().flatten() {
          if attr.key.as_ref() == b"t" {
            if let Ok(value) = attr.unescape_value() {
              if let Ok(ms) = value.parse::<f64>() {
                current_start = Some(ms / 1000.0);
              }
            }
          }
          if attr.key.as_ref() == b"d" {
            if let Ok(value) = attr.unescape_value() {
              if let Ok(ms) = value.parse::<f64>() {
                current_end = Some(ms / 1000.0);
              }
            }
          }
        }
      }
      Ok(Event::Text(event)) => {
        if let Ok(text) = event.xml10_content() {
          let cleaned = text.replace('\n', " ").replace('\r', " ");
          if !cleaned.trim().is_empty() {
            if !current_text.is_empty() {
              current_text.push(' ');
            }
            current_text.push_str(cleaned.trim());
          }
        }
      }
      Ok(Event::End(event)) if event.name().as_ref() == b"p" => {
        let text = current_text.trim();
        if !text.is_empty() {
          let start = current_start.unwrap_or(0.0);
          let duration = current_end.unwrap_or(0.0);
          let end = if duration > 0.0 { start + duration } else { start };
          segments.push(TranscriptSegment {
            start,
            end,
            text: text.to_string()
          });
        }
        current_text.clear();
      }
      Ok(Event::Eof) => break,
      Err(_) => break,
      _ => {}
    }
    buf.clear();
  }

  segments
}
