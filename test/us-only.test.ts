import { describe, expect, it } from "vitest";
import { shipsOutsideUs, usAddressProblem } from "../app/lib/us-only";

describe("US-only addresses", () => {
  const ok = { country: "United States", province: "Texas", zip: "75001" };
  it("accepts the 50 states and DC, in any common spelling", () => {
    expect(usAddressProblem(ok)).toBeNull();
    expect(
      usAddressProblem({ country: "USA", province: "dc", zip: "20001-1234" }),
    ).toBeNull();
    expect(
      usAddressProblem({ country: "US", province: "AK", zip: "99501" }),
    ).toBeNull();
  });
  it("refuses other countries, territories, missing states and bad ZIPs", () => {
    expect(usAddressProblem({ ...ok, country: "Canada" })).toMatch(
      /US addresses/,
    );
    expect(usAddressProblem({ ...ok, province: "Puerto Rico" })).toMatch(
      /state/,
    );
    expect(usAddressProblem({ ...ok, province: "" })).toMatch(/state/);
    expect(usAddressProblem({ ...ok, zip: "K1A 0B1" })).toMatch(/ZIP/);
  });
  it("flags orders shipping abroad only", () => {
    expect(shipsOutsideUs({ country_code: "CA" })).toBe(true);
    expect(shipsOutsideUs({ country_code: "us" })).toBe(false);
    expect(shipsOutsideUs(null)).toBe(false);
  });
});
