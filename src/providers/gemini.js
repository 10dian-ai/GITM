// providers/gemini.js —— Google Gemini generateContent 格式
import { fetchJson, doFetch, readSSE } from './base.js';

function normUsage(um) {
  if (!um) return null;
  return {
    prompt_tokens: um.promptTokenCount,
    completion_tokens: um.candidatesTokenCount,
    total_tokens: um.totalTokenCount,
  };
}

export const gemini = {
  id: 'gemini',
  modelsUrl: (b) => `${b}/v1beta/models`,
  headers: (k) => ({ 'x-goog-api-key': k, 'Content-Type': 'application/json' }),
  parseModels: (j) => (j?.models || []).map((m) => (m.name || '').replace(/^models\//, '')).filter(Boolean),

  _body({ system, messages, temperature = 0, max_tokens = 4096 }) {
    const body = {
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature, maxOutputTokens: max_tokens },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    return body;
  },

  async chat(base, key, opts) {
    const url = `${base}/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`;
    const j = await fetchJson(url, { method: 'POST', headers: this.headers(key), body: JSON.stringify(this._body(opts)) });
    const cand = j?.candidates?.[0];
    return {
      text: (cand?.content?.parts || []).map((p) => p.text || '').join(''),
      finishReason: cand?.finishReason || null,
      usage: normUsage(j?.usageMetadata),
      raw: j,
    };
  },

  async streamChat(base, key, opts, onDelta) {
    const url = `${base}/v1beta/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`;
    const res = await doFetch(url, { method: 'POST', headers: this.headers(key), body: JSON.stringify(this._body(opts)) });
    let text = '', usage = null, finishReason = null;
    await readSSE(res, (data) => {
      let j; try { j = JSON.parse(data); } catch { return; }
      const cand = j?.candidates?.[0];
      const piece = (cand?.content?.parts || []).map((p) => p.text || '').join('');
      if (piece) { text += piece; onDelta?.(piece); }
      if (cand?.finishReason) finishReason = cand.finishReason;
      if (j?.usageMetadata) usage = normUsage(j.usageMetadata);
    });
    return { text, usage, finishReason };
  },
};
