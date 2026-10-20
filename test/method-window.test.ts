import { describe, expect, it } from "vitest";
import { methodWindow } from "../app/lib/method-window";

const base = {
  daily: true,
  methods: null,
  draw: null,
  pastDraws: ["2026-10-19", "2026-10-18"],
  now: new Date("2026-10-20T15:00:00Z"),
  timeZone: "America/New_York",
  drawTime: "21:00",
};

describe("methodWindow", () => {
  it("defaults to the current draw (since last night's 9pm ET)", () => {
    const w = methodWindow(base);
    expect(w).toMatchObject({ period: "today", draw: null });
    expect(w.since?.toISOString()).toBe("2026-10-20T01:00:00.000Z");
    expect(w.until).toBeUndefined();
  });

  it("limits a past draw to its own 9pm-to-9pm window", () => {
    const w = methodWindow({ ...base, methods: "draw", draw: "2026-10-18" });
    expect(w.period).toBe("draw");
    expect(w.draw).toBe("2026-10-18");
    expect(w.since?.toISOString()).toBe("2026-10-18T01:00:00.000Z");
    expect(w.until?.toISOString()).toBe("2026-10-19T01:00:00.000Z");
  });

  it("picks the most recent past draw when none (or an unknown one) is chosen", () => {
    expect(methodWindow({ ...base, methods: "draw" }).draw).toBe("2026-10-19");
    expect(
      methodWindow({ ...base, methods: "draw", draw: "2020-01-01" }).draw,
    ).toBe("2026-10-19");
  });

  it("falls back to the current draw when there are no past draws yet", () => {
    expect(
      methodWindow({ ...base, methods: "draw", pastDraws: [] }).period,
    ).toBe("today");
  });

  it("counts everything for All Time and for monthly giveaways", () => {
    expect(methodWindow({ ...base, methods: "all" })).toEqual({
      period: "all",
      draw: null,
    });
    expect(methodWindow({ ...base, daily: false }).period).toBe("all");
  });
});
