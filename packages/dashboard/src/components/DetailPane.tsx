import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { dashboardPluginRegistry, type CaptureSummary, type DetailTabPlugin } from '@prompt-prism/plugins/dashboard';

type Resource = { status: 'loading' } | { status: 'ready'; data: unknown } | { status: 'error'; error: string };

export function DetailPane({ capture }: { capture: CaptureSummary | null }) {
  const plugins = dashboardPluginRegistry.plugins;
  const [tab, setTab] = useState(plugins[0]?.id ?? '');
  const cache = useRef(new Map<string, Resource>());
  const [, render] = useState(0);
  const [retryVersion, setRetryVersion] = useState(0);
  const activePlugin = useMemo(() => plugins.find((plugin) => plugin.id === tab) ?? plugins[0] ?? null, [plugins, tab]);
  const key = capture && activePlugin ? `${activePlugin.id}:${capture.id}` : null;

  useEffect(() => {
    if (!capture || !activePlugin?.load || !key || cache.current.has(key)) return;
    const controller = new AbortController();
    cache.current.set(key, { status: 'loading' });
    render((value) => value + 1);
    activePlugin.load(capture, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      cache.current.set(key, { status: 'ready', data });
      render((value) => value + 1);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      cache.current.set(key, { status: 'error', error: error instanceof Error ? error.message : String(error) });
      render((value) => value + 1);
    });
    return () => {
      controller.abort();
      if (cache.current.get(key)?.status === 'loading') cache.current.delete(key);
    };
  }, [activePlugin, key, retryVersion]);

  if (!capture) {
    return (
      <section className="detail-empty">
        <span className="empty-prism empty-prism--large" aria-hidden="true">◇</span>
        <h2>Select a request</h2>
        <p>Choose a capture from the request list to inspect its model input.</p>
      </section>
    );
  }

  if (!activePlugin) return <section className="detail-empty"><h2>No detail plugins</h2></section>;

  const resource = key ? cache.current.get(key) : undefined;
  const retry = () => {
    if (key) cache.current.delete(key);
    setRetryVersion((value) => value + 1);
  };
  const panelProps = {
    capture,
    data: resource?.status === 'ready' ? resource.data : null,
    loading: Boolean(activePlugin.load) && (!resource || resource.status === 'loading'),
    error: resource?.status === 'error' ? resource.error : null,
    retry,
  };

  return (
    <section className="detail-pane">
      <Tabs.Root className="detail-tabs" value={activePlugin.id} onValueChange={setTab}>
        <Tabs.List className="tab-list" aria-label="Request detail views">
          {plugins.map((plugin) => <Tabs.Tab className="tab" value={plugin.id} key={plugin.id}>{plugin.label}</Tabs.Tab>)}
          <Tabs.Indicator className="tab-indicator" />
        </Tabs.List>
        {plugins.map((plugin: DetailTabPlugin) => (
          <Tabs.Panel className="tab-panel" value={plugin.id} key={plugin.id}>
            {plugin.id === activePlugin.id ? plugin.render(panelProps) : null}
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </section>
  );
}
