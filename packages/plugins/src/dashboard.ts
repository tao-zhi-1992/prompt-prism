import './dashboard.css';

export type { CaptureSummary, DetailTabPanelProps, DetailTabPlugin, DetailTabPluginDefinition } from '@prompt-prism/dashboard-kit';
export type { CaptureTiming, ConversationContentBlock, ConversationMessage, JsonPrimitive, JsonValue, ModelOutputBlock, ModelOutputSnapshot, ProviderError, ReasoningOutputBlock, TextOutputBlock, ToolCallOutputBlock, UnknownOutputBlock, Usage } from '@prompt-prism/contracts/model';
export { defineDetailTab, DetailTabRegistry, I18nProvider, LOCALE_STORAGE_KEY, resolveLocale, useI18n, traceDisplayName, TRACE_DISPLAY_NAMES } from '@prompt-prism/dashboard-kit';
export type { Locale, TranslationKey } from '@prompt-prism/dashboard-kit';
export { ContentCopyButton, detectStructuredContent, StructuredContent } from './content/StructuredContent.js';
export type { StructuredContentHints, StructuredContentKind, StructuredContentMode, StructuredContentProps } from './content/StructuredContent.js';
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
import { toolsDashboardPlugin } from './tools/dashboard/index.js';

export { inputDiffDashboardPlugin, outputDashboardPlugin, systemPromptDashboardPlugin, traceDashboardPlugin, rawDashboardPlugin, toolsDashboardPlugin };
