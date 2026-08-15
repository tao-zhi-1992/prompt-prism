import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContentCopyButton, detectStructuredContent, StructuredContent } from './StructuredContent.js';

describe('StructuredContent', () => {
  it('conservatively detects structured values', () => {
    expect(detectStructuredContent({ value: true }).kind).toBe('json');
    expect(detectStructuredContent('{"value":true}').kind).toBe('json');
    expect(detectStructuredContent('# Heading\n\n- item').kind).toBe('markdown');
    expect(detectStructuredContent('const answer = 42;').kind).toBe('code');
    expect(detectStructuredContent('A normal sentence with * one character.').kind).toBe('text');
    expect(detectStructuredContent('plain', { contentType: 'application/problem+json' }).kind).toBe('json');
  });

  it('honors explicit hints and recognizes common content types and languages', () => {
    expect(detectStructuredContent('plain', { mode: 'json', language: 'json' })).toEqual({ kind: 'json', language: 'json' });
    expect(detectStructuredContent('plain', { mode: 'markdown' }).kind).toBe('markdown');
    expect(detectStructuredContent('plain', { mode: 'code', language: 'rust' })).toEqual({ kind: 'code', language: 'rust' });
    expect(detectStructuredContent('plain', { mode: 'text' }).kind).toBe('text');
    expect(detectStructuredContent('plain', { contentType: 'text/x-markdown; charset=utf-8' }).kind).toBe('markdown');
    expect(detectStructuredContent('plain', { contentType: 'application/vnd.example+json' }).kind).toBe('json');
    expect(detectStructuredContent('plain', { contentType: 'text/x-custom' }).kind).toBe('code');
    expect(detectStructuredContent('plain', { contentType: 'text/plain' }).kind).toBe('text');
    expect(detectStructuredContent('plain', { contentType: 'application/octet-stream' }).kind).toBe('text');
    expect(detectStructuredContent('~~~md\nvalue\n~~~').kind).toBe('markdown');
    expect(detectStructuredContent('1. ordered').kind).toBe('markdown');
    expect(detectStructuredContent('> quote').kind).toBe('markdown');
    expect(detectStructuredContent('| a | b |\n| --- | --- |').kind).toBe('markdown');
    expect(detectStructuredContent('- [x] done').kind).toBe('markdown');
    expect(detectStructuredContent('import value from "module";').language).toBe('javascript');
    expect(detectStructuredContent('const value = 1;').language).toBe('javascript');
    expect(detectStructuredContent('const fn = () => ({ ok: true });').language).toBe('javascript');
    expect(detectStructuredContent('def answer():\n').language).toBe('python');
    expect(detectStructuredContent('#!/usr/bin/env bash').language).toBe('bash');
    expect(detectStructuredContent('VALUE=1').language).toBe('bash');
    expect(detectStructuredContent('if true').language).toBe('bash');
    expect(detectStructuredContent('interface Result { ok: boolean }').language).toBe('typescript');
    expect(detectStructuredContent('.item { color: green; }').language).toBe('css');
    expect(detectStructuredContent(null).kind).toBe('text');
    expect(detectStructuredContent(42).kind).toBe('text');
    expect(detectStructuredContent('not { valid json').kind).toBe('text');
  });

  it('renders markdown safely, exposes source, and copies the original value', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const markdown = '# Result\n\n[unsafe](https://example.com)\n\n![remote](https://example.com/a.png)\n\n<script>alert(1)</script>\n\n```js\nconst ok = true;\n```';
    const { container } = render(<StructuredContent value={markdown} />);
    expect(screen.getByRole('heading', { name: 'Result' })).toBeVisible();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('.hljs-keyword')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(screen.getByText(/# Result/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(markdown);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
  });

  it('highlights clear standalone code and preserves ambiguous prose as text', () => {
    const { container, rerender } = render(<StructuredContent value="const answer = 42;" />);
    expect(container.querySelector('[data-content-kind="code"]')).toBeVisible();
    expect(container.querySelector('.hljs-keyword')).toHaveTextContent('const');
    rerender(<StructuredContent value="Use const when a value should not change." />);
    expect(container.querySelector('[data-content-kind="text"]')).toBeVisible();
  });

  it('copies JSON strings as complete formatted JSON', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<StructuredContent value='{"nested":{"ok":true}}' />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('{\n  "nested": {\n    "ok": true\n  }\n}');
  });

  it('renders explicit modes, empty fallbacks, and copy failures', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));
    Object.assign(navigator, { clipboard: { writeText } });
    const { rerender } = render(<StructuredContent value="not-json" mode="json" ariaLabel="JSON value" />);
    expect(screen.getByLabelText('JSON value')).toHaveTextContent('not-json');
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeVisible();

    rerender(<StructuredContent value={{ ok: true }} mode="json" />);
    expect(document.querySelector('[data-content-kind="json"]')).toBeVisible();
    rerender(<StructuredContent value="plain text" mode="text" allowSourceToggle={false} />);
    expect(document.querySelector('[data-content-kind="text"]')).toBeVisible();
    rerender(<StructuredContent value="const answer = 42;" mode="code" language="javascript" />);
    expect(document.querySelector('[data-content-kind="code"]')).toBeVisible();
    rerender(<StructuredContent value="" emptyFallback={<span>Nothing here</span>} />);
    expect(screen.getByText('Nothing here')).toBeVisible();
    rerender(<StructuredContent value={null} />);
    expect(document.querySelector('.structured-text')).toHaveTextContent('');
  });

  it('copies scalar and object values through the shared button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { rerender } = render(<StructuredContent value={{ count: 1 }} mode="text" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenLastCalledWith('{\n  "count": 1\n}');
    rerender(<StructuredContent value={false} mode="text" />);
    await userEvent.click(screen.getByRole('button', { name: /Copy|Copied/ }));
    expect(writeText).toHaveBeenLastCalledWith('false');
    rerender(<StructuredContent value="{invalid" mode="json" />);
    await userEvent.click(screen.getByRole('button', { name: /Copy|Copied/ }));
    expect(writeText).toHaveBeenLastCalledWith('"{invalid"');
  });
});
