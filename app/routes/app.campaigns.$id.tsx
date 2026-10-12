import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { CampaignStatus, EntrantStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { runDraw } from "../lib/draw.server";
import { activate, clawBackReferrals } from "../lib/entries/signup.server";
import { riskTone, statusTone } from "../lib/ui";
import { downloadFile } from "../lib/download";
import {
  DRAW_INTENTS,
  drawsSectionExtras,
  handleDrawIntent,
  winnerStatus,
} from "../lib/winners.server";
import { DrawsSection } from "../components/DrawsSection";
import { DailySection, type DailyData } from "../components/DailySection";
import {
  currentPrize,
  dailySettings,
  drawPrize,
  ensurePrize,
  markPrizeSent,
  releasePrize,
  swapPrize,
  choosePrize,
} from "../lib/daily.server";
import { publicName } from "../lib/winners";
import {
  orderPlacedAt,
  ordersCountFrom,
  removePreStartOrderEntries,
} from "../lib/entries/orders.server";
import { periodFor } from "../lib/daily";
import { entriesByMethod } from "../lib/entries/methods.server";
import { EntriesByMethodTable } from "../components/EntriesByMethod";
import { EntryActivityTable } from "../components/EntryActivity";
import { Select } from "../components/fields";
import {
  activityFeed,
  restoreEvent,
  voidEvent,
} from "../lib/entries/void.server";

const FILTERS = [
  "ALL",
  "ACTIVE",
  "HELD",
  "PENDING_VERIFICATION",
  "DISQUALIFIED",
] as const;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, shop: session.shop },
    include: { actions: { orderBy: { sortOrder: "asc" } } },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const filter = url.searchParams.get("status") ?? "ALL";
  // Entrant search: case-insensitive match on email or name.
  const q = url.searchParams.get("q")?.trim().slice(0, 200) ?? "";
  const searchWhere = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const statusWhere =
    filter !== "ALL" && FILTERS.includes(filter as never)
      ? { status: filter as EntrantStatus }
      : {};

  const [counts, entrants, totals, orders, draws] = await Promise.all([
    db.entrant.groupBy({
      by: ["status"],
      where: { campaignId: campaign.id },
      _count: true,
    }),
    db.entrant.findMany({
      where: { campaignId: campaign.id, ...statusWhere, ...searchWhere },
      orderBy: [{ riskScore: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: { riskSignals: { select: { code: true } } },
    }),
    db.entryEvent.groupBy({
      by: ["entrantId"],
      where: { campaignId: campaign.id },
      _sum: { entries: true },
    }),
    db.orderLog.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.draw.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: "desc" },
      include: {
        winners: {
          orderBy: { position: "asc" },
          include: { entrant: { select: { email: true, name: true } } },
        },
      },
    }),
  ]);
  const dailyCfg = dailySettings(campaign);
  // Daily giveaways can show just the current draw period ("Today").
  const methodPeriod =
    dailyCfg.enabled && url.searchParams.get("methods") !== "all"
      ? "today"
      : "all";
  const methods = await entriesByMethod(campaign.id, {
    since:
      methodPeriod === "today"
        ? periodFor(new Date(), campaign.timezone, dailyCfg.drawTime).opensAt
        : undefined,
  });
  let daily: DailyData | null = null;
  if (dailyCfg.enabled) {
    const [current, prizes] = await Promise.all([
      currentPrize(campaign),
      db.dailyPrize.findMany({
        where: { campaignId: campaign.id },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          draw: {
            include: {
              winners: {
                take: 1,
                include: { entrant: { select: { name: true, email: true } } },
              },
            },
          },
        },
      }),
    ]);
    daily = {
      drawTime: dailyCfg.drawTime,
      timezone: campaign.timezone,
      currentId: current?.prize?.id ?? null,
      prizes: prizes.map((p) => {
        const w = p.draw?.winners[0];
        return {
          id: p.id,
          periodKey: p.periodKey,
          title: p.title,
          imageUrl: p.imageUrl,
          value: p.value,
          status: p.status,
          drawAt: p.drawAt.toISOString(),
          winner: w
            ? `${publicName(w.entrant.name, w.entrant.email)} (${w.entrant.email})`
            : null,
          note: p.note,
        };
      }),
    };
  }
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: campaign.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  const activityMethod = url.searchParams.get("activity") ?? "";
  const activityQ = url.searchParams.get("aq")?.trim().slice(0, 200) ?? "";
  const activity = await activityFeed(campaign.id, {
    method: activityMethod || undefined,
    q: activityQ,
  });
  const totalBy = Object.fromEntries(
    totals.map((t) => [t.entrantId, t._sum.entries ?? 0]),
  );

  return {
    filter,
    q,
    storefrontPath: `/apps/giveaways/${campaign.slug}`,
    startsLabel: when.format(ordersCountFrom(campaign)),
    campaign: {
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      slug: campaign.slug,
      actions: campaign.actions.map((a) => ({
        id: a.id,
        label: a.label,
        entries: a.entries,
        type: a.type,
      })),
    },
    counts: Object.fromEntries(
      counts.map((c) => [c.status, c._count]),
    ) as Record<string, number>,
    totalEntries: totals.reduce(
      (s, t) => s + Math.max(0, t._sum.entries ?? 0),
      0,
    ),
    entrants: entrants.map((e) => ({
      id: e.id,
      email: e.email,
      name: e.name,
      status: e.status,
      riskScore: e.riskScore,
      signals: [...new Set(e.riskSignals.map((s) => s.code))],
      entries: Math.max(0, totalBy[e.id] ?? 0),
      createdAt: e.createdAt.toISOString(),
    })),
    orders: orders.map((o) => ({
      id: o.id,
      name: o.orderName,
      email: o.email,
      status:
        (o.breakdown as { reason?: string } | null)?.reason ===
        "placed before the giveaway started"
          ? "placed before start, entries removed"
          : o.status.toLowerCase().replaceAll("_", " "),
      entries: o.entries,
      placed: (() => {
        const at = orderPlacedAt(o.breakdown);
        return at ? when.format(at) : null;
      })(),
    })),
    draws: draws.map((d) => ({
      id: d.id,
      createdAt: d.createdAt.toISOString(),
      seed: d.seed,
      snapshotHash: d.snapshotHash,
      totalEntries: d.totalEntries,
      eligibleCount: d.eligibleCount,
      winners: d.winners.map((w) => ({
        id: w.id,
        position: w.position,
        email: w.entrant.email,
        name: w.entrant.name,
        notifiedAt: w.notifiedAt?.toISOString() ?? null,
        claimedAt: w.claimedAt?.toISOString() ?? null,
        forfeited: w.forfeited,
        claimData: w.claimData as Record<string, string> | null,
        ...winnerStatus(w, campaign.settings),
      })),
    })),
    drawExtras: await drawsSectionExtras(campaign),
    daily,
    methods: { period: methodPeriod, rows: methods.rows },
    activity: {
      method: activityMethod,
      q: activityQ,
      items: activity.map((a) => ({ ...a, at: when.format(a.at) })),
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, shop: session.shop },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const entrantIds = form.getAll("entrantId").map(String);
  const audit = (action: string, data?: object) =>
    db.auditLog.create({
      data: { shop: session.shop, action, target: campaign.id, data },
    });

  if (DRAW_INTENTS.has(intent))
    return handleDrawIntent({
      admin,
      shop: session.shop,
      campaignId: campaign.id,
      intent,
      form,
    });

  if (intent.startsWith("daily")) {
    const prizeId = String(form.get("prizeId") ?? "");
    const owned = async () => {
      const p = await db.dailyPrize.findFirst({
        where: { id: prizeId, campaignId: campaign.id },
      });
      if (!p) throw new Error("Prize not found.");
      return p;
    };
    try {
      switch (intent) {
        case "dailyPick": {
          const p = await ensurePrize(campaign, admin);
          if (!p)
            return {
              error:
                "No prize picked. Check that daily draw is on, the giveaway is live, and an in-stock product matches the rules.",
            };
          await audit("daily.pick", { prizeId: p.id });
          return { ok: true, message: `Today's prize: ${p.title}` };
        }
        case "dailyChoose": {
          const productId = String(form.get("productId") ?? "");
          if (!productId.startsWith("gid://shopify/Product/"))
            return { error: "Choose a product." };
          const p = await choosePrize(campaign, admin, productId);
          await audit("daily.choose", { prizeId: p.id });
          return { ok: true, message: `Today's prize: ${p.title}` };
        }
        case "dailySwap": {
          const p = await swapPrize(campaign, admin);
          await audit("daily.swap", { prizeId: p.id });
          return { ok: true, message: `Swapped. Today's prize: ${p.title}` };
        }
        case "dailyDrawNow": {
          const p = (await currentPrize(campaign))?.prize;
          if (!p || p.status !== "RESERVED")
            return { error: "There's no reserved prize to draw." };
          const draw = await drawPrize(p, admin);
          await audit("daily.draw", { prizeId: p.id, drawId: draw?.id });
          return draw
            ? { ok: true, message: "Winner drawn and emailed." }
            : {
                ok: true,
                message:
                  "Nobody has entered today, so the prize went back to stock.",
              };
        }
        case "dailySent": {
          await markPrizeSent((await owned()).id, admin);
          await audit("daily.sent", { prizeId });
          return {
            ok: true,
            message: "Marked sent and removed from inventory.",
          };
        }
        case "dailyRelease": {
          await releasePrize(
            (await owned()).id,
            admin,
            "Released from the admin",
          );
          await audit("daily.release", { prizeId });
          return { ok: true, message: "Prize put back in stock." };
        }
      }
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  switch (intent) {
    case "status": {
      const status = String(form.get("status")) as CampaignStatus;
      // Going live with no start date records one, so only orders placed from now earn entries.
      const startsAt =
        status === "ACTIVE" && !campaign.startsAt ? new Date() : undefined;
      await db.campaign.update({
        where: { id: campaign.id },
        data: { status, startsAt },
      });
      await audit("campaign.status", { status, startsAt });
      break;
    }
    case "voidEvent":
    case "restoreEvent": {
      const eventId = String(form.get("eventId") ?? "");
      const r =
        intent === "voidEvent"
          ? await voidEvent(
              campaign.id,
              eventId,
              String(form.get("reason") ?? ""),
            )
          : await restoreEvent(campaign.id, eventId);
      if ("ok" in r) await audit(`entry.${intent}`, { eventId });
      return r;
    }
    case "removePreStart": {
      const r = await removePreStartOrderEntries(campaign, admin);
      await audit("orders.removePreStart", r);
      return {
        ok: true,
        message: r.orders
          ? `Removed ${r.entries.toLocaleString()} entries from ${r.orders} orders placed before the giveaway started.`
          : "No entries from orders placed before the giveaway started.",
      };
    }
    case "approve": {
      for (const id of entrantIds) {
        const e = await db.entrant.findFirst({
          where: { id, campaignId: campaign.id },
        });
        if (e && e.status !== "ACTIVE") await activate(id);
      }
      await audit("entrant.approve", { entrantIds });
      break;
    }
    case "disqualify": {
      await db.entrant.updateMany({
        where: { id: { in: entrantIds }, campaignId: campaign.id },
        data: { status: "DISQUALIFIED" },
      });
      for (const id of entrantIds) await clawBackReferrals(id);
      await audit("entrant.disqualify", { entrantIds });
      break;
    }
    case "draw": {
      const count = Math.max(1, Math.min(50, Number(form.get("count") || 1)));
      try {
        const draw = await runDraw(campaign.id, count);
        await audit("draw.run", { drawId: draw.id });
        return { ok: true, drawId: draw.id };
      } catch (err) {
        return { error: (err as Error).message };
      }
    }
  }
  return { ok: true };
};

export default function CampaignPage() {
  const {
    campaign,
    counts,
    totalEntries,
    entrants,
    orders,
    draws,
    drawExtras,
    daily,
    filter,
    q,
    storefrontPath,
    methods,
    startsLabel,
    activity,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const submit = (data: Record<string, string>) =>
    fetcher.submit(data, { method: "post" });
  const [, setSearch] = useSearchParams();
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <s-page heading={campaign.title}>
      <s-badge slot="title-metadata" tone={statusTone(campaign.status)}>
        {campaign.status.toLowerCase()}
      </s-badge>
      {campaign.status === "ACTIVE" ? (
        <s-button
          slot="primary-action"
          onClick={() => submit({ intent: "status", status: "ENDED" })}
        >
          End giveaway
        </s-button>
      ) : (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => submit({ intent: "status", status: "ACTIVE" })}
        >
          Go live
        </s-button>
      )}
      <s-button
        slot="secondary-actions"
        href={`/app/campaigns/${campaign.id}/edit`}
      >
        Edit
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() =>
          fetcher.submit(
            { intent: "duplicate" },
            { method: "post", action: `/app/campaigns/${campaign.id}/edit` },
          )
        }
      >
        Duplicate
      </s-button>

      <s-section>
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          <Stat label="Entrants" value={total} />
          <Stat label="Total entries" value={totalEntries} />
          <Stat label="Needs review" value={counts.HELD ?? 0} />
          <Stat
            label="Blocked or disqualified"
            value={counts.DISQUALIFIED ?? 0}
          />
        </s-grid>
      </s-section>

      <s-section heading="Entries By Method">
        <s-stack gap="base">
          {daily && (
            <s-button-group>
              {(
                [
                  ["today", "Current draw"],
                  ["all", "All time"],
                ] as const
              ).map(([value, label]) => (
                <s-button
                  key={value}
                  slot="secondary-actions"
                  variant={methods.period === value ? "primary" : "secondary"}
                  onClick={() =>
                    setSearch((prev) => {
                      const next = new URLSearchParams(prev);
                      if (value === "all") next.set("methods", "all");
                      else next.delete("methods");
                      return next;
                    })
                  }
                >
                  {label}
                </s-button>
              ))}
            </s-button-group>
          )}
          <EntriesByMethodTable rows={methods.rows} />
          <s-text color="subdued">
            People counts each entrant once per method. Click an entrant below
            to see how they earned their entries.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Entry Activity">
        <s-stack gap="base">
          <s-stack direction="inline" gap="base" alignItems="end">
            <Select
              label="Method"
              value={activity.method}
              options={[
                { value: "", label: "All methods" },
                ...methods.rows.map((r) => ({ value: r.key, label: r.label })),
              ]}
              onChange={(v) =>
                setSearch((prev) => {
                  const next = new URLSearchParams(prev);
                  if (v) next.set("activity", v);
                  else next.delete("activity");
                  return next;
                })
              }
            />
            <Form method="get">
              {activity.method && (
                <input type="hidden" name="activity" value={activity.method} />
              )}
              <s-search-field
                name="aq"
                label="Search entries"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search by email or name"
                defaultValue={activity.q}
              />
            </Form>
          </s-stack>
          <EntryActivityTable
            items={activity.items}
            campaignId={campaign.id}
            submit={submit}
            busy={fetcher.state !== "idle"}
          />
          <s-text color="subdued">
            The newest 100 entries. Disqualifying an entry takes back just those
            entries; Restore gives them back.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Entrants">
        <s-stack gap="base">
          <s-stack direction="inline" gap="base" alignItems="end">
            <Form method="get">
              {filter !== "ALL" && (
                <input type="hidden" name="status" value={filter} />
              )}
              <s-search-field
                name="q"
                label="Search entrants"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search by email or name"
                defaultValue={q}
              />
            </Form>
            <s-button href={`/app/campaigns/${campaign.id}/analytics`}>
              Analytics
            </s-button>
            <s-button
              onClick={() =>
                downloadFile(
                  `/app/campaigns/${campaign.id}/export${filter === "ALL" ? "" : `?status=${filter}`}`,
                  "entrants.csv",
                )
              }
            >
              Export CSV
            </s-button>
            <s-button href={`/app/campaigns/${campaign.id}/import`}>
              Import and backfill
            </s-button>
          </s-stack>
          <s-button-group>
            {FILTERS.map((f) => (
              <s-button
                key={f}
                slot="secondary-actions"
                variant={f === filter ? "primary" : "secondary"}
                onClick={() => setSearch(f === "ALL" ? {} : { status: f })}
              >
                {f === "PENDING_VERIFICATION"
                  ? "Unverified"
                  : f === "HELD"
                    ? "Needs review"
                    : f[0] + f.slice(1).toLowerCase()}
              </s-button>
            ))}
          </s-button-group>
          {fetcher.data && "error" in fetcher.data && (
            <s-banner tone="critical">{fetcher.data.error}</s-banner>
          )}
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Entrant</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header format="numeric">Entries</s-table-header>
              <s-table-header format="numeric">Risk</s-table-header>
              <s-table-header>Signals</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {entrants.map((e) => (
                <s-table-row key={e.id}>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-link
                        href={`/app/campaigns/${campaign.id}/entrants/${e.id}`}
                      >
                        {e.email}
                      </s-link>
                      {e.name && <s-text color="subdued">{e.name}</s-text>}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={statusTone(e.status)}>
                      {e.status === "PENDING_VERIFICATION"
                        ? "unverified"
                        : e.status.toLowerCase()}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{e.entries}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={riskTone(e.riskScore)}>
                      {e.riskScore}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {e.signals.join(", ").replaceAll("_", " ") || "—"}
                  </s-table-cell>
                  <s-table-cell>
                    <s-button-group>
                      {e.status !== "ACTIVE" && e.status !== "DISQUALIFIED" && (
                        <s-button
                          onClick={() =>
                            submit({ intent: "approve", entrantId: e.id })
                          }
                        >
                          Approve
                        </s-button>
                      )}
                      {e.status !== "DISQUALIFIED" && (
                        <s-button
                          tone="critical"
                          onClick={() =>
                            submit({ intent: "disqualify", entrantId: e.id })
                          }
                        >
                          Disqualify
                        </s-button>
                      )}
                    </s-button-group>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          {entrants.length === 0 && (
            <s-paragraph>No entrants here yet.</s-paragraph>
          )}
        </s-stack>
      </s-section>

      {daily && <DailySection daily={daily} />}

      <DrawsSection draws={draws} extras={drawExtras} />

      <s-section heading="Recent orders">
        <s-stack gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button
              onClick={() => submit({ intent: "removePreStart" })}
              loading={
                fetcher.state !== "idle" &&
                fetcher.formData?.get("intent") === "removePreStart"
              }
            >
              Remove entries from orders placed before the start
            </s-button>
            <s-text color="subdued">
              Orders placed before {startsLabel} don&apos;t earn entries.
            </s-text>
          </s-stack>
          {fetcher.data &&
            "message" in fetcher.data &&
            fetcher.formData === undefined && (
              <s-banner tone="success">{String(fetcher.data.message)}</s-banner>
            )}
          {orders.length === 0 ? (
            <s-paragraph>
              Orders placed while this giveaway is live will show here with the
              entries they earned.
            </s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Order</s-table-header>
                <s-table-header>Placed</s-table-header>
                <s-table-header>Customer</s-table-header>
                <s-table-header listSlot="inline">Result</s-table-header>
                <s-table-header format="numeric">Entries</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {orders.map((o) => (
                  <s-table-row key={o.id}>
                    <s-table-cell>{o.name}</s-table-cell>
                    <s-table-cell>{o.email ?? "—"}</s-table-cell>
                    <s-table-cell>{o.status}</s-table-cell>
                    <s-table-cell>{o.entries}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="On your store">
        <s-paragraph>
          Add the Giveaway block in your theme editor and set its giveaway link
          to <s-text type="strong">{campaign.slug}</s-text>.
        </s-paragraph>
        <s-paragraph>
          Direct link: <s-text type="strong">{storefrontPath}</s-text>
        </s-paragraph>
      </s-section>
      <s-section slot="aside" heading="Ways to enter">
        <s-unordered-list>
          {campaign.actions.map((a) => (
            <s-list-item key={a.id}>
              {a.label}: {a.entries} {a.entries === 1 ? "entry" : "entries"}
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value.toLocaleString()}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
