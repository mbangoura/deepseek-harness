import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = join(import.meta.dirname, '..', 'health-report.mjs')

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-health-'))
  const profile = join(home, 'profiles', 'desktop')
  await mkdir(join(profile, 'node_modules', 'good'), { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'profile',
    dependencies: { good: '1.2.3', missing: '2.0.0' },
    dsh: { profile: { bundles: ['good'] } },
  }))
  await writeFile(join(profile, 'node_modules', 'good', 'package.json'), JSON.stringify({
    name: 'good', version: '1.2.3', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
  await mkdir(join(home, 'snapshots', 'fork', '2026-11-22T00-00-00-000Z'), { recursive: true })
  return home
}

test('health report flags a missing module and finds the latest snapshot', async () => {
  const home = await fixture()
  try {
    const result = spawnSync(process.execPath, [script, '--home', home, '--profile', 'desktop', '--json'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.status, 'fail')
    assert.deepEqual(report.missingModules, ['missing'])
    assert.equal(report.latestSnapshot, '2026-11-22T00-00-00-000Z')
    assert.equal(report.bundles[0].declared, true)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('strict mode exits non-zero for an unhealthy profile', async () => {
  const home = await fixture()
  try {
    const result = spawnSync(process.execPath, [script, '--home', home, '--profile', 'desktop', '--strict'], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /FAIL/)
  } finally { await rm(home, { recursive: true, force: true }) }
})
