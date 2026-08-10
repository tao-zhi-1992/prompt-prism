import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  afterEach(cleanup);

  it('uses the default variant and button type', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('ui-button', 'ui-button--default');
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('supports danger, icon, disabled, and custom classes', () => {
    render(<Button variant="danger" className="extra" disabled>Clear</Button>);
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveClass('ui-button--danger', 'extra');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('supports the icon variant and keyboard focus', async () => {
    const user = userEvent.setup();
    render(<Button variant="icon" aria-label="Settings">⚙</Button>);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button).toHaveClass('ui-button--icon');
    await user.tab();
    expect(button).toHaveFocus();
  });
});
