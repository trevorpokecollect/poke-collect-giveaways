import { describe, expect, it } from "vitest";
import {
  answerMatches,
  entriesBreakdown,
  leaderboardName,
  matchPollOption,
  publicAction,
  visibleActions,
} from "../app/lib/entries/actions";

const action = (over: Partial<Parameters<typeof publicAction>[0]> = {}) => ({
  id: "a",
  type: "VISIT_URL" as const,
  label: "Visit",
  entries: 1,
  config: { url: "https://poke-collect.com" },
  mandatory: false,
  repeatable: false,
  ...over,
});

describe("public action config", () => {
  it("never exposes quiz answers or secret codes", () => {
    const quiz = publicAction(
      action({
        type: "QUESTION",
        config: { question: "Who is #25?", answer: "Pikachu" },
      }),
    );
    expect(quiz.config).toEqual({ question: "Who is #25?", quiz: true });
    expect(JSON.stringify(quiz)).not.toContain("Pikachu");

    const code = publicAction(
      action({ type: "SECRET_CODE", config: { code: "CHARIZARD" } }),
    );
    expect(JSON.stringify(code)).not.toContain("CHARIZARD");
  });

  it("passes through what the widget needs", () => {
    expect(
      publicAction(
        action({
          type: "WATCH_VIDEO",
          config: { url: "https://youtu.be/x", seconds: 30 },
        }),
      ),
    ).toMatchObject({
      url: "https://youtu.be/x",
      config: { url: "https://youtu.be/x", seconds: 30 },
    });
    expect(
      publicAction(
        action({
          type: "POLL",
          config: {
            question: "Best starter?",
            options: ["Bulbasaur", 3, "Squirtle"],
          },
        }),
      ).config,
    ).toEqual({
      question: "Best starter?",
      options: ["Bulbasaur", "Squirtle"],
    });
  });

  it("drops archived and signup actions and puts mandatory ones first", () => {
    const list = visibleActions([
      action({ id: "signup", type: "SIGNUP" }),
      action({ id: "one" }),
      action({ id: "old", config: { url: "https://x.com", archived: true } }),
      action({ id: "must", mandatory: true }),
      action({ id: "two" }),
    ]);
    expect(list.map((a) => a.id)).toEqual(["must", "one", "two"]);
  });
});

describe("answers", () => {
  it("matches quiz answers ignoring case and spacing", () => {
    expect(answerMatches("  pikachu ", "Pikachu")).toBe(true);
    expect(answerMatches("mr   mime", "Mr Mime")).toBe(true);
    expect(answerMatches("Raichu", "Pikachu")).toBe(false);
    expect(answerMatches("   ", "")).toBe(false);
  });

  it("finds the poll option that was picked", () => {
    expect(matchPollOption(["Scarlet", "Violet"], " violet")).toBe("Violet");
    expect(matchPollOption(["Scarlet", "Violet"], "Sword")).toBeUndefined();
  });
});

describe("leaderboard names", () => {
  it("shows first name and last initial only", () => {
    expect(leaderboardName("ash ketchum", "a@b.com")).toBe("Ash K.");
    expect(leaderboardName("Professor Samuel Oak", "a@b.com")).toBe(
      "Professor O.",
    );
    expect(leaderboardName("Misty", "a@b.com")).toBe("Misty");
    expect(leaderboardName(null, "brock.harrison@gmail.com")).toBe("Brock H.");
    expect(leaderboardName("  ", "x@y.com")).toBe("X");
  });
});

describe("my entries breakdown", () => {
  it("groups ledger events by where they came from", () => {
    const e = (
      source: Parameters<typeof entriesBreakdown>[0][number]["source"],
      entries: number,
      dedupeKey: string | null = null,
      orderLogId: string | null = null,
    ) => ({ source, entries, dedupeKey, orderLogId });
    expect(
      entriesBreakdown([
        e("ACTION", 1, "signup:x"),
        e("ACTION", 3, "action:a:x"),
        e("PURCHASE", 120, "order:1", "log1"),
        e("ROLLBACK", -60, "order:1:edit", "log1"),
        e("REFERRAL", 5, "referral:y"),
        e("ROLLBACK", -5, "referral-clawback:y"),
        e("ADJUSTMENT", 2),
      ]),
    ).toEqual({ signup: 1, actions: 3, purchases: 60, referrals: 0, other: 2 });
  });
});
