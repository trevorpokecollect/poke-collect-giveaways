import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { entriesByMethod } from "../lib/entries/methods.server";
import { methodLabel } from "../lib/entries/methods";
import { orderPlacedAt } from "../lib/entries/orders.server";
import { riskTone, statusTone } from "../lib/ui";
import { EntriesByMethodTable } from "../components/EntriesByMethod";

// One entrant's entries: totals per method and every entry event, newest first.
// Named with "$id_" so it renders as its own page. URL: /app/campaigns/:id/entrants/:entrantId.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const entrant = await db.entrant.findFirst({
    where: {
      id: params.entrantId,
      campaignId: params.id,
      campaign: { shop: session.shop },
    },
    include: {
      campaign: { select: { id: true, title: true, timezone: true } },
    },
  });
  if (!entrant) throw new Response("Not found", { status: 404 });
  const [methods, events] = await Promise.all([
    entriesByMethod(entrant.campaignId, { entrantId: entrant.id }),
    db.entryEvent.findMany({
      where: { entrantId: entrant.id },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { orderLog: { select: { orderName: true, breakdown: true } } },
    }),
  ]);
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: entrant.campaign.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  return {
    campaign: entrant.campaign,
    entrant: {
      email: entrant.email,
      name: entrant.name,
      phone: entrant.phone,
      status: entrant.status,
      riskScore: entrant.riskScore,
      createdAt: when.format(entrant.createdAt),
    },
    total: Math.max(
      0,
      methods.rows.reduce((s, r) => s + r.entries, 0),
    ),
    rows: methods.rows.filter((r) => r.times > 0 || r.entries !== 0),
    events: events.map((e) => ({
      id: e.id,
      at: when.format(e.createdAt),
      method: methodLabel(e.source, e.actionId, methods.actions),
      entries: e.entries,
      order: e.orderLog
        ? [
            e.orderLog.orderName,
            orderPlacedAt(e.orderLog.breakdown) &&
              `placed ${when.format(orderPlacedAt(e.orderLog.breakdown)!)}`,
          ]
            .filter(Boolean)
            .join(", ")
        : null,
      note: e.note,
    })),
  };
};

export default function EntrantEntries() {
  const { campaign, entrant, total, rows, events } =
    useLoaderData<typeof loader>();
  return (
    <s-page heading={entrant.name || entrant.email}>
      <s-link slot="breadcrumb-actions" href={`/app/campaigns/${campaign.id}`}>
        {campaign.title}
      </s-link>
      <s-section>
        <s-stack gap="small-200">
          <s-stack direction="inline" gap="small-200">
            <s-badge tone={statusTone(entrant.status)}>
              {entrant.status === "PENDING_VERIFICATION"
                ? "unverified"
                : entrant.status.toLowerCase()}
            </s-badge>
            <s-badge tone={riskTone(entrant.riskScore)}>
              Risk {entrant.riskScore}
            </s-badge>
          </s-stack>
          <s-text>{entrant.email}</s-text>
          {entrant.phone && <s-text>{entrant.phone}</s-text>}
          <s-text color="subdued">Entered {entrant.createdAt}</s-text>
          <s-heading>{total.toLocaleString()} entries</s-heading>
        </s-stack>
      </s-section>

      <s-section heading="Entries By Method">
        <EntriesByMethodTable rows={rows} showPeople={false} />
      </s-section>

      <s-section heading="Entry History">
        {events.length === 0 ? (
          <s-paragraph>No entries yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Method</s-table-header>
              <s-table-header>Given</s-table-header>
              <s-table-header format="numeric">Entries</s-table-header>
              <s-table-header>Order</s-table-header>
              <s-table-header>Note</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {events.map((e) => (
                <s-table-row key={e.id}>
                  <s-table-cell>{e.method}</s-table-cell>
                  <s-table-cell>{e.at}</s-table-cell>
                  <s-table-cell>
                    {e.entries > 0 ? `+${e.entries}` : e.entries}
                  </s-table-cell>
                  <s-table-cell>{e.order ?? "—"}</s-table-cell>
                  <s-table-cell>{e.note ?? "—"}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
