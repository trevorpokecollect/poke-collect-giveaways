import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Newest Instagram post lookup with Instagram's API faked. Needs Postgres for the token store.
describe.skipIf(!process.env.DATABASE_URL)(
  "newest Instagram post",
  async () => {
    const { default: db } = await import("../app/db.server");
    const { latestInstagramPost, resetInstagramCache } =
      await import("../app/lib/instagram.server");

    const calls: string[] = [];
    let permalink = "https://www.instagram.com/p/first/";
    beforeEach(async () => {
      resetInstagramCache();
      calls.length = 0;
      await db.appValue.deleteMany({ where: { key: "instagram_token" } });
      process.env.INSTAGRAM_ACCESS_TOKEN = "tok-env";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          calls.push(url);
          if (url.includes("refresh_access_token"))
            return new Response(JSON.stringify({ access_token: "tok-new" }));
          if (url.includes("tok-new") || url.includes("tok-env"))
            return new Response(JSON.stringify({ data: [{ permalink }] }));
          return new Response(JSON.stringify({ error: { message: "bad" } }), {
            status: 400,
          });
        }),
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.INSTAGRAM_ACCESS_TOKEN;
    });

    it("returns the newest post, refreshing and saving the token", async () => {
      expect(await latestInstagramPost(0)).toBe(permalink);
      expect(calls[0]).toContain("refresh_access_token");
      expect(calls[1]).toContain("tok-new");
      const saved = await db.appValue.findUnique({
        where: { key: "instagram_token" },
      });
      expect(saved?.value).toBe("tok-env|tok-new");
    });

    it("caches for 10 minutes, then picks up a new post", async () => {
      await latestInstagramPost(0);
      permalink = "https://www.instagram.com/p/second/";
      expect(await latestInstagramPost(5 * 60_000)).toBe(
        "https://www.instagram.com/p/first/",
      );
      expect(await latestInstagramPost(11 * 60_000)).toBe(permalink);
      // The saved token is fresh, so no second refresh.
      expect(
        calls.filter((c) => c.includes("refresh_access_token")),
      ).toHaveLength(1);
    });

    it("returns null without a token, so the task falls back to its link", async () => {
      delete process.env.INSTAGRAM_ACCESS_TOKEN;
      expect(await latestInstagramPost(0)).toBeNull();
      expect(calls).toHaveLength(0);
    });
  },
);
