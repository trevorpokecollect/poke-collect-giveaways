import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

// The daily draw on the giveaway page: today's prize and the recent daily prizes,
// with controls to pick or swap the prize, draw early, release it or mark it sent.

export interface DailyPrizeRow {
  id: string;
  periodKey: string;
  title: string;
  imageUrl: string | null;
  value: number;
  status: "RESERVED" | "DRAWN" | "SENT" | "RELEASED";
  drawAt: string;
  winner: string | null;
  note: string | null;
}

export interface DailyData {
  drawTime: string;
  timezone: string;
  currentId: string | null;
  prizes: DailyPrizeRow[];
}

const STATUS: Record<
  DailyPrizeRow["status"],
  { label: string; tone: "info" | "success" | "neutral" | "warning" }
> = {
  RESERVED: { label: "Reserved", tone: "info" },
  DRAWN: { label: "Won, to send", tone: "warning" },
  SENT: { label: "Sent", tone: "success" },
  RELEASED: { label: "Back in stock", tone: "neutral" },
};

const money = (n: number) => `$${n.toFixed(2)}`;

export function DailySection({ daily }: { daily: DailyData }) {
  const shopify = useAppBridge();
  const fetcher = useFetcher<{
    ok?: boolean;
    error?: string;
    message?: string;
  }>();
  const busy = fetcher.state !== "idle";
  const submit = (data: Record<string, string>) =>
    fetcher.submit(data, { method: "post" });
  const current = daily.prizes.find((p) => p.id === daily.currentId) ?? null;
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: daily.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));

  return (
    <s-section heading="Daily draw">
      <s-stack gap="base">
        {fetcher.data?.error && (
          <s-banner tone="critical">{fetcher.data.error}</s-banner>
        )}
        {fetcher.data?.message && (
          <s-banner tone="success">{fetcher.data.message}</s-banner>
        )}
        {current ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              {current.imageUrl && (
                <s-thumbnail
                  src={current.imageUrl}
                  alt={current.title}
                  size="large"
                />
              )}
              <s-stack gap="small-200">
                <s-text color="subdued">Today&apos;s prize</s-text>
                <s-heading>{current.title}</s-heading>
                <s-text>
                  {money(current.value)} · drawn {when(current.drawAt)}
                </s-text>
                <s-stack direction="inline" gap="small-200">
                  <s-badge tone={STATUS[current.status].tone}>
                    {STATUS[current.status].label}
                  </s-badge>
                  {current.winner && <s-text>Winner: {current.winner}</s-text>}
                </s-stack>
              </s-stack>
            </s-stack>
          </s-box>
        ) : (
          <s-paragraph>
            No prize picked for today yet. The app picks one automatically
            within a minute of the giveaway going live, or pick one now.
          </s-paragraph>
        )}
        <s-stack direction="inline" gap="base">
          {(!current || current.status === "RESERVED") && (
            <s-button
              disabled={busy}
              onClick={async () => {
                // Any product, outside the price range too; 1 unit is reserved as usual,
                // and the automatic pick takes over from the next day.
                const selected = await shopify.resourcePicker({
                  type: "product",
                  action: "select",
                  multiple: false,
                });
                const id = selected?.[0]?.id;
                if (id) submit({ intent: "dailyChoose", productId: id });
              }}
            >
              Choose product
            </s-button>
          )}
          {!current && (
            <s-button
              disabled={busy}
              onClick={() => submit({ intent: "dailyPick" })}
            >
              Pick today&apos;s prize
            </s-button>
          )}
          {current?.status === "RESERVED" && (
            <>
              <s-button
                disabled={busy}
                onClick={() => submit({ intent: "dailySwap" })}
              >
                Swap for another product
              </s-button>
              <s-button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Draw today's winner now from the entries so far?",
                    )
                  )
                    submit({ intent: "dailyDrawNow" });
                }}
              >
                Draw now
              </s-button>
            </>
          )}
        </s-stack>
        <s-text color="subdued">
          Drawn every day at {daily.drawTime} ({daily.timezone}) from the
          entries earned since the previous draw.
        </s-text>

        {daily.prizes.length > 0 && (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Prize</s-table-header>
              <s-table-header>Day</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header>Winner</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {daily.prizes.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    {p.title} ({money(p.value)})
                  </s-table-cell>
                  <s-table-cell>{p.periodKey}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS[p.status].tone}>
                      {STATUS[p.status].label}
                    </s-badge>
                    {p.note && p.status === "RELEASED" && (
                      <s-text color="subdued"> {p.note}</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>{p.winner ?? "—"}</s-table-cell>
                  <s-table-cell>
                    {p.status === "DRAWN" && (
                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          variant="tertiary"
                          disabled={busy}
                          onClick={() =>
                            submit({ intent: "dailySent", prizeId: p.id })
                          }
                        >
                          Mark sent
                        </s-button>
                        <s-button
                          variant="tertiary"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Put this prize back in stock? The winner keeps their win on record.",
                              )
                            )
                              submit({ intent: "dailyRelease", prizeId: p.id });
                          }}
                        >
                          Release
                        </s-button>
                      </s-stack>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-stack>
    </s-section>
  );
}
