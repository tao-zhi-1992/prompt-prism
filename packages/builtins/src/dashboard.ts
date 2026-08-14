import type { DetailTabPlugin } from '@prompt-prism/dashboard-kit';
import { inputDiffDashboardPlugin, outputDashboardPlugin, rawDashboardPlugin, systemPromptDashboardPlugin, toolsDashboardPlugin, traceDashboardPlugin } from '@prompt-prism/plugins/dashboard';

/** Product-default dashboard composition. The dashboard owns the registry instance. */
export const defaultDashboardTabs: readonly DetailTabPlugin[] = [inputDiffDashboardPlugin, systemPromptDashboardPlugin, outputDashboardPlugin, toolsDashboardPlugin, traceDashboardPlugin, rawDashboardPlugin];
