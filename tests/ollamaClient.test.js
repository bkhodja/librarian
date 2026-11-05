const ollama = require('../server/services/ollamaClient');

// A fetch response whose body yields the given chunks, as Ollama streams.
function streamed(chunks) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: (async function* () {
      for (const chunk of chunks) yield encoder.encode(chunk);
    })()
  };
}

beforeEach(() => {
  ollama.available = true;
  ollama.availableUntil = Date.now() + 60000;
});

afterEach(() => {
  delete global.fetch;
});

describe('chatStream', () => {
  test('joins tokens, even when a line is split across chunks', async () => {
    global.fetch = jest.fn().mockResolvedValue(streamed([
      '{"message":{"content":"Start "}}\n{"message":{"con',
      'tent":"with"}}\n',
      '{"message":{"content":" this."},"done":true}\n'
    ]));

    const tokens = [];
    const text = await ollama.chatStream([{ role: 'user', content: 'hi' }], {
      onToken: (t) => tokens.push(t)
    });

    expect(text).toBe('Start with this.');
    expect(tokens).toEqual(['Start ', 'with', ' this.']);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ stream: true, think: false });
  });

  test('returns null when Ollama reports an error mid-stream', async () => {
    global.fetch = jest.fn().mockResolvedValue(streamed(['{"error":"model not found"}\n']));
    expect(await ollama.chatStream([{ role: 'user', content: 'hi' }])).toBeNull();
  });

  test('returns null when Ollama is down', async () => {
    ollama.available = false;
    global.fetch = jest.fn();
    expect(await ollama.chatStream([{ role: 'user', content: 'hi' }])).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('chat', () => {
  test('parses a schema-constrained reply', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '{"intent":"reading-path"}' } })
    });
    const reply = await ollama.chat([{ role: 'user', content: 'hi' }], { format: { type: 'object' } });
    expect(reply).toEqual({ intent: 'reading-path' });
  });
});
