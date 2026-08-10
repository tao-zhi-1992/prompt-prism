import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SystemPromptPanel } from '../dashboard/SystemPromptPanel.js';

describe('SystemPromptPanel', () => {
  it('renders a plain string system prompt', () => {
    render(<SystemPromptPanel data={{ id: 'abc', system: 'You are a helpful assistant.' }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('You are a helpful assistant.')).toBeVisible();
  });

  it('renders anthropic content blocks', () => {
    render(<SystemPromptPanel data={{ id: 'abc', system: [{ type: 'text', text: 'Be concise.' }] }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('Be concise.')).toBeVisible();
  });

  it('renders openai system/developer messages with role labels', () => {
    render(<SystemPromptPanel data={{ id: 'abc', system: [{ role: 'developer', content: 'Follow the schema.' }] }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('developer')).toBeVisible();
    expect(screen.getByText('Follow the schema.')).toBeVisible();
  });

  it('shows the not-set empty state', () => {
    render(<SystemPromptPanel data={{ id: 'abc', system: null }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('(no system prompt set)')).toBeVisible();
  });

  it('shows retryable errors', async () => {
    const retry = vi.fn();
    render(<SystemPromptPanel data={null} loading={false} error="network failed" onRetry={retry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
