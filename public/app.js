const logs = document.querySelector('#logs');
const dialog = document.querySelector('#detail');
const diff = document.querySelector('#diff');
const meta = document.querySelector('#meta');
document.querySelector('#close').addEventListener('click', () => dialog.close());

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = (value) => new Intl.NumberFormat().format(value ?? 0);

async function show(id) {
  const response = await fetch(`/_pp/api/diff/${encodeURIComponent(id)}`);
  const item = await response.json();
  if (!response.ok) return;
  meta.textContent = item.matched_parent_id
    ? `parent ${item.matched_parent_id.slice(0, 8)} · divergence ${item.divergence_point} · estimated miss ${item.estimated_cache_miss} tokens`
    : 'No earlier capture for this token.';
  diff.innerHTML = item.diff.map((part) => `<span class="${part.type}">${escapeHtml(part.value)}</span>`).join('');
  dialog.showModal();
}

async function refresh() {
  const response = await fetch('/_pp/api/logs');
  const items = await response.json();
  if (!items.length) { logs.innerHTML = '<div class="empty">No captures yet. Send an Anthropic request through the proxy.</div>'; return; }
  logs.innerHTML = `<table><thead><tr><th>Time</th><th>Model</th><th>Token</th><th>Input</th><th>Cache read</th><th>Result</th></tr></thead><tbody>${items.map((item) => {
    const bad = item.analysis?.cache_hit_below_expected;
    return `<tr data-id="${escapeHtml(item.id)}"><td>${escapeHtml(new Date(item.timestamp).toLocaleString())}</td><td>${escapeHtml(item.model ?? 'unknown')}</td><td title="${escapeHtml(item.token_hash)}">${escapeHtml(item.token_hash.slice(0, 8))}…</td><td>${number(item.usage?.input_tokens)}</td><td>${number(item.usage?.cache_read_input_tokens)}</td><td class="${bad ? 'bad' : 'good'}">${bad ? 'below expected' : 'ok'}</td></tr>`;
  }).join('')}</tbody></table>`;
  for (const row of logs.querySelectorAll('tr[data-id]')) row.addEventListener('click', () => show(row.dataset.id));
}

refresh().catch((error) => { logs.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; });
setInterval(refresh, 3000);
