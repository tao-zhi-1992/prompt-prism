import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { I18nProvider, LOCALE_STORAGE_KEY, resolveLocale, useI18n } from './index.js';

afterEach(() => {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  document.documentElement.lang = '';
});

describe('Dashboard i18n', () => {
  it('uses a stored locale before the browser locale and recognizes Chinese variants', () => {
    expect(resolveLocale('en', ['zh-CN'])).toBe('en');
    expect(resolveLocale(null, ['zh-Hant-TW', 'en'])).toBe('zh-CN');
    expect(resolveLocale('invalid', ['fr-FR'])).toBe('en');
  });

  it('translates, interpolates, persists, and updates the document language', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider initialLocale="en">{children}</I18nProvider>;
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t('diff.comparedWith', { id: 'abcd1234' })).toBe('Compared with abcd1234');
    act(() => result.current.setLocale('zh-CN'));
    expect(result.current.t('tab.input-diff')).toBe('输入差异');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('initializes from stored and browser locales when no locale is provided', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-CN');
    const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.locale).toBe('zh-CN');
    expect(result.current.t('requests.title')).toBe('请求');
  });

  it('falls back to the browser language and tolerates unavailable storage', () => {
    const originalStorage = window.localStorage;
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    const originalLanguages = navigator.languages;
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['zh-TW'] });
    const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.locale).toBe('zh-CN');
    act(() => result.current.setLocale('en'));
    expect(result.current.locale).toBe('en');
    Object.defineProperty(window, 'localStorage', { configurable: true, value: originalStorage });
    Object.defineProperty(navigator, 'languages', { configurable: true, value: originalLanguages });
  });

  it('uses the default language when browser language data is unavailable', () => {
    const originalLanguages = navigator.languages;
    Object.defineProperty(navigator, 'languages', { configurable: true, value: undefined });
    const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.locale).toBe('en');
    Object.defineProperty(navigator, 'languages', { configurable: true, value: originalLanguages });
  });
});
