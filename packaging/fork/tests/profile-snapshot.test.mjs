import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = join(import.meta.dirname, '..', 'profile-snapshot.mjs')

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

test('snapshot excludes modules, restores config, and lists the snapshot', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-home-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    await mkdir(join(profile, 'node_modules'), { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'profile', version: '1.0.0' }))
    await writeFile(join(profile, 'cordis.patch.yml'), 'plugins: []\n')
    await writeFile(join(profile, 'node_modules', 'large.bin'), 'module')

    const created = run(['snapshot', '--home', home, '--profile', 'desktop'])
    assert.equal(created.status, 0, created.stderr)
    const id = created.stdout.trim().split('\n')[0]
    assert.match(id, /^\d{4}-\d{2}-\d{2}T/)

    const snapProfile = join(home, 'snapshots', 'fork', id, 'profile')
    assert.equal(JSON.parse(await readFile(join(snapProfile, 'package.json'), 'utf8')).version, '1.0.0')
    let modules = true
    try { await readFile(join(snapProfile, 'node_modules', 'large.bin')) } catch { modules = false }
    assert.equal(modules, false)

    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'profile', version: '2.0.0' }))
    const restored = run(['restore', id, '--home', home, '--profile', 'desktop'])
    assert.equal(restored.status, 0, restored.stderr)
    assert.equal(JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')).version, '1.0.0')

    const listed = run(['list', '--home', home])
    assert.equal(listed.status, 0)
    assert.ok(listed.stdout.includes(id))
  } finally { await rm(home, { recursive: true, force: true }) }
})
