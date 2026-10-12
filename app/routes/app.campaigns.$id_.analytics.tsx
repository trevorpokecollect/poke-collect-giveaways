import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { campaignAnalytics, type DayPoint } from "../lib/analytics.server";
import { downloadFile } from "../lib/download";

// Named with "$id_" so it renders as its own page instead of nesting inside
// the campaign page (which has no <Outlet />). URL: /app/campaigns/:id/analytics.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, shop: session.shop },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });
  return {
    campaign: { id: campaign.id, title: campaign.title },
    stats: await campaignAnalytics(campaign),
  };
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function CampaignAnalytics() {
  const { campaign, stats } = useLoaderData<typeof loader>();
  const { totals, revenue, conversion } = stats;
  const [error, setError] = useState<string | null>(null);
  const base = `/app/campaigns/${campaign.id}`;
  const download = (query: string, name: string) =>
    downloadFile(`${base}/export?${query}`, name).catch((e: Error) =>
      setError(e.message),
    );

  return (
    <s-page heading={`${campaign.title}: analytics`}>
      <s-link slot="breadcrumb-actions" href={base}>
        Back to giveaway
      </s-link>
      <s-button
        slot="secondary-actions"
        onClick={() => download("type=entrants", "entrants.csv")}
      >
        Export entrants
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() => download("type=orders", "orders.csv")}
      >
        Export order log
      </s-button>
      {error && <s-banner tone="critical">{error}</s-banner>}

      <s-section>
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          <Stat label="Entrants" value={totals.entrants.toLocaleString()} />
          <Stat
            label="Verified"
            value={pct(totals.verificationRate)}
            hint={`${totals.verified.toLocaleString()} entrants`}
          />
          <Stat
            label="Held for review"
            value={pct(totals.holdRate)}
            hint={`${totals.held.toLocaleString()} entrants`}
          />
          <Stat
            label="Disqualified"
            value={pct(totals.disqualifiedRate)}
            hint={`${totals.disqualified.toLocaleString()} entrants`}
          />
          <Stat
            label="Revenue from entry orders"
            value={money(revenue.revenue)}
            hint={
              revenue.missing
                ? `${revenue.missing} older orders have no amount saved`
                : "Order subtotals"
            }
          />
          <Stat
            label="Orders that earned entries"
            value={revenue.orders.toLocaleString()}
          />
          <Stat
            label="Entrants who bought"
            value={pct(conversion.rate)}
            hint={`${conversion.formBuyers} of ${conversion.formEntrants} form sign-ups`}
          />
          <Stat
            label="Buyers in the giveaway"
            value={conversion.buyers.toLocaleString()}
            hint="Includes sign-ups created from orders"
          />
        </s-grid>
      </s-section>

      <s-section heading="Entrants per day">
        <BarChart days={stats.days} field="entrants" />
      </s-section>
      <s-section heading="Entries awarded per day">
        <BarChart days={stats.days} field="entries" />
      </s-section>

      <s-section heading="Entries by source">
        {stats.sources.length === 0 ? (
          <s-paragraph>No entries yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Source</s-table-header>
              <s-table-header format="numeric">Events</s-table-header>
              <s-table-header format="numeric">Entries</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {stats.sources.map((s) => (
                <s-table-row key={s.label}>
                  <s-table-cell>{s.label}</s-table-cell>
                  <s-table-cell>{s.events.toLocaleString()}</s-table-cell>
                  <s-table-cell>{s.entries.toLocaleString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Top referrers">
        {stats.topReferrers.length === 0 ? (
          <s-paragraph>No referrals yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Entrant</s-table-header>
              <s-table-header format="numeric">Referrals</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {stats.topReferrers.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    {r.name ? `${r.name} (${r.email})` : r.email}
                  </s-table-cell>
                  <s-table-cell>{r.referrals}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Traffic sources (UTM)">
        {stats.utm.length === 0 ? (
          <s-paragraph>No entrants yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">utm_source</s-table-header>
              <s-table-header format="numeric">Entrants</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {stats.utm.map((u) => (
                <s-table-row key={u.source}>
                  <s-table-cell>{u.source}</s-table-cell>
                  <s-table-cell>{u.count.toLocaleString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
      <s-section slot="aside" heading="How these are counted">
        <s-paragraph>
          Days use the giveaway&apos;s timezone. Revenue is the subtotal of
          orders that earned entries. &quot;Entrants who bought&quot; counts
          people who signed up through the giveaway form and also have an order
          in the log.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {hint && <s-text color="subdued">{hint}</s-text>}
      </s-stack>
    </s-box>
  );
}

/** Plain SVG bar chart; scales to the container width. */
function BarChart({
  days,
  field,
}: {
  days: DayPoint[];
  field: "entrants" | "entries";
}) {
  if (days.length === 0) return <s-paragraph>No activity yet.</s-paragraph>;
  const W = 720;
  const H = 180;
  const pad = { top: 16, bottom: 22, left: 4 };
  const max = Math.max(1, ...days.map((d) => d[field]));
  const slot = (W - pad.left) / days.length;
  const bar = Math.max(1, slot * 0.75);
  const plotH = H - pad.top - pad.bottom;
  const labelEvery = Math.ceil(days.length / 8);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={`${field} per day, peak ${max.toLocaleString()}`}
      style={{ display: "block" }}
    >
      <text x={W} y={11} textAnchor="end" fontSize="11" fill="#616161">
        peak {max.toLocaleString()}
      </text>
      <line
        x1={0}
        x2={W}
        y1={H - pad.bottom}
        y2={H - pad.bottom}
        stroke="#e3e3e3"
      />
      {days.map((d, i) => {
        const h = (d[field] / max) * plotH;
        const x = pad.left + i * slot + (slot - bar) / 2;
        return (
          <g key={d.day}>
            <rect
              x={x}
              y={H - pad.bottom - h}
              width={bar}
              height={h}
              rx={Math.min(3, bar / 3)}
              fill="#303030"
            >
              <title>
                {d.day}: {d[field].toLocaleString()}
              </title>
            </rect>
            {i % labelEvery === 0 && (
              <text
                x={x + bar / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize="11"
                fill="#616161"
              >
                {d.day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
