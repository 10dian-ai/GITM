// server.js —— GITM 后端入口。
// 分层：路由只做校验与编排；逻辑在 providers/probes/assemble/eval/exporter。
// 后端代发上游请求（避免跨域、集中脱敏日志）；SSE 实时推送提取进度。
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { log } from './logger.js';
import { detectFormat, listModels } from './providers/index.js';
import { runPipeline } from './probes/index.js';
import { baselineProbe } from './probes/baseline.js';
import { structuralProbe } from './probes/structural.js';
import { mergeRuns, splitIntoEntries } from './assemble.js';
import { scoreRecovery } from './eval.js';
import { buildSillyTavernPreset, toText, toMarkdown } from './exporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '8mb' }));

if (!config.token) log.warn('未设置 GITM_TOKEN，所有 API 调用将被拒绝。');

// ---- 访问令牌 ----
function auth(req, res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = req.headers['x-gitm-token'] || bearer;
  if (!config.token || token !== config.token) return res.status(401).json({ error: '访问令牌无效或缺失' });
  next();
}
app.use((req, _r, next) => { log.debug('req', { m: req.method, u: req.path }); next(); });

app.get('/healthz', (_q, res) => res.json({ ok: true, name: 'GITM', version: '2.0.0', port: config.port }));

// ---- 识别 / 模型 ----
app.post('/api/detect', auth, wrap(async (req) => {
  const { base, key } = need(req.body, ['base', 'key']);
  return detectFormat(base, key);
}));
app.post('/api/models', auth, wrap(async (req) => {
  const { provider, base, key } = need(req.body, ['provider', 'base', 'key']);
  return { models: await listModels(provider, base, key) };
}));

// ---- 预探测（有无预设 / 位置 / 体量）----
app.post('/api/probe', auth, wrap(async (req) => {
  const { provider, base, key, model, mode = 'standard' } = need(req.body, ['provider', 'base', 'key', 'model']);
  const ctx = { provider, base, key, model };
  const baseline = await baselineProbe(ctx);
  const structure = config.modes[mode]?.structural ? await structuralProbe(ctx) : null;
  return { baseline, structure };
}));

// ---- 完整提取（SSE 流式）----
app.post('/api/extract-stream', auth, async (req, res) => {
  try {
    const { provider, base, key, model, mode = 'standard' } = need(req.body, ['provider', 'base', 'key', 'model']);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    const ctx = { provider, base, key, model };
    const result = await runPipeline(ctx, mode, send);

    const merged = mergeRuns(result.runs);
    const entries = splitIntoEntries(merged.merged).map((e) => ({ ...e, confidence: entryConfidence(merged.segments, e.content) }));
    send({
      stage: 'result',
      present: result.baseline.present,
      injectedTokens: result.baseline.injectedTokens,
      position: result.structure?.position || 'before_prompt',
      confidence: merged.confidence,
      segments: merged.segments,
      entries,
    });
    send({ stage: 'done' });
    res.end();
  } catch (e) {
    log.error('extract-stream error', { msg: String(e.message || e) });
    if (!res.headersSent) res.status(e.status || 500).json({ error: String(e.message || e) });
    else { res.write(`data: ${JSON.stringify({ stage: 'error', error: String(e.message || e) })}\n\n`); res.end(); }
  }
});

// ---- 对照评分 ----
app.post('/api/eval', auth, wrap(async (req) => {
  const { original, entries } = req.body;
  if (!original) throw bad('缺少 original（原始预设 JSON 或文本）');
  if (!Array.isArray(entries) || !entries.length) throw bad('缺少 entries');
  return scoreRecovery(original, entries);
}));

// ---- 导出 ----
app.post('/api/export', auth, wrap(async (req) => {
  const { entries = [], meta = {}, format = 'st' } = req.body;
  if (!Array.isArray(entries) || !entries.length) throw bad('entries 为空');
  if (format === 'txt') return { filename: 'preset.txt', mime: 'text/plain', content: toText(entries, meta) };
  if (format === 'md') return { filename: 'preset.md', mime: 'text/markdown', content: toMarkdown(entries, meta) };
  return { filename: 'gitm_preset.json', mime: 'application/json', content: JSON.stringify(buildSillyTavernPreset(entries, meta), null, 2) };
}));

app.use('/', express.static(path.join(__dirname, '..', 'public')));

// ---- 辅助 ----
function wrap(fn) {
  return async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      const status = e.status >= 400 && e.status < 600 ? e.status : 500;
      log.error('handler error', { msg: String(e.message || e), status });
      res.status(status).json({ error: String(e.message || e), upstream: !!e.upstream });
    }
  };
}
function need(body, fields) {
  for (const f of fields) if (body?.[f] == null || body[f] === '') throw bad(`缺少字段: ${f}`);
  return body;
}
function bad(msg) { const e = new Error(msg); e.status = 400; return e; }
function entryConfidence(segments, content) {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const matched = segments.filter((s) => lines.includes(s.text.trim()));
  if (!matched.length) return null;
  return Math.round((matched.reduce((a, s) => a + s.confidence, 0) / matched.length) * 100) / 100;
}

app.listen(config.port, '0.0.0.0', () => log.info('GITM 已启动', { port: config.port, auth: config.token ? 'on' : 'OFF(!)' }));
