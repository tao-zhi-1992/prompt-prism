export type {
  CaptureSummary,
  DetailTabPanelProps,
  DetailTabPlugin,
  DetailTabPluginDefinition,
  Usage,
} from './contracts/dashboard.js';
export { defineDetailTab, DetailTabRegistry } from './registry/dashboard.js';
export type { InputDiffAnalysis, InputDiffSection, InputDiffSectionState } from './input-diff/dashboard/InputDiffPanel.js';
export type { RawCapture, RawHeaders } from './raw/dashboard/RawPanel.js';

import { inputDiffDashboardPlugin } from './input-diff/dashboard/index.js';
import { rawDashboardPlugin } from './raw/dashboard/index.js';
import { DetailTabRegistry } from './registry/dashboard.js';

export { inputDiffDashboardPlugin, rawDashboardPlugin };
export const dashboardPluginRegistry = new DetailTabRegistry([inputDiffDashboardPlugin, rawDashboardPlugin]);
