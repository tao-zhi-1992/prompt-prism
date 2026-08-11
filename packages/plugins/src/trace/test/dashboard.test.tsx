import { fireEvent, render, screen } from '@testing-library/react';
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
      content: [{ type: 'reasoning', text: 'check tests' }, { type: 'text', text: 'Done' }, { type: 'tool_call', id: 'tool-2', name: 'bash', input: { command: 'pnpm test' } }, { type: 'unknown', provider_type: 'openai_delta_fields', value: [{ vendor_field: true }] }],
    },
  }],
};

describe('TracePanel', () => {
  it('renders the agent timeline with compact defaults and capture navigation', async () => {
    const selectCapture = vi.fn();
    const { container } = render(<TracePanel trace={trace} loading={false} error={null} refreshError={null} onRetry={vi.fn()} selectCapture={selectCapture} />);
    expect(screen.getByText('Explicit')).toBeVisible();
    expect(screen.getByText('HTTP 200')).toHaveClass('trace-http--good');
    expect(screen.queryByText('Fix the endpoint')).not.toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown output')).not.toBeInTheDocument();
    const summary = container.querySelector('.trace-usage')!;
    expect(summary).toHaveTextContent('Input total35');
    expect(summary).toHaveTextContent('Output2');
    expect(summary).toHaveTextContent('Cache read20');
    expect(summary).toHaveTextContent('Cache write5');
    expect(summary).toHaveTextContent('Cache hit57%');
    expect(screen.getByRole('button', { name: /^User$/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^Thinking$/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Tool result/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Tool call/ })).toHaveAttribute('aria-expanded', 'false');
    const icons = [...container.querySelectorAll('.trace-event-icon')];
    expect(icons).toHaveLength(5);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
    expect(screen.getByRole('button', { name: /^User$/ })).toHaveAccessibleName('User');
    expect([...container.querySelectorAll('.trace-event-toggle')].every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByText('Fix the endpoint')).toBeVisible();
    expect(screen.getByText('Done')).toBeVisible();
    expect([...container.querySelectorAll('.trace-event-toggle')].every((button) => button.getAttribute('aria-expanded') === 'true')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByText('Fix the endpoint')).not.toBeInTheDocument();
    expect([...container.querySelectorAll('.trace-event-toggle')].every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(container.querySelector('.trace-tool-result-link--missing')).toHaveTextContent('tool-1');
    expect(screen.getByText('tool call not found')).toBeVisible();
    const captureLink = screen.getByRole('link', { name: /Select request capture-two/ });
    expect(captureLink).toHaveAttribute('href', expect.stringContaining('capture=capture-two'));
    await userEvent.click(captureLink);
    expect(selectCapture).toHaveBeenCalledWith('capture-two');
    selectCapture.mockClear();
    const preventNativeNavigation = (event: MouseEvent) => event.preventDefault();
    captureLink.addEventListener('click', preventNativeNavigation);
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'] as const) {
      fireEvent.click(captureLink, { [modifier]: true });
      expect(selectCapture).not.toHaveBeenCalled();
    }
    captureLink.removeEventListener('click', preventNativeNavigation);
  });

  it('keeps tool result error styling alongside its message kind', () => {
    const call = trace.calls[0]!;
    const input_delta = [{ ...call.input_delta[0]!, content: [{ type: 'tool_result' as const, tool_call_id: 'tool-error', content: { message: 'failed' }, is_error: true }] }];
    const { container } = render(<TracePanel trace={{ ...trace, calls: [{ ...call, input_delta, output: null }] }} loading={false} error={null} refreshError={null} onRetry={vi.fn()} selectCapture={vi.fn()} />);
    const event = container.querySelector('.trace-event--error');
    expect(event).toHaveClass('trace-event--error');
    expect(event!.querySelector('.trace-event-icon')).toHaveAttribute('aria-hidden', 'true');
  });

  it('links a tool result across trace calls and highlights the matching tool call', async () => {
    const first = {
      ...trace.calls[0]!,
      capture_id: 'capture-one',
      input_delta: [],
      output: { ...trace.calls[0]!.output!, content: [{ type: 'tool_call' as const, id: 'tool-linked', name: 'read_file', input: { path: 'README.md' } }] },
    };
    const second = {
      ...trace.calls[0]!,
      capture_id: 'capture-two',
      input_delta: [{ role: 'user', content: [{ type: 'tool_result' as const, tool_call_id: 'tool-linked', content: { text: 'done' }, is_error: false }] }],
      output: null,
    };
    const { container } = render(<TracePanel trace={{ ...trace, calls: [first, second] }} loading={false} error={null} refreshError={null} onRetry={vi.fn()} selectCapture={vi.fn()} />);
    const link = container.querySelector('.trace-tool-result-link') as HTMLAnchorElement;
    const target = container.querySelector('#trace-tool-call-0-output-0') as HTMLElement;
    const resultLink = target.querySelector('.trace-tool-result-link') as HTMLAnchorElement;

    expect(link).toHaveTextContent('read_file');
    expect(link).toHaveAttribute('href', '#trace-tool-call-0-output-0');
    expect(link.closest('.trace-event-title')).not.toBeNull();
    expect(resultLink).toHaveTextContent('result →');
    expect(resultLink).toHaveAttribute('href', '#trace-tool-call-1-input-0-0');
    await userEvent.click(resultLink);
    expect(container.querySelector('#trace-tool-call-1-input-0-0')).toHaveAttribute('data-tool-highlight');
  });

  it('keeps stale trace visible when a background refresh fails', () => {
    render(<TracePanel trace={trace} loading={false} error={null} refreshError="network down" onRetry={vi.fn()} selectCapture={vi.fn()} />);
    expect(screen.getByText(/Refresh failed: network down/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeVisible();
  });

  it('keeps batch expansion scoped to one call', async () => {
    const first = { ...trace.calls[0]!, capture_id: 'capture-one' };
    const second = { ...trace.calls[0]!, capture_id: 'capture-two' };
    const { container } = render(<TracePanel trace={{ ...trace, calls: [first, second] }} loading={false} error={null} refreshError={null} onRetry={vi.fn()} selectCapture={vi.fn()} />);
    const calls = container.querySelectorAll('.trace-call');
    const expandButtons = screen.getAllByRole('button', { name: 'Expand all' });
    await userEvent.click(expandButtons[0]!);
    expect([...calls[0]!.querySelectorAll('.trace-event-toggle')].every((button) => button.getAttribute('aria-expanded') === 'true')).toBe(true);
    expect([...calls[1]!.querySelectorAll('.trace-event-toggle')].every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true);
    await userEvent.click(screen.getAllByRole('button', { name: 'Collapse all' })[0]!);
    expect([...calls[0]!.querySelectorAll('.trace-event-toggle')].every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true);
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
    expect(newestEvents!.querySelector('.trace-tool-name')).toHaveTextContent('bash');
  });

  it('does not invent token or cache values when the provider omits usage', () => {
    const call = trace.calls[0]!;
    const withoutUsage = { ...call, output: call.output ? { ...call.output, usage: {} } : null };
    const { container } = render(<TracePanel trace={{ ...trace, calls: [withoutUsage] }} loading={false} error={null} refreshError={null} onRetry={vi.fn()} selectCapture={vi.fn()} />);
    expect([...container.querySelectorAll('.trace-usage dd')].map((node) => node.textContent)).toEqual(['—', '—', '—', '—', '—']);
    expect(container.querySelector('.trace-call-usage')).toBeNull();
  });

  it('shows malformed OpenAI conversation tool arguments as raw text', async () => {
    const call = trace.calls[0]!;
    const input_delta = [{ role: 'assistant', content: [{ type: 'tool_call' as const, id: 'call-bad', name: 'write', input: null, input_raw: '{bad' }] }];
    render(<TracePanel trace={{ ...trace, calls: [{ ...call, input_delta, output: null }] }} loading={false} error={null} refreshError={null} onRetry={vi.fn()} selectCapture={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: /Tool call.*write/i });
    expect(screen.getByText(/invalid JSON/i)).toBeVisible();
    await userEvent.click(toggle);
    expect(screen.getByText('{bad')).toBeVisible();
  });
});
