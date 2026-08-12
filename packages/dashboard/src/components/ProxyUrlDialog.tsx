import { useState, type FormEvent } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '@prompt-prism/ui';
import { useI18n } from '@prompt-prism/plugins/dashboard';
import { generateProxyUrl } from '../api';

function LinkIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.2 11.8 11.8 8.2M7 13l-1 1a3 3 0 0 1-4.2-4.2l3-3A3 3 0 0 1 9 6.7M13 7l1-1a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2.1" /></svg>;
}

export function ProxyUrlDialog() {
  const { t } = useI18n();
  const [upstream, setUpstream] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setUpstream('');
    setResult('');
    setError('');
    setBusy(false);
    setCopied(false);
  };

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setCopied(false);
    try { setResult(await generateProxyUrl(upstream)); }
    catch (value) {
      const message = value instanceof Error ? value.message : String(value);
      setResult('');
      setError(message.includes('disabled for non-loopback') ? t('proxyUrl.remoteDisabled') : t('proxyUrl.invalid'));
    }
    finally { setBusy(false); }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setError('');
    } catch { setError(t('proxyUrl.copyFailed')); }
  };

  return (
    <Dialog.Root onOpenChange={(open) => { if (!open) reset(); }}>
      <Dialog.Trigger className="proxy-url-trigger ui-interactive" title={t('proxyUrl.trigger')}>
        <LinkIcon /><span>{t('proxyUrl.trigger')}</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="proxy-url-backdrop" />
        <Dialog.Viewport className="proxy-url-viewport">
          <Dialog.Popup className="proxy-url-dialog">
            <Dialog.Title className="proxy-url-title">{t('proxyUrl.title')}</Dialog.Title>
            <Dialog.Description className="proxy-url-description">{t('proxyUrl.description')}</Dialog.Description>
            <form onSubmit={(event) => { void generate(event); }}>
              <label className="proxy-url-label" htmlFor="proxy-upstream-url">{t('proxyUrl.upstreamLabel')}</label>
              <input
                id="proxy-upstream-url"
                className="proxy-url-input"
                type="url"
                required
                value={upstream}
                placeholder="https://api.example.com/v1"
                onChange={(event) => { setUpstream(event.target.value); setResult(''); setError(''); setCopied(false); }}
              />
              {error && <p className="proxy-url-error" role="alert">{error}</p>}
              {result && <div className="proxy-url-result"><label htmlFor="proxy-generated-url">{t('proxyUrl.resultLabel')}</label><div><input id="proxy-generated-url" readOnly value={result} /><Button onClick={() => { void copy(); }}>{copied ? t('proxyUrl.copied') : t('proxyUrl.copy')}</Button></div></div>}
              <div className="proxy-url-actions">
                <Dialog.Close className="ui-button ui-button--default">{t('common.cancel')}</Dialog.Close>
                <Button type="submit" disabled={busy || !upstream}>{busy ? t('proxyUrl.generating') : t('proxyUrl.generate')}</Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
