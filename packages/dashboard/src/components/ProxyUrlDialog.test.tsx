import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@prompt-prism/plugins/dashboard';
import { ProxyUrlDialog } from './ProxyUrlDialog';

afterEach(() => vi.unstubAllGlobals());

describe('ProxyUrlDialog', () => {
  it('generates and copies a validated proxy URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ path: '/_proxy/encoded' }), { status: 200 }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<I18nProvider><ProxyUrlDialog /></I18nProvider>);

    await userEvent.click(screen.getByRole('button', { name: 'Proxy URL' }));
    await userEvent.type(screen.getByLabelText('Upstream URL or Base URL'), 'https://provider.example.com/v1');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));

    const result = await screen.findByLabelText('Proxy Base URL');
    expect(result).toHaveValue(`${window.location.origin}/_proxy/encoded`);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/_proxy/encoded`);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
  });

  it('shows server validation failures without producing a URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Upstream Base URL must not contain a query' }), { status: 400 })));
    render(<I18nProvider><ProxyUrlDialog /></I18nProvider>);

    await userEvent.click(screen.getByRole('button', { name: 'Proxy URL' }));
    await userEvent.type(screen.getByLabelText('Upstream URL or Base URL'), 'https://provider.example.com/v1?key=value');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid HTTP(S) provider URL');
    expect(screen.queryByLabelText('Proxy Base URL')).not.toBeInTheDocument();
  });
});
