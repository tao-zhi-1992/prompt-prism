export type {
  CaptureSummary, DetailTabPanelProps, DetailTabPlugin, DetailTabPluginDefinition,
} from './contracts.js';
export type {
  CaptureTiming, ConversationContentBlock, ConversationMessage, JsonPrimitive, JsonValue,
  ModelOutputBlock, ModelOutputSnapshot, ProviderError, ReasoningOutputBlock,
  TextOutputBlock, ToolCallOutputBlock, UnknownOutputBlock, Usage,
} from '@prompt-prism/contracts/model';
export { defineDetailTab, DetailTabRegistry } from './registry/dashboard.js';
export { I18nProvider, LOCALE_STORAGE_KEY, resolveLocale, useI18n } from './i18n/index.js';
export type { Locale, TranslationKey } from './i18n/index.js';
export { traceDisplayName, TRACE_DISPLAY_NAMES } from './trace/displayName.js';
export { ContentCopyButton, detectStructuredContent, StructuredContent } from './content/StructuredContent.js';
export type { StructuredContentHints, StructuredContentKind, StructuredContentMode, StructuredContentProps } from './content/StructuredContent.js';
