// probes/baseline.js —— 基线探测：多点回归估算注入量，判断是否存在预设
// 原理：prompt_tokens = 截距 + 斜率 * 本条消息token。
// 发若干条已知长度的消息做最小二乘拟合，截距即“注入+模板”的常数项。
// 常数项明显偏大 => 存在预设注入。比两点差分稳健得多。
import { chat } from '../providers/index.js';
import { config } from '../config.js';
import { log } from '../logger.js';

// 近似已知 token 长度的消息（" word" ≈ 1 token）
function msgOfLen(n) { return n <= 1 ? 'hi' : Array(n).fill('word').join(' '); }
const POINTS = [1, 16, 48, 96];

/** 最小二乘，返回 {slope, intercept, r2} */
function linreg(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const r2 = syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, intercept, r2 };
}

export async function baselineProbe(ctx) {
  const samples = [];
  for (const n of POINTS) {
    try {
      const r = await chat(ctx.provider, ctx.base, ctx.key, {
        model: ctx.model, messages: [{ role: 'user', content: msgOfLen(n) }], max_tokens: 1, temperature: 0,
      });
      const pt = r.usage?.prompt_tokens;
      if (Number.isFinite(pt)) samples.push({ x: n, y: pt });
    } catch (e) { log.warn('baseline sample failed', { n, err: String(e.message || e) }); }
  }

  if (samples.length < 2) {
    return { usable: false, present: null, injectedTokens: null, samples, note: 'usage 不可用或采样失败，无法估算' };
  }
  const { slope, intercept, r2 } = linreg(samples.map((s) => s.x), samples.map((s) => s.y));
  const injected = Math.max(0, Math.round(intercept));
  const present = injected > config.presenceThreshold;
  log.info('baselineProbe', { injected, slope: +slope.toFixed(3), r2: +r2.toFixed(3), present });
  return {
    usable: true, present, injectedTokens: injected,
    fit: { slope: +slope.toFixed(3), intercept: +intercept.toFixed(1), r2: +r2.toFixed(3) },
    samples,
  };
}
