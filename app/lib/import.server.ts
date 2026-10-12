import { randomBytes } from "node:crypto";
import db from "../db.server";
import { isValidEmailSyntax, normalizeEmail } from "./bot/email";
import { parseCsv } from "./csv";

// Entrant import for migrating a running giveaway (e.g. from GiveawayNinja).
// Imported people start ACTIVE with one IMPORT ledger event carrying their
// entries. The event's dedupe key is "import:<normalized email>", so running
// the same file again adds nothing.

const HEADER_ALIASES = {
  email: [
    "email",
    "email address",
    "e-mail",
    "e-mail address",
    "customer email",
  ],
  name: ["name", "full name", "customer name", "entrant name", "entrant"],
  firstName: ["first name", "firstname", "first_name"],
  lastName: ["last name", "lastname", "last_name"],
  entries: [
    "entries",
    "total entries",
    "entry count",
    "points",
    "total points",
    "score",
    "tickets",
  ],
  consent: [
    "accepts marketing",
    "marketing consent",
    "consent",
    "subscribed",
    "opted in",
  ],
} as const;

type Column = keyof typeof HEADER_ALIASES;

const clean = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/[^a-z0-9 -]/g, "");

/** Index of each known column in the header row (case and spacing insensitive). */
export function mapHeaders(header: string[]) {
  const cleaned = header.map(clean);
  const map: Partial<Record<Column, number>> = {};
  for (const [col, aliases] of Object.entries(HEADER_ALIASES) as [
    Column,
    readonly string[],
  ][]) {
    const idx = cleaned.findIndex((h) => aliases.some((a) => clean(a) === h));
    if (idx >= 0) map[col] = idx;
  }
  return map;
}

export interface ImportRow {
  line: number;
  email: string;
  emailNormalized: string;
  name: string | null;
  entries: number;
  consent: boolean;
}

export interface ParsedImport {
  rows: ImportRow[];
  errors: { line: number; message: string }[];
  duplicates: number;
  columns: Partial<Record<Column, number>>;
}

const TRUTHY = new Set(["yes", "y", "true", "1", "subscribed", "opted in"]);

/** Parses and validates an export file. Pure; touches no database. */
export function parseImport(text: string): ParsedImport {
  const [header, ...data] = parseCsv(text);
  if (!header) {
    return {
      rows: [],
      errors: [{ line: 1, message: "The file is empty." }],
      duplicates: 0,
      columns: {},
    };
  }
  const columns = mapHeaders(header);
  if (columns.email === undefined) {
    return {
      rows: [],
      errors: [
        { line: 1, message: 'No "Email" column found in the header row.' },
      ],
      duplicates: 0,
      columns,
    };
  }

  const cell = (r: string[], c: Column) =>
    columns[c] === undefined ? "" : (r[columns[c]!] ?? "").trim();
  const byEmail = new Map<string, ImportRow>();
  const errors: ParsedImport["errors"] = [];
  let duplicates = 0;

  data.forEach((r, i) => {
    const line = i + 2;
    const email = cell(r, "email");
    if (!isValidEmailSyntax(email)) {
      errors.push({ line, message: `Invalid email "${email}"` });
      return;
    }
    const rawEntries = cell(r, "entries").replace(/,/g, "");
    const entries = rawEntries === "" ? 0 : Number(rawEntries);
    if (!Number.isInteger(entries) || entries < 0) {
      errors.push({ line, message: `Invalid entries "${rawEntries}"` });
      return;
    }
    const name =
      cell(r, "name") ||
      [cell(r, "firstName"), cell(r, "lastName")].filter(Boolean).join(" ") ||
      null;
    const emailNormalized = normalizeEmail(email);
    const row: ImportRow = {
      line,
      email,
      emailNormalized,
      name,
      entries,
      consent: TRUTHY.has(cell(r, "consent").toLowerCase()),
    };
    const prev = byEmail.get(emailNormalized);
    if (prev) {
      // Aliases of one inbox (or a repeated row): keep the larger entry count.
      duplicates++;
      if (row.entries > prev.entries)
        byEmail.set(emailNormalized, { ...row, line: prev.line });
      return;
    }
    byEmail.set(emailNormalized, row);
  });

  return { rows: [...byEmail.values()], errors, duplicates, columns };
}

export const importDedupeKey = (emailNormalized: string) =>
  `import:${emailNormalized}`;

const CHUNK = 500;
const chunks = <T>(items: T[]) =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) =>
    items.slice(i * CHUNK, (i + 1) * CHUNK),
  );

/** What an import would do, without writing anything. */
export async function previewImport(campaignId: string, parsed: ParsedImport) {
  let existing = 0;
  let alreadyImported = 0;
  let entriesToAdd = 0;
  for (const part of chunks(parsed.rows)) {
    const [entrants, events] = await Promise.all([
      db.entrant.findMany({
        where: {
          campaignId,
          emailNormalized: { in: part.map((r) => r.emailNormalized) },
        },
        select: { emailNormalized: true },
      }),
      db.entryEvent.findMany({
        where: {
          campaignId,
          dedupeKey: {
            in: part.map((r) => importDedupeKey(r.emailNormalized)),
          },
        },
        select: { dedupeKey: true },
      }),
    ]);
    const done = new Set(events.map((e) => e.dedupeKey));
    existing += entrants.length;
    for (const r of part) {
      if (done.has(importDedupeKey(r.emailNormalized))) alreadyImported++;
      else entriesToAdd += r.entries;
    }
  }
  return {
    rows: parsed.rows.length,
    newEntrants: parsed.rows.length - existing,
    existingEntrants: existing,
    alreadyImported,
    entriesToAdd,
  };
}

/**
 * Creates missing entrants and their IMPORT events. Existing entrants keep
 * their status and details; they only receive the imported entries (once).
 */
export async function runImport(campaignId: string, parsed: ParsedImport) {
  let created = 0;
  let awarded = 0;
  let entries = 0;
  for (const part of chunks(parsed.rows)) {
    await db.$transaction(async (tx) => {
      const now = new Date();
      const made = await tx.entrant.createMany({
        data: part.map((r) => ({
          campaignId,
          email: r.email,
          emailNormalized: r.emailNormalized,
          name: r.name,
          status: "ACTIVE" as const,
          verifiedAt: now,
          marketingConsent: r.consent,
          referralCode: randomBytes(5).toString("base64url"),
        })),
        skipDuplicates: true,
      });
      created += made.count;

      const entrants = await tx.entrant.findMany({
        where: {
          campaignId,
          emailNormalized: { in: part.map((r) => r.emailNormalized) },
        },
        select: { id: true, emailNormalized: true },
      });
      const idByEmail = new Map(entrants.map((e) => [e.emailNormalized, e.id]));
      const events = part
        .filter((r) => r.entries > 0 && idByEmail.has(r.emailNormalized))
        .map((r) => ({
          campaignId,
          entrantId: idByEmail.get(r.emailNormalized)!,
          source: "IMPORT" as const,
          entries: r.entries,
          note: "imported from CSV",
          dedupeKey: importDedupeKey(r.emailNormalized),
        }));
      // The (campaignId, dedupeKey) unique index makes a re-run a no-op.
      const added = await tx.entryEvent.createManyAndReturn({
        data: events,
        skipDuplicates: true,
        select: { entries: true },
      });
      awarded += added.length;
      entries += added.reduce((s, e) => s + e.entries, 0);
    });
  }
  return { created, awarded, entries };
}
