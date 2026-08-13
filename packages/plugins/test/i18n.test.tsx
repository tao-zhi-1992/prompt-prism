import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { I18nProvider, LOCALE_STORAGE_KEY, resolveLocale, useI18n } from '@prompt-prism/dashboard-kit';

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
});
