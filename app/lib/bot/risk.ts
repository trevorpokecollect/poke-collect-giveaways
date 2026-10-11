// Turns individual bot signals into a 0-100 risk score and a policy decision.
// Pure functions so the scoring can be unit tested and explained in the admin UI.

export type SignalCode =
  | "turnstile_failed"
  | "disposable_email"
  | "generated_email"
  | "duplicate_email_alias"
  | "ip_burst"
  | "subnet_burst"
  | "device_reuse"
  | "datacenter_ip"
  | "honeypot"
  | "too_fast"
  | "self_referral"
  | "referral_ring";

export interface Signal {
  code: SignalCode;
  detail?: string;
}

export const SIGNAL_WEIGHTS: Record<SignalCode, number> = {
  turnstile_failed: 100,
  honeypot: 100,
  disposable_email: 60,
  self_referral: 60,
  device_reuse: 45,
  referral_ring: 45,
  ip_burst: 35,
  datacenter_ip: 30,
  too_fast: 30,
  duplicate_email_alias: 25,
  subnet_burst: 20,
  generated_email: 15,
};

export type Decision = "allow" | "verify" | "hold" | "block";

export interface RiskPolicy {
  /** Scores below this are allowed straight through (after email verification if required). */
  verifyAt: number;
  /** Scores at or above this are held for manual review and can't win until approved. */
  holdAt: number;
  /** Scores at or above this are rejected outright. */
  blockAt: number;
  /** Always require an email code before entries count. */
  alwaysVerifyEmail: boolean;
}

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  verifyAt: 20,
  holdAt: 50,
  blockAt: 80,
  alwaysVerifyEmail: true,
};

export function scoreSignals(signals: Signal[]) {
  const unique = new Map(signals.map((s) => [s.code, s]));
  const score = Math.min(
    100,
    [...unique.keys()].reduce((sum, code) => sum + SIGNAL_WEIGHTS[code], 0),
  );
  return { score, signals: [...unique.values()] };
}

export function decide(
  score: number,
  policy: RiskPolicy = DEFAULT_RISK_POLICY,
): Decision {
  if (score >= policy.blockAt) return "block";
  if (score >= policy.holdAt) return "hold";
  if (score >= policy.verifyAt || policy.alwaysVerifyEmail) return "verify";
  return "allow";
}

export function parsePolicy(raw: unknown): RiskPolicy {
  if (!raw || typeof raw !== "object") return DEFAULT_RISK_POLICY;
  return { ...DEFAULT_RISK_POLICY, ...(raw as Partial<RiskPolicy>) };
}
