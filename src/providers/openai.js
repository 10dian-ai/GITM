// providers/openai.js —— OpenAI 兼容格式（NewAPI 等网关多走这个）
import { fetchJson, doFetch, readSSE } from './base.js';

export const openai = {
  id: 'openai',
  modelsUrl: (b) => `${b}/v1/models`,
  headers: (k) => ({ Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }),
  parseModels: (j) => (j?.data || []).map((m) => m.id).filter(Boolean),

  _body({ model, system, messages, temperature = 0, max_tokens = 4096, stream = false }) {
    const msgs = [];
    if (system) msgs.push({ role: 'system', content: system });
    for (const m of messages) msgs.push(m);
    return { model, messages: msgs, temperature, max_tokens, stream };
  },

  async chat(base, key, opts) {
    const j = await fetchJson(`${base}/v1/chat/completions`, {
      method: 'POST', headers: this.headers(key), body: JSON.stringify(this._body(opts)),
    });
    const c = j?.choices?.[0];
    const content = c?.message?.content;
    return {
      text: Array.isArray(content) ? content.map((p) => p.text || '').join('') : (content || ''),
      finishReason: c?.finish_reason || null,
      usage: j?.usage || null,
      raw: j,
    };
  },

  async streamChat(base, key, opts, onDelta) {
    const res = await doFetch(`${base}/v1/chat/completions`, {
      method: 'POST', headers: this.headers(key), body: JSON.stringify(this._body({ ...opts, stream: true })),
    });
    let text = '', usage = null, finishReason = null;
    await readSSE(res, (data) => {
      if (data === '[DONE]') return;
      let j; try { j = JSON.parse(data); } catch { return; }
      const d = j?.choices?.[0];
      const piece = d?.delta?.content;
      if (piece) { text += piece; onDelta?.(piece); }
      if (d?.finish_reason) finishReason = d.finish_reason;
      if (j?.usage) usage = j.usage; // 部分网关在末帧带 usage
    });
    return { text, usage, finishReason };
  },
};
