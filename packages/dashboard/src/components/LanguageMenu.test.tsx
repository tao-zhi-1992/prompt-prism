import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@prompt-prism/plugins/dashboard';
import { LanguageMenu } from './LanguageMenu';

describe('LanguageMenu', () => {
  it('shows the current language and emits an accessible language selection', async () => {
    const onLocaleChange = vi.fn();
    render(<I18nProvider initialLocale="en"><LanguageMenu locale="en" onLocaleChange={onLocaleChange} /></I18nProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    expect(await screen.findByRole('menuitemradio', { name: /English/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('menuitemradio', { name: /中文/ }));
    expect(onLocaleChange).toHaveBeenCalledWith('zh-CN');
  });
});
