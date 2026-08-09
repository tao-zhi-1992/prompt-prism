import { useEffect, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import type { Analysis, CaptureSummary, RawCapture } from '../types';
import { DiffPanel } from './DiffPanel';
import { RawPanel } from './RawPanel';

type Props = {
  capture: CaptureSummary | null;
  analysis: Analysis | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  raw: RawCapture | null;
  rawLoading: boolean;
  rawError: string | null;
  onRawOpen: (id: string) => void;
  onRawRetry: () => void;
};

export function DetailPane({ capture, analysis, loading, error, onRetry, raw, rawLoading, rawError, onRawOpen, onRawRetry }: Props) {
  const [tab, setTab] = useState<'diff' | 'raw'>('diff');

  useEffect(() => {
    if (tab === 'raw' && capture) onRawOpen(capture.id);
  }, [tab, capture, onRawOpen]);

  if (!capture) {
    return (
      <section className="detail-empty">
        <span className="empty-prism empty-prism--large" aria-hidden="true">◇</span>
        <h2>Select a request</h2>
        <p>Choose a capture from the request list to inspect its prompt-cache diff.</p>
      </section>
    );
  }

  return (
    <section className="detail-pane">
      <Tabs.Root className="detail-tabs" value={tab} onValueChange={(value) => setTab(value as 'diff' | 'raw')}>
        <Tabs.List className="tab-list" aria-label="Request detail views">
          <Tabs.Tab className="tab" value="diff">Diff</Tabs.Tab>
          <Tabs.Tab className="tab" value="raw">Raw</Tabs.Tab>
          <Tabs.Indicator className="tab-indicator" />
        </Tabs.List>
        <Tabs.Panel className="tab-panel" value="diff">
          <DiffPanel analysis={analysis} loading={loading} error={error} onRetry={onRetry} />
        </Tabs.Panel>
        <Tabs.Panel className="tab-panel" value="raw">
          <RawPanel raw={raw} loading={rawLoading} error={rawError} onRetry={onRawRetry} />
        </Tabs.Panel>
      </Tabs.Root>
    </section>
  );
}
