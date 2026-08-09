import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeMenu } from './ThemeMenu';

describe('ThemeMenu', () => {
  it('shows the active preference and changes it from an accessible radio menu', async () => {
    const user = userEvent.setup();
    const onPreferenceChange = vi.fn();
    render(<ThemeMenu preference="system" onPreferenceChange={onPreferenceChange} />);

    const trigger = screen.getByRole('button', { name: 'Theme: System' });
    await user.click(trigger);

    expect(await screen.findByRole('menuitemradio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(onPreferenceChange).toHaveBeenCalledWith('dark');
  });
});
