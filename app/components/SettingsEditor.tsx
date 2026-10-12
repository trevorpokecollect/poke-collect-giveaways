import type { CampaignSettings } from "../lib/settings";
import { Check, NumberInput, TextArea, TextInput } from "./fields";

// Stores Campaign.settings only; the winner email, discounts, Klaviyo sync
// and webhook delivery read these elsewhere.
export function SettingsEditor(props: {
  settings: CampaignSettings;
  onChange: (settings: CampaignSettings) => void;
}) {
  const s = props.settings;
  const set = (patch: Partial<CampaignSettings>) =>
    props.onChange({ ...s, ...patch });
  const winner = (patch: Partial<CampaignSettings["winnerEmail"]>) =>
    set({ winnerEmail: { ...s.winnerEmail, ...patch } });
  const consolation = (patch: Partial<CampaignSettings["consolation"]>) =>
    set({ consolation: { ...s.consolation, ...patch } });
  const klaviyo = (patch: Partial<CampaignSettings["klaviyo"]>) =>
    set({ klaviyo: { ...s.klaviyo, ...patch } });

  return (
    <>
      <s-section heading="Winner email">
        <s-stack gap="base">
          <Check
            label="Email winners when they're drawn"
            checked={s.winnerEmail.enabled}
            onChange={(enabled) => winner({ enabled })}
          />
          {s.winnerEmail.enabled && (
            <>
              <TextInput
                label="Subject"
                value={s.winnerEmail.subject}
                onChange={(subject) => winner({ subject })}
              />
              <TextArea
                label="Message"
                rows={4}
                value={s.winnerEmail.body}
                details="Placeholders: {{prize}}, {{title}} and {{claim_url}} (the link where the winner confirms shipping)."
                onChange={(body) => winner({ body })}
              />
              <NumberInput
                label="Days to claim"
                min={1}
                value={s.winnerEmail.claimDays}
                details="After this the prize can be forfeited and redrawn."
                onChange={(claimDays) => winner({ claimDays })}
              />
            </>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Consolation discount">
        <s-stack gap="base">
          <Check
            label="Send everyone who didn't win a discount code"
            checked={s.consolation.enabled}
            onChange={(enabled) => consolation({ enabled })}
          />
          {s.consolation.enabled && (
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <NumberInput
                label="Discount"
                suffix="%"
                min={1}
                max={100}
                value={s.consolation.percentOff}
                onChange={(percentOff) => consolation({ percentOff })}
              />
              <NumberInput
                label="Valid for"
                suffix="days"
                min={1}
                value={s.consolation.daysValid}
                onChange={(daysValid) => consolation({ daysValid })}
              />
              <NumberInput
                label="Minimum entries"
                min={0}
                value={s.consolation.minEntries}
                onChange={(minEntries) => consolation({ minEntries })}
              />
            </s-grid>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Integrations and display">
        <s-stack gap="base">
          <Check
            label="Add entrants to a Klaviyo list"
            checked={s.klaviyo.enabled}
            onChange={(enabled) => klaviyo({ enabled })}
          />
          {s.klaviyo.enabled && (
            <>
              <TextInput
                label="Klaviyo list ID"
                value={s.klaviyo.listId}
                placeholder="e.g. XyZ123"
                onChange={(listId) => klaviyo({ listId })}
              />
              <Check
                label="Only entrants who agreed to marketing"
                checked={s.klaviyo.onlyConsented}
                onChange={(onlyConsented) => klaviyo({ onlyConsented })}
              />
            </>
          )}
          <TextInput
            url
            label="Outbound webhook URL (optional)"
            placeholder="https://"
            details="Receives a POST for new entrants and winners."
            value={s.webhookUrl}
            onChange={(webhookUrl) => set({ webhookUrl })}
          />
          <Check
            label="Show a leaderboard on the giveaway"
            checked={s.showLeaderboard}
            onChange={(showLeaderboard) => set({ showLeaderboard })}
          />
          <Check
            label="Show winners after the draw"
            checked={s.showWinners}
            onChange={(showWinners) => set({ showWinners })}
          />
        </s-stack>
      </s-section>
    </>
  );
}
