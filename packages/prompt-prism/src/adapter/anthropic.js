function normalizeUsage(usage = {}) {
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0
  };
}

export function parseRequest(body) {
  const value = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  const parsed = JSON.parse(value);
  return { model: parsed.model ?? null, messages: Array.isArray(parsed.messages) ? parsed.messages : [] };
}

export function parseResponse(body, contentType = '') {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  if (!/text\/event-stream/i.test(contentType)) {
    try { return { usage: normalizeUsage(JSON.parse(text).usage) }; }
    catch { return { usage: normalizeUsage() }; }
  }

  const usage = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const event = JSON.parse(data);
      const next = event.usage || event.message?.usage;
      if (next) Object.assign(usage, next);
    } catch { /* Ignore incomplete or non-JSON SSE data lines. */ }
  }
  return { usage: normalizeUsage(usage) };
}

export default { parseRequest, parseResponse };
