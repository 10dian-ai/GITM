// providers/anthropic.js —— Anthropic Messages 格式
import { fetchJson, doFetch, readSSE } from './base.js';

function normUsage(u) {
  if (!u) return null;
  return {
    prompt_tokens: u.input_tokens,
    completion_tokens: u.output_tokens,
    total_tokens: (u.input_tokens || 0) + (u.output_tokens || 0),
  };
}

export const anthropic = {
  id: 'anthropic',
  modelsUrl: (b) => `${b}/v1/models`,
  headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }),
  parseModels: (j) => (j?.data || []).map((m) => m.id).filter(Boolean),

  _body({ model, system, messages, temperature = 0, max_tokens = 4096, stream = false }) {
    const body = {
      model, max_tokens, temperature, stream,
      messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    };
    if (system) body.system = system;
    return body;
  },

  async chat(base, key, opts) {
    const j = await fetchJson(`${base}/v1/messages`, {
      method: 'POST', headers: this.headers(key), body: JSON.stringify(this._body(opts)),
    });
    return {
      text: (j?.content || []).map((b) => b.text || '').join(''),
      finishReason: j?.stop_reason || null,
      usage: normUsage(j?.usage),
      raw: j,
    };
  },

  async streamChat(base, key, opts, onDelta) {
    const res = await doFetch(`${base}/v1/messages`, {
      method: 'POST', headers: this.headers(key), body: JSON.stringify(this._body({ ...opts, stream: true })),
    });
    let text = '', finishReason = null, inTok = 0, outTok = 0;
    await readSSE(res, (data) => {
      let j; try { j = JSON.parse(data); } catch { return; }
      if (j.type === 'content_block_delta' && j.delta?.text) { text += j.delta.text; onDelta?.(j.delta.text); }
      if (j.type === 'message_start' && j.message?.usage) inTok = j.message.usage.input_tokens || 0;
      if (j.type === 'message_delta') {
        if (j.delta?.stop_reason) finishReason = j.delta.stop_reason;
        if (j.usage?.output_tokens) outTok = j.usage.output_tokens;
      }
    });
    return { text, finishReason, usage: normUsage({ input_tokens: inTok, output_tokens: outTok }) };
  },
};
