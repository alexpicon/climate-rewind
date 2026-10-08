import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GENERIC_MESSAGE, NETWORK_MESSAGE, TIMEOUT_MESSAGE, requestLookup } from "@/lib/ui/lookup-client";

const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("requestLookup (the browser side of /api/lookup)", () => {
  it("returns the payload on success and encodes the address", async () => {
    const seen: string[] = [];
    const result = await requestLookup("100 James Robertson Pkwy, Nashville, TN", async (url) => {
      seen.push(url);
      return new Response(JSON.stringify({ address: { matched: "x" } }), { status: 200 });
    });
    expect(result.ok).toBe(true);
    expect(seen[0]).toBe("/api/lookup?address=100%20James%20Robertson%20Pkwy%2C%20Nashville%2C%20TN");
  });

  it("passes the server's own plain message through for a nonsense address (404)", async () => {
    const message = "The Census could not match that to a street address. Include the house number, street, city and state.";
    expect(await requestLookup("asdf qwer", reply({ error: message }, 404))).toEqual({ ok: false, message });
  });

  it("uses a generic message when the server sends no usable one", async () => {
    expect(await requestLookup("x", reply({}, 500))).toEqual({ ok: false, message: GENERIC_MESSAGE });
    expect(await requestLookup("x", async () => new Response("<html>bad gateway</html>", { status: 502 }))).toEqual({ ok: false, message: NETWORK_MESSAGE });
  });

  it("says the connection failed when fetch itself rejects", async () => {
    expect(await requestLookup("x", async () => Promise.reject(new TypeError("Failed to fetch")))).toEqual({ ok: false, message: NETWORK_MESSAGE });
  });

  describe("an API timeout", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const hangsUntilAborted = (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });

    it("stops waiting after the time limit and says the services may be slow", async () => {
      const pending = requestLookup("100 James Robertson Pkwy, Nashville, TN", hangsUntilAborted, 25_000);
      await vi.advanceTimersByTimeAsync(24_900);
      let done = false;
      void pending.then(() => (done = true));
      await Promise.resolve();
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(await pending).toEqual({ ok: false, message: TIMEOUT_MESSAGE });
      expect(TIMEOUT_MESSAGE).toMatch(/try again/i);
    });

    it("does not call a quick network failure a timeout", async () => {
      const pending = requestLookup("x", async () => Promise.reject(new TypeError("offline")), 25_000);
      expect(await pending).toEqual({ ok: false, message: NETWORK_MESSAGE });
    });
  });
});
