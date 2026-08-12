import { useCallback, useEffect, useReducer, useRef } from 'react';
import { clearCaptures, getCapturePage, getNewCaptureBatch, type CapturePage } from '../api';
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
}

export const initialCaptureFeedState: CaptureFeedState = {
  captures: [], pendingCaptures: [], totalCaptures: 0, oldestCursor: null, newestCursor: null,
  hasOlder: false, olderLoading: false, olderError: null, isAtTop: true,
  listLoading: true, listError: null, generation: 0,
};

type CaptureFeedAction =
  | { type: 'initialLoading' }
  | { type: 'initialLoaded'; page: CapturePage }
  | { type: 'initialFailed'; error: string }
  | { type: 'pollLoaded'; items: CaptureSummary[]; total: number; newestCursor: string; page?: CapturePage; stage: boolean }
  | { type: 'pollFailed'; error: string }
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

  const refreshNew = useCallback(async (signal?: AbortSignal) => {
    const cursor = stateRef.current.newestCursor;
    if (!cursor) {
      const page = await getCapturePage({ signal });
      if (signal?.aborted || !mounted.current) return;
      dispatch({ type: 'pollLoaded', items: page.items, total: page.total, newestCursor: page.newest_cursor ?? '', page, stage: !stateRef.current.isAtTop });
      return;
    }
    const batch = await getNewCaptureBatch(cursor, signal);
    if (signal?.aborted || !mounted.current) return;
    dispatch({ type: 'pollLoaded', items: batch.items, total: batch.total, newestCursor: batch.newestCursor, stage: !stateRef.current.isAtTop });
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
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController();
      try { await refreshNew(controller.signal); }
      catch (error) { if (!controller.signal.aborted && mounted.current) dispatch({ type: 'pollFailed', error: errorMessage(error) }); }
      if (!stopped) timer = window.setTimeout(poll, POLL_INTERVAL);
    };
    timer = window.setTimeout(poll, POLL_INTERVAL);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [state.listLoading, refreshNew]);

  useEffect(() => {
    if (state.isAtTop && state.pendingCaptures.length > 0) dispatch({ type: 'showPending' });
  }, [state.isAtTop, state.pendingCaptures.length]);

  return { state, loadOlder, refreshNew, retryInitial, clear, showNewCaptures, setAtTop };
}
