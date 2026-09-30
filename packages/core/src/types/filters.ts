/*
 * Vendored from LNReader/lnreader-plugins (src/types/filters.ts).
 * Copyright (c) LNReader contributors, MIT License.
 */

export type FilterOption = {
  readonly label: string;
  readonly value: string;
};

export enum FilterTypes {
  TextInput = 'Text',
  Picker = 'Picker',
  CheckboxGroup = 'Checkbox',
  Switch = 'Switch',
  ExcludableCheckboxGroup = 'XCheckbox',
}

type SwitchFilter = { type: FilterTypes.Switch; value: boolean };
type TextFilter = { type: FilterTypes.TextInput; value: string };
type CheckboxFilter = {
  type: FilterTypes.CheckboxGroup;
  options: readonly FilterOption[];
  value: string[];
};
type PickerFilter = {
  type: FilterTypes.Picker;
  options: readonly FilterOption[];
  value: string;
};
type ExcludableCheckboxFilter = {
  type: FilterTypes.ExcludableCheckboxGroup;
  options: readonly FilterOption[];
  value: { include?: string[]; exclude?: string[] };
};

type FilterFromType = {
  [FilterTypes.CheckboxGroup]: CheckboxFilter;
  [FilterTypes.ExcludableCheckboxGroup]: ExcludableCheckboxFilter;
  [FilterTypes.Picker]: PickerFilter;
  [FilterTypes.Switch]: SwitchFilter;
  [FilterTypes.TextInput]: TextFilter;
};

export type Filter<Type extends FilterTypes> = {
  label: string;
} & FilterFromType[Type];

export type Filters = Record<string, Filter<FilterTypes>>;

export type AnyFilterValue = Filter<FilterTypes>['value'];

/** `{ key: { type, value } }` as passed to `popularNovels`. */
export type FilterValues = Record<
  string,
  { type: FilterTypes; value: AnyFilterValue }
>;
