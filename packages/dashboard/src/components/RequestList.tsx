import { ScrollArea } from '@base-ui/react/scroll-area';
import type { CaptureSummary } from '../types';
import { RequestListItem } from './RequestListItem';
import { useI18n } from '@prompt-prism/plugins/dashboard';
import { Button } from '@prompt-prism/ui';

type Props = {
  captures: CaptureSummary[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: string, tab?: string) => void;
  onRetry: () => void;
};

export function RequestList({ captures, selectedId, loading, error, onSelect, onRetry }: Props) {
  const { t } = useI18n();
  return (
    <ScrollArea.Root className="request-scroll">
      <ScrollArea.Viewport className="scroll-viewport">
        <ScrollArea.Content className="request-list" role="list" aria-label={t('requests.listLabel')}>
          {error && captures.length === 0 && (
            <div className="list-message list-message--error">
              <strong>{t('requests.loadFailed')}</strong>
              <span>{error}</span>
              <Button onClick={onRetry}>{t('common.tryAgain')}</Button>
            </div>
          )}
          {error && captures.length > 0 && <div className="list-warning">{t('requests.refreshPaused', { error })}</div>}
          {!error && loading && captures.length === 0 && (
            <div className="request-skeletons" aria-label={t('requests.loading')}>
              {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
            </div>
          )}
          {!error && !loading && captures.length === 0 && (
            <div className="list-message">
              <span className="empty-prism" aria-hidden="true">◇</span>
              <strong>{t('requests.emptyTitle')}</strong>
              <span>{t('requests.emptyDescription')}</span>
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
