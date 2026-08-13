import { useCallback, useEffect, useRef, useState } from 'react';
import { Logo } from './components/Logo';
import { RequestList } from './components/RequestList';
import { DetailPane } from './components/DetailPane';
import { SettingsMenu } from './components/SettingsMenu';
import { useTheme } from './theme';
import { I18nProvider, useI18n } from '@prompt-prism/plugins/dashboard';
import { Button } from '@prompt-prism/ui';
import { useCaptureFeed } from './hooks/useCaptureFeed';
import { useCaptureSelection } from './hooks/useCaptureSelection';
import { getTraceFirstCaptureId } from './api';

function Dashboard() {
  const { preference, setPreference } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const feed = useCaptureFeed();
  const { captures, pendingCaptures, totalCaptures, hasOlder, olderLoading, olderError, listLoading, listError, generation } = feed.state;
  const selection = useCaptureSelection(captures, pendingCaptures, listLoading);
  const { clear: clearFeed, loadOlder, retryInitial, setAtTop, showNewCaptures } = feed;
  const { resetSelection, select, selectTab, selected, selectedId, selectedTab } = selection;
  const [clearOpen, setClearOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const clearActionRef = useRef<HTMLSpanElement>(null);
  const traceNavigationRef = useRef<{ sequence: number; controller?: AbortController }>({ sequence: 0 });

  const openTrace = useCallback(async (captureId: string) => {
    traceNavigationRef.current.controller?.abort();
    const controller = new AbortController();
    const sequence = traceNavigationRef.current.sequence + 1;
    traceNavigationRef.current = { sequence, controller };
    try {
      const firstCaptureId = await getTraceFirstCaptureId(captureId, controller.signal);
      if (!controller.signal.aborted && traceNavigationRef.current.sequence === sequence) select(firstCaptureId, 'trace');
    } catch {
      if (!controller.signal.aborted && traceNavigationRef.current.sequence === sequence) select(captureId, 'trace');
    }
  }, [select]);

  useEffect(() => () => traceNavigationRef.current.controller?.abort(), []);

  const clear = useCallback(async () => {
    setClearBusy(true);
    try {
      await clearFeed();
      setClearOpen(false);
      resetSelection();
    } catch (error) {
      // The feed keeps existing data on failure; the dialog remains available for retry.
    } finally {
      setClearBusy(false);
    }
  }, [clearFeed, resetSelection]);

  useEffect(() => {
    if (!clearOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !clearActionRef.current?.contains(event.target)) setClearOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setClearOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [clearOpen]);

  return (
    <main className="app-shell">
      <aside className="requests-pane">
        <header className="app-header">
          <div className="brand"><Logo /><div><h1>Prompt Prism</h1><span>v{__PROMPT_PRISM_VERSION__}</span></div></div>
          <div className="header-actions">
            <div className="live-status"><span />{t('status.live')}</div>
            <SettingsMenu
              preference={preference}
              onPreferenceChange={setPreference}
              locale={locale}
              onLocaleChange={setLocale}
            />
          </div>
        </header>
        <div className="request-heading">
          <h2>{t('requests.title')}</h2>
          <span className="request-heading-actions"><span>{totalCaptures}</span><span ref={clearActionRef} className="clear-action"><Button onClick={() => setClearOpen((open) => !open)}>{t('requests.clear')}</Button>{clearOpen && <section className="clear-popup" role="dialog" aria-labelledby="clear-dialog-title" aria-describedby="clear-dialog-description">
            <h2 id="clear-dialog-title">{t('requests.clearTitle')}</h2>
            <p id="clear-dialog-description">{t('requests.clearConfirm')}</p>
            <div className="confirm-actions">
              <Button onClick={() => setClearOpen(false)} disabled={clearBusy}>{t('common.cancel')}</Button>
              <Button variant="danger" onClick={() => { void clear(); }} disabled={clearBusy}>{clearBusy ? t('requests.clearing') : t('requests.clear')}</Button>
            </div>
          </section>}</span></span>
        </div>
        <RequestList
          key={generation}
          captures={captures}
          selectedId={selectedId}
          loading={listLoading}
          error={listError}
          hasOlder={hasOlder}
          olderLoading={olderLoading}
          olderError={olderError}
          newCount={pendingCaptures.length}
          onSelect={select}
          onTraceClick={(captureId) => { void openTrace(captureId); }}
          onRetry={retryInitial}
          onLoadOlder={() => { void loadOlder(); }}
          onShowNew={showNewCaptures}
          onAtTopChange={setAtTop}
        />
      </aside>
      <DetailPane capture={selected} initialTab={selectedTab} onSelectCapture={select} onSelectTab={selectTab} />
    </main>
  );
}

export default function App() {
  return <I18nProvider><Dashboard /></I18nProvider>;
}
