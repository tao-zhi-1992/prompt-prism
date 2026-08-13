import type { PromptPrismServerPlugin } from '@prompt-prism/contracts/server';
import { rawPluginMeta } from '../index.js';

export function createRawServerPlugin(): PromptPrismServerPlugin {
  return {
    id: rawPluginMeta.id,
    async handleApi(request, response, subpath, context) {
      if (request.method !== 'GET') {
        context.json(response, 405, { error: 'Method not allowed' });
        return true;
      }
      const capture = await context.readCapture(decodeURIComponent(subpath));
      if (!capture) context.json(response, 404, { error: 'Capture not found' });
      else context.json(response, 200, { request: capture.request ?? null, response: capture.response ?? null });
      return true;
    }
  };
}
