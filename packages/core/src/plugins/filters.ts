import {
  FilterTypes,
  type AnyFilterValue,
  type Filter,
  type Filters,
  type FilterValues,
} from '../types/filters.js';
import { LnreaderError } from '../errors.js';

type WithOptions = { options: readonly { label: string; value: string }[] };

/** Match a user-typed option against values first, then labels (case-insensitive). */
function matchOption(
  filter: WithOptions & { label: string },
  key: string,
  input: string,
): string {
  const q = input.trim().toLowerCase();
  const hit =
    filter.options.find(o => o.value.toLowerCase() === q) ??
    filter.options.find(o => o.label.toLowerCase() === q);
  if (hit) return hit.value;
  const shown = filter.options
    .slice(0, 12)
    .map(o => o.value)
    .join(', ');
  const more =
    filter.options.length > 12 ? `, … (${filter.options.length} total)` : '';
  throw new LnreaderError(
    'INVALID_INPUT',
    `Unknown option "${input}" for ${key}. Options: ${shown}${more}`,
  );
}

function parseBool(key: string, input: string): boolean {
  const v = input.trim().toLowerCase();
  if (['true', 'on', 'yes', '1'].includes(v)) return true;
  if (['false', 'off', 'no', '0'].includes(v)) return false;
  throw new LnreaderError(
    'INVALID_INPUT',
    `${key} is a switch: use true or false`,
  );
}

const list = (input: string) =>
  input
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

function parseOne(
  key: string,
  filter: Filter<FilterTypes>,
  input: string,
): AnyFilterValue {
  switch (filter.type) {
    case FilterTypes.TextInput:
      return input;
    case FilterTypes.Switch:
      return parseBool(key, input);
    case FilterTypes.Picker:
      return matchOption(filter, key, input);
    case FilterTypes.CheckboxGroup:
      return list(input).map(v => matchOption(filter, key, v));
    case FilterTypes.ExcludableCheckboxGroup: {
      const include: string[] = [];
      const exclude: string[] = [];
      for (const item of list(input)) {
        if (item.startsWith('-'))
          exclude.push(matchOption(filter, key, item.slice(1)));
        else include.push(matchOption(filter, key, item.replace(/^\+/, '')));
      }
      return { include, exclude };
    }
  }
}

/**
 * Turn `key=value` arguments into the `{ key: { type, value } }` object that
 * `popularNovels` receives, starting from the plugin's defaults.
 *
 * - Text: any string. Switch: true/false.
 * - Picker: one option (value or label).
 * - Checkbox: comma-separated options.
 * - Excludable checkbox: comma-separated, `-option` to exclude.
 */
export function parseFilterArgs(
  filters: Filters | undefined,
  args: string[],
): FilterValues | undefined {
  if (!filters) {
    if (args.length)
      throw new LnreaderError('INVALID_INPUT', 'This plugin has no filters');
    return undefined;
  }
  const values: FilterValues = Object.fromEntries(
    Object.entries(filters).map(([k, f]) => [
      k,
      { type: f.type, value: f.value },
    ]),
  );
  for (const arg of args) {
    const eq = arg.indexOf('=');
    if (eq <= 0)
      throw new LnreaderError(
        'INVALID_INPUT',
        `Filters look like key=value, got "${arg}"`,
      );
    const key = arg.slice(0, eq).trim();
    const filter = filters[key];
    if (!filter) {
      throw new LnreaderError(
        'INVALID_INPUT',
        `Unknown filter "${key}". Filters: ${Object.keys(filters).join(', ')}`,
      );
    }
    values[key] = {
      type: filter.type,
      value: parseOne(key, filter, arg.slice(eq + 1)),
    };
  }
  return values;
}

/** One-line description of a filter's accepted values, for help output. */
export function describeFilter(filter: Filter<FilterTypes>): string {
  switch (filter.type) {
    case FilterTypes.TextInput:
      return 'text';
    case FilterTypes.Switch:
      return 'true | false';
    case FilterTypes.Picker:
      return `one of: ${(filter as WithOptions).options.map(o => o.value).join(', ')}`;
    case FilterTypes.CheckboxGroup:
      return `comma list of: ${(filter as WithOptions).options.map(o => o.value).join(', ')}`;
    case FilterTypes.ExcludableCheckboxGroup:
      return `comma list, -x to exclude: ${(filter as WithOptions).options.map(o => o.value).join(', ')}`;
  }
}
