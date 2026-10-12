import type { EntrySource, Prisma } from "@prisma/client";
import db from "../../db.server";
import { parseSettings } from "../settings";
import { requiredActions } from "./actions";

type Tx = Prisma.TransactionClient | typeof db;

export interface AwardInput {
  campaignId: string;
  entrantId: string;
  entries: number;
  source: EntrySource;
  actionId?: string;
  orderLogId?: string;
  note?: string;
  dedupeKey?: string;
}

/** Append an event to the ledger. Returns false if the dedupe key was already used. */
export async function award(input: AwardInput, tx: Tx = db) {
  if (input.dedupeKey) {
    const existing = await tx.entryEvent.findUnique({
      where: {
        campaignId_dedupeKey: {
          campaignId: input.campaignId,
          dedupeKey: input.dedupeKey,
        },
      },
    });
    if (existing) return false;
  }
  await tx.entryEvent.create({ data: input });
  return true;
}

export async function entrantTotal(entrantId: string, tx: Tx = db) {
  const { _sum } = await tx.entryEvent.aggregate({
    where: { entrantId },
    _sum: { entries: true },
  });
  return Math.max(0, _sum.entries ?? 0);
}

/**
 * Keeps only entrants who finished entering: every required action done and, when the giveaway
 * requires it, the email opt-in ticked. Until then their entries don't count in a draw.
 */
export async function onlyFullyEntered<T extends { entrantId: string }>(
  campaignId: string,
  tickets: T[],
  tx: Tx = db,
): Promise<T[]> {
  const campaign = await tx.campaign.findUnique({
    where: { id: campaignId },
    include: { actions: true },
  });
  if (!campaign || !tickets.length) return tickets;
  const required = requiredActions(campaign.actions);
  const needsConsent = parseSettings(campaign.settings).requireEmailConsent;
  if (!required.length && !needsConsent) return tickets;
  const ids = tickets.map((t) => t.entrantId);
  let ok = new Set(ids);
  if (needsConsent) {
    const consented = await tx.entrant.findMany({
      where: { id: { in: ids }, marketingConsent: true },
      select: { id: true },
    });
    ok = new Set(consented.map((e) => e.id));
  }
  if (required.length) {
    const done = await tx.entryEvent.findMany({
      where: {
        entrantId: { in: [...ok] },
        actionId: { in: required.map((a) => a.id) },
      },
      distinct: ["entrantId", "actionId"],
      select: { entrantId: true },
    });
    const count = new Map<string, number>();
    for (const d of done) count.set(d.entrantId, (count.get(d.entrantId) ?? 0) + 1);
    ok = new Set([...ok].filter((id) => count.get(id) === required.length));
  }
  return tickets.filter((t) => ok.has(t.entrantId));
}

/** Totals for every entrant in a campaign that can currently win. */
export async function eligibleTickets(campaignId: string, tx: Tx = db) {
  const rows = await tx.entryEvent.groupBy({
    by: ["entrantId"],
    where: { campaignId, entrant: { status: "ACTIVE" } },
    _sum: { entries: true },
  });
  return onlyFullyEntered(
    campaignId,
    rows
      .map((r) => ({
        entrantId: r.entrantId,
        entries: Math.max(0, r._sum.entries ?? 0),
      }))
      .filter((t) => t.entries > 0),
    tx,
  );
}
