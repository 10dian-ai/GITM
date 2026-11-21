// providers/base.js —— 适配器共用底座：HTTP、SSE 流读取、错误、地址规范化
import { config } from '../config.js';

export const UA = 'GITM/2.0 (preset-recovery)';

/** 规范化 base：去掉 /v1、/chat/completions 等后缀，只留根 */
export function normalizeBase(raw) {
  if (!raw) return '';
  let u = String(raw).trim().replace(/\s+/g, '');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '')
       .replace(/\/(v1|v1beta)\/(chat\/completions|messages|models.*|completions|generateContent.*)$/i, '')
       .replace(/\/(chat\/completions|messages|completions)$/i, '')
       .replace(/\/(v1|v1beta)$/i, '')
       .replace(/\/+$/, '');
  return u;
}

/** 结构化上游错误 */
export class UpstreamError extends Error {
  constructor(status, body) {
    const msg = body?.error?.message || body?.error || (typeof body === 'string' ? body.slice(0, 300) : `HTTP ${status}`);
    super(typeof msg === 'string' ? msg : JSON.stringify(msg));
    this.status = status;
    this.upstream = true;
  }
}

/** 带超时的 fetch */
export async function doFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.upstreamTimeout);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

/** 普通 JSON 请求 */
export async function fetchJson(url, opts = {}) {
  const res = await doFetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非JSON */ }
  if (!res.ok) throw new UpstreamError(res.status, json ?? text);
  return json;
}

/**
 * 逐行读取 SSE 流。对每条 `data: ...` 回调 onData(payloadString)。
 * 跨 Node 版本稳健：用 getReader() + TextDecoder，自己切分 \n\n。
 */
export async function readSSE(res, onData) {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let json = null; try { json = JSON.parse(text); } catch {}
    throw new UpstreamError(res.status, json ?? text);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    // 事件以空行分隔
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const rawLine of chunk.split('\n')) {
        const line = rawLine.trimEnd();
        if (line.startsWith('data:')) onData(line.slice(5).trim());
      }
    }
  }
  if (buf.trim()) {
    for (const rawLine of buf.split('\n')) {
      const line = rawLine.trimEnd();
      if (line.startsWith('data:')) onData(line.slice(5).trim());
    }
  }
}
