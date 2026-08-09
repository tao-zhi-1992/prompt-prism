import type { ComponentType, ReactNode } from 'react';

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface CaptureSummary {
  id: string;
  timestamp: string;
  token_hash: string;
  model: string | null;
  usage?: Usage;
  response_status?: number | null;
  upstream_host?: string;
  file_ref: string;
  analysis?: unknown;
}

export interface DetailTabPanelProps<Data> {
  capture: CaptureSummary;
  data: Data | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export interface DetailTabPluginDefinition<Data> {
  id: string;
  label: string;
  order: number;
  load?: (capture: CaptureSummary, signal: AbortSignal) => Promise<Data>;
  Panel: ComponentType<DetailTabPanelProps<Data>>;
}

export interface DetailTabPlugin {
  id: string;
  label: string;
  order: number;
  load?: (capture: CaptureSummary, signal: AbortSignal) => Promise<unknown>;
  render: (props: DetailTabPanelProps<unknown>) => ReactNode;
}
