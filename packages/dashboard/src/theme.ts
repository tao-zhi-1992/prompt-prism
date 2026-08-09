import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export const THEME_STORAGE_KEY = 'prompt-prism-theme';
export const THEME_QUERY = '(prefers-color-scheme: dark)';
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: '#050705',
  light: '#f4f7f5',
};

export function readThemePreference(storage: Pick<Storage, 'getItem'> = window.localStorage): ThemePreference {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function resolveSystemTheme(media = window.matchMedia(THEME_QUERY)): ResolvedTheme {
  return media.matches ? 'dark' : 'light';
}

export function applyTheme(theme: ResolvedTheme, documentRoot: Document = document) {
  documentRoot.documentElement.dataset.theme = theme;
  documentRoot.documentElement.style.colorScheme = theme;
  documentRoot.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

export function persistThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = window.localStorage,
) {
  try {
    if (preference === 'system') storage.removeItem(THEME_STORAGE_KEY);
    else storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Theme selection still applies for this session when storage is unavailable.
  }
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(resolveSystemTheme);
  const resolvedTheme = preference === 'system' ? systemTheme : preference;

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (preference !== 'system') return;
    const media = window.matchMedia(THEME_QUERY);
    const update = () => setSystemTheme(media.matches ? 'dark' : 'light');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    persistThemePreference(next);
    setPreferenceState(next);
  }, []);

  return { preference, resolvedTheme, setPreference };
}
