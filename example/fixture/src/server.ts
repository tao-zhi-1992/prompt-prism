import http from 'node:http';
import { listInventory, type InventoryItem } from './http.js';

const inventory: InventoryItem[] = [
  { id: 'sku-1', name: 'Prism', quantity: 3 },
  { id: 'sku-2', name: 'Lens', quantity: 5 }
];

export function createServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/inventory') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(listInventory(inventory, url.searchParams.get('limit') ?? undefined)));
      return;
    }
    response.writeHead(404).end();
  });
}
