#!/usr/bin/env node
/**
 * Offline health report for a dsh profile: missing packages, version drift,
 * unpinned specs, bundle declarations, lockfile and latest snapshot.
 * It does not start the Host; load-time plugin failures are not visible here.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { classifySpec } from './shared/pins.mjs'

function usage() {
  console.error('usage: health-report.mjs [--home DIR] [--profile NAME] [--json] [--strict]')
  process.exitCode = 64
}

function parse(argv) {
  const options = { home: process.env.DSH_HOME ?? join(homedir(), '.dsh'), profile: 'desktop', json: false, strict: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--home') options.home = resolve(argv[++i])
    else if (arg === '--profile') options.profile = argv[++i]
    else if (arg === '--json') options.json = true
    else if (arg === '--strict') options.strict = true
    else { usage(); throw new Error(`unknown argument ${arg}`) }
  }
  return options
}

async function exists(path) { return stat(path).then(() => true, () => false) }

const options = parse(process.argv.slice(2))
const home = resolve(options.home)
const profileDir = join(home, 'profiles', options.profile)
const checks = []
const report = {
  profile: options.profile,
  directory: profileDir,
  status: 'ok',
  checks,
  dependencies: [],
  bundles: [],
  missingModules: [],
  versionDrift: [],
  unpinned: [],
  latestSnapshot: null,
}

function add(status, name, detail) { checks.push({ status, name, detail }) }

if (!(await exists(profileDir))) {
  add('fail', 'profile', 'profile directory is missing')
  report.status = 'fail'
} else {
  add('ok', 'profile', 'profile directory exists')
  let manifest
  try { manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) }
  catch { add('fail', 'package.json', 'missing or invalid'); report.status = 'fail' }
  if (manifest !== undefined) {
    add('ok', 'package.json', `${manifest.name ?? 'unnamed'} ${manifest.version ?? ''}`.trim())
    const dependencies = manifest.dependencies ?? {}
    const hasDependencies = Object.keys(dependencies).length > 0
    const lock = await exists(join(profileDir, 'pnpm-lock.yaml'))
    if (!hasDependencies) add('ok', 'lockfile', 'no profile dependencies; lockfile not required')
    else add(lock ? 'ok' : 'warn', 'lockfile', lock ? 'pnpm-lock.yaml present' : 'pnpm-lock.yaml missing')
    const patch = await exists(join(profileDir, 'cordis.patch.yml'))
    add(patch ? 'ok' : 'warn', 'profile patch', patch ? 'cordis.patch.yml present' : 'cordis.patch.yml missing')

    for (const [name, spec] of Object.entries(dependencies)) {
      const installedPath = join(profileDir, 'node_modules', name, 'package.json')
      let installed
      try { installed = JSON.parse(await readFile(installedPath, 'utf8')) } catch { installed = undefined }
      const pin = classifySpec(spec)
      const row = { name, requested: spec, installed: installed?.version ?? null, pinned: pin.pinned, reason: pin.reason }
      report.dependencies.push(row)
      if (installed === undefined) report.missingModules.push(name)
      if (!pin.pinned) report.unpinned.push(name)
      if (installed !== undefined && pin.pinned && pin.kind === 'registry' && installed.version !== spec) {
        report.versionDrift.push({ name, requested: spec, installed: installed.version })
      }
      add(installed === undefined ? 'fail' : 'ok', `plugin ${name}`, installed === undefined ? 'not installed' : `installed ${installed.version}`)
    }

    for (const name of manifest.dsh?.profile?.bundles ?? []) {
      if (dependencies[name] === undefined) {
        report.bundles.push({ name, installed: null, declared: true, providedByRuntime: true })
        add('ok', `bundle ${name}`, 'provided by the app runtime')
        continue
      }
      let bundle
      try { bundle = JSON.parse(await readFile(join(profileDir, 'node_modules', name, 'package.json'), 'utf8')) } catch { bundle = undefined }
      report.bundles.push({ name, installed: bundle?.version ?? null, declared: bundle?.dsh?.bundle !== undefined })
      if (bundle === undefined) add('fail', `bundle ${name}`, 'bundle package is missing')
      else if (bundle.dsh?.bundle === undefined) add('warn', `bundle ${name}`, 'package does not declare dsh.bundle')
      else add('ok', `bundle ${name}`, `installed ${bundle.version}`)
    }

    const snapshotRoot = join(home, 'snapshots', 'fork')
    let snapshots = []
    try { snapshots = (await readdir(snapshotRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort() } catch { /* none */ }
    report.latestSnapshot = snapshots.at(-1) ?? null
    add(report.latestSnapshot ? 'ok' : 'warn', 'snapshot', report.latestSnapshot ?? 'no fork snapshot found')
  }
}

if (report.missingModules.length > 0 || report.status === 'fail') report.status = 'fail'
else if (checks.some(check => check.status === 'warn') || report.unpinned.length > 0 || report.versionDrift.length > 0) report.status = 'warn'

if (options.json) console.log(JSON.stringify(report, null, 2))
else {
  console.log(`profile ${report.profile}: ${report.status.toUpperCase()}`)
  for (const check of report.checks) console.log(`  [${check.status}] ${check.name} — ${check.detail}`)
  if (report.versionDrift.length) for (const item of report.versionDrift) console.log(`  drift ${item.name}: ${item.requested} -> ${item.installed}`)
  if (report.unpinned.length) console.log(`  unpinned: ${report.unpinned.join(', ')}`)
}
if (options.strict && report.status !== 'ok') process.exitCode = 1
