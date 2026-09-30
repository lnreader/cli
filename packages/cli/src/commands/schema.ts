import { LnreaderError } from '@lnreader-cli/core';
import type { Command } from 'commander';
import { jsonSchema, OUTPUT_SCHEMAS, type SchemaName } from '../schemas.js';
import { out, printJson } from '../ui/format.js';

export function registerSchema(program: Command) {
  program
    .command('schema [command...]')
    .description(
      'Print the JSON Schema of a command’s --json output; lists commands when none is given',
    )
    .option('--json', 'list command names as JSON')
    .action((words: string[], flags: { json?: boolean }) => {
      const names = Object.keys(OUTPUT_SCHEMAS) as SchemaName[];
      const name = words.join(' ').trim();
      if (!name) {
        if (flags.json) return printJson(names);
        for (const n of names) out(n);
        return;
      }
      if (!names.includes(name as SchemaName))
        throw new LnreaderError(
          'INVALID_INPUT',
          `No schema for "${name}"`,
          `Commands with JSON output: ${names.join(', ')}`,
        );
      printJson(jsonSchema(name as SchemaName));
    });
}
