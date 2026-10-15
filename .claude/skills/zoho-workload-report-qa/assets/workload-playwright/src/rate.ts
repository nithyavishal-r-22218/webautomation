import type { BrowserContext } from '@playwright/test';

/**
 * Portal-wide API budget. The portal allows about 200 API calls per 2 minutes in total and then blocks for a while,
 * so EVERY call is counted — the web app's own requests from each browser context and the suite's direct calls
 * (ZpApi, OAuthApi) — in one sliding window per test process (workers=1, so one process).
 *
 *   ZP_API_BUDGET     calls allowed per window before the suite waits (default 150: headroom under 200)
 *   ZP_API_WINDOW_MS  window length (default 120000)
 */
const BUDGET = Number(process.env.ZP_API_BUDGET ?? 150);
const WINDOW_MS = Number(process.env.ZP_API_WINDOW_MS ?? 120_000);
const calls: number[] = [];
const tracked = new WeakSet<BrowserContext>();

const isPortalApi = (url: string) => /\/(api\/v3(\.1)?|restapi)\/portal\//.test(url);
const prune = (now: number) => { while (calls.length && now - calls[0]! >= WINDOW_MS) calls.shift(); };

/** Record one call now. */
export function noteApiCall() { const now = Date.now(); prune(now); calls.push(now); }

/** Calls in the current window (for annotations and logs). */
export function apiCallsInWindow() { prune(Date.now()); return calls.length; }

/**
 * Wait until the window has room for `need` more calls. Called before each test, before a page load (a load sends
 * about 10 calls) and before every direct API call.
 */
export async function waitForApiBudget(need = 1) {
  need = Math.min(need, BUDGET); // asking for more than the whole budget would wait forever
  for (;;) {
    const now = Date.now(); prune(now);
    if (!calls.length || calls.length + need <= BUDGET) return;
    const wait = WINDOW_MS - (now - calls[0]!) + 250;
    if (wait > 5_000) console.log(`[rate] ${calls.length} portal API calls in the last ${WINDOW_MS / 1000} s; waiting ${Math.ceil(wait / 1000)} s`);
    await new Promise(r => setTimeout(r, wait));
  }
}

/**
 * Hold every portal API request a browser context makes (the web app's own calls) until the window has room, then
 * let it through. Counting alone is not enough: one case can save many times, and each save reloads the report
 * (a live run on 09-10-2026 peaked at 322 calls in 2 minutes while only counting).
 */
export async function trackContext(ctx: BrowserContext) {
  if (tracked.has(ctx)) return;
  tracked.add(ctx);
  await ctx.route(url => isPortalApi(url.href), async route => {
    await waitForApiBudget(); noteApiCall();
    await route.continue().catch(() => { /* page or context closed while the request was held */ });
  });
}
