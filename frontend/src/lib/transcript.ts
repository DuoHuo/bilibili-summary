/**
 * Normalize the "字幕摘录" section of a Claude-style summary into bullet
 * lines with [mm:ss-mm:ss] timestamps. The LLM occasionally emits a single
 * run-on paragraph containing many timestamps; this splits it into legible
 * list items. Preserves existing bullet lists and headings.
 */
export function normalizeTranscriptSection(markdown: string): string {
  const timestampPattern = /\[\d{2}:\d{2}(?:-\d{2}:\d{2})?\]/g
  const formatListBlock = (items: string[]) => `\n${items.join("\n")}\n`

  const splitTimestampLine = (line: string) => {
    const matches = Array.from(
      line.matchAll(/(\[\d{2}:\d{2}(?:-\d{2}:\d{2})?\])\s*([^[]*)/g)
    )
    if (matches.length < 1) return null
    const output: string[] = []
    let lastTimestamp = ""
    for (const match of matches) {
      const timestamp = match[1]
      const text = match[2].trim()
      if (timestamp === lastTimestamp && !text) continue
      lastTimestamp = timestamp
      const item = `- ${timestamp} ${text}`.trim()
      if (item !== "-") output.push(item)
    }
    return output
  }

  const normalizeTimestampRepeats = (text: string): string => {
    let result = text
    let previous = ""
    const repeatPattern = /(\[\d{2}:\d{2}(?:-\d{2}:\d{2})?\])\s*\1/g
    while (result !== previous) {
      previous = result
      result = result.replace(repeatPattern, "$1")
    }
    return result
  }

  const normalizeLines = (text: string, forceList: boolean): string => {
    const lines = text.replace(/\r\n/g, "\n").split("\n")
    const output: string[] = []
    for (const rawLine of lines) {
      const trimmed = normalizeTimestampRepeats(rawLine.trim())
      if (!trimmed) continue
      if (/^\s*[-*]\s+/.test(trimmed)) {
        output.push(trimmed)
        continue
      }
      const listItems = splitTimestampLine(trimmed)
      if (listItems) {
        output.push(...listItems)
        continue
      }
      output.push(forceList ? `- ${trimmed}` : trimmed)
    }
    return output.join("\n")
  }

  const headingMatch = markdown.match(/^(#+)\s*字幕摘录\s*$/m)
  if (!headingMatch || headingMatch.index === undefined) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n")
    return lines
      .map((line) => {
        const normalizedLine = normalizeTimestampRepeats(line)
        const matches = normalizedLine.match(timestampPattern)
        if (matches && matches.length >= 1) {
          const listItems = splitTimestampLine(normalizedLine)
          return listItems ? formatListBlock(listItems) : normalizedLine
        }
        return normalizedLine
      })
      .join("\n")
  }

  const heading = headingMatch[1]
  const startIndex = headingMatch.index
  const sectionStart = startIndex + headingMatch[0].length
  const rest = markdown.slice(sectionStart)
  const nextHeadingRegex = new RegExp(`^#{1,${heading.length}}\\s+`, "m")
  const nextMatch = rest.match(nextHeadingRegex)
  const sectionEnd =
    nextMatch && nextMatch.index !== undefined
      ? sectionStart + nextMatch.index
      : markdown.length
  const sectionBody = markdown.slice(sectionStart, sectionEnd).trim()

  if (/^\s*[-*]\s+/m.test(sectionBody)) return markdown

  const normalizedBody = normalizeLines(sectionBody, true)
  return `${markdown.slice(0, sectionStart)}\n\n${normalizedBody}\n${markdown.slice(
    sectionEnd
  )}`
}
