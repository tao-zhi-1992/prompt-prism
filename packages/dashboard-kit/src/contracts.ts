import type { ComponentType, ReactNode } from 'react';
import type { CaptureTiming, Usage } from '@prompt-prism/contracts/model';
export type { CaptureTiming, Usage } from '@prompt-prism/contracts/model';

export interface CaptureSummary {
  id: string;
  timestamp: string;
  token_hash: string;
  model: string | null;
  usage?: Usage;
  response_status?: number | null;
  upstream_host?: string;
  trace_id?: string;
  trace_group_id?: string;
  trace_group_source?: 'explicit' | 'inferred';
  trace_group_index?: number;
  timing?: CaptureTiming;
  file_ref: string;
  analysis?: unknown;
}

export interface DetailTabPanelProps<Data> {
  capture: CaptureSummary;
  data: Data | null;
  loading: boolean;
  error: string | null;
  refreshError: string | null;
  retry: () => void;
  selectCapture: (id: string, tab?: string, anchor?: string) => void;
}

export interface DetailTabPluginDefinition<Data> {
  id: string;
  label: string;
  order: number;
  pollIntervalMs?: number;
  load?: (capture: CaptureSummary, signal: AbortSignal) => Promise<Data>;
  Panel: ComponentType<DetailTabPanelProps<Data>>;
}

export interface DetailTabPlugin {
  id: string;
  label: string;
  order: number;
  pollIntervalMs?: number;
  load?: (capture: CaptureSummary, signal: AbortSignal) => Promise<unknown>;
  render: (props: DetailTabPanelProps<unknown>) => ReactNode;
}
