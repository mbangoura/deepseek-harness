# Default plugin policy

The fork ships **no third-party plugins by default**. Only built-in bundles are enabled; the market, Discover and custom indexes stay off. This is deliberate: installed plugin code runs in-process, outside the workspace sandbox, with the user's permissions.

## Adding a plugin

1. Prefer a dedicated VM. Never evaluate an untrusted plugin on a machine holding real credentials.
2. Read the plugin source and its install lifecycle scripts.
3. Audit the unpacked package:
   ```sh
   node packaging/fork/audit-plugin.mjs /path/to/plugin --json
   ```
4. If you accept the findings, pin the exact version and content hash in `allowlist.json`. Use `--print-hash` to obtain the hash.
5. Snapshot the profile, install, then verify:
   ```sh
   node packaging/fork/profile-snapshot.mjs snapshot --profile desktop
   dsh plugin --profile desktop add <exact-version-or-commit>
   node packaging/fork/trust-report.mjs --profile desktop --allowlist packaging/fork/defaults/allowlist.json --strict
   node packaging/fork/health-report.mjs --profile desktop
   ```
6. Re-audit after every version bump. A version change invalidates the approval.

## Allowlist format

See `allowlist.example.json`. The exact content hash binds the approval to the bytes reviewed; a re-published package with the same version but different content will not match.

## Non-negotiables

- No ranges, tags or floating Git refs for third-party plugins.
- No `postinstall`/`prepare` scripts without explicit review.
- No plugins with access to `~/.ssh`, browser stores, Keychain or the main `~/.dsh` profile in the experimental VM.
- Keep the previous profile snapshot until the new plugin has run for a few sessions.
