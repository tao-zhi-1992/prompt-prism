export type {
  CaptureSummary,
  DetailTabPanelProps,
  DetailTabPlugin,
  DetailTabPluginDefinition,
  Usage,
} from './contracts/dashboard.js';
export { defineDetailTab, DetailTabRegistry } from './registry/dashboard.js';
export type { Analysis } from './diff/dashboard/DiffPanel.js';
export type { RawCapture, RawHeaders } from './raw/dashboard/RawPanel.js';

import { diffDashboardPlugin } from './diff/dashboard/index.js';
import { rawDashboardPlugin } from './raw/dashboard/index.js';
import { DetailTabRegistry } from './registry/dashboard.js';

export { diffDashboardPlugin, rawDashboardPlugin };
export const dashboardPluginRegistry = new DetailTabRegistry([diffDashboardPlugin, rawDashboardPlugin]);
