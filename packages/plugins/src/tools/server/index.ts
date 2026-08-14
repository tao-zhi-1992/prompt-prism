import type { Capture, JsonValue, PromptPrismServerPlugin, ServerPluginContext } from '@prompt-prism/contracts/server';
import { toolsPluginMeta } from '../index.js';

function toolsFromInput(input: { sections: Array<{ id: string; value: JsonValue }> }): JsonValue[] | null {
  const value = input.sections.find((section) => section.id === 'tools')?.value;
  return Array.isArray(value) ? value : null;
}

export function extractTools(capture: Capture, context: Pick<ServerPluginContext, 'parseProviderRequest'>): JsonValue[] {
  const normalized = capture.prompt_input && toolsFromInput(capture.prompt_input);
  if (normalized) return normalized;
  if (!capture.request?.body || !capture.adapter_id || capture.adapter_id === 'unresolved') return [];
  try {
    return toolsFromInput(context.parseProviderRequest(capture.adapter_id, capture.request.body).input) ?? [];
  } catch {
    return [];
  }
}

export interface ToolUsageInvocation {
  tool_call_id: string | null;
  index: number;
  input: JsonValue | null;
  input_raw?: string;
}

export interface ToolUsage {
  name: string;
  calls: number;
  invocations: ToolUsageInvocation[];
}

function visibleOutput(block: { type: string; visibility?: 'internal' }): boolean {
  return block.visibility !== 'internal';
}

export function extractUsedTools(capture: Capture, context: ServerPluginContext): ToolUsage[] {
  const groups = new Map<string, ToolUsage>();
  let output = capture.model_output ?? null;
  if (!output && capture.response?.body && capture.adapter_id && capture.adapter_id !== 'unresolved') {
    const contentType = Object.entries(capture.response.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
    try { output = context.parseProviderResponse(capture.adapter_id, capture.response.body, Array.isArray(contentType) ? contentType[0] : contentType).output; } catch { output = null; }
  }
  const blocks = output?.content ?? [];
  for (const [index, block] of blocks.entries()) {
    if (!visibleOutput(block)) continue;
    if (block.type !== 'tool_call') continue;
    const group = groups.get(block.name) ?? { name: block.name, calls: 0, invocations: [] };
    group.calls += 1;
    group.invocations.push({ tool_call_id: block.id, index, input: block.input, ...(block.input_raw !== undefined ? { input_raw: block.input_raw } : {}) });
    groups.set(block.name, group);
  }
  return [...groups.values()];
}

export function createToolsServerPlugin(): PromptPrismServerPlugin {
  return {
    id: toolsPluginMeta.id,
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
      context.json(response, 200, { id: capture.id, tools: extractTools(capture, context), used_tools: extractUsedTools(capture, context) });
      return true;
    },
  };
}
