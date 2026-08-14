import type { PromptPrismServerPlugin } from '@prompt-prism/contracts/server';
import { inputDiffPluginMeta } from '../index.js';
import { InputDiffAnalyzer } from './analyzer.js';

export function createInputDiffServerPlugin(): PromptPrismServerPlugin & { getAnalyzer(): InputDiffAnalyzer } {
  let analyzer: InputDiffAnalyzer | null = null;
  const getAnalyzer = () => {
    if (!analyzer) throw new Error('Diff plugin has not been initialized');
    return analyzer;
  };
  return {
    id: inputDiffPluginMeta.id,
    getAnalyzer,
    async init(context) {
      analyzer = new InputDiffAnalyzer({ analysisPath: context.analysisPath });
      await analyzer.init(context.captures);
    },
    onEvict(entry) {
      getAnalyzer().remove(entry);
    },
    onClear() {
      getAnalyzer().clear();
    },
    async handleApi(request, response, subpath, context) {
      if (request.method !== 'GET') {
        context.json(response, 405, { error: 'Method not allowed' });
        return true;
      }
      const id = decodeURIComponent(subpath);
      const analyzer = getAnalyzer();
      const parentId = context.getTraceParent?.(id) ?? null;
      const cached = analyzer.analyses.get(id);
      if (cached && cached.matched_parent_id === parentId) { context.json(response, 200, cached); return true; }
      const capture = await context.readCapture(id);
      if (!capture) { context.json(response, 404, { error: 'Capture not found' }); return true; }
      if (!capture.prompt_input) { context.json(response, 422, { error: 'Input diff is unavailable for this capture' }); return true; }
      const parent = parentId ? context.captures.find((entry) => entry.id === parentId) ?? null : null;
      const analysis = await analyzer.analyze(capture, context.captures.find((entry) => entry.id === id), parent);
      context.json(response, 200, analysis);
      return true;
    }
  };
}
