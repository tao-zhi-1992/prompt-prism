import { createElement } from 'react';
import type { DetailTabPanelProps, DetailTabPlugin, DetailTabPluginDefinition } from '../contracts/dashboard.js';
import { validatePluginId } from './validation.js';

export function defineDetailTab<Data>(definition: DetailTabPluginDefinition<Data>): DetailTabPlugin {
  return {
    id: definition.id,
    label: definition.label,
    order: definition.order,
    pollIntervalMs: definition.pollIntervalMs,
    load: definition.load ? async (capture, signal) => definition.load!(capture, signal) : undefined,
    render: (props) => createElement(definition.Panel, props as DetailTabPanelProps<Data>),
  };
}

export class DetailTabRegistry {
  readonly plugins: readonly DetailTabPlugin[];

  constructor(plugins: DetailTabPlugin[] = []) {
    const ids = new Set<string>();
    const indexed = plugins.map((plugin, index) => {
      validatePluginId(plugin.id, ids);
      ids.add(plugin.id);
      return { plugin, index };
    });
    this.plugins = indexed
      .sort((left, right) => left.plugin.order - right.plugin.order || left.index - right.index)
      .map(({ plugin }) => plugin);
  }
}
