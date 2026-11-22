import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = join(import.meta.dirname, '..', 'check-parity.mjs')
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>1.0.0</string></dict></plist>
`

async function app(root, name, archDir, includeBundle = true) {
  const dir = join(root, `${name}.app`)
  const dsh = join(dir, 'Contents/Resources/app.asar.unpacked/dsh')
  await mkdir(join(dir, 'Contents/MacOS'), { recursive: true })
  await mkdir(dsh, { recursive: true })
  await writeFile(join(dir, 'Contents/Info.plist'), plist)
  await writeFile(join(dir, 'Contents/MacOS/DeepSeek Harness'), 'binary')
  await writeFile(join(dsh, 'package.json'), JSON.stringify({ name: 'dsh', version: '1.0.0' }))
  if (includeBundle) {
    const pkg = join(dsh, 'node_modules/@deepseek-ai/foo')
    await mkdir(join(pkg, archDir), { recursive: true })
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'foo', version: '1.0.0', dsh: { bundle: 'patch.yml' } }))
    await writeFile(join(pkg, archDir, 'native.node'), 'native')
  }
  return dir
}

test('normalized bundles pass parity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-parity-'))
  try {
    const x64 = await app(root, 'x64', 'darwin-x64')
    const arm64 = await app(root, 'arm64', 'darwin-arm64')
    const result = spawnSync(process.execPath, [script, '--x64-app', x64, '--arm64-app', arm64, '--skip-arch', '--json'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.deepEqual(JSON.parse(result.stdout).problems, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a missing plugin bundle is reported', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-parity-'))
  try {
    const x64 = await app(root, 'x64', 'darwin-x64', true)
    const arm64 = await app(root, 'arm64', 'darwin-arm64', false)
    const result = spawnSync(process.execPath, [script, '--x64-app', x64, '--arm64-app', arm64, '--skip-arch', '--json'], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    const report = JSON.parse(result.stdout)
    assert.ok(report.problems.some(problem => problem.includes('plugin bundle')))
  } finally { await rm(root, { recursive: true, force: true }) }
})
