import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ToolsPanel } from '../dashboard/ToolsPanel.js';

describe('ToolsPanel', () => {
  it('keeps collapsed tool cards at their content height', async () => {
    const css = await readFile(path.resolve('src/tools/dashboard/styles.css'), 'utf8');
    expect(css).toMatch(/\.tools-content\s*\{[^}]*align-content:\s*start;/);
  });

  it('renders Anthropic and OpenAI tool cards', async () => {
    const { container } = render(<ToolsPanel data={{ id: 'abc', tools: [
      { name: 'read', description: 'Read files', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
      { type: 'function', function: { name: 'bash', description: 'Run commands', parameters: { type: 'object' } } },
    ], used_tools: [{ name: 'read', calls: 2, invocations: [
      { tool_call_id: 'call-read-1', index: 0, input: { path: 'a.ts' } },
      { tool_call_id: 'call-read-2', index: 1, input: { path: 'b.ts' } },
    ] }] }} loading={false} error={null} onRetry={vi.fn()} />);

    expect(screen.getByText('Total tools')).toBeVisible();
    expect(screen.getByText('2')).toBeVisible();
    expect(screen.getByText('Called')).toBeVisible();
    expect(screen.getByText('read × 2')).toBeVisible();
    await userEvent.click(screen.getByText('read × 2'));
    expect(screen.getByRole('link', { name: 'Call 1 →' })).toHaveAttribute('href', expect.stringContaining('tool_call_id=call-read-1'));
    expect(screen.getByRole('link', { name: 'Call 2 →' })).toHaveAttribute('href', expect.stringContaining('tool_call_id=call-read-2'));
    const read = screen.getByRole('button', { name: 'read' });
    const bash = screen.getByRole('button', { name: 'bash' });
    expect(read).toHaveClass('detail-sticky-header');
    expect(bash).toHaveClass('detail-sticky-header');
    expect(read).toHaveAttribute('aria-expanded', 'false');
    expect(bash).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Read files')).not.toBeInTheDocument();
    expect(screen.queryByText('Run commands')).not.toBeInTheDocument();

    await userEvent.click(read);
    expect(read).toHaveAttribute('aria-expanded', 'true');
    expect(bash).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Read files')).toBeVisible();
    expect(screen.getByText('Description')).toBeVisible();
    expect(screen.getByText('Parameters')).toBeVisible();
    expect(screen.getAllByText('path').length).toBeGreaterThan(0);
    expect(screen.getByText('optional')).toBeVisible();
    expect(screen.getAllByText('Schema')).toHaveLength(2);
    expect([...container.querySelectorAll('.tools-schema')].every((schema) => !schema.hasAttribute('open'))).toBe(true);
  });

  it('links a single called tool to Trace and keeps modified clicks native', async () => {
    const selectCapture = vi.fn();
    render(<ToolsPanel data={{ id: 'abc', tools: [{ name: 'bash' }], used_tools: [{ name: 'bash', calls: 1, invocations: [{ tool_call_id: 'call-bash', index: 0, input: { command: 'pwd' } }] }] }} loading={false} error={null} onRetry={vi.fn()} selectCapture={selectCapture} />);
    const link = screen.getByRole('link', { name: 'bash × 1' });
    expect(link).toHaveAttribute('href', expect.stringContaining('capture=abc'));
    expect(link).toHaveAttribute('href', expect.stringContaining('tab=trace'));
    expect(link).toHaveAttribute('href', expect.stringContaining('tool_call_id=call-bash'));
    await userEvent.click(link);
    expect(selectCapture).toHaveBeenCalledWith('abc', 'trace');
    selectCapture.mockClear();
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'] as const) {
      fireEvent.click(link, { [modifier]: true });
      expect(selectCapture).not.toHaveBeenCalled();
    }
  });

  it('shows an empty state when no tools are provided', () => {
    render(<ToolsPanel data={{ id: 'abc', tools: [], used_tools: [] }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('(no tools provided)')).toBeVisible();
    expect(screen.getByText('(no tools called)')).toBeVisible();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('keeps unknown tool definitions as raw JSON', async () => {
    render(<ToolsPanel data={{ id: 'abc', tools: [{ vendor_tool: true, config: { mode: 'safe' } }], used_tools: [] }} loading={false} error={null} onRetry={vi.fn()} />);
    const unnamed = screen.getByRole('button', { name: 'Unnamed tool' });
    expect(unnamed).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(unnamed);
    expect(screen.getByText('Raw tool definition')).toBeVisible();
    expect(screen.getByLabelText('Tool 1 parameter schema')).toBeVisible();
  });

  it('supports retryable errors', async () => {
    const retry = vi.fn();
    render(<ToolsPanel data={null} loading={false} error="network failed" onRetry={retry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
