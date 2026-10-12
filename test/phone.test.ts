import { describe, expect, it } from "vitest";
import { formatUsPhone, normalizeUsPhone } from "../app/lib/phone";

describe("normalizeUsPhone", () => {
  it("accepts common US formats", () => {
    for (const s of [
      "(555) 234-5678",
      "555.234.5678",
      "5552345678",
      "+1 555 234 5678",
      "1-555-234-5678",
    ]) {
      expect(normalizeUsPhone(s)).toBe("+15552345678");
    }
  });
  it("rejects invalid numbers", () => {
    for (const s of [
      "",
      "234-5678",
      "055 234 5678",
      "555 134 5678",
      "911 234 5678",
      "+44 20 7946 0958",
      "123456789012",
    ]) {
      expect(normalizeUsPhone(s)).toBeNull();
    }
  });
  it("formats for display", () => {
    expect(formatUsPhone("+15552345678")).toBe("(555) 234-5678");
    expect(formatUsPhone(null)).toBe("");
  });
});
