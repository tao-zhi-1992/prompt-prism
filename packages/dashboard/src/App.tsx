import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearCaptures, getCapturePage, getCaptureSummary, getNewCaptureBatch } from './api';
import type { CaptureSummary } from './types';
import { Logo } from './components/Logo';
import { RequestList } from './components/RequestList';
import { DetailPane } from './components/DetailPane';
import { SettingsMenu } from './components/SettingsMenu';
import { useTheme } from './theme';
import { I18nProvider, useI18n } from '@prompt-prism/plugins/dashboard';
import { Button } from '@prompt-prism/ui';

const POLL_INTERVAL = 3000;

function compareCaptures(left: CaptureSummary, right: CaptureSummary) {
  return right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id);
}

function mergeCaptures(current: CaptureSummary[], incoming: CaptureSummary[]) {
  const byId = new Map(current.map((capture) => [capture.id, capture]));
  for (const capture of incoming) byId.set(capture.id, capture);
  return [...byId.values()].sort(compareCaptures);
}

function captureFromUrl() {
  return new URLSearchParams(window.location.search).get('capture');
}

function tabFromUrl() {
  return new URLSearchParams(window.location.search).get('tab');
}

function Dashboard() {
  const { preference, setPreference } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const [captures, setCaptures] = useState<CaptureSummary[]>([]);
  const [pendingCaptures, setPendingCaptures] = useState<CaptureSummary[]>([]);
  const [totalCaptures, setTotalCaptures] = useState(0);
  const [oldestCursor, setOldestCursor] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [isAtTop, setIsAtTop] = useState(true);
  const [selectedSummary, setSelectedSummary] = useState<CaptureSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(captureFromUrl);
  const [selectedTab, setSelectedTab] = useState<string | null>(tabFromUrl);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [listGeneration, setListGeneration] = useState(0);
  const mounted = useRef(true);
  const newestCursorRef = useRef<string | null>(null);
  const atTopRef = useRef(true);
  const clearActionRef = useRef<HTMLSpanElement>(null);

  const select = useCallback((id: string, tab?: string, anchor?: string) => {
    setSelectedId(id);
    if (tab) setSelectedTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('capture', id);
    if (tab) url.searchParams.set('tab', tab);
    url.hash = anchor ? `#${anchor.replace(/^#/, '')}` : '';
    window.history.replaceState(null, '', url);
  }, []);

  const selectTab = useCallback((tab: string) => {
    setSelectedTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    url.hash = '';
    window.history.replaceState(null, '', url);
  }, []);

  const loadInitial = useCallback(async () => {
    try {
      const page = await getCapturePage();
      if (!mounted.current) return;
      setCaptures(page.items);
      setPendingCaptures([]);
      setTotalCaptures(page.total);
      setOldestCursor(page.oldest_cursor);
      setHasOlder(page.has_older);
      setOlderError(null);
      newestCursorRef.current = page.newest_cursor;
      setListError(null);
    } catch (error) {
      if (mounted.current) setListError(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setListLoading(false);
    }
  }, []);

  const refreshNew = useCallback(async (signal?: AbortSignal) => {
    const cursor = newestCursorRef.current;
    if (!cursor) {
      const page = await getCapturePage({ signal });
      if (signal?.aborted || !mounted.current) return;
      newestCursorRef.current = page.newest_cursor;
      setOldestCursor(page.oldest_cursor);
      setHasOlder(page.has_older);
      setTotalCaptures(page.total);
      if (page.items.length > 0) {
        if (atTopRef.current) setCaptures((current) => mergeCaptures(current, page.items));
        else setPendingCaptures((current) => mergeCaptures(current, page.items));
      }
      setListError(null);
      return;
    }
    const batch = await getNewCaptureBatch(cursor, signal);
    if (signal?.aborted || !mounted.current) return;
    newestCursorRef.current = batch.newestCursor;
    setTotalCaptures(batch.total);
    if (batch.items.length > 0) {
      if (atTopRef.current) setCaptures((current) => mergeCaptures(current, batch.items));
      else setPendingCaptures((current) => mergeCaptures(current, batch.items));
    }
    setListError(null);
  }, []);

  const loadOlder = useCallback(async () => {
    if (!oldestCursor || !hasOlder || olderLoading) return;
    setOlderLoading(true);
    setOlderError(null);
    try {
      const page = await getCapturePage({ before: oldestCursor });
      if (!mounted.current) return;
      setCaptures((current) => mergeCaptures(current, page.items));
      setTotalCaptures(page.total);
      if (page.oldest_cursor) setOldestCursor(page.oldest_cursor);
      setHasOlder(page.has_older);
    } catch (error) {
      if (mounted.current) setOlderError(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setOlderLoading(false);
    }
  }, [hasOlder, oldestCursor, olderLoading]);

  const showNewCaptures = useCallback(() => {
    setCaptures((current) => mergeCaptures(current, pendingCaptures));
    setPendingCaptures([]);
  }, [pendingCaptures]);

  const handleAtTopChange = useCallback((atTop: boolean) => {
    atTopRef.current = atTop;
    setIsAtTop(atTop);
  }, []);

  const clear = useCallback(async () => {
    setClearBusy(true);
    try {
      await clearCaptures();
      setClearOpen(false);
      setCaptures([]);
      setPendingCaptures([]);
      setTotalCaptures(0);
      setOldestCursor(null);
      setHasOlder(false);
      setSelectedId(null);
      setSelectedSummary(null);
      newestCursorRef.current = null;
      atTopRef.current = true;
      setIsAtTop(true);
      setOlderError(null);
      setListGeneration((generation) => generation + 1);
      const url = new URL(window.location.href);
      url.searchParams.delete('capture');
      window.history.replaceState(null, '', url);
      setListLoading(true);
      await loadInitial();
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setClearBusy(false);
    }
  }, [loadInitial]);

  useEffect(() => {
    mounted.current = true;
    void loadInitial();
    return () => {
      mounted.current = false;
    };
  }, [loadInitial]);

  useEffect(() => {
    if (listLoading) return;
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController();
      try { await refreshNew(controller.signal); }
      catch (error) { if (!controller.signal.aborted && mounted.current) setListError(error instanceof Error ? error.message : String(error)); }
      if (!stopped) timer = window.setTimeout(poll, POLL_INTERVAL);
    };
    timer = window.setTimeout(poll, POLL_INTERVAL);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [listLoading, refreshNew]);

  useEffect(() => {
    if (isAtTop && pendingCaptures.length > 0) showNewCaptures();
  }, [isAtTop, pendingCaptures.length, showNewCaptures]);

  useEffect(() => {
    if (listLoading) return;
    if (!selectedId || captures.some((capture) => capture.id === selectedId) || pendingCaptures.some((capture) => capture.id === selectedId)) {
      setSelectedSummary(null);
      return;
    }
    const controller = new AbortController();
    getCaptureSummary(selectedId, controller.signal).then((summary) => {
      if (!controller.signal.aborted) setSelectedSummary(summary);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setSelectedSummary(null);
      setSelectedId(null);
      const url = new URL(window.location.href);
      url.searchParams.delete('capture');
      window.history.replaceState(null, '', url);
    });
    return () => controller.abort();
  }, [captures, listLoading, pendingCaptures, selectedId]);

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

  const selected = useMemo(() => captures.find((item) => item.id === selectedId)
    ?? pendingCaptures.find((item) => item.id === selectedId)
    ?? (selectedSummary?.id === selectedId ? selectedSummary : null), [captures, pendingCaptures, selectedId, selectedSummary]);

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
          key={listGeneration}
          captures={captures}
          selectedId={selectedId}
          loading={listLoading}
          error={listError}
          hasOlder={hasOlder}
          olderLoading={olderLoading}
          olderError={olderError}
          newCount={pendingCaptures.length}
          onSelect={select}
          onRetry={() => { setListLoading(true); void loadInitial(); }}
          onLoadOlder={() => { void loadOlder(); }}
          onShowNew={showNewCaptures}
          onAtTopChange={handleAtTopChange}
        />
      </aside>
      <DetailPane capture={selected} initialTab={selectedTab} onSelectCapture={select} onSelectTab={selectTab} />
    </main>
  );
}

export default function App() {
  return <I18nProvider><Dashboard /></I18nProvider>;
}
