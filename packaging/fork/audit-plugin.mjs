#!/usr/bin/env node
/**
 * Preflight audit for a dsh plugin package directory.
 *
 * This is a review aid, not a sandbox. It flags common supply-chain and
 * exfiltration patterns before a plugin is installed into a profile.
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'

const MAX_FILES = 20000
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_HASH_BYTES = 50 * 1024 * 1024

const RULES = [
  { id: 'lifecycle-script', severity: 'high', pattern: null, message: 'Package runs an install lifecycle script' },
  { id: 'child-process', severity: 'high', pattern: /child_process|execSync|spawnSync|execFileSync|\bspawn\(/, message: 'Process execution API' },
  { id: 'dynamic-code', severity: 'high', pattern: /\beval\(|new Function\(|vm\.runIn/, message: 'Dynamic code evaluation' },
  { id: 'credential-path', severity: 'high', pattern: /\.ssh\/|id_rsa|id_ed25519|Keychain|security find-|Login Data|Cookies\.sqlite/, message: 'Credential or browser-store access' },
  { id: 'shell-download', severity: 'high', pattern: /\b(curl|wget)\s+https?:/, message: 'Shell download command' },
  { id: 'network-api', severity: 'medium', pattern: /\bfetch\(|https?\.request|net\.connect|dns\.lookup|WebSocket\(/, message: 'Network access' },
  { id: 'base64-payload', severity: 'medium', pattern: /atob\(|Buffer\.from\([^)]*base64/, message: 'Base64 decode, possible embedded payload' },
  { id: 'env-access', severity: 'low', pattern: /process\.env/, message: 'Environment variable access' },
  { id: 'home-access', severity: 'low', pattern: /os\.homedir\(|process\.env\.HOME/, message: 'Home directory access' },
]

const SCRIPT_SEVERITY = {
  preinstall: 'high',
  install: 'high',
  postinstall: 'high',
  prepare: 'medium',
  prepack: 'medium',
  postpack: 'medium',
}

const CODE_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx',
  '.json', '.sh', '.bash', '.zsh', '.fish', '.py', '.rb', '.php', '.yml', '.yaml',
])

function usage() {
  console.error('usage: audit-plugin.mjs <package-dir> [--json] [--allowlist file] [--print-hash] [--quiet]')
  process.exitCode = 64
}

function parseArgs(argv) {
  const options = { dir: undefined, json: false, allowlist: undefined, printHash: false, quiet: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') options.json = true
    else if (arg === '--print-hash') options.printHash = true
    else if (arg === '--quiet') options.quiet = true
    else if (arg === '--allowlist') options.allowlist = argv[++i]
    else if (arg.startsWith('-')) { usage(); throw new Error(`unknown option ${arg}`) }
    else if (options.dir === undefined) options.dir = arg
    else { usage(); throw new Error(`unexpected argument ${arg}`) }
  }
  if (options.dir === undefined) { usage(); throw new Error('package directory is required') }
  return options
}

async function walk(dir, root, files, findings) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) }
  catch (error) { findings.push({ severity: 'medium', rule: 'unreadable', file: relative(root, dir), message: String(error) }); return }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, root, files, findings)
    else if (entry.isFile()) files.push(full)
    if (files.length > MAX_FILES) throw new Error(`package has more than ${MAX_FILES} files; audit it manually`)
  }
}

function severityRank(severity) { return severity === 'high' ? 3 : severity === 'medium' ? 2 : 1 }

function addFinding(findings, severity, rule, file, line, message, excerpt) {
  findings.push({ severity, rule, file, line, message, ...(excerpt === undefined ? {} : { excerpt }) })
}

async function inspectPackage(dir, findings) {
  let manifest
  try { manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) }
  catch { throw new Error('package.json is missing or invalid') }

  const scripts = manifest.scripts ?? {}
  for (const [name, severity] of Object.entries(SCRIPT_SEVERITY)) {
    if (typeof scripts[name] === 'string') {
      addFinding(findings, severity, 'lifecycle-script', 'package.json', undefined, `${name}: ${scripts[name]}`)
    }
  }
  if (manifest.bin !== undefined) {
    addFinding(findings, 'medium', 'bin-entry', 'package.json', undefined, 'Package installs an executable on PATH')
  }
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    if (typeof spec !== 'string') continue
    if (/^(?:file:|link:|git\+|https?:)/.test(spec)) {
      addFinding(findings, 'medium', 'unpinned-dependency', 'package.json', undefined, `${name}: ${spec}`)
    }
  }
  return manifest
}

function lineOf(text, index) { return text.slice(0, index).split('\n').length }

async function inspectFile(file, root, findings) {
  const rel = relative(root, file)
  let info
  try { info = await stat(file) } catch { return }
  if (info.size === 0 || info.size > MAX_HASH_BYTES) return
  if ((info.mode & 0o111) !== 0) {
    addFinding(findings, 'medium', 'executable-file', rel, undefined, 'File is executable')
  }
  let buffer
  try { buffer = await readFile(file) } catch { return }
  const magic = buffer.subarray(0, 4)
  if (magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46
    || magic[0] === 0x4d && magic[1] === 0x5a
    || magic[0] === 0xcf && magic[1] === 0xfa && magic[2] === 0xed && magic[3] === 0xfe
    || magic[0] === 0xca && magic[1] === 0xfe && magic[2] === 0xba && magic[3] === 0xbe) {
    addFinding(findings, 'medium', 'native-binary', rel, undefined, 'Native executable or library')
  }
  if (buffer.includes(0)) return
  if (buffer.length > MAX_TEXT_BYTES) return
  if (!CODE_EXTENSIONS.has(extname(file)) && !/^(?:Dockerfile|Makefile)$/.test(rel)) return
  const text = buffer.toString('utf8')
  for (const rule of RULES) {
    if (rule.pattern === null) continue
    const match = rule.pattern.exec(text)
    if (match !== null) {
      addFinding(findings, rule.severity, rule.id, rel, lineOf(text, match.index), rule.message, text.slice(match.index, match.index + 120).split('\n')[0])
    }
  }
  const longLine = text.split('\n').find(line => line.length > 2000)
  if (longLine !== undefined && text.length > 5000) {
    addFinding(findings, 'medium', 'obfuscation', rel, undefined, 'Very long source line; inspect manually')
  }
}

async function contentHash(files, root) {
  const hash = createHash('sha256')
  const sorted = [...files].sort()
  for (const file of sorted) {
    const rel = relative(root, file).split('\\').join('/')
    hash.update(rel)
    hash.update('\0')
    try {
      const buffer = await readFile(file)
      hash.update(String(buffer.length))
      hash.update('\0')
      hash.update(buffer)
    } catch { hash.update('unreadable') }
    hash.update('\n')
  }
  return hash.digest('hex')
}

function readAllowlist(value) {
  if (value === undefined) return { plugins: [] }
  const parsed = JSON.parse(value)
  if (!Array.isArray(parsed.plugins)) throw new Error('allowlist must contain a plugins array')
  return parsed
}

function findAllowlistEntry(allowlist, manifest, hash) {
  return allowlist.plugins.find(entry => entry.name === manifest.name
    && entry.version === manifest.version
    && entry.contentHash === hash)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const dir = resolve(options.dir)
  const findings = []
  const files = []
  await walk(dir, dir, files, findings)
  const manifest = await inspectPackage(dir, findings)
  for (const file of files) await inspectFile(file, dir, findings)
  const hash = await contentHash(files, dir)

  if (options.printHash) {
    console.log(hash)
    return
  }

  let allowlist = { plugins: [] }
  if (options.allowlist !== undefined) allowlist = readAllowlist(await readFile(options.allowlist, 'utf8'))
  const allowlisted = findAllowlistEntry(allowlist, manifest, hash) !== undefined

  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
  const counts = { high: 0, medium: 0, low: 0 }
  for (const finding of findings) counts[finding.severity] += 1
  const verdict = allowlisted ? 'allowlisted' : counts.high > 0 ? 'block' : counts.medium > 0 ? 'review' : 'pass'
  const report = {
    name: manifest.name,
    version: manifest.version,
    directory: dir,
    contentHash: hash,
    files: files.length,
    counts,
    verdict,
    allowlisted,
    findings,
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else if (!options.quiet) {
    console.log(`${manifest.name}@${manifest.version} — ${verdict.toUpperCase()}`)
    console.log(`files: ${files.length}  high: ${counts.high}  medium: ${counts.medium}  low: ${counts.low}`)
    console.log(`content hash: ${hash}`)
    if (allowlisted) console.log('matched the local allowlist')
    for (const finding of findings.slice(0, 40)) {
      const location = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`
      console.log(`  [${finding.severity}] ${finding.rule} ${location} — ${finding.message}`)
      if (finding.excerpt !== undefined) console.log(`      ${finding.excerpt}`)
    }
    if (findings.length > 40) console.log(`  … ${findings.length - 40} more findings`)
  }

  process.exitCode = verdict === 'block' ? 2 : verdict === 'review' ? 1 : 0
}

main().catch(error => {
  console.error(`audit-plugin: ${error.message}`)
  process.exitCode = 2
})
