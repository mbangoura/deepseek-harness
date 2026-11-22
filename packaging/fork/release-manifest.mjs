#!/usr/bin/env node
/**
 * Emit a release manifest and a minimal CycloneDX SBOM for the two macOS DMGs.
 */
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { basename, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')

function usage() {
  console.error('usage: release-manifest.mjs --x64 DMG --arm64 DMG --out DIR [--upstream COMMIT] [--notarization app=ID]... [--no-git]')
  process.exitCode = 64
}

function parse(argv) {
  const options = { x64: undefined, arm64: undefined, out: undefined, upstream: undefined, notarization: {}, git: true }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--x64') options.x64 = argv[++i]
    else if (arg === '--arm64') options.arm64 = argv[++i]
    else if (arg === '--out') options.out = argv[++i]
    else if (arg === '--upstream') options.upstream = argv[++i]
    else if (arg === '--notarization') {
      const [key, id] = (argv[++i] ?? '').split('=')
      if (!key || !id) throw new Error('--notarization expects key=id')
      options.notarization[key] = id
    } else if (arg === '--no-git') options.git = false
    else { usage(); throw new Error(`unknown argument ${arg}`) }
  }
  if (!options.x64 || !options.arm64 || !options.out) { usage(); throw new Error('--x64, --arm64 and --out are required') }
  return options
}

async function hashFile(path) {
  const info = await stat(path)
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return { file: basename(path), bytes: info.size, sha256: hash.digest('hex') }
}

function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return undefined }
}

async function main() {
  const options = parse(process.argv.slice(2))
  const desktop = JSON.parse(await readFile(join(ROOT, 'apps/desktop/package.json'), 'utf8'))
  const versions = await readFile(join(ROOT, 'apps/desktop/.desktop-build/targets/mac-x64/runtime/versions.json'), 'utf8')
    .then(value => JSON.parse(value)).catch(() => ({}))
  const dsh = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const commit = options.git ? git(['rev-parse', 'HEAD']) : undefined
  const dirty = options.git ? git(['status', '--porcelain']) !== '' : undefined
  const release = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: desktop.version,
    dshVersion: dsh.version,
    upstreamCommit: options.upstream ?? null,
    forkCommit: commit ?? null,
    dirty: dirty ?? null,
    runtime: { node: versions.node ?? null, pnpm: versions.pnpm ?? null },
    artifacts: {
      'mac-x64': { ...await hashFile(options.x64), notarization: options.notarization['x64'] ?? null },
      'mac-arm64': { ...await hashFile(options.arm64), notarization: options.notarization['arm64'] ?? null },
    },
  }
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      timestamp: release.generatedAt,
      component: { type: 'application', name: 'DeepSeek Harness', version: release.version, properties: [
        { name: 'dsh:upstreamCommit', value: release.upstreamCommit ?? 'unknown' },
        { name: 'dsh:forkCommit', value: release.forkCommit ?? 'unknown' },
      ] },
    },
    components: [
      { type: 'application', name: 'dsh', version: dsh.version },
      { type: 'application', name: 'Electron', version: JSON.parse(await readFile(join(ROOT, 'apps/desktop/package.json'), 'utf8')).devDependencies?.electron ?? 'unknown' },
      ...(versions.node ? [{ type: 'application', name: 'Node.js', version: versions.node }] : []),
      ...(versions.pnpm ? [{ type: 'application', name: 'pnpm', version: versions.pnpm }] : []),
    ],
  }
  await mkdir(resolve(options.out), { recursive: true })
  const jsonPath = join(resolve(options.out), `release-manifest-${release.version}.json`)
  const bomPath = join(resolve(options.out), `sbom-${release.version}.cdx.json`)
  const mdPath = join(resolve(options.out), `release-manifest-${release.version}.md`)
  await writeFile(jsonPath, `${JSON.stringify(release, null, 2)}\n`)
  await writeFile(bomPath, `${JSON.stringify(bom, null, 2)}\n`)
  const md = [
    `# DeepSeek Harness ${release.version}`,
    '',
    `- Generated: ${release.generatedAt}`,
    `- Upstream commit: ${release.upstreamCommit ?? 'unknown'}`,
    `- Fork commit: ${release.forkCommit ?? 'unknown'}${release.dirty ? ' (dirty)' : ''}`,
    `- Node: ${release.runtime.node ?? 'unknown'}  pnpm: ${release.runtime.pnpm ?? 'unknown'}`,
    '',
    '| Architecture | File | Bytes | SHA-256 | Notarization |',
    '|---|---|---:|---|---|',
    ...Object.entries(release.artifacts).map(([arch, artifact]) =>
      `| ${arch} | ${artifact.file} | ${artifact.bytes} | \`${artifact.sha256}\` | ${artifact.notarization ?? 'unknown'} |`),
    '',
  ].join('\n')
  await writeFile(mdPath, md)
  console.log(jsonPath)
  console.log(bomPath)
  console.log(mdPath)
}

main().catch(error => { console.error(`release-manifest: ${error.message}`); process.exitCode = 1 })
