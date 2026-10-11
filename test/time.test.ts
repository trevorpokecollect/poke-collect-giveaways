import { describe, expect, it } from "vitest";
import { parseLocalDateTime, toLocalInput } from "../app/lib/time";
import { slugify } from "../app/lib/slug";

describe("parseLocalDateTime", () => {
  it("reads wall-clock time in the store timezone", () => {
    expect(
      parseLocalDateTime("2026-11-01T09:00", "America/New_York")?.toISOString(),
    ).toBe("2026-11-01T14:00:00.000Z"); // EST after DST ends
    expect(
      parseLocalDateTime("2026-10-12T09:00", "America/New_York")?.toISOString(),
    ).toBe("2026-10-12T13:00:00.000Z"); // EDT
  });
  it("flags bad input instead of making an Invalid Date", () => {
    expect(parseLocalDateTime("", "America/New_York")).toBeUndefined();
    expect(parseLocalDateTime("next friday", "America/New_York")).toBeNull();
  });
  it("round-trips to a datetime-local value", () => {
    const d = parseLocalDateTime("2026-12-24T18:30", "America/New_York")!;
    expect(toLocalInput(d, "America/New_York")).toBe("2026-12-24T18:30");
  });
});

describe("slugify", () => {
  it("matches what merchants type in the theme editor", () => {
    expect(slugify("Delta Reign")).toBe("delta-reign");
    expect(slugify(" delta-reign ")).toBe("delta-reign");
  });
});
