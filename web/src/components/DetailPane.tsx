import { Tabs } from '@base-ui/react/tabs';
import type { Analysis, CaptureSummary } from '../types';
import { DetailHeader } from './DetailHeader';
import { DiffPanel } from './DiffPanel';

type Props = {
  capture: CaptureSummary | null;
  analysis: Analysis | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

export function DetailPane({ capture, analysis, loading, error, onRetry }: Props) {
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
      <DetailHeader capture={capture} />
      <Tabs.Root className="detail-tabs" defaultValue="diff">
        <Tabs.List className="tab-list" aria-label="Request detail views">
          <Tabs.Tab className="tab" value="diff">Diff</Tabs.Tab>
          <Tabs.Indicator className="tab-indicator" />
        </Tabs.List>
        <Tabs.Panel className="tab-panel" value="diff">
          <DiffPanel analysis={analysis} loading={loading} error={error} onRetry={onRetry} />
        </Tabs.Panel>
      </Tabs.Root>
    </section>
  );
}
