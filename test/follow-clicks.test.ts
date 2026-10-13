import { describe, expect, it } from "vitest";
import {
  centralDate,
  followClickTable,
  parseDays,
  platformOfAction,
  recentDates,
} from "../app/lib/follow-clicks";

describe("follow click helpers", () => {
  it("finds the platform from the action's URL", () => {
    const follow = (url: string) => ({
      type: "SOCIAL_FOLLOW",
      config: { url },
    });
    expect(
      platformOfAction(follow("https://www.whatnot.com/user/pokecollect")),
    ).toBe("whatnot");
    expect(platformOfAction(follow("https://discord.gg/abc"))).toBe("discord");
    expect(platformOfAction(follow("https://notwhatnot.com/x"))).toBe("other");
    expect(platformOfAction(follow("not a url"))).toBe("other");
    expect(
      platformOfAction({
        type: "VISIT_URL",
        config: { url: "https://example.com" },
      }),
    ).toBeNull();
    expect(
      platformOfAction({
        type: "VISIT_URL",
        config: { url: "https://whatnot.com/s" },
      }),
    ).toBe("whatnot");
    expect(
      platformOfAction({
        type: "SIGNUP",
        config: { url: "https://whatnot.com" },
      }),
    ).toBeNull();
  });

  it("dates clicks in Central Time", () => {
    // 04:30Z is 11:30pm the previous day in Chicago (CDT, UTC-5).
    expect(centralDate(new Date("2026-10-14T04:30:00Z"))).toBe("2026-10-13");
    expect(centralDate(new Date("2026-10-14T05:30:00Z"))).toBe("2026-10-14");
    // Winter (CST, UTC-6).
    expect(centralDate(new Date("2026-12-01T05:30:00Z"))).toBe("2026-11-30");
  });

  it("lists recent dates oldest first, across month ends", () => {
    expect(recentDates(3, new Date("2026-11-01T18:00:00Z"))).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  it("clamps ?days", () => {
    expect(parseDays(null)).toBe(14);
    expect(parseDays("abc")).toBe(14);
    expect(parseDays("0")).toBe(14);
    expect(parseDays("30")).toBe(30);
    expect(parseDays("9999")).toBe(366);
  });

  it("pivots rows into a table with Whatnot first", () => {
    const t = followClickTable(
      [
        { date: "2026-10-13", platform: "discord", clicks: 2 },
        { date: "2026-10-13", platform: "whatnot", clicks: 5 },
        { date: "2026-10-12", platform: "whatnot", clicks: 1 },
      ],
      ["2026-10-12", "2026-10-13"],
    );
    expect(t.platforms).toEqual(["whatnot", "discord"]);
    expect(t.days).toEqual([
      { date: "2026-10-13", counts: [5, 2] },
      { date: "2026-10-12", counts: [1, 0] },
    ]);
    expect(t.totals).toEqual([6, 2]);
    expect(followClickTable([], ["2026-10-13"]).platforms).toEqual(["whatnot"]);
  });
});
