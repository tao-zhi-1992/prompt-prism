import type { RawHeaders } from '@prompt-prism/contracts/server';
import type { PromptPrismServerPlugin } from '@prompt-prism/contracts/server';
import { outputPluginMeta } from '../index.js';

function header(headers: RawHeaders, name: string): string | undefined {
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  return Array.isArray(value) ? value.join(', ') : value;
}

export function createOutputServerPlugin(): PromptPrismServerPlugin {
  return {
    id: outputPluginMeta.id,
    async handleApi(request, response, subpath, context) {
      if (request.method !== 'GET') {
        context.json(response, 405, { error: 'Method not allowed' });
        return true;
      }
      const capture = await context.readCapture(decodeURIComponent(subpath));
      if (!capture) {
        context.json(response, 404, { error: 'Capture not found' });
        return true;
      }
      let output = capture.model_output ?? null;
      if (!output && capture.response) {
        try {
          output = context.parseProviderResponse(
            capture.adapter_id ?? 'anthropic',
            capture.response.body,
            header(capture.response.headers, 'content-type'),
          ).output;
        } catch { /* Unsupported historical adapters remain unavailable. */ }
      }
      context.json(response, 200, { output });
      return true;
    },
  };
}
