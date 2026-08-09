import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TracePanel, type TraceResult } from '../dashboard/TracePanel.js';

const trace: TraceResult = {
  id: 'session-123', source: 'explicit', selected_capture_id: 'capture-two', truncated: false,
  calls: [{
    capture_id: 'capture-two', timestamp: '2026-08-09T00:00:00.000Z', model: 'demo-model', upstream_host: 'api.example.com', response_status: 200,
    input_relation: 'append',
    input_delta: [{ role: 'user', content: [
      { type: 'text', text: 'Fix the endpoint' },
      { type: 'tool_result', tool_call_id: 'tool-1', content: { result: 'ok' }, is_error: false },
    ] }],
    output: {
      adapter_id: 'anthropic', id: 'msg', model: 'demo-model', role: 'assistant', stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 },
      content: [{ type: 'reasoning', text: 'check tests' }, { type: 'text', text: 'Done' }, { type: 'tool_call', id: 'tool-2', name: 'bash', input: { command: 'pnpm test' } }],
    },
  }],
};

describe('TracePanel', () => {
  it('renders the agent timeline with compact defaults and capture navigation', async () => {
    const selectCapture = vi.fn();
    const { container } = render(<TracePanel trace={trace} loading={false} error={null} refreshError={null} onRetry={vi.fn()} selectCapture={selectCapture} />);
    expect(screen.getByText('Explicit')).toBeVisible();
    expect(screen.getByText('HTTP 200')).toHaveClass('trace-http--good');
    expect(screen.getByText('Fix the endpoint')).toBeVisible();
    expect(screen.getByText('Done')).toBeVisible();
    const summary = container.querySelector('.trace-usage')!;
    expect(summary).toHaveTextContent('Input total35');
    expect(summary).toHaveTextContent('Output2');
    expect(summary).toHaveTextContent('Cache read20');
    expect(summary).toHaveTextContent('Cache write5');
    expect(summary).toHaveTextContent('Cache hit57%');
    expect(screen.getByRole('button', { name: /^User$/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Thinking$/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Tool result/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Tool call/ })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(screen.getByRole('button', { name: /Select request capture-two/ }));
    expect(selectCapture).toHaveBeenCalledWith('capture-two');
  });

  it('keeps stale trace visible when a background refresh fails', () => {
    render(<TracePanel trace={trace} loading={false} error={null} refreshError="network down" onRetry={vi.fn()} selectCapture={vi.fn()} />);
    expect(screen.getByText(/Refresh failed: network down/)).toBeVisible();
    expect(screen.getByText('Done')).toBeVisible();
  });

  it('places inferred trace guidance behind an accessible help tooltip', async () => {
    render(<TracePanel trace={{ ...trace, source: 'inferred' }} loading={false} error={null} refreshError={null} onRetry={vi.fn()} selectCapture={vi.fn()} />);
    const help = screen.getByRole('button', { name: 'About inferred traces' });
    expect(help).toBeVisible();
    await userEvent.hover(help);
    expect(await screen.findByText('x-prompt-prism-trace-id')).toBeVisible();
    expect(screen.getByText('Calls')).toBeVisible();
    expect(screen.queryByText(/newest first/i)).not.toBeInTheDocument();
  });

  it('shows the newest model call first without changing event order inside a call', () => {
    const older = { ...trace.calls[0]!, capture_id: 'older-call', timestamp: '2026-08-09T00:00:00.000Z' };
    const newer = { ...trace.calls[0]!, capture_id: 'newer-call', timestamp: '2026-08-09T00:00:01.000Z' };
    const { container } = render(<TracePanel trace={{ ...trace, calls: [older, newer] }} loading={false} error={null} refreshError={null} onRetry={vi.fn()} selectCapture={vi.fn()} />);
    expect([...container.querySelectorAll('.trace-call-index')].map((node) => node.textContent)).toEqual(['newer-ca', 'older-ca']);
    const newestEvents = container.querySelector('.trace-call .trace-events');
    expect([...newestEvents!.querySelectorAll('.trace-event-toggle strong')].map((node) => node.textContent)).toEqual(['User', 'Tool result', 'Thinking', 'Assistant text', 'Tool call']);
  });

  it('does not invent token or cache values when the provider omits usage', () => {
    const call = trace.calls[0]!;
    const withoutUsage = { ...call, output: call.output ? { ...call.output, usage: {} } : null };
    const { container } = render(<TracePanel trace={{ ...trace, calls: [withoutUsage] }} loading={false} error={null} refreshError={null} onRetry={vi.fn()} selectCapture={vi.fn()} />);
    expect([...container.querySelectorAll('.trace-usage dd')].map((node) => node.textContent)).toEqual(['—', '—', '—', '—', '—']);
    expect(container.querySelector('.trace-call-usage')).toBeNull();
  });
});
