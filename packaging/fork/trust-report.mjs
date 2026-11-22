#!/usr/bin/env node
/**
 * Read-only trust report for a profile's installed plugins.
 * The UI panel is a later phase; this is the data layer and CLI.
 */
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { classifySpec } from './shared/pins.mjs'

function usage() {
  console.error('usage: trust-report.mjs [--home DIR] [--profile NAME] [--allowlist FILE] [--json] [--strict]')
  process.exitCode = 64
}

function parse(argv) {
  const options = { home: process.env.DSH_HOME ?? join(homedir(), '.dsh'), profile: 'desktop', allowlist: undefined, json: false, strict: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--home') options.home = resolve(argv[++i])
    else if (arg === '--profile') options.profile = argv[++i]
    else if (arg === '--allowlist') options.allowlist = resolve(argv[++i])
    else if (arg === '--json') options.json = true
    else if (arg === '--strict') options.strict = true
    else { usage(); throw new Error(`unknown argument ${arg}`) }
  }
  return options
}

async function installedManifest(profileDir, name) {
  try {
    const path = join(profileDir, 'node_modules', name, 'package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    const info = await stat(path)
    return { manifest, installedAt: info.mtime.toISOString() }
  } catch { return undefined }
}

const options = parse(process.argv.slice(2))
const profileDir = join(resolve(options.home), 'profiles', options.profile)
let profile
try { profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) }
catch { console.error(`trust-report: no readable package.json in ${profileDir}`); process.exitCode = 2; process.exit() }

let allowlist = { plugins: [] }
if (options.allowlist !== undefined) {
  try { allowlist = JSON.parse(await readFile(options.allowlist, 'utf8')) }
  catch (error) { console.error(`trust-report: cannot read allowlist: ${error.message}`); process.exitCode = 2; process.exit() }
}

const bundles = new Set(profile.dsh?.profile?.bundles ?? [])
const rows = []
for (const [name, spec] of Object.entries(profile.dependencies ?? {})) {
  const installed = await installedManifest(profileDir, name)
  const pin = classifySpec(spec)
  const version = installed?.manifest?.version
  const allowlisted = allowlist.plugins.some(entry => entry.name === name && (version === undefined || entry.version === version))
  rows.push({
    name,
    requested: spec,
    installed: version ?? null,
    bundled: installed?.manifest?.dsh?.bundle !== undefined || bundles.has(name),
    pinned: pin.pinned,
    pinReason: pin.reason,
    allowlisted,
    installedAt: installed?.installedAt ?? null,
  })
}
rows.sort((a, b) => a.name.localeCompare(b.name))
const summary = {
  profile: options.profile,
  directory: profileDir,
  total: rows.length,
  unpinned: rows.filter(row => !row.pinned).length,
  notAllowlisted: rows.filter(row => !row.allowlisted).length,
  rows,
}

if (options.json) console.log(JSON.stringify(summary, null, 2))
else {
  console.log(`profile ${options.profile}: ${summary.total} plugins, ${summary.unpinned} unpinned, ${summary.notAllowlisted} not allowlisted`)
  for (const row of rows) {
    const flags = [row.pinned ? 'pinned' : 'UNPINNED', row.allowlisted ? 'allowlisted' : 'NOT-ALLOWLISTED', row.bundled ? 'bundle' : 'plugin']
    console.log(`  ${row.name}@${row.installed ?? '?'} requested=${row.requested} ${flags.join(' ')}`)
  }
}
if (options.strict && (summary.unpinned > 0 || summary.notAllowlisted > 0)) process.exitCode = 1
