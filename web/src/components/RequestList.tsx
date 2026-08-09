import { ScrollArea } from '@base-ui/react/scroll-area';
import type { CaptureSummary } from '../types';
import { RequestListItem } from './RequestListItem';

type Props = {
  captures: CaptureSummary[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
};

export function RequestList({ captures, selectedId, loading, error, onSelect, onRetry }: Props) {
  return (
    <ScrollArea.Root className="request-scroll">
      <ScrollArea.Viewport className="scroll-viewport">
        <ScrollArea.Content className="request-list" role="list" aria-label="Captured requests">
          {error && captures.length === 0 && (
            <div className="list-message list-message--error">
              <strong>Couldn’t load requests</strong>
              <span>{error}</span>
              <button onClick={onRetry}>Try again</button>
            </div>
          )}
          {error && captures.length > 0 && <div className="list-warning">Refresh paused · {error}</div>}
          {!error && loading && captures.length === 0 && (
            <div className="request-skeletons" aria-label="Loading requests">
              {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
            </div>
          )}
          {!error && !loading && captures.length === 0 && (
            <div className="list-message">
              <span className="empty-prism" aria-hidden="true">◇</span>
              <strong>No requests yet</strong>
              <span>Send a Messages request through the proxy to begin.</span>
            </div>
          )}
          {captures.map((capture) => (
            <div role="listitem" key={capture.id}>
              <RequestListItem capture={capture} selected={capture.id === selectedId} onSelect={onSelect} />
            </div>
          ))}
        </ScrollArea.Content>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="scrollbar">
        <ScrollArea.Thumb className="scrollbar-thumb" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
