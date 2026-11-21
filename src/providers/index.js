// providers/index.js —— 适配器注册表 + 自动识别 + 统一分发
import { openai } from './openai.js';
import { anthropic } from './anthropic.js';
import { gemini } from './gemini.js';
import { normalizeBase, fetchJson, UpstreamError } from './base.js';
import { log } from '../logger.js';

const ADAPTERS = { openai, anthropic, gemini };

export function getAdapter(provider) {
  const a = ADAPTERS[provider];
  if (!a) { const e = new Error(`未知格式: ${provider}`); e.status = 400; throw e; }
  return a;
}

export { normalizeBase };

/**
 * 并发探测三个 models 端点，按命中数量排序返回候选。
 * NewAPI 这类三通网关可能全部命中，交给前端选。
 */
export async function detectFormat(base, key) {
  const b = normalizeBase(base);
  const results = await Promise.all(Object.values(ADAPTERS).map(async (a) => {
    try {
      const j = await fetchJson(a.modelsUrl(b), { headers: a.headers(key) });
      const models = a.parseModels(j);
      return { provider: a.id, ok: true, count: models.length, models };
    } catch (e) {
      return { provider: a.id, ok: false, count: 0, models: [], status: e.status || 0, error: String(e.message || e) };
    }
  }));
  const candidates = results.filter((r) => r.ok && r.count > 0).sort((x, y) => y.count - x.count);
  log.info('detectFormat', { base: b, hits: candidates.map((c) => `${c.provider}:${c.count}`) });
  return { base: b, candidates, all: results };
}

export async function listModels(provider, base, key) {
  const a = getAdapter(provider);
  return a.parseModels(await fetchJson(a.modelsUrl(normalizeBase(base)), { headers: a.headers(key) }));
}

export async function chat(provider, base, key, opts) {
  return getAdapter(provider).chat(normalizeBase(base), key, opts);
}

export async function streamChat(provider, base, key, opts, onDelta) {
  return getAdapter(provider).streamChat(normalizeBase(base), key, opts, onDelta);
}
