import type { EntrySource, Prisma } from "@prisma/client";
import db from "../../db.server";

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

/** Totals for every entrant in a campaign that can currently win. */
export async function eligibleTickets(campaignId: string, tx: Tx = db) {
  const rows = await tx.entryEvent.groupBy({
    by: ["entrantId"],
    where: { campaignId, entrant: { status: "ACTIVE" } },
    _sum: { entries: true },
  });
  return rows
    .map((r) => ({
      entrantId: r.entrantId,
      entries: Math.max(0, r._sum.entries ?? 0),
    }))
    .filter((t) => t.entries > 0);
}
