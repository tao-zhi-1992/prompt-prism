import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@prompt-prism/plugins/dashboard';
import { SettingsMenu } from './SettingsMenu';

describe('SettingsMenu', () => {
  function renderMenu(onPreferenceChange = vi.fn(), onLocaleChange = vi.fn()) {
    render(
      <I18nProvider initialLocale="en">
        <SettingsMenu preference="system" onPreferenceChange={onPreferenceChange} locale="en" onLocaleChange={onLocaleChange} />
      </I18nProvider>,
    );
    return { onPreferenceChange, onLocaleChange };
  }

  it('groups theme and language preferences behind one accessible button', async () => {
    const onPreferenceChange = vi.fn();
    const onLocaleChange = vi.fn();
    const user = userEvent.setup();
    renderMenu(onPreferenceChange, onLocaleChange);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('menuitemradio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /English/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(onPreferenceChange).toHaveBeenCalledWith('dark');
  });

  it('changes language from the same menu', async () => {
    const { onLocaleChange } = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /中文/ }));
    expect(onLocaleChange).toHaveBeenCalledWith('zh-CN');
  });
});
