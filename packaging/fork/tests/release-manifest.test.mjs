import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = join(import.meta.dirname, '..', 'release-manifest.mjs')

test('manifest records hashes, versions and an SBOM', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-manifest-'))
  try {
    const x64 = join(root, 'x64.dmg')
    const arm64 = join(root, 'arm64.dmg')
    await writeFile(x64, 'intel artifact')
    await writeFile(arm64, 'apple silicon artifact')
    const out = join(root, 'out')
    const result = spawnSync(process.execPath, [script, '--x64', x64, '--arm64', arm64, '--out', out, '--no-git'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const manifestPath = result.stdout.trim().split('\n')[0]
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.equal(manifest.artifacts['mac-x64'].sha256, createHash('sha256').update('intel artifact').digest('hex'))
    assert.equal(manifest.artifacts['mac-arm64'].sha256, createHash('sha256').update('apple silicon artifact').digest('hex'))
    assert.match(manifest.version, /^\d+\.\d+\.\d+/)
    const bom = JSON.parse(await readFile(join(out, `sbom-${manifest.version}.cdx.json`), 'utf8'))
    assert.equal(bom.bomFormat, 'CycloneDX')
    assert.ok(bom.components.some(component => component.name === 'dsh'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
