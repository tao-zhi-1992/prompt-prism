export type {
  CaptureSummary,
  CaptureTiming,
  ConversationContentBlock,
  ConversationMessage,
  DetailTabPanelProps,
  DetailTabPlugin,
  DetailTabPluginDefinition,
  ModelOutputBlock,
  ModelOutputSnapshot,
  ProviderError,
  ReasoningOutputBlock,
  TextOutputBlock,
  ToolCallOutputBlock,
  UnknownOutputBlock,
  Usage,
} from './contracts/dashboard.js';
export { defineDetailTab, DetailTabRegistry } from './registry/dashboard.js';
export { I18nProvider, LOCALE_STORAGE_KEY, resolveLocale, useI18n } from './i18n/index.js';
export type { Locale, TranslationKey } from './i18n/index.js';
export type { InputDiffAnalysis, InputDiffSection, InputDiffSectionState } from './input-diff/dashboard/InputDiffPanel.js';
export type { SystemPromptData } from './system-prompt/dashboard/SystemPromptPanel.js';
export type { RawCapture, RawHeaders } from './raw/dashboard/RawPanel.js';
export type { OutputCapture } from './output/dashboard/OutputPanel.js';
export type { TraceCall, TraceInputRelation, TraceResult } from './trace/dashboard/TracePanel.js';
export type { ToolUsage, ToolUsageInvocation, ToolsData } from './tools/dashboard/ToolsPanel.js';

import { inputDiffDashboardPlugin } from './input-diff/dashboard/index.js';
import { outputDashboardPlugin } from './output/dashboard/index.js';
import { rawDashboardPlugin } from './raw/dashboard/index.js';
import { systemPromptDashboardPlugin } from './system-prompt/dashboard/index.js';
import { traceDashboardPlugin } from './trace/dashboard/index.js';
import { DetailTabRegistry } from './registry/dashboard.js';
import { toolsDashboardPlugin } from './tools/dashboard/index.js';

export { inputDiffDashboardPlugin, outputDashboardPlugin, systemPromptDashboardPlugin, traceDashboardPlugin, rawDashboardPlugin, toolsDashboardPlugin };
export const dashboardPluginRegistry = new DetailTabRegistry([inputDiffDashboardPlugin, systemPromptDashboardPlugin, outputDashboardPlugin, toolsDashboardPlugin, traceDashboardPlugin, rawDashboardPlugin]);
