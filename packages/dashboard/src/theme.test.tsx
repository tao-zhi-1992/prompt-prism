import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  persistThemePreference,
  readThemePreference,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  useTheme,
} from './theme';

class MatchMediaMock {
  matches: boolean;
  media = '(prefers-color-scheme: dark)';
  onchange = null;
  private listeners = new Set<() => void>();

  constructor(matches: boolean) { this.matches = matches; }
  addEventListener(_type: string, listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: () => void) { this.listeners.delete(listener); }
  addListener(listener: () => void) { this.listeners.add(listener); }
  removeListener(listener: () => void) { this.listeners.delete(listener); }
  dispatchEvent() { return true; }
  setMatches(matches: boolean) {
    this.matches = matches;
    this.listeners.forEach((listener) => listener());
  }
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
  vi.unstubAllGlobals();
});

describe('theme state', () => {
  it('defaults missing, invalid, and unreadable storage to system', () => {
    expect(readThemePreference()).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readThemePreference()).toBe('system');
    expect(readThemePreference({ getItem: () => { throw new Error('blocked'); } })).toBe('system');
  });

  it('stores explicit themes and removes the value for system', () => {
    persistThemePreference('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    persistThemePreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    persistThemePreference('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('applies the resolved theme to the document and browser metadata', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
    applyTheme('light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', THEME_COLORS.light);
    meta.remove();
  });

  it('follows system changes until an explicit theme is selected', () => {
    const media = new MatchMediaMock(false);
    vi.stubGlobal('matchMedia', () => media as unknown as MediaQueryList);
    const { result } = renderHook(() => useTheme());

    expect(result.current.preference).toBe('system');
    expect(result.current.resolvedTheme).toBe('light');

    act(() => media.setMatches(true));
    expect(result.current.resolvedTheme).toBe('dark');

    act(() => result.current.setPreference('light'));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    act(() => media.setMatches(false));
    act(() => media.setMatches(true));
    expect(result.current.resolvedTheme).toBe('light');

    act(() => result.current.setPreference('system'));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(result.current.resolvedTheme).toBe('dark');
  });
});
