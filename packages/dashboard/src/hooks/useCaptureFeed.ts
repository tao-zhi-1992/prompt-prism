import { useCallback, useEffect, useReducer, useRef } from 'react';
import { clearCaptures, getCaptureChanges, getCapturePage, type CaptureChange, type CapturePage } from '../api';
import type { CaptureSummary } from '../types';

const POLL_INTERVAL = 3000;

export function compareCaptures(left: CaptureSummary, right: CaptureSummary) {
  return right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id);
}

export function mergeCaptures(current: CaptureSummary[], incoming: CaptureSummary[]) {
  const byId = new Map(current.map((capture) => [capture.id, capture]));
  for (const capture of incoming) byId.set(capture.id, capture);
  return [...byId.values()].sort(compareCaptures);
}

export interface CaptureFeedState {
  captures: CaptureSummary[];
  pendingCaptures: CaptureSummary[];
  totalCaptures: number;
  oldestCursor: string | null;
  newestCursor: string | null;
  hasOlder: boolean;
  olderLoading: boolean;
  olderError: string | null;
  isAtTop: boolean;
  listLoading: boolean;
  listError: string | null;
  generation: number;
  revision: number;
}

export const initialCaptureFeedState: CaptureFeedState = {
  captures: [], pendingCaptures: [], totalCaptures: 0, oldestCursor: null, newestCursor: null,
  hasOlder: false, olderLoading: false, olderError: null, isAtTop: true,
  listLoading: true, listError: null, generation: 0, revision: 0,
};

type CaptureFeedAction =
  | { type: 'initialLoading' }
  | { type: 'initialLoaded'; page: CapturePage }
  | { type: 'initialFailed'; error: string }
  | { type: 'pollLoaded'; items: CaptureSummary[]; total: number; newestCursor: string; page?: CapturePage; stage: boolean }
  | { type: 'pollFailed'; error: string }
  | { type: 'changeApplied'; change: CaptureChange; stage: boolean }
  | { type: 'olderLoading' }
  | { type: 'olderLoaded'; page: CapturePage }
  | { type: 'olderFailed'; error: string }
  | { type: 'showPending' }
  | { type: 'atTopChanged'; atTop: boolean }
  | { type: 'cleared' };

export function captureFeedReducer(state: CaptureFeedState, action: CaptureFeedAction): CaptureFeedState {
  switch (action.type) {
    case 'initialLoading': return { ...state, listLoading: true };
    case 'initialLoaded': return {
      ...state,
      captures: action.page.items,
      pendingCaptures: [],
      totalCaptures: action.page.total,
      oldestCursor: action.page.oldest_cursor,
      newestCursor: action.page.newest_cursor,
      hasOlder: action.page.has_older,
      olderError: null,
      listLoading: false,
      listError: null,
      revision: action.page.revision ?? state.revision,
    };
    case 'initialFailed': return { ...state, listLoading: false, listError: action.error };
    case 'pollLoaded': {
      const items = action.items;
      return {
        ...state,
        captures: action.stage ? state.captures : mergeCaptures(state.captures, items),
        pendingCaptures: action.stage ? mergeCaptures(state.pendingCaptures, items) : state.pendingCaptures,
        totalCaptures: action.total,
        newestCursor: action.newestCursor,
        oldestCursor: action.page?.oldest_cursor ?? state.oldestCursor,
        hasOlder: action.page?.has_older ?? state.hasOlder,
        listError: null,
      };
    }
    case 'pollFailed': return { ...state, listError: action.error };
    case 'changeApplied': {
      const removed = new Set(action.change.removed_ids);
      const replace = (items: CaptureSummary[]) => mergeCaptures(items.filter((item) => !removed.has(item.id)), action.change.updated);
      const added = action.change.added;
      return {
        ...state,
        captures: action.stage ? replace(state.captures) : mergeCaptures(replace(state.captures), added),
        pendingCaptures: action.stage ? mergeCaptures(replace(state.pendingCaptures), added) : replace(state.pendingCaptures),
        totalCaptures: action.change.total,
        revision: action.change.revision,
        listError: null,
      };
    }
    case 'olderLoading': return { ...state, olderLoading: true, olderError: null };
    case 'olderLoaded': return {
      ...state,
      captures: mergeCaptures(state.captures, action.page.items),
      totalCaptures: action.page.total,
      oldestCursor: action.page.oldest_cursor ?? state.oldestCursor,
      hasOlder: action.page.has_older,
      olderLoading: false,
    };
    case 'olderFailed': return { ...state, olderLoading: false, olderError: action.error };
    case 'showPending': return { ...state, captures: mergeCaptures(state.captures, state.pendingCaptures), pendingCaptures: [] };
    case 'atTopChanged': return { ...state, isAtTop: action.atTop };
    case 'cleared': return { ...initialCaptureFeedState, generation: state.generation + 1 };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useCaptureFeed() {
  const [state, dispatch] = useReducer(captureFeedReducer, initialCaptureFeedState);
  const mounted = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;

  const loadInitial = useCallback(async () => {
    try {
      const page = await getCapturePage();
      if (mounted.current) dispatch({ type: 'initialLoaded', page });
    } catch (error) {
      if (mounted.current) dispatch({ type: 'initialFailed', error: errorMessage(error) });
    }
  }, []);

  const retryInitial = useCallback(() => {
    dispatch({ type: 'initialLoading' });
    void loadInitial();
  }, [loadInitial]);

  const applyChange = useCallback((change: CaptureChange) => {
    if (!mounted.current) return;
    const current = stateRef.current;
    if (change.revision <= current.revision) return;
    dispatch({ type: 'changeApplied', change, stage: !current.isAtTop });
  }, []);

  const loadOlder = useCallback(async () => {
    const current = stateRef.current;
    if (!current.oldestCursor || !current.hasOlder || current.olderLoading) return;
    dispatch({ type: 'olderLoading' });
    try {
      const page = await getCapturePage({ before: current.oldestCursor });
      if (mounted.current) dispatch({ type: 'olderLoaded', page });
    } catch (error) {
      if (mounted.current) dispatch({ type: 'olderFailed', error: errorMessage(error) });
    }
  }, []);

  const clear = useCallback(async () => {
    try {
      await clearCaptures();
      if (!mounted.current) return;
      dispatch({ type: 'cleared' });
      await loadInitial();
    } catch (error) {
      if (mounted.current) dispatch({ type: 'pollFailed', error: errorMessage(error) });
      throw error;
    }
  }, [loadInitial]);

  const showNewCaptures = useCallback(() => dispatch({ type: 'showPending' }), []);
  const setAtTop = useCallback((atTop: boolean) => dispatch({ type: 'atTopChanged', atTop }), []);

  useEffect(() => {
    mounted.current = true;
    void loadInitial();
    return () => { mounted.current = false; };
  }, [loadInitial]);

  useEffect(() => {
    if (state.listLoading) return;
    let source: EventSource | null = null;
    let fallback: number | undefined;
    let failures = 0;
    const fallbackPoll = async () => {
      try {
        const value = await getCaptureChanges(stateRef.current.revision);
        if (value.reset_required) { await loadInitial(); return; }
        for (const change of value.changes ?? []) applyChange(change);
      } catch (error) { if (mounted.current) dispatch({ type: 'pollFailed', error: errorMessage(error) }); }
    };
    if (typeof EventSource === 'undefined') fallback = window.setInterval(() => { void fallbackPoll(); }, POLL_INTERVAL);
    else {
      source = new EventSource(`/_pp/api/logs/stream?since=${state.revision}`);
      source.addEventListener('change', (event) => { failures = 0; applyChange(JSON.parse((event as MessageEvent).data) as CaptureChange); });
      source.addEventListener('reset', () => { void loadInitial(); });
      source.onerror = () => { if (++failures >= 3 && fallback === undefined) fallback = window.setInterval(() => { void fallbackPoll(); }, POLL_INTERVAL); };
    }
    return () => { source?.close(); if (fallback !== undefined) window.clearInterval(fallback); };
  }, [applyChange, loadInitial, state.listLoading, state.revision]);

  useEffect(() => {
    if (state.isAtTop && state.pendingCaptures.length > 0) dispatch({ type: 'showPending' });
  }, [state.isAtTop, state.pendingCaptures.length]);

  return { state, loadOlder, retryInitial, clear, showNewCaptures, setAtTop };
}
