import { describe, expect, it } from "vitest";
import { burstCache } from "../app/lib/storefront/burst-cache";

describe("burstCache", () => {
  it("runs one lookup for a burst of requests and shares the result", async () => {
    const cache = burstCache(10_000);
    let calls = 0;
    let finish!: (v: string) => void;
    const load = () => {
      calls++;
      return new Promise<string>((r) => (finish = r));
    };
    const waves = Array.from({ length: 300 }, () => cache.get("k", load));
    finish("prize");
    expect(await Promise.all(waves)).toEqual(Array(300).fill("prize"));
    expect(calls).toBe(1);
    expect(await cache.get("k", load)).toBe("prize");
    expect(calls).toBe(1);
  });

  it("looks up again once the result is older than the TTL", async () => {
    let t = 0;
    const cache = burstCache(10_000, () => t);
    let calls = 0;
    const load = async () => ++calls;
    expect(await cache.get("k", load)).toBe(1);
    t = 9_999;
    expect(await cache.get("k", load)).toBe(1);
    t = 10_000;
    expect(await cache.get("k", load)).toBe(2);
  });

  it("keeps keys apart and doesn't cache failures", async () => {
    const cache = burstCache(10_000);
    let calls = 0;
    const fail = async () => {
      calls++;
      throw new Error("down");
    };
    await expect(cache.get("a", fail)).rejects.toThrow("down");
    await expect(cache.get("a", fail)).rejects.toThrow("down");
    expect(calls).toBe(2);
    expect(await cache.get("b", async () => "ok")).toBe("ok");
  });
});
