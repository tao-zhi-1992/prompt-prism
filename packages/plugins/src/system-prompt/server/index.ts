import type { Capture, JsonValue, PromptPrismServerPlugin } from '../../contracts/server.js';
import { systemPromptPluginMeta } from '../index.js';

function extractSystem(capture: Capture): JsonValue | null {
  const section = capture.prompt_input?.sections.find((item) => item.id === 'system');
  if (section) {
    const value = section.value;
    if (Array.isArray(value) && value.length === 0) return null;
    return value;
  }
  // Historical captures without prompt_input: fall back to system/developer role messages.
  const legacy = capture.messages.filter((message) => message.role === 'system' || message.role === 'developer');
  return legacy.length ? legacy : null;
}

export function createSystemPromptServerPlugin(): PromptPrismServerPlugin {
  return {
    id: systemPromptPluginMeta.id,
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
      context.json(response, 200, { id: capture.id, system: extractSystem(capture) });
      return true;
    }
  };
}
