import { describe, expect, it } from 'vitest';
import { describeFilter, parseFilterArgs } from '../src/plugins/filters.js';
import { FilterTypes, type Filters } from '../src/types/filters.js';

const options = [
  { label: 'Action', value: 'action' },
  { label: 'Sci-fi', value: 'sci_fi' },
  { label: 'Romance', value: 'romance' },
];
const filters: Filters = {
  keyword: { type: FilterTypes.TextInput, label: 'Keyword', value: '' },
  completed: { type: FilterTypes.Switch, label: 'Completed', value: false },
  order: {
    type: FilterTypes.Picker,
    label: 'Order',
    value: 'popular',
    options: [
      { label: 'Popular', value: 'popular' },
      { label: 'Newest', value: 'new' },
    ],
  },
  tags: { type: FilterTypes.CheckboxGroup, label: 'Tags', value: [], options },
  genres: {
    type: FilterTypes.ExcludableCheckboxGroup,
    label: 'Genres',
    value: { include: [], exclude: [] },
    options,
  },
};

describe('parseFilterArgs', () => {
  it('starts from defaults and applies each key=value', () => {
    const values = parseFilterArgs(filters, [
      'keyword=a=b',
      'completed=yes',
      'order=Newest',
      'tags=action, SCI-FI',
      'genres=action,-romance,+sci_fi',
    ]);
    expect(values).toEqual({
      keyword: { type: 'Text', value: 'a=b' },
      completed: { type: 'Switch', value: true },
      order: { type: 'Picker', value: 'new' },
      tags: { type: 'Checkbox', value: ['action', 'sci_fi'] },
      genres: {
        type: 'XCheckbox',
        value: { include: ['action', 'sci_fi'], exclude: ['romance'] },
      },
    });
    expect(parseFilterArgs(filters, [])).toMatchObject({
      order: { value: 'popular' },
    });
  });

  it('explains bad input', () => {
    expect(() => parseFilterArgs(filters, ['nope=1'])).toThrow(
      'Unknown filter "nope". Filters: keyword, completed, order, tags, genres',
    );
    expect(() => parseFilterArgs(filters, ['order=oldest'])).toThrow(
      'Unknown option "oldest" for order. Options: popular, new',
    );
    expect(() => parseFilterArgs(filters, ['completed=maybe'])).toThrow(
      'is a switch',
    );
    expect(() => parseFilterArgs(filters, ['order'])).toThrow('key=value');
    expect(() => parseFilterArgs(undefined, ['a=b'])).toThrow('has no filters');
    expect(parseFilterArgs(undefined, [])).toBeUndefined();
  });

  it('describes accepted values', () => {
    expect(describeFilter(filters.genres!)).toBe(
      'comma list, -x to exclude: action, sci_fi, romance',
    );
    expect(describeFilter(filters.completed!)).toBe('true | false');
  });
});
