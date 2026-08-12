import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCaptureSummary } from '../api';
import type { CaptureSummary } from '../types';

function queryValue(name: string) {
  return new URLSearchParams(window.location.search).get(name);
}

export function useCaptureSelection(captures: CaptureSummary[], pendingCaptures: CaptureSummary[], listLoading: boolean) {
  const [selectedSummary, setSelectedSummary] = useState<CaptureSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => queryValue('capture'));
  const [selectedTab, setSelectedTab] = useState<string | null>(() => queryValue('tab'));

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

  const resetSelection = useCallback(() => {
    setSelectedId(null);
    setSelectedSummary(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('capture');
    window.history.replaceState(null, '', url);
  }, []);

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
      if (!controller.signal.aborted) resetSelection();
    });
    return () => controller.abort();
  }, [captures, listLoading, pendingCaptures, resetSelection, selectedId]);

  const selected = useMemo(() => captures.find((item) => item.id === selectedId)
    ?? pendingCaptures.find((item) => item.id === selectedId)
    ?? (selectedSummary?.id === selectedId ? selectedSummary : null), [captures, pendingCaptures, selectedId, selectedSummary]);

  return { selected, selectedId, selectedTab, select, selectTab, resetSelection };
}
