#!/usr/bin/env node
/**
 * Compare the Intel and Apple Silicon app bundles for version, plugin and file parity.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

function usage() {
  console.error('usage: check-parity.mjs --x64-app "…/DeepSeek Harness.app" --arm64-app "…/DeepSeek Harness.app" [--json] [--skip-arch]')
  process.exitCode = 64
}

function parse(argv) {
  const options = { x64: undefined, arm64: undefined, json: false, skipArch: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--x64-app') options.x64 = argv[++i]
    else if (arg === '--arm64-app') options.arm64 = argv[++i]
    else if (arg === '--json') options.json = true
    else if (arg === '--skip-arch') options.skipArch = true
    else { usage(); throw new Error(`unknown argument ${arg}`) }
  }
  if (!options.x64 || !options.arm64) { usage(); throw new Error('both app paths are required') }
  return options
}

function plistValue(app, key) {
  try { return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim() }
  catch { return undefined }
}

function architecture(app) {
  try { return execFileSync('file', [join(app, 'Contents/MacOS/DeepSeek Harness')], { encoding: 'utf8' }).split(': ')[1]?.trim() }
  catch { return undefined }
}

async function walk(dir, root, files) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, root, files)
    else if (entry.isFile()) files.push(relative(root, full).split('\\').join('/'))
  }
}

/**
 * Read the ASAR index without extracting it. Header layout: 16-byte preamble,
 * JSON length at byte 12, JSON at byte 16, data aligned to four bytes.
 */
function readAsar(app) {
  const path = join(app, 'Contents/Resources/app.asar')
  let buffer
  try { buffer = readFileSync(path) } catch { return { files: [], bundles: [], dshVersion: undefined } }
  if (buffer.length < 16) return { files: [], bundles: [], dshVersion: undefined }
  const jsonSize = buffer.readUInt32LE(12)
  let header
  try { header = JSON.parse(buffer.subarray(16, 16 + jsonSize).toString('utf8')) }
  catch { return { files: [], bundles: [], dshVersion: undefined } }
  const dataStart = Math.ceil((16 + jsonSize) / 4) * 4
  const files = []
  const bundles = []
  let dshVersion
  const readEntry = entry => {
    const start = dataStart + Number(entry.offset)
    return buffer.subarray(start, start + Number(entry.size)).toString('utf8')
  }
  const visit = (node, prefix) => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const pathName = prefix === '' ? name : `${prefix}/${name}`
      if (entry.files !== undefined) { visit(entry, pathName); continue }
      files.push(pathName)
      if (entry.size > 1024 * 1024) continue
      if (pathName === 'dsh/package.json') {
        try { dshVersion = JSON.parse(readEntry(entry)).version } catch { /* ignore */ }
      } else if (/^dsh\/node_modules\/@deepseek-ai\/[^/]+\/package\.json$/.test(pathName)) {
        try {
          const manifest = JSON.parse(readEntry(entry))
          if (manifest.dsh?.bundle !== undefined) bundles.push(`${manifest.name}@${manifest.version}`)
        } catch { /* ignore */ }
      }
    }
  }
  visit(header, '')
  return { files, bundles, dshVersion }
}

async function unpackedBundles(packageDirs) {
  let entries = []
  try { entries = await readdir(packageDirs, { withFileTypes: true }) } catch { return [] }
  const bundles = []
  for (const entry of entries.filter(item => item.isDirectory())) {
    try {
      const manifest = JSON.parse(await readFile(join(packageDirs, entry.name, 'package.json'), 'utf8'))
      if (manifest.dsh?.bundle !== undefined) bundles.push(`${manifest.name}@${manifest.version}`)
    } catch { /* ignore */ }
  }
  return bundles
}

function normalize(path) {
  return path
    .replace(/^dsh\//, '')
    .replace(/darwin[_-]arm64/g, 'darwin_ARCH')
    .replace(/darwin[_-]x64/g, 'darwin_ARCH')
    .replace(/linux[_-]arm64/g, 'linux_ARCH')
    .replace(/linux[_-]x64/g, 'linux_ARCH')
    .replace(/win32[_-]arm64/g, 'win32_ARCH')
    .replace(/win32[_-]x64/g, 'win32_ARCH')
    .replace(/-arm64/g, '-ARCH')
    .replace(/-x64/g, '-ARCH')
    .replace(/-[A-Za-z0-9_-]{8}\.js$/, '-HASH.js')
}

async function inspect(app) {
  const resources = join(app, 'Contents/Resources')
  const dshRoot = join(resources, 'app.asar.unpacked/dsh')
  const packageDirs = join(dshRoot, 'node_modules/@deepseek-ai')
  const asar = readAsar(app)
  const unpacked = []
  await walk(dshRoot, dshRoot, unpacked)
  const files = [...new Set([...unpacked, ...asar.files].map(normalize))].sort()
  const bundles = (asar.bundles.length > 0 ? asar.bundles : await unpackedBundles(packageDirs)).sort()
  const dshVersion = asar.dshVersion
    ?? await readFile(join(dshRoot, 'package.json'), 'utf8').then(value => JSON.parse(value).version).catch(() => undefined)
  return {
    app,
    version: plistValue(app, 'CFBundleShortVersionString'),
    architecture: architecture(app),
    dshVersion,
    bundles,
    files,
  }
}

function diff(a, b) {
  const onlyA = a.filter(value => !b.includes(value))
  const onlyB = b.filter(value => !a.includes(value))
  return { onlyA, onlyB }
}

async function main() {
  const options = parse(process.argv.slice(2))
  const [x64, arm64] = await Promise.all([inspect(resolve(options.x64)), inspect(resolve(options.arm64))])
  const fileDiff = diff(x64.files, arm64.files)
  const bundleDiff = diff(x64.bundles, arm64.bundles)
  const problems = []
  if (x64.version !== arm64.version) problems.push(`version ${x64.version} != ${arm64.version}`)
  if (x64.dshVersion !== arm64.dshVersion) problems.push(`dsh ${x64.dshVersion} != ${arm64.dshVersion}`)
  if (!options.skipArch && !x64.architecture?.includes('x86_64')) problems.push(`x64 app is ${x64.architecture}`)
  if (!options.skipArch && !arm64.architecture?.includes('arm64')) problems.push(`arm64 app is ${arm64.architecture}`)
  if (bundleDiff.onlyA.length || bundleDiff.onlyB.length) problems.push('plugin bundle sets differ')
  if (fileDiff.onlyA.length || fileDiff.onlyB.length) problems.push('file sets differ after architecture normalization')
  const report = { x64, arm64, problems, fileDiff, bundleDiff }
  if (options.json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`x64:   ${x64.version} dsh ${x64.dshVersion} ${x64.architecture}`)
    console.log(`arm64: ${arm64.version} dsh ${arm64.dshVersion} ${arm64.architecture}`)
    console.log(`bundles: ${x64.bundles.length} / ${arm64.bundles.length}`)
    console.log(`files:   ${x64.files.length} / ${arm64.files.length}`)
    for (const problem of problems) console.log(`  MISMATCH ${problem}`)
    for (const file of fileDiff.onlyA.slice(0, 10)) console.log(`  only x64: ${file}`)
    for (const file of fileDiff.onlyB.slice(0, 10)) console.log(`  only arm64: ${file}`)
    if (problems.length === 0) console.log('parity OK')
  }
  process.exitCode = problems.length === 0 ? 0 : 1
}

main().catch(error => { console.error(`check-parity: ${error.message}`); process.exitCode = 1 })
