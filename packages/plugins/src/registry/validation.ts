const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_IDS = new Set(['logs', 'assets', 'brand']);

export function validatePluginId(id: string, existing: ReadonlySet<string>): void {
  if (!PLUGIN_ID.test(id)) throw new Error(`Invalid plugin ID: ${id}`);
  if (RESERVED_IDS.has(id)) throw new Error(`Reserved plugin ID: ${id}`);
  if (existing.has(id)) throw new Error(`Duplicate plugin ID: ${id}`);
}
