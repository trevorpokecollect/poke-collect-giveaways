import { describe, expect, it } from "vitest";
import { suggestEmail } from "../app/lib/bot/email";
import { riskTone } from "../app/lib/ui";

describe("email typo check", () => {
  it("suggests the fixed address for common provider typos", () => {
    expect(suggestEmail("ash@gmail.con")).toBe("ash@gmail.com");
    expect(suggestEmail("Ash.K@GMIAL.com")).toBe("Ash.K@gmail.com");
    expect(suggestEmail("misty@yahooo.com")).toBe("misty@yahoo.com");
    expect(suggestEmail("brock@poke-collect.con")).toBe(
      "brock@poke-collect.com",
    );
  });

  it("leaves real domains alone", () => {
    for (const e of [
      "a@gmail.com",
      "a@yahoo.co.uk",
      "a@hotmail.co.uk",
      "a@me.com",
      "a@poke-collect.com",
    ])
      expect(suggestEmail(e)).toBeNull();
  });
});

describe("risk badge color", () => {
  it("shows weak warnings on verified entrants in grey", () => {
    expect(riskTone(20, "ACTIVE")).toBe("neutral");
    expect(riskTone(0, "ACTIVE")).toBe("success");
    expect(riskTone(20, "PENDING_VERIFICATION")).toBe("caution");
    expect(riskTone(55, "ACTIVE")).toBe("warning");
    expect(riskTone(100, "ACTIVE")).toBe("critical");
  });
});
