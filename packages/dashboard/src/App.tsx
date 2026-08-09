import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCaptures } from './api';
import type { CaptureSummary } from './types';
import { Logo } from './components/Logo';
import { RequestList } from './components/RequestList';
import { DetailPane } from './components/DetailPane';
import { ThemeMenu } from './components/ThemeMenu';
import { LanguageMenu } from './components/LanguageMenu';
import { useTheme } from './theme';
import { I18nProvider, useI18n } from '@prompt-prism/plugins/dashboard';

const POLL_INTERVAL = 3000;

function captureFromUrl() {
  return new URLSearchParams(window.location.search).get('capture');
}

function Dashboard() {
  const { preference, setPreference } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const [captures, setCaptures] = useState<CaptureSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(captureFromUrl);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
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

  const selected = useMemo(() => captures.find((item) => item.id === selectedId) ?? null, [captures, selectedId]);

  return (
    <main className="app-shell">
      <aside className="requests-pane">
        <header className="app-header">
          <div className="brand"><Logo /><div><h1>Prompt Prism</h1><span>{t('brand.subtitle')}</span></div></div>
          <div className="header-actions">
            <div className="live-status"><span />{t('status.live')}</div>
            <LanguageMenu locale={locale} onLocaleChange={setLocale} />
            <ThemeMenu preference={preference} onPreferenceChange={setPreference} />
          </div>
        </header>
        <div className="request-heading">
          <h2>{t('requests.title')}</h2>
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
      <DetailPane capture={selected} onSelectCapture={select} />
    </main>
  );
}

export default function App() {
  return <I18nProvider><Dashboard /></I18nProvider>;
}
