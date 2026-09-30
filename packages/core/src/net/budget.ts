import { BudgetExceededError } from '../errors.js';

export const DEFAULT_SESSION_FETCH_BUDGET = 300;

export type FetchBudgetOptions = {
  /** Uncached chapter fetches allowed per host this session. */
  limit: number;
  /**
   * Called when a host runs out, to pick up a limit the user raised since
   * the session started (e.g. by re-reading the config).
   */
  refreshLimit?: () => Promise<number | undefined>;
};

/**
 * Caps how many uncached chapters one session may fetch from each host. The
 * rate limiter caps speed; this caps volume, so a looping agent stops and a
 * person decides whether to continue. Cached reads never count.
 */
export class FetchBudget {
  private readonly used = new Map<string, number>();
  private limit: number;

  constructor(private readonly options: FetchBudgetOptions) {
    this.limit = options.limit;
  }

  usage(host: string): { used: number; limit: number; remaining: number } {
    const used = this.used.get(host) ?? 0;
    return {
      used,
      limit: this.limit,
      remaining: Math.max(0, this.limit - used),
    };
  }

  /** Throw `BudgetExceededError` unless `count` more fetches fit. */
  async ensure(host: string, count = 1): Promise<void> {
    if (count <= 0) return;
    const used = this.used.get(host) ?? 0;
    if (used + count <= this.limit) return;
    const refreshed = await this.options
      .refreshLimit?.()
      .catch(() => undefined);
    if (refreshed !== undefined && refreshed > this.limit)
      this.limit = refreshed;
    if (used + count > this.limit)
      throw new BudgetExceededError(host, used, this.limit, count);
  }

  /** Record one uncached fetch; call after `ensure`. */
  take(host: string): void {
    this.used.set(host, (this.used.get(host) ?? 0) + 1);
  }
}
