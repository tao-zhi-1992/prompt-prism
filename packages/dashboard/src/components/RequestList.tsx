import { ScrollArea } from '@base-ui/react/scroll-area';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import type { CaptureSummary } from '../types';
import { RequestListItem } from './RequestListItem';
import { useI18n } from '@prompt-prism/plugins/dashboard';
import { Button } from '@prompt-prism/ui';

type Props = {
  captures: CaptureSummary[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  hasOlder: boolean;
  olderLoading: boolean;
  olderError: string | null;
  newCount: number;
  onSelect: (id: string, tab?: string) => void;
  onRetry: () => void;
  onLoadOlder: () => void;
  onShowNew: () => void;
  onAtTopChange: (atTop: boolean) => void;
};

export function RequestList({ captures, selectedId, loading, error, hasOlder, olderLoading, olderError, newCount, onSelect, onRetry, onLoadOlder, onShowNew, onAtTopChange }: Props) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: captures.length > 0 ? captures.length + 1 : 0,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => index === captures.length ? 44 : 64,
    overscan: 8,
    initialRect: { width: 356, height: 800 },
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualItems.at(-1)?.index ?? -1;
  const showNew = () => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    onAtTopChange(true);
    onShowNew();
  };

  useEffect(() => {
    if (lastVirtualIndex >= captures.length && hasOlder && !olderLoading && !olderError) onLoadOlder();
  }, [captures.length, hasOlder, lastVirtualIndex, onLoadOlder, olderError, olderLoading]);

  return (
    <ScrollArea.Root className="request-scroll">
      {newCount > 0 && <Button className="request-new-banner" onClick={showNew}>{t('requests.newAvailable', { count: newCount })}</Button>}
      <ScrollArea.Viewport ref={viewportRef} className="scroll-viewport" onScroll={(event) => onAtTopChange(event.currentTarget.scrollTop <= 8)}>
        <ScrollArea.Content className="request-list-shell">
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
          {captures.length > 0 && <div className="request-list" role="list" aria-label={t('requests.listLabel')} style={{ height: Math.max(virtualizer.getTotalSize(), captures.length * 64 + 44) }}>
            {virtualItems.map((virtualItem) => {
              const capture = captures[virtualItem.index];
              return <div
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                role={capture ? 'listitem' : undefined}
                className={capture ? 'request-virtual-row' : 'request-list-footer'}
                key={capture?.id ?? 'request-list-footer'}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {capture
                  ? <RequestListItem capture={capture} selected={capture.id === selectedId} onSelect={onSelect} />
                  : olderError
                    ? <Button onClick={onLoadOlder}>{t('requests.loadOlderFailed')}</Button>
                    : olderLoading
                      ? <span>{t('requests.loadingOlder')}</span>
                      : hasOlder
                        ? <Button onClick={onLoadOlder}>{t('requests.loadOlder')}</Button>
                        : <span>{t('requests.noMore')}</span>}
              </div>;
            })}
          </div>}
        </ScrollArea.Content>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="scrollbar">
        <ScrollArea.Thumb className="scrollbar-thumb" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
