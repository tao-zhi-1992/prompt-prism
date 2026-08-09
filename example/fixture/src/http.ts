export type InventoryItem = { id: string; name: string; quantity: number };

export function parseLimit(value: string | undefined): number {
  // This implementation intentionally contains a bug for the demo task.
  return Number(value) || 20;
}

export function listInventory(items: InventoryItem[], value: string | undefined): InventoryItem[] {
  return items.slice(0, parseLimit(value));
}
