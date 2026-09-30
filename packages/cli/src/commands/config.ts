import { resolve } from 'node:path';
import {
  ConfigSchema,
  configFile,
  loadConfig,
  PluginStorage,
  saveConfig,
  type Config,
  type Runtime,
} from '@lnreader/plugin-runtime';
import type { Command } from 'commander';
import pc from 'picocolors';
import { openRuntime, type GlobalOptions } from '../context.js';
import { log, out, printJson, table } from '../ui/format.js';
import { askSelect, askText, isInteractive } from '../ui/prompts.js';

type FieldSchema = {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: unknown }
    | { success: false; error: { issues: Array<{ message: string }> } };
};

/** Keys managed elsewhere or not meant to be set by hand. */
const READ_ONLY: Record<string, string> = {
  repos: 'use `lnreader plugins repo add/remove`',
};

/** Config keys holding file paths, stored as absolute paths. */
const PATH_KEYS = new Set(['outDir', 'css']);

const SECRET = /pass(word)?|token|secret|key/i;

type PluginSetting = { value: unknown; label: string; type?: string };

const isSwitch = (s: PluginSetting) =>
  s.type === 'Switch' || typeof s.value === 'boolean';

/** The schema for a settable global key; throws for unknown or read-only keys. */
function configField(key: string) {
  const field = (ConfigSchema.shape as Record<string, FieldSchema>)[key];
  if (!field) {
    throw new Error(
      `Unknown setting "${key}". Settings: ${Object.keys(ConfigSchema.shape).join(', ')}`,
    );
  }
  if (READ_ONLY[key])
    throw new Error(`"${key}" can't be set here; ${READ_ONLY[key]}`);
  return field;
}

/** Parse a command-line value for a global config key, validating it. */
export function parseConfigValue(key: string, raw: string): unknown {
  const field = configField(key);
  const candidate = /^-?\d+$/.test(raw)
    ? Number(raw)
    : PATH_KEYS.has(key)
      ? resolve(raw)
      : raw;
  const parsed = field.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `Invalid value for ${key}: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  return parsed.data;
}

/** Parse a plugin setting value according to its declared type. */
export function parsePluginValue(setting: PluginSetting, raw: string): unknown {
  if (!isSwitch(setting)) return raw;
  const v = raw.trim().toLowerCase();
  if (['true', 'on', 'yes', '1'].includes(v)) return true;
  if (['false', 'off', 'no', '0'].includes(v)) return false;
  throw new Error(`"${setting.label}" is a switch: use true or false`);
}

const show = (key: string, value: unknown) =>
  value === undefined || value === ''
    ? pc.dim('(not set)')
    : SECRET.test(key) && typeof value === 'string'
      ? '••••••'
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);

async function pluginSettings(rt: Runtime, id: string) {
  const runner = await rt.loader.load(id);
  const settings = (runner.plugin.pluginSettings ?? {}) as Record<
    string,
    PluginSetting
  >;
  const storage = new PluginStorage(rt.loader.storageFile(runner.id));
  return { runner, settings, storage };
}

function requireSetting(
  settings: Record<string, PluginSetting>,
  id: string,
  key: string,
) {
  const setting = settings[key];
  if (!setting) {
    const keys = Object.keys(settings);
    throw new Error(
      keys.length
        ? `Plugin ${id} has no setting "${key}". Settings: ${keys.join(', ')}`
        : `Plugin ${id} has no settings`,
    );
  }
  return setting;
}

export function registerConfig(program: Command) {
  const config = program
    .command('config')
    .description(
      'Show or change settings, globally or for one plugin (--plugin)',
    );

  config
    .command('get [key]')
    .description('Show all settings, or one')
    .option('-p, --plugin <id>', 'show this plugin’s settings')
    .option('--json', 'output JSON')
    .action(
      async (
        key: string | undefined,
        flags: { plugin?: string; json?: boolean },
        cmd: Command,
      ) => {
        const rt = await openRuntime(cmd.optsWithGlobals<GlobalOptions>());
        try {
          if (flags.plugin) {
            const { runner, settings, storage } = await pluginSettings(
              rt,
              flags.plugin,
            );
            if (key) requireSetting(settings, runner.id, key);
            const keys = key ? [key] : Object.keys(settings);
            if (flags.json) {
              return printJson(
                Object.fromEntries(
                  keys.map(k => [k, storage.get(k) ?? settings[k]!.value]),
                ),
              );
            }
            if (!keys.length)
              return log.info(`Plugin ${runner.id} has no settings`);
            out(
              table([
                [pc.bold('Key'), pc.bold('Value'), pc.bold('Description')],
                ...keys.map(k => [
                  k,
                  show(k, storage.get(k)),
                  settings[k]!.label,
                ]),
              ]),
            );
            return;
          }
          const current = await loadConfig(rt.paths);
          if (key) {
            if (!(key in ConfigSchema.shape)) configField(key);
            const value = current[key as keyof Config];
            return flags.json ? printJson(value) : out(show(key, value));
          }
          if (flags.json) return printJson(current);
          out(
            table(
              Object.keys(ConfigSchema.shape).map(k => [
                k,
                show(k, current[k as keyof Config]),
              ]),
            ),
          );
          log.info(`Stored in ${configFile(rt.paths)}`);
        } finally {
          await rt.close();
        }
      },
    );

  config
    .command('set <key> <value>')
    .description('Change a setting')
    .option('-p, --plugin <id>', 'change this plugin’s setting')
    .action(
      async (
        key: string,
        raw: string,
        flags: { plugin?: string },
        cmd: Command,
      ) => {
        const rt = await openRuntime(cmd.optsWithGlobals<GlobalOptions>());
        try {
          if (flags.plugin) {
            const { runner, settings, storage } = await pluginSettings(
              rt,
              flags.plugin,
            );
            const setting = requireSetting(settings, runner.id, key);
            storage.set(key, parsePluginValue(setting, raw));
            log.success(`Set ${runner.id} ${key}`);
            return;
          }
          const current = await loadConfig(rt.paths);
          const value = parseConfigValue(key, raw);
          await saveConfig(rt.paths, { ...current, [key]: value });
          log.success(`Set ${key} = ${show(key, value)}`);
        } finally {
          await rt.close();
        }
      },
    );

  config
    .command('unset <key>')
    .description('Reset a setting to its default')
    .option('-p, --plugin <id>', 'reset this plugin’s setting')
    .action(async (key: string, flags: { plugin?: string }, cmd: Command) => {
      const rt = await openRuntime(cmd.optsWithGlobals<GlobalOptions>());
      try {
        if (flags.plugin) {
          const { runner, settings, storage } = await pluginSettings(
            rt,
            flags.plugin,
          );
          requireSetting(settings, runner.id, key);
          storage.delete(key);
          log.success(`Reset ${runner.id} ${key}`);
          return;
        }
        configField(key);
        const current = (await loadConfig(rt.paths)) as Record<string, unknown>;
        delete current[key];
        // Re-parse so the default for that key is filled back in.
        await saveConfig(rt.paths, ConfigSchema.parse(current));
        log.success(`Reset ${key}`);
      } finally {
        await rt.close();
      }
    });

  config
    .command('edit')
    .description('Change a plugin’s settings interactively')
    .requiredOption('-p, --plugin <id>', 'plugin to configure')
    .action(async (flags: { plugin: string }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      if (!isInteractive(globals)) {
        throw new Error(
          '`config edit` needs a terminal; use `config set --plugin` instead',
        );
      }
      const rt = await openRuntime(globals);
      try {
        const { runner, settings, storage } = await pluginSettings(
          rt,
          flags.plugin,
        );
        const keys = Object.keys(settings);
        if (!keys.length)
          return log.info(`Plugin ${runner.id} has no settings`);
        for (const key of keys) {
          const setting = settings[key]!;
          const current = storage.get(key);
          if (isSwitch(setting)) {
            const answer = await askSelect(
              setting.label,
              [
                { value: 'true', label: 'On' },
                { value: 'false', label: 'Off' },
              ],
              current === true ? 'true' : 'false',
            );
            if (answer === undefined) return;
            storage.set(key, answer === 'true');
          } else {
            const answer = await askText(setting.label, {
              initialValue: SECRET.test(key)
                ? ''
                : ((current as string | undefined) ?? ''),
              placeholder:
                SECRET.test(key) && current ? 'leave empty to keep' : undefined,
            });
            if (answer === undefined) return;
            if (answer !== '' || !SECRET.test(key)) storage.set(key, answer);
          }
        }
        log.success(`Saved settings for ${runner.id}`);
      } finally {
        await rt.close();
      }
    });

  config
    .command('path')
    .description('Show where config, cache and data are stored')
    .action(async (_flags, cmd: Command) => {
      const rt = await openRuntime(cmd.optsWithGlobals<GlobalOptions>());
      out(
        table([
          ['config', configFile(rt.paths)],
          ['cache', rt.paths.cache],
          ['data', rt.paths.data],
        ]),
      );
      await rt.close();
    });
}
