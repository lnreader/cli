import { ConfigSchema, ERROR_CODES, READ_FORMATS } from '@lnreader-cli/core';
import { z } from 'zod';

/*
 * JSON output of each command, as printed with `--json`. `lnreader schema
 * <command>` prints these as JSON Schema; tests check real output against
 * them. Removing or retyping a field is a breaking change (major version).
 */

const NovelItem = z.looseObject({
  name: z.string(),
  path: z.string(),
  cover: z.string().optional(),
});

const ChapterItem = z.looseObject({
  name: z.string(),
  path: z.string(),
  releaseTime: z.string().nullable().optional(),
  chapterNumber: z.number().optional(),
  page: z.string().optional(),
  scanlator: z.union([z.string(), z.array(z.string())]).optional(),
});

const SourceNovel = NovelItem.extend({
  genres: z.string().optional(),
  summary: z.string().optional(),
  author: z.string().optional(),
  artist: z.string().optional(),
  status: z.string().optional(),
  rating: z.number().optional(),
});

const ErrorInfo = z.object({
  code: z.enum(ERROR_CODES as [string, ...string[]]),
  message: z.string(),
  hint: z.string().optional(),
});

const Failure = z.object({
  index: z.number().int(),
  chapter: ChapterItem,
  error: z.string(),
});

const LibraryNovel = z.object({
  id: z.number().int(),
  pluginId: z.string(),
  path: z.string(),
  name: z.string(),
  author: z.string().optional(),
  cover: z.string().optional(),
  url: z.string().optional(),
  options: z.object({
    outDir: z.string(),
    split: z.number().int().optional(),
    noImages: z.boolean().optional(),
    css: z.string().optional(),
  }),
  followedAt: z.string(),
  checkedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  knownCount: z.number().int(),
  totalCount: z.number().int(),
});

const UpdateResult = z.union([
  z.object({ status: z.literal('up-to-date'), total: z.number().int() }),
  z.object({
    status: z.literal('updated'),
    total: z.number().int(),
    added: z.array(z.number().int()),
    files: z.array(z.string()),
    failed: z.array(Failure),
  }),
]);

const NovelRef = z.object({
  plugin: z.string(),
  path: z.string(),
  name: z.string(),
  url: z.string(),
});

const ChapterRef = z.object({
  index: z.number().int(),
  name: z.string(),
  path: z.string(),
});

const ReadOne = z.object({
  novel: NovelRef,
  chapter: ChapterRef,
  totalChapters: z.number().int(),
  format: z.enum(READ_FORMATS as [string, ...string[]]),
  offset: z.number().int(),
  nextOffset: z
    .number()
    .int()
    .optional()
    .describe('Pass as --offset to read the next chunk; absent at the end'),
  totalChars: z.number().int(),
  cached: z.boolean(),
  content: z.string().describe('Untrusted text from the source site'),
});

const ReadRange = z.object({
  novel: NovelRef,
  totalChapters: z.number().int(),
  format: z.enum(READ_FORMATS as [string, ...string[]]),
  chapters: z.array(
    z.union([
      ChapterRef.extend({
        cached: z.boolean(),
        content: z.string().describe('Untrusted text from the source site'),
      }),
      ChapterRef.extend({ error: ErrorInfo }),
    ]),
  ),
});

const PluginTestStep = z.object({
  step: z.enum(['load', 'popular', 'search', 'novel', 'chapter']),
  ok: z.boolean(),
  skipped: z.boolean().optional(),
  ms: z.number(),
  detail: z.string().optional(),
  error: ErrorInfo.optional(),
});

export const OUTPUT_SCHEMAS = {
  'plugins list': z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      site: z.string(),
      lang: z.string(),
      version: z.string(),
      url: z.string(),
      iconUrl: z.string().optional(),
      repo: z.string(),
    }),
  ),
  'plugins repo list': z.array(z.string()),
  'plugins test': z.object({
    plugin: z.string(),
    ok: z.boolean(),
    steps: z.array(PluginTestStep),
  }),
  search: z.array(
    z.object({
      plugin: z.string(),
      results: z.array(NovelItem),
      error: z.string().optional(),
    }),
  ),
  popular: z.array(NovelItem),
  info: SourceNovel.extend({
    plugin: z.object({ id: z.string(), name: z.string(), version: z.string() }),
    url: z.string(),
    chapterCount: z.number().int(),
    chapters: z.array(ChapterItem).optional(),
  }),
  read: z.union([ReadOne, ReadRange]),
  download: z.object({
    novel: SourceNovel,
    allChapters: z.array(ChapterItem),
    files: z.array(z.string()),
    failed: z.array(Failure),
    chapters: z.number().int(),
  }),
  follow: z.object({
    novel: LibraryNovel,
    alreadyFollowed: z.boolean(),
    update: UpdateResult.optional(),
    error: ErrorInfo.optional(),
  }),
  unfollow: z.object({ unfollowed: LibraryNovel }),
  list: z.array(
    LibraryNovel.extend({
      outputs: z.array(
        z.object({
          file: z.string(),
          kind: z.enum(['full', 'delta']),
          builtAt: z.string(),
        }),
      ),
    }),
  ),
  update: z.array(
    z.looseObject({
      plugin: z.string(),
      path: z.string(),
      name: z.string(),
      status: z.enum(['up-to-date', 'updated']).optional(),
      total: z.number().int().optional(),
      added: z.array(z.number().int()).optional(),
      files: z.array(z.string()).optional(),
      failed: z.array(Failure).optional(),
      error: z.string().optional(),
      errorCode: ErrorInfo.shape.code.optional(),
    }),
  ),
  'config get': ConfigSchema,
  error: z.object({ error: ErrorInfo }),
} as const;

export type SchemaName = keyof typeof OUTPUT_SCHEMAS;

export function jsonSchema(name: SchemaName): unknown {
  return z.toJSONSchema(OUTPUT_SCHEMAS[name], {
    io: 'output',
    unrepresentable: 'any',
  });
}
