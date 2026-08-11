import { describe, expect, it } from "vitest"

import { compareSemver } from "./updater"

describe("compareSemver", () => {
  it("0.2.0 > 0.1.1", () => {
    expect(compareSemver("0.2.0", "0.1.1")).toBe(1)
  })
  it("v 前缀等价", () => {
    expect(compareSemver("v0.1.1", "0.1.1")).toBe(0)
  })
  it("0.1.1 < 0.1.2", () => {
    expect(compareSemver("0.1.1", "0.1.2")).toBe(-1)
  })
  it("段数不齐按 0 补", () => {
    expect(compareSemver("1", "1.0.0")).toBe(0)
  })
  it("次版本优先于修订", () => {
    expect(compareSemver("0.2.0", "0.1.99")).toBe(1)
  })
  it("非数字段按 0 处理", () => {
    expect(compareSemver("0.x.0", "0.0.0")).toBe(0)
  })
})
