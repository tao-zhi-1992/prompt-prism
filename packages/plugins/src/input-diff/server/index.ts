import type { PromptPrismServerPlugin } from '../../contracts/server.js';
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
    async onCapture(capture, entry) {
      if (!capture.prompt_input) return;
      await getAnalyzer().analyze(capture, entry);
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
      const analysis = getAnalyzer().analyses.get(id);
      if (!analysis) context.json(response, 404, { error: 'Capture not found' });
      else context.json(response, 200, analysis);
      return true;
    }
  };
}
