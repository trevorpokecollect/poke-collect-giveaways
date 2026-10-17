import { describe, expect, it } from "vitest";
import { isBlockedDomain, isCommonDomain } from "../app/lib/bot/domains";

describe("bot farm domains", () => {
  it("blocks the known farm domains and their subdomains", () => {
    expect(isBlockedDomain("putterkickz.com", [])).toBe(true);
    expect(isBlockedDomain("GOOGLE-O.COM", [])).toBe(true);
    expect(isBlockedDomain("x.unioninbox.com", [])).toBe(true);
    expect(isBlockedDomain("gmail.com", [])).toBe(false);
    expect(isBlockedDomain("newfarm.com", ["newfarm.com"])).toBe(true);
  });

  it("treats big providers, schools and country variants as common", () => {
    for (const d of [
      "gmail.com",
      "yahoo.com",
      "hotmail.fr",
      "yahoo.co.uk",
      "umich.edu",
      "comcast.net",
    ])
      expect(isCommonDomain(d)).toBe(true);
    for (const d of ["putterkickz.com", "lilduckytcg.com", "google-o.com"])
      expect(isCommonDomain(d)).toBe(false);
  });
});
