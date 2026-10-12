import { describe, expect, it } from "vitest";
import { statusBefore } from "../app/lib/entries/list-status";

const entered = new Date("2026-10-12T15:00:00Z");
const sub = (at: string | null) => ({
  marketingState: "SUBSCRIBED",
  consentUpdatedAt: at,
});

describe("statusBefore", () => {
  it("treats no customer as brand new", () => {
    expect(statusBefore(null, entered)).toEqual({
      existingCustomer: false,
      emailWasSubscribed: false,
      smsWasSubscribed: false,
    });
  });

  it("counts customers and subscriptions from before entering as existing", () => {
    expect(
      statusBefore(
        {
          createdAt: "2025-01-01T00:00:00Z",
          emailMarketingConsent: sub("2025-01-01T00:00:00Z"),
          smsMarketingConsent: sub(null),
        },
        entered,
      ),
    ).toEqual({
      existingCustomer: true,
      emailWasSubscribed: true,
      smsWasSubscribed: true,
    });
  });

  it("counts opt-ins made by the sign-up itself as new", () => {
    expect(
      statusBefore(
        {
          createdAt: "2026-10-12T15:00:30Z",
          emailMarketingConsent: sub("2026-10-12T14:59:30Z"),
          smsMarketingConsent: {
            marketingState: "NOT_SUBSCRIBED",
            consentUpdatedAt: null,
          },
        },
        entered,
      ),
    ).toEqual({
      existingCustomer: false,
      emailWasSubscribed: false,
      smsWasSubscribed: false,
    });
  });
});
