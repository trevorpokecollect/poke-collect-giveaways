import { useState } from "react";
import { publicName } from "../lib/names";
import { flag, TextInput } from "./fields";

export interface ActivityItem {
  id: string;
  at: string;
  entrant?: { id: string; email: string; name: string | null; status: string };
  what: string;
  entries: number;
  canVoid: boolean;
  voided: string | null;
}

/**
 * Every entry, newest first: who, how, and how many, with Disqualify / Restore for a single entry.
 * `submit` posts { intent, eventId, reason } to the page's action.
 */
export function EntryActivityTable(props: {
  items: ActivityItem[];
  campaignId: string;
  submit: (data: Record<string, string>) => void;
  busy?: boolean;
  /** Off on an entrant's own page. */
  showEntrant?: boolean;
}) {
  const [reason, setReason] = useState("");
  if (props.items.length === 0)
    return <s-paragraph>No entries match.</s-paragraph>;
  const showEntrant = props.showEntrant ?? true;
  return (
    <s-stack gap="base">
      <TextInput
        label="Reason for disqualifying an entry (optional)"
        placeholder="e.g. duplicate account, fake follow"
        value={reason}
        onChange={setReason}
      />
      <s-table>
        <s-table-header-row>
          {showEntrant && (
            <s-table-header listSlot="primary">Entrant</s-table-header>
          )}
          <s-table-header listSlot={showEntrant ? undefined : "primary"}>
            How
          </s-table-header>
          <s-table-header format="numeric">Entries</s-table-header>
          <s-table-header>When</s-table-header>
          <s-table-header>Status</s-table-header>
          <s-table-header />
        </s-table-header-row>
        <s-table-body>
          {props.items.map((i) => (
            <s-table-row key={i.id}>
              {showEntrant && (
                <s-table-cell>
                  {i.entrant ? (
                    <s-stack gap="none">
                      <s-link
                        href={`/app/campaigns/${props.campaignId}/entrants/${i.entrant.id}`}
                      >
                        {publicName(i.entrant.name, i.entrant.email)}
                      </s-link>
                      <s-text color="subdued">{i.entrant.email}</s-text>
                    </s-stack>
                  ) : (
                    "—"
                  )}
                </s-table-cell>
              )}
              <s-table-cell>{i.what}</s-table-cell>
              <s-table-cell>
                {i.entries > 0
                  ? `+${i.entries.toLocaleString()}`
                  : i.entries.toLocaleString()}
              </s-table-cell>
              <s-table-cell>{i.at}</s-table-cell>
              <s-table-cell>
                {i.voided !== null ? (
                  <s-badge tone="critical">Disqualified: {i.voided}</s-badge>
                ) : i.entrant?.status === "DISQUALIFIED" ? (
                  <s-badge tone="critical">Entrant disqualified</s-badge>
                ) : i.entrant && i.entrant.status !== "ACTIVE" ? (
                  <s-badge tone="warning">Not counted yet</s-badge>
                ) : (
                  <s-badge tone="success">Counts</s-badge>
                )}
              </s-table-cell>
              <s-table-cell>
                {i.voided !== null ? (
                  <s-button
                    disabled={flag(props.busy)}
                    onClick={() =>
                      props.submit({ intent: "restoreEvent", eventId: i.id })
                    }
                  >
                    Restore
                  </s-button>
                ) : i.canVoid ? (
                  <s-button
                    tone="critical"
                    disabled={flag(props.busy)}
                    onClick={() =>
                      props.submit({
                        intent: "voidEvent",
                        eventId: i.id,
                        reason,
                      })
                    }
                  >
                    Disqualify entry
                  </s-button>
                ) : null}
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-stack>
  );
}
