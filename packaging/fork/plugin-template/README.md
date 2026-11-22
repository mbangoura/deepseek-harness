# Plugin template

A copyable scaffold for a fork-local dsh plugin bundle. It is deliberately outside the pnpm workspace so it does not alter upstream build graphs.

1. Copy the directory and rename `dsh-fork-plugin-template` in `package.json` and `cordis.patch.yml`.
2. Implement `apply(ctx)` in `src/index.ts`; register services, tools and listeners on `ctx` so they unwind on unload.
3. Build and test:
   ```sh
   npm install
   npm run build
   npm test
   ```
4. Audit before installing:
   ```sh
   node ../audit-plugin.mjs .
   ```
5. Snapshot the target profile, then install the local package:
   ```sh
   node ../profile-snapshot.mjs snapshot --profile desktop
   dsh plugin --profile desktop add file:/absolute/path/to/this/package
   ```
6. Verify:
   ```sh
   node ../trust-report.mjs --profile desktop --strict
   node ../health-report.mjs --profile desktop
   ```

Do not add runtime dependencies you have not audited. Pin exact versions, and do not run install scripts without reviewing them.
