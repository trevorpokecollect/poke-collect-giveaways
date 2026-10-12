import { describe, expect, it } from "vitest";
import { purchaseRulesSchema } from "../app/lib/entries/rules";
import { purchaseRateText } from "../app/lib/shop-promo";

const rules = (r: object) => purchaseRulesSchema.parse(r);

describe("purchaseRateText", () => {
  it("states the rate from the purchase rules", () => {
    expect(
      purchaseRateText(rules({ base: { mode: "per_amount", entries: 50, amount: 10 } })),
    ).toBe("50 entries for every $10 you spend");
    expect(
      purchaseRateText(
        rules({ base: { mode: "per_amount", entries: 1, amount: 1 }, minOrderValue: 25 }),
      ),
    ).toBe("1 entry for every $1 you spend on orders of $25+");
    expect(purchaseRateText(rules({ base: { mode: "fixed", entries: 5 } }))).toBe(
      "5 entries for every order",
    );
  });

  it("hides the box when purchases earn nothing", () => {
    expect(purchaseRateText(rules({ enabled: false }))).toBeNull();
    expect(purchaseRateText(rules({ base: { mode: "none" } }))).toBeNull();
  });
});
