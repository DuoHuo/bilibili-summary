import { describe, expect, it } from "vitest"
import { LOG_LEVELS, shouldLog } from "./levels"

describe("shouldLog", () => {
  it("level 等于 threshold 时放行", () => {
    for (const level of LOG_LEVELS) {
      expect(shouldLog(level, level)).toBe(true)
    }
  })

  it("level 高于 threshold 时放行", () => {
    expect(shouldLog("WARN", "INFO")).toBe(true)
    expect(shouldLog("ERROR", "DEBUG")).toBe(true)
  })

  it("level 低于 threshold 时过滤", () => {
    expect(shouldLog("DEBUG", "INFO")).toBe(false)
    expect(shouldLog("INFO", "ERROR")).toBe(false)
  })

  it("完整 4x4 过滤矩阵", () => {
    const expected: Record<string, Record<string, boolean>> = {
      DEBUG: { DEBUG: true, INFO: false, WARN: false, ERROR: false },
      INFO: { DEBUG: true, INFO: true, WARN: false, ERROR: false },
      WARN: { DEBUG: true, INFO: true, WARN: true, ERROR: false },
      ERROR: { DEBUG: true, INFO: true, WARN: true, ERROR: true }
    }
    for (const level of LOG_LEVELS) {
      for (const threshold of LOG_LEVELS) {
        expect(shouldLog(level, threshold)).toBe(expected[level][threshold])
      }
    }
  })
})
