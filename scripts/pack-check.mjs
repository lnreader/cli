#!/usr/bin/env node
// Pack smoke test: pack @lnreader/plugin-runtime and @lnreader/cli the way
// npm would publish them, install the tarballs into a fresh project (no
// workspace links) and run the installed `lnreader` binary.
//
// Run `pnpm build` first. Works on Linux, macOS and Windows.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = ['plugin-runtime', 'cli'];
const keep = process.argv.includes('--keep');

let failures = 0;
const pass = msg => console.log(`  ok  ${msg}`);
const fail = msg => {
  failures++;
  console.error(`  FAIL ${msg}`);
};

/** Quote an argument for the shell (cmd.exe or sh); paths may contain spaces. */
const quote = arg =>
  /[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;

/**
 * Run a command through the shell, so `pnpm`, `npm` and `npx` resolve to
 * their `.cmd` shims on Windows.
 */
function run(cmd, args, opts = {}) {
  const line = [cmd, ...args].map(quote).join(' ');
  const res = spawnSync(line, {
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5 * 60_000,
    ...opts,
    env: { ...process.env, NO_COLOR: '1', ...opts.env },
  });
  if (res.error) throw res.error;
  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    line,
  };
}

function mustRun(cmd, args, opts) {
  const res = run(cmd, args, opts);
  if (res.code !== 0) {
    console.error(`$ ${res.line}\n${res.stdout}\n${res.stderr}`);
    throw new Error(`Command failed with exit code ${res.code}: ${res.line}`);
  }
  return res;
}

/** File paths inside a .tgz, without the leading `package/`. */
function tarballFiles(file) {
  const tar = gunzipSync(readFileSync(file));
  const files = [];
  let longName;
  for (let off = 0; off + 512 <= tar.length;) {
    const header = tar.subarray(off, off + 512);
    if (header.every(b => b === 0)) break;
    const str = (start, len) =>
      header.toString('utf8', start, start + len).replace(/\0.*$/s, '');
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = str(156, 1);
    const prefix = str(345, 155);
    let name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = undefined;
    const body = tar.subarray(off + 512, off + 512 + size);
    if (type === 'L') longName = body.toString('utf8').replace(/\0.*$/s, '');
    else if (type === 'x') {
      const path = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      if (path) longName = path[1];
    } else if (type === '0' || type === '')
      files.push(name.replace(/^package\//, ''));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

const work = mkdtempSync(join(tmpdir(), 'lnreader-pack-'));
console.log(`Working in ${work}`);

try {
  // 1. Pack.
  const packs = join(work, 'packs');
  mkdirSync(packs);
  const tarballs = {};
  for (const name of PACKAGES) {
    const dir = join(root, 'packages', name);
    if (!existsSync(join(dir, 'dist')))
      throw new Error(
        `packages/${name}/dist is missing; run \`pnpm build\` first`,
      );
    const before = new Set(readdirSync(packs));
    mustRun('pnpm', ['pack', '--pack-destination', packs], { cwd: dir });
    const created = readdirSync(packs).filter(
      f => f.endsWith('.tgz') && !before.has(f),
    );
    if (created.length !== 1)
      throw new Error(
        `Expected one tarball for ${name}, got: ${created.join(', ')}`,
      );
    tarballs[name] = join(packs, created[0]);
    console.log(`Packed ${created[0]}`);
  }

  // 2. Tarball contents: only built output, README and LICENSE.
  console.log('\nTarball contents');
  for (const name of PACKAGES) {
    const files = tarballFiles(tarballs[name]);
    const bad = files.filter(
      f =>
        f.startsWith('src/') ||
        f.startsWith('test/') ||
        /(^|\/)(fixtures?|__fixtures__|__tests__)\//.test(f) ||
        /\.test\.[cm]?[jt]s$/.test(f) ||
        (/\.[cm]?ts$/.test(f) && !/\.d\.[cm]?ts$/.test(f)) ||
        /(^|\/)tsconfig[^/]*\.json$/.test(f) ||
        /(^|\/)tsup\.config\./.test(f),
    );
    if (bad.length)
      fail(`${name} tarball ships source or test files: ${bad.join(', ')}`);
    else
      pass(
        `${name} tarball has no src/, tests, fixtures or .ts sources (${files.length} files)`,
      );
    for (const required of ['package.json', 'README.md', 'LICENSE']) {
      if (!files.includes(required))
        fail(`${name} tarball is missing ${required}`);
    }
    const pkg = JSON.parse(
      readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'),
    );
    const entry = pkg.bin ? Object.values(pkg.bin)[0] : pkg.exports['.'].import;
    if (!files.includes(entry.replace(/^\.\//, '')))
      fail(`${name} tarball is missing its entry ${entry}`);
  }

  // 3. Install into a fresh project, with no workspace links.
  const project = join(work, 'project');
  mkdirSync(project);
  writeFileSync(
    join(project, 'package.json'),
    JSON.stringify(
      { name: 'lnreader-pack-check', version: '0.0.0', private: true },
      null,
      2,
    ),
  );
  console.log('\nInstalling tarballs with npm');
  mustRun(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      tarballs['plugin-runtime'],
      tarballs.cli,
    ],
    { cwd: project },
  );

  const cliPkg = JSON.parse(
    readFileSync(join(root, 'packages', 'cli', 'package.json'), 'utf8'),
  );
  const home = join(work, 'home');
  const lnreader = (...args) =>
    run('npx', ['--no-install', 'lnreader', ...args], {
      cwd: project,
      env: { LNREADER_HOME: home },
    });
  const moduleError =
    /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (module|package)|ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_UNSUPPORTED_DIR_IMPORT/;

  console.log('\nInstalled binary');
  const version = lnreader('--version');
  if (version.code === 0 && version.stdout.trim() === cliPkg.version)
    pass(`lnreader --version prints ${cliPkg.version}`);
  else
    fail(
      `lnreader --version: exit ${version.code}, stdout ${JSON.stringify(version.stdout.trim())}\n${version.stderr}`,
    );

  const help = lnreader('--help');
  if (help.code === 0 && help.stdout.includes('Usage: lnreader'))
    pass('lnreader --help exits 0');
  else
    fail(`lnreader --help: exit ${help.code}\n${help.stdout}\n${help.stderr}`);

  const list = lnreader('plugins', 'list', '--json', '--no-input');
  const output = `${list.stdout}\n${list.stderr}`;
  if (moduleError.test(output)) {
    fail(`lnreader plugins list hit a module-resolution error:\n${output}`);
  } else if (list.code === 0) {
    pass('lnreader plugins list --json --no-input succeeds');
  } else {
    let error = {};
    try {
      error = JSON.parse(list.stdout).error ?? {};
    } catch {
      // Not JSON; reported below.
    }
    // Plain connection failures (no HTTP response) surface as `fetch failed`.
    const offline =
      /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR|network/i;
    if (
      error.code === 'NETWORK' ||
      offline.test(`${error.message ?? ''}\n${list.stderr}`)
    )
      pass(
        'lnreader plugins list --json --no-input fails with a network error (offline)',
      );
    else
      fail(
        `lnreader plugins list: exit ${list.code}, expected success or a network error\n${output}`,
      );
  }
} finally {
  if (keep) console.log(`\nKept ${work}`);
  else
    rmSync(work, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
}

if (failures) {
  console.error(`\n${failures} pack check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('\nPack check passed');
