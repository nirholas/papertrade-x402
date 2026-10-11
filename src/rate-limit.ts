/**
 * Fixed-window rate limiter held in isolate memory.
 *
 * Pages Functions have no shared state without a paid binding, so this is a per-isolate guard: it
 * bounds what one client can pull through a warm isolate (and therefore how hard a flood can hit the
 * upstream Papertrade API) but is not a global quota. Cost lets expensive calls drain a client faster.
 */
export interface LimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

export function createLimiter(limit: number, windowMs: number, now: () => number = Date.now, maxKeys = 5_000) {
  const hits = new Map<string, { start: number; used: number }>();
  return {
    take(key: string, cost = 1): LimitResult {
      const t = now();
      let entry = hits.get(key);
      if (!entry || t - entry.start >= windowMs) {
        if (hits.size >= maxKeys) {
          for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
          if (hits.size >= maxKeys) hits.delete(hits.keys().next().value as string);
        }
        entry = { start: t, used: 0 };
        hits.set(key, entry);
      }
      const retryAfter = Math.max(1, Math.ceil((entry.start + windowMs - t) / 1000));
      if (entry.used + cost > limit) return { ok: false, limit, remaining: Math.max(0, limit - entry.used), retryAfter };
      entry.used += cost;
      return { ok: true, limit, remaining: limit - entry.used, retryAfter };
    },
  };
}

/** Client identity for limiting: the Cloudflare edge address, else a shared bucket. */
export const clientKey = (req: Request): string => req.headers.get('CF-Connecting-IP') ?? req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'anonymous';

/** Relative upstream cost of each preview, in limiter units. */
export const PREVIEW_COST = { 'wallet-risk': 3, 'liquidations-nearby': 8, estimate: 2, 'traders-top': 5, markets: 2 } as const;
