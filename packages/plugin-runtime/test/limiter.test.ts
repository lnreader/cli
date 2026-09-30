import { describe, expect, it } from 'vitest';
import { HostLimiter } from '../src/net/limiter.js';

const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('HostLimiter', () => {
  it('caps concurrency per host but not across hosts', async () => {
    const limiter = new HostLimiter({ concurrency: 2, minGapMs: 0 });
    const active: Record<string, number> = { a: 0, b: 0 };
    const peak: Record<string, number> = { a: 0, b: 0 };
    const task = (host: string) =>
      limiter.run(host, async () => {
        active[host]!++;
        peak[host] = Math.max(peak[host]!, active[host]!);
        await tick(10);
        active[host]!--;
      });
    await Promise.all([...Array(6)].flatMap(() => [task('a'), task('b')]));
    expect(peak).toEqual({ a: 2, b: 2 });
  });

  it('spaces request starts by minGapMs', async () => {
    const limiter = new HostLimiter({ concurrency: 5, minGapMs: 40 });
    const starts: number[] = [];
    await Promise.all(
      [...Array(3)].map(() =>
        limiter.run('h', async () => void starts.push(Date.now())),
      ),
    );
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(35);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(35);
  });

  it('pause delays the next start on that host', async () => {
    const limiter = new HostLimiter({ concurrency: 1, minGapMs: 0 });
    limiter.pause('h', 50);
    const t0 = Date.now();
    await limiter.run('h', async () => {});
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
  });
});
