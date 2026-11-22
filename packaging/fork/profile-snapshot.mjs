#!/usr/bin/env node
/**
 * Snapshot and restore a dsh profile before installing or updating plugins.
 * Snapshots live beside the profile tree, never inside it.
 */
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

function usage() {
  console.error('usage: profile-snapshot.mjs snapshot [--home DIR] [--profile NAME] [--with-modules]')
  console.error('       profile-snapshot.mjs restore <snapshot-id> [--home DIR] [--profile NAME]')
  console.error('       profile-snapshot.mjs list [--home DIR]')
  process.exitCode = 64
}

function parse(argv) {
  const options = { command: argv[0], id: undefined, home: process.env.DSH_HOME ?? join(homedir(), '.dsh'), profile: 'desktop', withModules: false }
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--home') options.home = resolve(argv[++i])
    else if (arg === '--profile') options.profile = argv[++i]
    else if (arg === '--with-modules') options.withModules = true
    else if (!arg.startsWith('-') && options.id === undefined) options.id = arg
    else { usage(); throw new Error(`unknown argument ${arg}`) }
  }
  if (!['snapshot', 'restore', 'list'].includes(options.command)) { usage(); throw new Error('unknown command') }
  if (options.command === 'restore' && options.id === undefined) { usage(); throw new Error('restore needs a snapshot id') }
  return options
}

function snapshotRoot(home) { return join(home, 'snapshots', 'fork') }
function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-') }

async function profileVersion(profileDir) {
  try { return JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')).version ?? 'unknown' }
  catch { return 'unknown' }
}

async function copyProfile(source, destination, withModules) {
  await cp(source, destination, {
    recursive: true,
    filter: path => withModules || !path.split('/').includes('node_modules'),
  })
}

async function countFiles(dir) {
  let count = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? await countFiles(join(dir, entry.name)) : 1
  }
  return count
}

async function snapshot(options) {
  const home = resolve(options.home)
  const profileDir = join(home, 'profiles', options.profile)
  try { await stat(profileDir) } catch { throw new Error(`profile not found: ${profileDir}`) }
  const id = timestamp()
  const root = snapshotRoot(home)
  const destination = join(root, id)
  await mkdir(destination, { recursive: true })
  const temporary = join(destination, 'profile.tmp')
  await copyProfile(profileDir, temporary, options.withModules)
  await rename(temporary, join(destination, 'profile'))
  const meta = {
    id,
    createdAt: new Date().toISOString(),
    profile: options.profile,
    withModules: options.withModules,
    version: await profileVersion(profileDir),
    files: await countFiles(join(destination, 'profile')),
  }
  await writeFile(join(destination, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
  console.log(id)
  if (!options.withModules) console.log('snapshot excludes node_modules; run pnpm install --frozen-lockfile after restore')
}

async function list(options) {
  const root = snapshotRoot(resolve(options.home))
  let entries = []
  try { entries = await readdir(root, { withFileTypes: true }) } catch { /* empty */ }
  for (const entry of entries.filter(item => item.isDirectory()).sort().reverse()) {
    try {
      const meta = JSON.parse(await readFile(join(root, entry.name, 'meta.json'), 'utf8'))
      console.log(`${meta.id}\t${meta.profile}\t${meta.version}\t${meta.files} files\tmodules=${meta.withModules}`)
    } catch { console.log(`${entry.name}\t(unreadable metadata)`) }
  }
}

async function restore(options) {
  const home = resolve(options.home)
  const root = snapshotRoot(home)
  const source = join(root, options.id, 'profile')
  try { await stat(source) } catch { throw new Error(`snapshot not found: ${options.id}`) }
  const profileDir = join(home, 'profiles', options.profile)
  try { await stat(profileDir) } catch { /* no current profile */ }
  if (await stat(profileDir).then(() => true, () => false)) {
    const safety = join(root, `pre-restore-${timestamp()}`)
    await mkdir(safety, { recursive: true })
    await copyProfile(profileDir, join(safety, 'profile'), true)
    await writeFile(join(safety, 'meta.json'), `${JSON.stringify({ id: 'pre-restore', profile: options.profile, withModules: true, createdAt: new Date().toISOString() }, null, 2)}\n`)
    console.log(`current profile saved as ${safety}`)
  }
  await rm(profileDir, { recursive: true, force: true })
  await mkdir(join(home, 'profiles'), { recursive: true })
  await copyProfile(source, profileDir, true)
  console.log(`restored ${options.id} into ${profileDir}`)
  const meta = JSON.parse(await readFile(join(root, options.id, 'meta.json'), 'utf8'))
  if (!meta.withModules) console.log('run pnpm install --frozen-lockfile in the profile before starting dsh')
}

const options = parse(process.argv.slice(2))
if (options.command === 'snapshot') await snapshot(options)
else if (options.command === 'restore') await restore(options)
else await list(options)
