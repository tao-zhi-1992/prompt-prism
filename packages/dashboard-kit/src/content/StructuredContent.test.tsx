import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { detectStructuredContent, StructuredContent } from './StructuredContent.js';

describe('StructuredContent', () => {
  it('conservatively detects structured values', () => {
    expect(detectStructuredContent({ value: true }).kind).toBe('json');
    expect(detectStructuredContent('{"value":true}').kind).toBe('json');
    expect(detectStructuredContent('# Heading\n\n- item').kind).toBe('markdown');
    expect(detectStructuredContent('const answer = 42;').kind).toBe('code');
    expect(detectStructuredContent('A normal sentence with * one character.').kind).toBe('text');
    expect(detectStructuredContent('plain', { contentType: 'application/problem+json' }).kind).toBe('json');
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
});
