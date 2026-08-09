import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCaptures, getDiff, getRawCapture } from './api';
import type { Analysis, CaptureSummary, RawCapture } from './types';
import { Logo } from './components/Logo';
import { RequestList } from './components/RequestList';
import { DetailPane } from './components/DetailPane';
import { ThemeMenu } from './components/ThemeMenu';
import { useTheme } from './theme';

const POLL_INTERVAL = 3000;

function captureFromUrl() {
  return new URLSearchParams(window.location.search).get('capture');
}

export default function App() {
  const { preference, setPreference } = useTheme();
  const [captures, setCaptures] = useState<CaptureSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(captureFromUrl);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [details, setDetails] = useState<Map<string, Analysis>>(() => new Map());
  const [rawDetails, setRawDetails] = useState<Map<string, RawCapture>>(() => new Map());
  const [rawLoadingIds, setRawLoadingIds] = useState<Set<string>>(() => new Set());
  const [rawErrors, setRawErrors] = useState<Map<string, string>>(() => new Map());
  const rawPending = useRef(new Set<string>());
  const mounted = useRef(true);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('capture', id);
    window.history.replaceState(null, '', url);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await getCaptures();
      if (!mounted.current) return;
      setCaptures(next);
      setListError(null);
      setSelectedId((current) => {
        const available = current && next.some((item) => item.id === current);
        const resolved = available ? current : next[0]?.id ?? null;
        const url = new URL(window.location.href);
        if (resolved) url.searchParams.set('capture', resolved);
        else url.searchParams.delete('capture');
        window.history.replaceState(null, '', url);
        return resolved;
      });
    } catch (error) {
      if (mounted.current) setListError(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setListLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(refresh, POLL_INTERVAL);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const loadDetail = useCallback(async (id: string, force = false) => {
    if (!force && details.has(id)) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const analysis = await getDiff(id);
      if (!mounted.current) return;
      setDetails((current) => new Map(current).set(id, analysis));
    } catch (error) {
      if (mounted.current) setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setDetailLoading(false);
    }
  }, [details]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const loadRaw = useCallback(async (id: string, force = false) => {
    if (rawPending.current.has(id) || (!force && rawDetails.has(id))) return;
    rawPending.current.add(id);
    setRawLoadingIds((current) => new Set(current).add(id));
    setRawErrors((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    try {
      const raw = await getRawCapture(id);
      if (!mounted.current) return;
      setRawDetails((current) => new Map(current).set(id, raw));
    } catch (error) {
      if (mounted.current) setRawErrors((current) => new Map(current).set(id, error instanceof Error ? error.message : String(error)));
    } finally {
      rawPending.current.delete(id);
      if (mounted.current) setRawLoadingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, [rawDetails]);

  const selected = useMemo(() => captures.find((item) => item.id === selectedId) ?? null, [captures, selectedId]);
  const detail = selectedId ? details.get(selectedId) ?? null : null;

  return (
    <main className="app-shell">
      <aside className="requests-pane">
        <header className="app-header">
          <div className="brand"><Logo /><div><h1>Prompt Prism</h1><span>Prompt &amp; response inspector</span></div></div>
          <div className="header-actions">
            <div className="live-status"><span />Live</div>
            <ThemeMenu preference={preference} onPreferenceChange={setPreference} />
          </div>
        </header>
        <div className="request-heading">
          <h2>Requests</h2>
          <span>{captures.length}</span>
        </div>
        <RequestList
          captures={captures}
          selectedId={selectedId}
          loading={listLoading}
          error={listError}
          onSelect={select}
          onRetry={() => { setListLoading(true); void refresh(); }}
        />
      </aside>
      <DetailPane
        capture={selected}
        analysis={detail}
        loading={detailLoading}
        error={detailError}
        onRetry={() => selectedId && void loadDetail(selectedId, true)}
        raw={selectedId ? rawDetails.get(selectedId) ?? null : null}
        rawLoading={Boolean(selectedId && rawLoadingIds.has(selectedId))}
        rawError={selectedId ? rawErrors.get(selectedId) ?? null : null}
        onRawOpen={loadRaw}
        onRawRetry={() => selectedId && void loadRaw(selectedId, true)}
      />
    </main>
  );
}
