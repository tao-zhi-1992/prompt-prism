import type { PromptPrismServerPlugin } from '../../contracts/server.js';
import { diffPluginMeta } from '../index.js';
import { Analyzer } from './analyzer.js';

export function createDiffServerPlugin(): PromptPrismServerPlugin & { getAnalyzer(): Analyzer } {
  let analyzer: Analyzer | null = null;
  const getAnalyzer = () => {
    if (!analyzer) throw new Error('Diff plugin has not been initialized');
    return analyzer;
  };
  return {
    id: diffPluginMeta.id,
    getAnalyzer,
    async init(context) {
      analyzer = new Analyzer({ analysisPath: context.analysisPath });
      await analyzer.init(context.captures);
    },
    async onCapture(capture) {
      await getAnalyzer().analyze(capture);
    },
    onEvict(entry) {
      getAnalyzer().remove(entry.id, entry.token_hash);
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
