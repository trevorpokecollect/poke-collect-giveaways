type Tone = "neutral" | "info" | "success" | "caution" | "warning" | "critical";

export function statusTone(status: string): Tone {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "SCHEDULED":
    case "PENDING_VERIFICATION":
      return "info";
    case "HELD":
      return "warning";
    case "DISQUALIFIED":
      return "critical";
    default:
      return "neutral";
  }
}

export function riskTone(score: number): Tone {
  if (score >= 80) return "critical";
  if (score >= 50) return "warning";
  if (score >= 20) return "caution";
  return "success";
}
