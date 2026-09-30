export type LimiterOptions = {
  /** Max in-flight tasks per host. */
  concurrency: number;
  /** Minimum gap between task starts on one host, in ms. */
  minGapMs: number;
};

type HostState = {
  active: number;
  nextStart: number;
  queue: Array<() => void>;
  timer?: NodeJS.Timeout;
};

/**
 * Per-host concurrency limiter with a minimum gap between request starts.
 * `pause` pushes a host's next start out, e.g. to honor `Retry-After`.
 */
export class HostLimiter {
  private readonly hosts = new Map<string, HostState>();

  constructor(
    private readonly options: LimiterOptions,
    private readonly now: () => number = Date.now,
  ) {}

  private state(host: string): HostState {
    let s = this.hosts.get(host);
    if (!s) {
      s = { active: 0, nextStart: 0, queue: [] };
      this.hosts.set(host, s);
    }
    return s;
  }

  pause(host: string, ms: number): void {
    const s = this.state(host);
    s.nextStart = Math.max(s.nextStart, this.now() + ms);
  }

  async run<T>(host: string, task: () => Promise<T>): Promise<T> {
    const s = this.state(host);
    await new Promise<void>(resolve => {
      s.queue.push(resolve);
      this.drain(s);
    });
    try {
      return await task();
    } finally {
      s.active--;
      this.drain(s);
    }
  }

  private drain(s: HostState): void {
    if (s.timer || s.queue.length === 0 || s.active >= this.options.concurrency)
      return;
    const wait = s.nextStart - this.now();
    if (wait > 0) {
      s.timer = setTimeout(() => {
        s.timer = undefined;
        this.drain(s);
      }, wait);
      return;
    }
    s.active++;
    s.nextStart = this.now() + this.options.minGapMs;
    s.queue.shift()!();
    this.drain(s);
  }
}
