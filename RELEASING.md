# Releasing

Three packages are published to npm under the `@lnreader` scope:

| Package                    | Folder                    | Notes                                                     |
| -------------------------- | ------------------------- | --------------------------------------------------------- |
| `@lnreader/plugin-runtime` | `packages/plugin-runtime` | Library used by the CLI                                   |
| `@lnreader/cli`            | `packages/cli`            | Installs the `lnreader` command (and `lnreader mcp`)      |
| `@lnreader/cli-browser`    | `packages/cli-browser`    | Optional add-on for `lnreader auth`, versioned on its own |

Versions and changelogs are managed with [changesets](https://github.com/changesets/changesets). Nothing is published by hand: merging to `main` does it.

## 1. Add a changeset to your PR

Any PR that changes what a package ships needs a changeset:

```bash
pnpm changeset
```

Pick the packages you changed and the bump (`patch`, `minor` or `major`), and write one or two sentences for the changelog. This creates a Markdown file in `.changeset/`; commit it with your change. PRs that only touch tests, CI or docs don't need one.

Packages are versioned independently (nothing is `fixed` or `linked`). The CLI depends on the runtime with `workspace:*`, which pnpm replaces with the runtime's exact version when packing. So a published CLI always pins the runtime version it was built and tested with, and a runtime release does not by itself release the CLI: **to ship a runtime fix to CLI users, include `@lnreader/cli` in the changeset too.** `@lnreader/cli-browser` is only a dev dependency of the CLI and is released entirely on its own.

Check what would be released with `pnpm changeset status`.

## 2. What the release workflow does

[`.github/workflows/release.yml`](.github/workflows/release.yml) runs on every push to `main`. It builds, runs the pack smoke test, then runs [`changesets/action`](https://github.com/changesets/action):

- **Pending changesets on `main`:** it opens (or updates) a **"chore: Version Packages"** PR. That PR runs `changeset version`, which bumps versions, writes the `CHANGELOG.md` files and deletes the consumed changesets.
- **That PR is merged:** there are no pending changesets and some package version is not on npm yet, so it runs `changeset publish`. Each unpublished package is packed with `pnpm` (which turns `workspace:*` into the real version) and published with npm, with a provenance attestation. It then pushes a git tag per package (e.g. `@lnreader/cli@0.1.0`) and creates GitHub releases.

Publishing uses **npm trusted publishing** (OIDC): the job has `id-token: write` and there is no `NPM_TOKEN` secret. The workflow updates npm to the latest version because trusted publishing needs npm 11.5.1 or newer.

Before merging the Version Packages PR, CI must be green, including `pnpm pack:check`, which packs the CLI and runtime, installs the tarballs into a fresh project and runs `lnreader`.

## 3. First publish of each package (one time)

npm only lets you add a trusted publisher to a package that **already exists** on npm. So the very first publish of each package has to use a token:

1. On npmjs.com, go to **Access Tokens → Generate New Token → Granular Access Token**.
   - Permissions: **Read and write**, limited to **the `@lnreader` scope** (Packages and scopes → select scope `@lnreader`).
   - Enable **Bypass two-factor authentication** so it can publish from CI.
   - Set a short expiry (e.g. 7 days).
2. In GitHub, **Settings → Secrets and variables → Actions → New repository secret**: name `NPM_TOKEN`, value the token.
3. In `.github/workflows/release.yml`, uncomment the `NPM_TOKEN` and `NODE_AUTH_TOKEN` lines of the `Create Version PR Or Publish` step and merge that to `main` together with (or before) the Version Packages PR.
4. Merge the Version Packages PR. The workflow publishes all three packages (provenance still works, since the job has `id-token: write`).
5. **Revoke the token** on npmjs.com, delete the `NPM_TOKEN` secret and comment the two lines out again.
6. Configure the trusted publisher for each package (next section).

A package added to the monorepo later needs the same one-time steps.

## 4. Configure the npm trusted publisher (one time per package)

For each of `@lnreader/cli`, `@lnreader/plugin-runtime` and `@lnreader/cli-browser`:

1. Open `https://www.npmjs.com/package/<name>/access` (package page → **Settings**).
2. Under **Trusted Publisher**, choose **GitHub Actions** and enter:
   - Organization or user: `lnreader`
   - Repository: `cli`
   - Workflow filename: `release.yml`
   - Environment: leave empty
3. Save. Optionally, under **Publishing access**, choose **Require two-factor authentication and disallow tokens**, so only the workflow can publish from now on.

From then on, releases need no secrets.

## 5. Verify provenance

After a release:

- On `https://www.npmjs.com/package/@lnreader/cli`, the version shows a **Provenance** badge. The section at the bottom of the page links to the exact commit, the `release.yml` workflow file and the Actions run that built it.
- From a terminal, in any project that installs the packages:

  ```bash
  npm audit signatures
  ```

  It should report verified registry signatures and verified attestations for `@lnreader/*`.

- `npm view @lnreader/cli dist.attestations` shows the attestation URL.

## Checks to run locally

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm pack:check
pnpm --filter @lnreader/cli pack --dry-run   # the exact file list that would ship
```
