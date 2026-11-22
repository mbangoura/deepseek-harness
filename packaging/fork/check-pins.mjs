#!/usr/bin/env node
/**
 * Check a dsh profile's dependency specs against the fork's exact-pinning policy.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { collectDependencies } from './shared/pins.mjs'

function usage() {
  console.error('usage: check-pins.mjs [--home DIR] [--profile NAME] [--json] [--allow-workspace]')
  process.exitCode = 64
}

function parse(argv) {
  const options = { home: process.env.DSH_HOME ?? join(homedir(), '.dsh'), profile: 'desktop', json: false, allowWorkspace: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--home') options.home = resolve(argv[++i])
    else if (arg === '--profile') options.profile = argv[++i]
    else if (arg === '--json') options.json = true
    else if (arg === '--allow-workspace') options.allowWorkspace = true
    else { usage(); throw new Error(`unknown argument ${arg}`) }
  }
  return options
}

const options = parse(process.argv.slice(2))
const profileDir = join(resolve(options.home), 'profiles', options.profile)
let manifest
try { manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) }
catch { console.error(`check-pins: no readable package.json in ${profileDir}`); process.exitCode = 2; process.exit() }

const dependencies = collectDependencies(manifest).map(dependency => ({
  ...dependency,
  pinned: dependency.pinned || (options.allowWorkspace && dependency.kind === 'workspace'),
}))
const failures = dependencies.filter(dependency => !dependency.pinned)
const report = { profile: options.profile, directory: profileDir, dependencies, failures: failures.length }

if (options.json) console.log(JSON.stringify(report, null, 2))
else {
  console.log(`profile ${options.profile}: ${dependencies.length} dependencies, ${failures.length} unpinned`)
  for (const dependency of dependencies) {
    console.log(`  ${dependency.pinned ? 'OK  ' : 'FAIL'} ${dependency.name} ${dependency.spec} — ${dependency.reason}`)
  }
}
process.exitCode = failures.length === 0 ? 0 : 1
