import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')

test('the bundle declaration points at an existing patch', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  await readFile(join(root, 'cordis.patch.yml'))
})

test('the patch mounts this package by name', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
  assert.ok(patch.includes(`name: ${manifest.name}`))
})
