import type { Context } from '@deepseek-ai/cordis'

export const name = 'fork-plugin-template'

/**
 * Mount your plugin here. Keep side effects reversible: register services,
 * listeners and tools on ctx so they unwind when the plugin unloads.
 */
export function apply(_ctx: Context): void {
  // Example: _ctx.on('agent/created', agent => { ... })
}
