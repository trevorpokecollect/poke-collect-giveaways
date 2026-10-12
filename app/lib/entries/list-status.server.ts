import type { Campaign } from "@prisma/client";
import db from "../../db.server";
import { unauthenticated } from "../../shopify.server";

// "Were they already on our lists?" For each sign-up, the Shopify customer with that email is
// checked once: a customer created before they entered is an existing customer, and a
// subscription whose consent date is before they entered was already there. Everything else
// they opted into on the form is new. Consent dates move when a customer's consent is changed
// later, so these counts are close, not exact.

const QUERY = `#graphql
  query EntrantListStatus($q: String!) {
    customers(first: 1, query: $q) {
      nodes {
        createdAt
        emailMarketingConsent { marketingState consentUpdatedAt }
        smsMarketingConsent { marketingState consentUpdatedAt }
      }
    }
  }`;

interface Consent {
  marketingState: string;
  consentUpdatedAt: string | null;
}
interface CustomerNode {
  createdAt: string;
  emailMarketingConsent: Consent | null;
  smsMarketingConsent: Consent | null;
}

// Allows for the moment between signing up and our own opt-in reaching Shopify.
const GRACE_MS = 2 * 60 * 1000;

/** Status before entering, from the customer record (null when there's no customer). */
export function statusBefore(customer: CustomerNode | null, enteredAt: Date) {
  const before = (iso: string | null | undefined) =>
    !iso || new Date(iso).getTime() < enteredAt.getTime() - GRACE_MS;
  const subscribed = (c: Consent | null) =>
    !!c && c.marketingState === "SUBSCRIBED" && before(c.consentUpdatedAt);
  return {
    existingCustomer: !!customer && before(customer.createdAt),
    emailWasSubscribed: subscribed(customer?.emailMarketingConsent ?? null),
    smsWasSubscribed: subscribed(customer?.smsMarketingConsent ?? null),
  };
}

const running = new Set<string>();

/**
 * Checks up to `limit` sign-ups not checked yet (form entries only; imports and order
 * buyers are skipped). Runs in the background; one run per giveaway at a time.
 */
export async function checkListStatus(campaign: Campaign, limit = 200) {
  if (running.has(campaign.id)) return;
  running.add(campaign.id);
  try {
    const pending = await db.entrant.findMany({
      where: {
        campaignId: campaign.id,
        listsCheckedAt: null,
        ipHash: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, email: true, createdAt: true },
    });
    if (!pending.length) return;
    const { admin } = await unauthenticated.admin(campaign.shop);
    for (const e of pending) {
      const res = await admin.graphql(QUERY, {
        variables: { q: `email:"${e.email.replace(/"/g, "")}"` },
      });
      const body = (await res.json()) as {
        data?: { customers: { nodes: CustomerNode[] } };
      };
      if (!body.data) break; // no access to customer data: try again later
      await db.entrant.update({
        where: { id: e.id },
        data: {
          ...statusBefore(body.data.customers.nodes[0] ?? null, e.createdAt),
          listsCheckedAt: new Date(),
        },
      });
    }
  } catch (err) {
    console.error("list status check", err);
  } finally {
    running.delete(campaign.id);
  }
}

/** New vs already-on-the-list counts, optionally only sign-ups since `since`. */
export async function listGrowth(campaignId: string, since?: Date) {
  const where = {
    campaignId,
    ipHash: { not: null },
    ...(since ? { createdAt: { gte: since } } : {}),
  };
  const checked = { ...where, listsCheckedAt: { not: null } };
  const [
    signups,
    unchecked,
    newCustomers,
    emailOptIns,
    newEmail,
    smsOptIns,
    newSms,
  ] = await Promise.all([
    db.entrant.count({ where }),
    db.entrant.count({ where: { ...where, listsCheckedAt: null } }),
    db.entrant.count({ where: { ...checked, existingCustomer: false } }),
    db.entrant.count({ where: { ...checked, marketingConsent: true } }),
    db.entrant.count({
      where: { ...checked, marketingConsent: true, emailWasSubscribed: false },
    }),
    db.entrant.count({ where: { ...checked, smsConsentAt: { not: null } } }),
    db.entrant.count({
      where: {
        ...checked,
        smsConsentAt: { not: null },
        smsWasSubscribed: false,
      },
    }),
  ]);
  return {
    signups,
    unchecked,
    newCustomers,
    email: { optIns: emailOptIns, new: newEmail },
    sms: { optIns: smsOptIns, new: newSms },
  };
}
