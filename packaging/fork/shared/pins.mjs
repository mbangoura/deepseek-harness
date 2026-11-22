const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Classify a dependency spec for the fork's exact-pinning policy.
 * @param {string} spec package.json dependency value
 */
export function classifySpec(spec) {
  if (typeof spec !== 'string' || spec.trim() === '') return { kind: 'invalid', pinned: false, reason: 'empty spec' }
  if (/^(?:file:|link:)/.test(spec)) return { kind: 'local', pinned: true, reason: 'local path' }
  if (spec.startsWith('workspace:')) return { kind: 'workspace', pinned: false, reason: 'workspace range' }
  if (spec.startsWith('npm:')) {
    const body = spec.slice(4)
    const at = body.lastIndexOf('@')
    if (at <= 0) return { kind: 'alias', pinned: false, reason: 'alias without exact version' }
    const version = body.slice(at + 1)
    return EXACT.test(version)
      ? { kind: 'alias', pinned: true, reason: `alias ${body.slice(0, at)}@${version}` }
      : { kind: 'alias', pinned: false, reason: `alias range ${version}` }
  }
  if (/^(?:git\+|github:|gitlab:|bitbucket:)/.test(spec) || /^https?:\/\/.*\.git(?:#|$)/.test(spec)) {
    const hash = spec.includes('#') ? spec.slice(spec.lastIndexOf('#') + 1) : ''
    return /^[0-9a-f]{40}$/i.test(hash)
      ? { kind: 'git', pinned: true, reason: 'commit pinned' }
      : { kind: 'git', pinned: false, reason: 'Git spec is not pinned to a full 40-character commit' }
  }
  if (/^https?:\/\/.*\.(?:tgz|tar\.gz)(?:$|[?#])/.test(spec)) {
    return { kind: 'tarball', pinned: false, reason: 'remote tarball without a local integrity check' }
  }
  if (EXACT.test(spec)) return { kind: 'registry', pinned: true, reason: 'exact version' }
  return { kind: 'range', pinned: false, reason: 'range, tag or floating version' }
}

export function collectDependencies(manifest) {
  return Object.entries(manifest.dependencies ?? {})
    .map(([name, spec]) => ({ name, spec, ...classifySpec(spec) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
