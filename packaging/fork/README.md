# Fork tools

Local safety and release tools for the macOS fork. They do not change dsh runtime behaviour and are not loaded into the app.

## Plugin preflight

```sh
node packaging/fork/audit-plugin.mjs /path/to/unpacked/plugin
node packaging/fork/audit-plugin.mjs /path/to/plugin --json
node packaging/fork/audit-plugin.mjs /path/to/plugin --allowlist packaging/fork/allowlist.json
```

Exit codes: `0` pass or allowlisted, `1` review (medium findings), `2` block (high findings). `--print-hash` prints the content hash to pin in an allowlist. The allowlist matches name, version and exact content hash:

```json
{ "plugins": [{ "name": "example", "version": "1.2.3", "contentHash": "…", "approved": "2026-11-22" }] }
```

This is a review aid, not a sandbox. Read the plugin source before approving.

## Profile snapshots

```sh
node packaging/fork/profile-snapshot.mjs snapshot --profile desktop
node packaging/fork/profile-snapshot.mjs list
node packaging/fork/profile-snapshot.mjs restore <snapshot-id> --profile desktop
```

Snapshots live in `$DSH_HOME/snapshots/fork/<id>/` and exclude `node_modules` by default. `--with-modules` includes them. Restore keeps a `pre-restore-*` safety copy. After restoring without modules, run `pnpm install --frozen-lockfile` in the profile.

## Release manifest

```sh
node packaging/fork/release-manifest.mjs \
  --x64 dist/deepseek-harness-x64.dmg \
  --arm64 dist/deepseek-harness-arm64.dmg \
  --out dist \
  --upstream <upstream-commit> \
  --notarization x64=<request-id> --notarization arm64=<request-id>
```

Writes JSON, Markdown and a minimal CycloneDX SBOM. It does not submit to Apple; pass the notarization request IDs.

## Parity check

```sh
node packaging/fork/check-parity.mjs \
  --x64-app "/path/DeepSeek Harness.app" \
  --arm64-app "/path/DeepSeek Harness.app"
```

Compares version, dsh version, plugin bundles, and normalized file lists; checks the main executable architecture. `--skip-arch` is for fixtures only.

## Tests

```sh
./packaging/fork/test.sh
```
