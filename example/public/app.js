const messagesElement = document.querySelector('#messages');
const timeline = document.querySelector('#timeline');
const composer = document.querySelector('#composer');
const input = document.querySelector('#input');
const sendButton = document.querySelector('#send');
const abortButton = document.querySelector('#abort');
const resetButton = document.querySelector('#reset');
const status = document.querySelector('#status');
const config = await fetch('/api/config').then((response) => response.json());
let session;
let events;
let lastEventId = 0;
const bubbles = new Map();
const toolCards = new Map();

function setStatus(text, error = false) {
  status.textContent = text;
  status.className = error ? 'status error' : 'status';
}

function bubble(message) {
  let element = bubbles.get(message.id);
  if (!element) {
    element = document.createElement('div');
    element.className = `bubble ${message.role}`;
    bubbles.set(message.id, element);
    messagesElement.append(element);
  }
  element.textContent = message.content;
  messagesElement.scrollTop = messagesElement.scrollHeight;
  return element;
}

function toolCard(event) {
  let card = toolCards.get(event.toolCallId);
  if (!card) {
    card = document.createElement('article');
    card.className = 'tool-card waiting';
    card.dataset.toolCallId = event.toolCallId;
    const title = document.createElement('div');
    title.className = 'tool-title';
    title.textContent = event.toolName;
    const payload = document.createElement('pre');
    payload.textContent = JSON.stringify(event.input, null, 2);
    const controls = document.createElement('div');
    controls.className = 'tool-controls';
    const approve = document.createElement('button');
    approve.className = 'approve';
    approve.textContent = 'Approve';
    approve.addEventListener('click', () => approveTool(event.toolCallId, true));
    const deny = document.createElement('button');
    deny.className = 'deny';
    deny.textContent = 'Deny';
    deny.addEventListener('click', () => approveTool(event.toolCallId, false));
    controls.append(approve, deny);
    card.append(title, payload, controls);
    toolCards.set(event.toolCallId, card);
    timeline.append(card);
  }
  return card;
}

function updateTool(event) {
  const card = toolCards.get(event.toolCallId);
  if (!card) return;
  card.className = `tool-card ${event.status}`;
  const controls = card.querySelector('.tool-controls');
  if (event.status !== 'approved') controls?.remove();
  if (event.status === 'running') card.querySelector('.tool-title').textContent += ' · running';
}

function toolResult(event) {
  const card = toolCards.get(event.toolCallId);
  if (!card) return;
  card.className = `tool-card ${event.isError ? 'failed' : 'complete'}`;
  const output = document.createElement('pre');
  output.className = 'tool-output';
  output.textContent = event.content ? event.content.slice(0, 12000) : '(no output)';
  card.append(output);
}

function applyEvent(event) {
  lastEventId = Math.max(lastEventId, event.id || 0);
  if (event.type === 'assistant_delta') {
    const existing = bubbles.get(event.messageId);
    bubble({ id: event.messageId, role: 'assistant', content: (existing?.textContent || '') + event.delta });
  }
  if (event.type === 'tool_call') toolCard(event);
  if (event.type === 'tool_status') updateTool(event);
  if (event.type === 'tool_result') toolResult(event);
  if (event.type === 'turn_complete') {
    setStatus('Complete — inspect this multi-step run in Prompt Prism.');
    setComposer(false);
  }
  if (event.type === 'aborted') {
    setStatus('Agent turn aborted.');
    setComposer(false);
  }
  if (event.type === 'error') {
    setStatus(event.message || 'Agent failed.', true);
    setComposer(false);
  }
}

function setComposer(disabled) {
  input.disabled = sendButton.disabled = disabled;
  abortButton.disabled = !disabled;
}

async function approveTool(toolCallId, approved) {
  const response = await fetch(`/api/sessions/${session.id}/approvals/${toolCallId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved })
  });
  if (!response.ok) setStatus(`${response.status}: ${await response.text()}`, true);
}

function connectEvents() {
  events?.close();
  events = new EventSource(`/api/sessions/${session.id}/events?after=${lastEventId}`);
  for (const type of ['assistant_delta', 'tool_call', 'tool_status', 'tool_result', 'turn_complete', 'aborted', 'error']) {
    events.addEventListener(type, (message) => applyEvent(JSON.parse(message.data)));
  }
  events.onerror = () => setStatus('Reconnecting to the agent session…');
}

async function newSession() {
  events?.close();
  bubbles.clear(); toolCards.clear(); messagesElement.replaceChildren(); timeline.replaceChildren(); lastEventId = 0;
  const response = await fetch('/api/sessions', { method: 'POST' });
  if (!response.ok) throw new Error(await response.text());
  session = await response.json();
  localStorage.setItem('prompt-prism-demo-session', session.id);
  for (const message of session.messages) bubble(message);
  connectEvents();
  setComposer(false);
  setStatus(`Workspace ready · ${config.model} · ${config.apiFormat} via Prompt Prism.`);
}

async function restoreSession() {
  const id = localStorage.getItem('prompt-prism-demo-session');
  if (!id) return false;
  const response = await fetch(`/api/sessions/${id}`);
  if (!response.ok) { localStorage.removeItem('prompt-prism-demo-session'); return false; }
  session = await response.json();
  for (const message of session.messages) bubble(message);
  for (const event of session.events) {
    lastEventId = Math.max(lastEventId, event.id || 0);
    if (event.type === 'tool_call') toolCard(event);
    if (event.type === 'tool_status') updateTool(event);
    if (event.type === 'tool_result') toolResult(event);
  }
  connectEvents();
  setComposer(session.active);
  setStatus(session.active ? 'Agent is working. Pending approvals remain available.' : `Workspace restored · ${config.model} · ${config.apiFormat} via Prompt Prism.`);
  return true;
}

composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content) return;
  bubble({ id: crypto.randomUUID(), role: 'user', content });
  input.value = '';
  setComposer(true);
  setStatus('Agent is working. Approve each requested tool call to continue.');
  const response = await fetch(`/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content })
  });
  if (!response.ok) { setStatus(`${response.status}: ${await response.text()}`, true); setComposer(false); }
});

abortButton.addEventListener('click', async () => {
  await fetch(`/api/sessions/${session.id}/abort`, { method: 'POST' });
});

resetButton.addEventListener('click', async () => {
  const response = await fetch(`/api/sessions/${session.id}/reset`, { method: 'POST' });
  if (!response.ok) return setStatus(`${response.status}: ${await response.text()}`, true);
  session = await response.json();
  localStorage.setItem('prompt-prism-demo-session', session.id);
  bubbles.clear(); toolCards.clear(); messagesElement.replaceChildren(); timeline.replaceChildren(); lastEventId = 0;
  connectEvents(); setComposer(false); setStatus('Fresh workspace created.');
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); }
});

if (!await restoreSession()) await newSession();
