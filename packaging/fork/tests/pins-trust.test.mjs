import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { classifySpec } from '../shared/pins.mjs'

test('classifySpec enforces exact versions and commit-pinned git specs', () => {
  assert.equal(classifySpec('1.2.3').pinned, true)
  assert.equal(classifySpec('1.2.3-rc.1').pinned, true)
  assert.equal(classifySpec('^1.2.3').pinned, false)
  assert.equal(classifySpec('latest').pinned, false)
  assert.equal(classifySpec('npm:foo@1.2.3').pinned, true)
  assert.equal(classifySpec('npm:foo@^1.2.3').pinned, false)
  assert.equal(classifySpec('github:owner/repo#0123456789abcdef0123456789abcdef01234567').pinned, true)
  assert.equal(classifySpec('github:owner/repo#main').pinned, false)
  assert.equal(classifySpec('file:../plugin').pinned, true)
})

test('check-pins reports unpinned dependencies', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pins-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'profile',
      dependencies: { good: '1.2.3', bad: '^2.0.0' },
    }))
    const script = join(import.meta.dirname, '..', 'check-pins.mjs')
    const result = spawnSync(process.execPath, [script, '--home', home, '--profile', 'desktop', '--json'], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    const report = JSON.parse(result.stdout)
    assert.equal(report.failures, 1)
    assert.equal(report.dependencies.find(item => item.name === 'bad').pinned, false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('trust-report shows installed version, pin and allowlist state', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-trust-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    await mkdir(join(profile, 'node_modules', 'good'), { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'profile',
      dependencies: { good: '1.2.3' },
      dsh: { profile: { bundles: ['good'] } },
    }))
    await writeFile(join(profile, 'node_modules', 'good', 'package.json'), JSON.stringify({
      name: 'good', version: '1.2.3', dsh: { bundle: 'patch.yml' },
    }))
    const allowlist = join(home, 'allowlist.json')
    await writeFile(allowlist, JSON.stringify({ plugins: [{ name: 'good', version: '1.2.3' }] }))
    const script = join(import.meta.dirname, '..', 'trust-report.mjs')
    const result = spawnSync(process.execPath, [script, '--home', home, '--profile', 'desktop', '--allowlist', allowlist, '--json'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.rows[0].installed, '1.2.3')
    assert.equal(report.rows[0].pinned, true)
    assert.equal(report.rows[0].allowlisted, true)
    assert.equal(report.rows[0].bundled, true)
  } finally { await rm(home, { recursive: true, force: true }) }
})
