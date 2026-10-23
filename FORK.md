# Fork guide: macOS Intel + Apple Silicon builds

This fork tracks [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) and adds macOS packaging only. No upstream source files are modified, so upstream rebases stay conflict-free unless upstream adds the same paths.

## Remotes and upstream sync

```sh
git remote -v
# origin   https://github.com/mbangoura/deepseek-harness.git
# upstream https://github.com/deepseek-ai/deepseek-harness.git
```

Keep your work on `macos-builds` and pull upstream changes regularly:

```sh
./packaging/macos/sync-upstream.sh macos-builds
```

That command fetches `upstream`, rebases `macos-builds` onto `upstream/master`, and pushes with `--force-with-lease`. You can also use GitHub's **Sync fork** button for `master`; the build branch still needs the rebase.

Guidelines that keep syncs cheap:

- Add fork behavior in new files (`packaging/macos/`, `.github/workflows/macos-dmg.yml`).
- Put actual product changes on feature branches and merge them into `macos-builds`.
- If you must edit an upstream file, keep the edit small and isolated; it becomes the only conflict surface at the next rebase.
- Never commit `node_modules/`, `.desktop-build/`, `dist/`, or signing credentials.

## Build locally

Requirements: macOS, Xcode command line tools, Node.js 22.19+ or 24+, and the repo-pinned pnpm (`corepack enable`).

```sh
./packaging/macos/build.sh          # host architecture, unsigned DMG
ARCH=arm64 ./packaging/macos/build.sh
```

The script writes the DMG to `dist/`.

Upstream prepares the bundled Node/Python runtime for the build host, so:

- Intel Mac → `mac-x64`
- Apple Silicon Mac → `mac-arm64`

The repo rejects `mac-arm64` on an Intel host and vice versa. Use the Apple Silicon Mac, or the CI workflow below, for the arm64 image.

## CI: both architectures

[`.github/workflows/macos-dmg.yml`](../.github/workflows/macos-dmg.yml) runs on manual dispatch and `v*` tags:

| Runner | Target |
|---|---|
| `macos-15-intel` | `mac-x64` |
| `macos-15` | `mac-arm64` |

Each job uploads an unsigned DMG artifact named `deepseek-harness-macos-<arch>`. Unsigned artifacts are for testing; sign and notarize them locally before distributing.

## Sign and notarize locally

Prerequisites:

- `Developer ID Application` certificate in the login keychain.
- A notarytool keychain profile, for example:
  ```sh
  xcrun notarytool store-credentials "OrcaVoice-Notary" \
    --apple-id you@example.com --team-id YOURTEAMID
  ```
- A 10-character Team ID.

The upstream release pipeline expects a `.p12` in `CSC_LINK`. This fork does not store one; it signs with the keychain identity instead.

1. Prepare and build unsigned (this also prepares the bundled runtime):
   ```sh
   pnpm --filter @deepseek-ai/dsh-desktop run package:mac:x64:unsigned
   ```
2. Sign the bundled runtime trees:
   ```sh
   export MACOS_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)"
   ./packaging/macos/sign-runtime.sh
   ```
3. Package and sign the Electron shell with the upstream config, but disable the integrity/notarization hooks (signing changes the runtime hashes they check):
   ```js
   // /tmp/dsh-sign-config.mjs
   import { createElectronBuilderConfig } from '<repo>/apps/desktop/scripts/electron-builder-config.mjs'
   const base = createElectronBuilderConfig()
   export default {
     ...base,
     afterPack: undefined,
     afterSign: undefined,
     artifactBuildCompleted: undefined,
     mac: { ...base.mac, notarize: false },
     dmg: { ...base.dmg, sign: true },
   }
   ```
   ```sh
   export DSH_DESKTOP_TARGET_PLATFORM=darwin DSH_DESKTOP_TARGET_ARCH=x64
   export DSH_DESKTOP_UNSIGNED=0 DSH_DESKTOP_MACOS_SKIP_NOTARIZATION=1
   export DSH_DESKTOP_MACOS_SIGNING_IDENTITY="Name (TEAMID)"
   export DSH_DESKTOP_MACOS_TEAM_ID=TEAMID
   export DSH_DESKTOP_APP_ID=com.deepseek.harness

   pnpm --filter @deepseek-ai/dsh-desktop exec electron-builder \
     --config /tmp/dsh-sign-config.mjs --mac --x64 --publish never \
     --config.directories.output=/tmp/dsh-signed
   ```
4. Notarize and staple the app:
   ```sh
   ditto -c -k --keepParent "/tmp/dsh-signed/mac/DeepSeek Harness.app" /tmp/app.zip
   xcrun notarytool submit /tmp/app.zip --keychain-profile OrcaVoice-Notary --wait
   xcrun stapler staple "/tmp/dsh-signed/mac/DeepSeek Harness.app"
   ```
5. Build the final DMG from the stapled app, then sign, notarize, and staple it:
   ```sh
   mkdir -p /tmp/dmg-stage
   ditto "/tmp/dsh-signed/mac/DeepSeek Harness.app" "/tmp/dmg-stage/DeepSeek Harness.app"
   ln -s /Applications /tmp/dmg-stage/Applications
   hdiutil create -volname "DeepSeek Harness" -srcfolder /tmp/dmg-stage \
     -ov -format UDZO /tmp/DeepSeek-Harness-mac-x64.dmg
   codesign --force --sign "Developer ID Application: Name (TEAMID)" --timestamp /tmp/DeepSeek-Harness-mac-x64.dmg
   xcrun notarytool submit /tmp/DeepSeek-Harness-mac-x64.dmg --keychain-profile OrcaVoice-Notary --wait
   xcrun stapler staple /tmp/DeepSeek-Harness-mac-x64.dmg
   ```

Verify:

```sh
spctl -a -vvv -t open --context context:primary-signature /tmp/DeepSeek-Harness-mac-x64.dmg
codesign --verify --deep --strict "/tmp/dsh-signed/mac/DeepSeek Harness.app"
xcrun stapler validate /tmp/DeepSeek-Harness-mac-x64.dmg
```

For Apple Silicon, repeat with `arm64`, `DSH_DESKTOP_TARGET_ARCH=arm64`, and `--arm64` on an Apple Silicon Mac.

## Updates

The app embeds an update feed. An unofficial x64 build has no matching upstream feed, so this fork uses a non-routable placeholder or disables the feed; "Check for Updates" then does nothing useful. That is intentional: an arm64 official update must not replace an x64 build. Update this fork by syncing and rebuilding instead.

## Releases

Tag a build and let CI produce both unsigned DMGs, then sign them locally and attach them to the GitHub release:

```sh
git tag v0.2.1-rc.2-intel.1
git push origin v0.2.1-rc.2-intel.1
```

Keep the upstream version in the tag and add your own suffix, so it is obvious which upstream release a build came from.
