import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OutputPanel, type OutputCapture } from '../dashboard/OutputPanel.js';

const result: OutputCapture = {
  output: {
    adapter_id: 'anthropic', id: 'msg_1', model: 'demo-model', role: 'assistant', stop_reason: 'tool_use',
    usage: { input_tokens: 12, output_tokens: 4, cache_read_input_tokens: 8 },
    content: [
      { type: 'reasoning', text: 'private inspection' },
      { type: 'text', text: '<img src=x onerror=alert(1)>\nplain output' },
      { type: 'tool_call', id: 'tool_1', name: 'read', input: { path: 'src/a.ts', options: { lines: 20 } } },
      { type: 'unknown', provider_type: 'citation', value: { url: 'https://example.com' } },
      { type: 'unknown', provider_type: 'openai_delta_fields', value: [{ vendor_field: true }] },
    ],
  },
};

describe('OutputPanel', () => {
  it('shows exact text, raw usage, and expandable output blocks safely', async () => {
    const user = userEvent.setup();
    const { container } = render(<OutputPanel result={result} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('tool_use')).toBeVisible();
    expect(screen.getByText('12')).toBeVisible();
    expect(screen.getByText('4')).toBeVisible();
    expect(screen.getByText('8')).toBeVisible();
    expect(screen.getByText('—')).toBeVisible();
    expect(screen.getByText(/<img src=x/)).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
    expect([...container.querySelectorAll('.output-block-toggle > strong')].map((node) => node.textContent)).toEqual(['Text', 'Thinking', 'Unknown block']);
    expect(screen.queryByText('openai_delta_fields')).not.toBeInTheDocument();

    const textBlock = screen.getByRole('button', { name: /^Text$/ });
    expect(textBlock).toHaveAttribute('aria-expanded', 'true');
    await user.click(textBlock);
    expect(textBlock).toHaveAttribute('aria-expanded', 'false');

    const thinking = screen.getByRole('button', { name: /Thinking/ });
    expect(thinking).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('private inspection')).toBeVisible();
    await user.click(thinking);
    expect(thinking).toHaveAttribute('aria-expanded', 'false');

    expect(screen.getByText('read')).toBeVisible();
    expect(screen.getByRole('tree', { name: 'read tool arguments' })).toBeVisible();
    expect(screen.getAllByLabelText('Collapse JSON node').length).toBeGreaterThan(0);

    const unknown = screen.getByRole('button', { name: /Unknown block/ });
    expect(unknown).toHaveAttribute('aria-expanded', 'false');
    await user.click(unknown);
    expect(screen.getByRole('tree', { name: 'citation provider block' })).toBeVisible();
  });

  it('shows provider errors, invalid tool JSON, empty and unavailable states', () => {
    const { rerender } = render(<OutputPanel result={{ output: {
      adapter_id: 'anthropic', id: null, model: null, role: null, stop_reason: null, usage: {}, content: [],
      error: { type: 'authentication_error', message: 'bad key' },
    } }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('authentication_error')).toBeVisible();
    expect(screen.getByText('bad key')).toBeVisible();

    rerender(<OutputPanel result={{ output: {
      adapter_id: 'anthropic', id: null, model: null, role: 'assistant', stop_reason: null, usage: {},
      content: [{ type: 'tool_call', id: null, name: 'write', input: null, input_raw: '{bad' }],
    } }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('Invalid JSON arguments')).toBeVisible();
    expect(screen.getByText('{bad')).toBeVisible();

    rerender(<OutputPanel result={{ output: null }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('Output unavailable')).toBeVisible();
  });

  it('retries load failures', async () => {
    const retry = vi.fn();
    render(<OutputPanel result={null} loading={false} error="network failed" onRetry={retry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
