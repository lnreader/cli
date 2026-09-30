import { errorInfo, type ErrorInfo } from '../errors.js';
import type { FetchBudget } from '../net/budget.js';
import type { Plugin } from '../types/plugin.js';
import type { PluginLoader, PluginRunner } from './loader.js';
import { hostOf } from './registry.js';

export type PluginTestStepName =
  'load' | 'popular' | 'search' | 'novel' | 'chapter';

export type PluginTestStep = {
  step: PluginTestStepName;
  ok: boolean;
  /** Not run because an earlier step it depends on failed. */
  skipped?: boolean;
  ms: number;
  detail?: string;
  error?: ErrorInfo;
};

export type PluginTestResult = {
  plugin: string;
  ok: boolean;
  steps: PluginTestStep[];
};

/**
 * Exercise a plugin end to end against its live site: load it, list popular
 * novels, search, open a novel and read its first chapter. Nothing is cached
 * or written; the one chapter fetch counts against `budget`.
 */
export async function testPlugin(
  loader: PluginLoader,
  id: string,
  opts: { budget?: FetchBudget } = {},
): Promise<PluginTestResult> {
  const steps: PluginTestStep[] = [];
  const run = async <T>(
    step: PluginTestStepName,
    fn: () => Promise<T>,
    describe: (value: T) => string,
  ): Promise<T | undefined> => {
    const start = Date.now();
    try {
      const value = await fn();
      steps.push({
        step,
        ok: true,
        ms: Date.now() - start,
        detail: describe(value),
      });
      return value;
    } catch (err) {
      steps.push({
        step,
        ok: false,
        ms: Date.now() - start,
        error: errorInfo(err),
      });
      return undefined;
    }
  };
  const skip = (step: PluginTestStepName, why: string) =>
    steps.push({ step, ok: false, skipped: true, ms: 0, detail: why });

  const runner = await run<PluginRunner>(
    'load',
    () => loader.load(id),
    r => `${r.entry.name} ${r.entry.version}`,
  );
  if (!runner) {
    for (const s of ['popular', 'search', 'novel', 'chapter'] as const)
      skip(s, 'plugin did not load');
    return { plugin: id, ok: false, steps };
  }

  const popular = await run(
    'popular',
    async () => {
      const items = await runner.popularNovels(1);
      if (!items.length) throw new Error('no novels returned');
      return items;
    },
    items => `${items.length} novels`,
  );
  const sample: Plugin.NovelItem | undefined = popular?.[0];

  const term =
    sample?.name
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 2)
      .join(' ') || 'the';
  await run(
    'search',
    async () => {
      const items = await runner.searchNovels(term, 1);
      if (!items.length) throw new Error(`no results for "${term}"`);
      return items;
    },
    items => `${items.length} results for "${term}"`,
  );

  if (!sample) {
    skip('novel', 'no novel to open');
    skip('chapter', 'no novel to open');
    return { plugin: runner.id, ok: false, steps };
  }
  const novel = await run(
    'novel',
    async () => {
      const n = await runner.parseNovel(sample.path);
      if (!n.chapters.length) throw new Error('no chapters');
      return n;
    },
    n => `"${n.name}" with ${n.chapters.length} chapters`,
  );
  const first = novel?.chapters[0];
  if (!first) skip('chapter', 'no chapter to read');
  else {
    await run(
      'chapter',
      async () => {
        const host = hostOf(runner.plugin.site) ?? runner.id;
        await opts.budget?.ensure(host);
        opts.budget?.take(host);
        const html = await runner.parseChapter(first.path);
        const text = html.replace(/<[^>]*>|&nbsp;/g, '').trim();
        if (!text && !/<img\b/i.test(html)) throw new Error('empty chapter');
        return text.length;
      },
      chars => `"${first.name}", ${chars} characters`,
    );
  }
  return { plugin: runner.id, ok: steps.every(s => s.ok), steps };
}
