const messagesElement = document.querySelector('#messages');
const composer = document.querySelector('#composer');
const input = document.querySelector('#input');
const sendButton = document.querySelector('#send');
const status = document.querySelector('#status');
const history = [];
const config = await fetch('/api/config').then((response) => response.json());

function bubble(role, content = '') {
  const element = document.createElement('div');
  element.className = `bubble ${role}`;
  element.textContent = content;
  messagesElement.append(element);
  messagesElement.scrollTop = messagesElement.scrollHeight;
  return element;
}

function consumeSse(buffer, onEvent) {
  buffer = buffer.replace(/\r\n/g, '\n');
  let boundary;
  while ((boundary = buffer.indexOf('\n\n')) !== -1) {
    const block = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* Ignore non-JSON events. */ }
    }
  }
  return buffer;
}

composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content) return;
  history.push({ role: 'user', content });
  bubble('user', content);
  input.value = '';
  input.disabled = sendButton.disabled = true;
  status.className = 'status';
  status.textContent = `Streaming ${config.model} through Prompt Prism…`;
  const assistant = bubble('assistant');
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history })
    });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = consumeSse(buffer, (payload) => {
        if (payload.type === 'content_block_delta' && payload.delta?.text) {
          assistant.textContent += payload.delta.text;
          messagesElement.scrollTop = messagesElement.scrollHeight;
        }
      });
    }
    if (!assistant.textContent) assistant.textContent = '(The provider returned no text.)';
    history.push({ role: 'assistant', content: assistant.textContent });
    status.textContent = 'Complete — inspect this turn in the dashboard.';
  } catch (error) {
    assistant.remove();
    history.pop();
    status.className = 'status error';
    status.textContent = error.message;
  } finally {
    input.disabled = sendButton.disabled = false;
    input.focus();
  }
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});
