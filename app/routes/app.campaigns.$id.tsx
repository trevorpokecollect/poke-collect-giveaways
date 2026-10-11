import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { CampaignStatus, EntrantStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { runDraw } from "../lib/draw.server";
import { activate, clawBackReferrals } from "../lib/entries/signup.server";
import { riskTone, statusTone } from "../lib/ui";

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

  const filter = new URL(request.url).searchParams.get("status") ?? "ALL";
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
      where: { campaignId: campaign.id, ...statusWhere },
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
          include: { entrant: { select: { email: true, name: true } } },
        },
      },
    }),
  ]);
  const totalBy = Object.fromEntries(
    totals.map((t) => [t.entrantId, t._sum.entries ?? 0]),
  );

  return {
    filter,
    storefrontPath: `/apps/giveaways/${campaign.slug}`,
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
      status: o.status,
      entries: o.entries,
    })),
    draws: draws.map((d) => ({
      id: d.id,
      createdAt: d.createdAt.toISOString(),
      seed: d.seed,
      snapshotHash: d.snapshotHash,
      totalEntries: d.totalEntries,
      eligibleCount: d.eligibleCount,
      winners: d.winners.map((w) => ({
        position: w.position,
        email: w.entrant.email,
        name: w.entrant.name,
      })),
    })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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

  switch (intent) {
    case "status": {
      const status = String(form.get("status")) as CampaignStatus;
      await db.campaign.update({
        where: { id: campaign.id },
        data: { status },
      });
      await audit("campaign.status", { status });
      break;
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
      } catch (err) {
        return { error: (err as Error).message };
      }
      break;
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
    filter,
    storefrontPath,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
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

      <s-section heading="Entrants">
        <s-stack gap="base">
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
                      <s-text>{e.email}</s-text>
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

      <s-section heading="Draw winners">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="draw" />
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-number-field
              name="count"
              label="Number of winners"
              value="1"
              min={1}
              max={50}
            />
            <s-button
              type="submit"
              variant="primary"
              {...(busy ? { loading: true } : {})}
            >
              Draw
            </s-button>
          </s-stack>
        </fetcher.Form>
        <s-paragraph>
          Only verified entrants who are not held or disqualified can win. Each
          draw records its random seed so the result can be re-checked later.
        </s-paragraph>
        {draws.map((d) => (
          <s-box
            key={d.id}
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-stack gap="small-200">
              <s-text type="strong">
                {new Date(d.createdAt).toLocaleString()}
              </s-text>
              {d.winners.map((w) => (
                <s-text key={w.position}>
                  #{w.position}: {w.name ? `${w.name} (${w.email})` : w.email}
                </s-text>
              ))}
              <s-text color="subdued">
                {d.eligibleCount} eligible entrants, {d.totalEntries} entries.
                Seed {d.seed.slice(0, 12)}…
              </s-text>
            </s-stack>
          </s-box>
        ))}
      </s-section>

      <s-section heading="Recent orders">
        {orders.length === 0 ? (
          <s-paragraph>
            Orders placed while this giveaway is live will show here with the
            entries they earned.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header listSlot="inline">Result</s-table-header>
              <s-table-header format="numeric">Entries</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {orders.map((o) => (
                <s-table-row key={o.id}>
                  <s-table-cell>{o.name}</s-table-cell>
                  <s-table-cell>{o.email ?? "—"}</s-table-cell>
                  <s-table-cell>
                    {o.status.toLowerCase().replaceAll("_", " ")}
                  </s-table-cell>
                  <s-table-cell>{o.entries}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
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
