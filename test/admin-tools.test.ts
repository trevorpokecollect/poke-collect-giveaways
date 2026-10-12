import { describe, expect, it } from "vitest";
import { csvLine, parseCsv } from "../app/lib/csv";
import { mapHeaders, parseImport } from "../app/lib/import.server";
import {
  legacyId,
  orderSearchQuery,
  toWebhookPayload,
  type GraphqlOrder,
} from "../app/lib/backfill.server";
import { toScorableOrder } from "../app/lib/entries/orders.server";
import {
  breakdownSubtotal,
  conversion,
  dayKey,
  fillDays,
  summarizeRevenue,
  utmBreakdown,
} from "../app/lib/analytics.server";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded newlines, CRLF and a BOM", () => {
    const text =
      '﻿Email,Name\r\n"a@x.com","Ash ""Red"" K"\r\nb@x.com,"Line\nTwo"\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ["Email", "Name"],
      ["a@x.com", 'Ash "Red" K'],
      ["b@x.com", "Line\nTwo"],
    ]);
  });

  it("keeps empty fields and a last line without a newline", () => {
    expect(parseCsv("a,,c\n1,2,")).toEqual([
      ["a", "", "c"],
      ["1", "2", ""],
    ]);
  });

  it("round-trips through csvLine", () => {
    const row = ['He said "hi", then left', "plain", "multi\nline"];
    expect(parseCsv(csvLine(row))).toEqual([row]);
  });

  it("neutralises spreadsheet formulas in text cells", () => {
    expect(csvLine(["=SUM(A1)", -3, null])).toBe("'=SUM(A1),-3,\r\n");
  });
});

describe("import parsing", () => {
  it("maps GiveawayNinja-style headers case-insensitively", () => {
    expect(mapHeaders(["Email Address", "NAME", "Total Entries"])).toEqual({
      email: 0,
      name: 1,
      entries: 2,
    });
    expect(
      mapHeaders(["email", "First Name", "Last Name", "Points"]),
    ).toMatchObject({ email: 0, firstName: 1, lastName: 2, entries: 3 });
  });

  it("validates rows, merges inbox aliases and joins first/last names", () => {
    const parsed = parseImport(
      [
        "Email,First Name,Last Name,Points,Accepts Marketing",
        "ash.ketchum@gmail.com,Ash,Ketchum,12,yes",
        "ashketchum+promo@gmail.com,Ash,K,30,no",
        "not-an-email,Bad,Row,3,",
        "misty@example.com,Misty,,abc,",
        'brock@example.com,,,"1,200",',
      ].join("\n"),
    );
    expect(parsed.duplicates).toBe(1);
    expect(parsed.errors.map((e) => e.line)).toEqual([4, 5]);
    expect(parsed.rows).toEqual([
      {
        line: 2,
        email: "ashketchum+promo@gmail.com",
        emailNormalized: "ashketchum@gmail.com",
        name: "Ash K",
        entries: 30,
        consent: false,
      },
      {
        line: 6,
        email: "brock@example.com",
        emailNormalized: "brock@example.com",
        name: null,
        entries: 1200,
        consent: false,
      },
    ]);
  });

  it("requires an email column", () => {
    expect(parseImport("Name,Points\nAsh,3").errors[0].message).toMatch(
      /Email/,
    );
  });
});

describe("backfill mapper", () => {
  const order: GraphqlOrder = {
    id: "gid://shopify/Order/5551234",
    name: "#1042",
    email: "ash@example.com",
    createdAt: "2026-10-01T15:00:00Z",
    cancelledAt: null,
    sourceName: "web",
    customer: { id: "gid://shopify/Customer/77" },
    currentSubtotalPriceSet: { shopMoney: { amount: "54.00" } },
    currentTotalPriceSet: { shopMoney: { amount: "59.40" } },
    lineItems: {
      nodes: [
        {
          quantity: 3,
          currentQuantity: 2,
          product: { id: "gid://shopify/Product/10" },
          variant: { id: "gid://shopify/ProductVariant/20" },
          originalUnitPriceSet: { shopMoney: { amount: "27.00" } },
        },
        {
          quantity: 1,
          currentQuantity: 1,
          product: null,
          variant: null,
          originalUnitPriceSet: null,
        },
      ],
    },
  };

  it("produces the webhook payload shape with numeric ids", () => {
    const p = toWebhookPayload(order);
    expect(p).toMatchObject({
      id: "5551234",
      name: "#1042",
      email: "ash@example.com",
      created_at: "2026-10-01T15:00:00Z",
      cancelled_at: null,
      source_name: "web",
      subtotal_price: "54.00",
      total_price: "59.40",
      customer: { id: "77" },
    });
    expect(p.line_items).toEqual([
      {
        product_id: "10",
        variant_id: "20",
        quantity: 3,
        current_quantity: 2,
        price: "27.00",
      },
      {
        product_id: null,
        variant_id: null,
        quantity: 1,
        current_quantity: 1,
        price: "0",
      },
    ]);
  });

  it("scores the same as the equivalent webhook", () => {
    const s = toScorableOrder(toWebhookPayload(order));
    expect(s.subtotal).toBe(54);
    expect(s.lines[0]).toEqual({
      productId: "gid://shopify/Product/10",
      variantId: "gid://shopify/ProductVariant/20",
      quantity: 2,
      unitPrice: 27,
    });
    expect(s.lines[1].productId).toBe("");
  });

  it("builds the order search filter", () => {
    expect(legacyId("gid://shopify/Order/9")).toBe("9");
    expect(
      orderSearchQuery(
        new Date("2026-09-01T04:00:00Z"),
        new Date("2026-09-30T03:59:59.999Z"),
      ),
    ).toBe(
      "created_at:>='2026-09-01T04:00:00.000Z' created_at:<='2026-09-30T03:59:59.999Z'",
    );
    expect(orderSearchQuery(null, null)).toBe("");
  });
});

describe("analytics helpers", () => {
  it("buckets days in the campaign timezone", () => {
    // 02:00 UTC is still the previous evening in New York.
    expect(dayKey(new Date("2026-10-02T02:00:00Z"), "America/New_York")).toBe(
      "2026-10-01",
    );
  });

  it("fills gaps between days", () => {
    expect(
      fillDays([
        { day: "2026-10-03", entries: 5 },
        { day: "2026-10-01", entrants: 2 },
        { day: "2026-10-01", entries: 4 },
      ]),
    ).toEqual([
      { day: "2026-10-01", entrants: 2, entries: 4 },
      { day: "2026-10-02", entrants: 0, entries: 0 },
      { day: "2026-10-03", entrants: 0, entries: 5 },
    ]);
  });

  it("reads revenue from the order breakdown", () => {
    expect(breakdownSubtotal({ entries: 3, subtotal: 19.99 })).toBe(19.99);
    expect(breakdownSubtotal({ entries: 3 })).toBeNull();
    expect(
      summarizeRevenue([
        { breakdown: { subtotal: 10.1 } },
        { breakdown: { subtotal: 20.2 } },
        { breakdown: null },
      ]),
    ).toEqual({ orders: 3, revenue: 30.3, missing: 1 });
  });

  it("groups UTM sources", () => {
    expect(
      utmBreakdown([
        { utm_source: "TikTok" },
        { utm_source: "tiktok" },
        null,
        { utm_medium: "email" },
        { utm_source: "instagram" },
      ]),
    ).toEqual([
      { source: "(direct)", count: 2 },
      { source: "tiktok", count: 2 },
      { source: "instagram", count: 1 },
    ]);
  });

  it("measures conversion over form sign-ups only", () => {
    expect(
      conversion(
        [
          { emailNormalized: "a@x.com", fromForm: true },
          { emailNormalized: "b@x.com", fromForm: true },
          { emailNormalized: "c@x.com", fromForm: false },
        ],
        ["a@x.com", "c@x.com"],
      ),
    ).toEqual({ buyers: 2, formEntrants: 2, formBuyers: 1, rate: 0.5 });
  });
});
