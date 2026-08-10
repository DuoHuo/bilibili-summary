/** 错误码注册表：code → 人话文案模板。命名规则 DOMAIN.REASON。 */
export const ERROR_MESSAGES: Record<string, string> = {
  "WHISPER.YTDLP_DOWNLOAD_FAILED": "下载音频失败，请检查网络或视频链接是否有效",
  "WHISPER.WAV_NOT_FOUND": "音频转换未生成预期文件，请重试",
  "WHISPER.YTDLP_VIDEO_DOWNLOAD_FAILED": "下载视频失败，请检查网络或视频链接是否有效",
  "WHISPER.MP4_NOT_FOUND": "视频下载未生成预期文件，请重试",
  // Phase 0b：大模型调用（core/llm/client.ts）
  "LLM.CALL_FAILED": "大模型调用失败，请检查 API Key/Base URL/网络",
  "LLM.INVALID_ENDPOINT": "自定义端点配置无效，请检查 Base URL",
  "LLM.PARSE_RESPONSE_FAILED": "解析大模型响应失败，请稍后重试",
  // Phase 0b：语音转写（core/whisper/index.ts）
  "WHISPER.TRANSCRIBE_FAILED": "语音转写失败，请检查音频文件或模型配置",
  "WHISPER.PARSE_RESULT_FAILED": "解析语音转写结果失败，请重试",
  "WHISPER.EMPTY_RESULT": "语音转写结果为空，请确认音频内容有效"
}
