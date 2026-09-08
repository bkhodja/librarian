/**
 * Thin client for a local Ollama server.
 *
 * Everything AI in this app runs on the user's own machine — no API keys, no
 * per-token cost, no data leaving the laptop. Ollama may not be running, so
 * every call degrades to null rather than throwing, and callers fall back to
 * whatever non-AI path they have.
 */

const HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 120000;

class OllamaClient {
  constructor() {
    this.model = MODEL;
    this.host = HOST;

    // Availability is cached briefly: a per-book tagging sweep should not
    // re-probe the server hundreds of times, but it should notice within a
    // minute if Ollama is started or stopped.
    this.availableUntil = 0;
    this.available = null;
  }

  async request(path, body, { timeout = TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.host}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Ollama responded ${response.status}: ${await response.text()}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Is Ollama reachable? Cached for a minute. */
  async isAvailable() {
    if (this.available !== null && Date.now() < this.availableUntil) {
      return this.available;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${this.host}/api/version`, { signal: controller.signal });
      clearTimeout(timer);
      this.available = response.ok;
    } catch {
      this.available = false;
    }

    this.availableUntil = Date.now() + 60000;
    return this.available;
  }

  async listModels() {
    try {
      const response = await fetch(`${this.host}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json();
      return (data.models || []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  /**
   * Generate against a JSON schema. Ollama constrains decoding to the schema,
   * so the reply parses without any "respond only with JSON" pleading — and
   * without a repair pass when the model adds prose anyway.
   *
   * Returns null when Ollama is unreachable or the reply will not parse.
   */
  async generateJSON(prompt, schema, options = {}) {
    if (!(await this.isAvailable())) return null;

    try {
      const data = await this.request('/api/generate', {
        model: options.model || this.model,
        prompt,
        system: options.system,
        stream: false,
        format: schema,
        // Reasoning models otherwise spend their budget thinking before the
        // one short answer this needs.
        think: false,
        options: {
          temperature: options.temperature ?? 0,
          num_predict: options.maxTokens ?? 256,
          ...options.modelOptions
        }
      }, { timeout: options.timeout });

      return JSON.parse(data.response);
    } catch (error) {
      console.error(`Ollama generateJSON failed: ${error.message}`);
      return null;
    }
  }

  /** Free-text generation, for prose like summaries. */
  async generateText(prompt, options = {}) {
    if (!(await this.isAvailable())) return null;

    try {
      const data = await this.request('/api/generate', {
        model: options.model || this.model,
        prompt,
        system: options.system,
        stream: false,
        think: false,
        options: {
          temperature: options.temperature ?? 0.3,
          num_predict: options.maxTokens ?? 800,
          ...options.modelOptions
        }
      }, { timeout: options.timeout });

      return (data.response || '').trim() || null;
    } catch (error) {
      console.error(`Ollama generateText failed: ${error.message}`);
      return null;
    }
  }

  async embed(text, options = {}) {
    if (!(await this.isAvailable())) return null;

    try {
      const data = await this.request('/api/embeddings', {
        model: options.model || EMBED_MODEL,
        prompt: text
      }, { timeout: options.timeout });

      return data.embedding || null;
    } catch (error) {
      console.error(`Ollama embed failed: ${error.message}`);
      return null;
    }
  }
}

module.exports = new OllamaClient();
module.exports.MODEL = MODEL;
