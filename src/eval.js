// eval.js —— 对照评分：把还原结果与“原始预设”逐条比对，算还原率。
// 因为中间件是用户自己的，能拿到 ground truth，这是回答“到底能拿回多少”的关键模块。
import { diceSim } from './assemble.js';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** 从 ST 预设 JSON 或纯文本里抽出“条目文本”数组 */
export function extractGroundTruth(input) {
  if (typeof input === 'object' && input) {
    if (Array.isArray(input.prompts)) {
      return input.prompts.filter((p) => !p.marker && p.content).map((p) => ({ name: p.name || p.identifier, content: p.content }));
    }
  }
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  return text.split(/\n{2,}/).map((b, i) => ({ name: `block_${i + 1}`, content: b.trim() })).filter((b) => b.content);
}

/**
 * 评分。
 * @param original ST预设对象 或 原始文本
 * @param recovered 还原的合并文本 或 条目数组
 */
export function scoreRecovery(original, recovered) {
  const truth = extractGroundTruth(original);
  const recText = Array.isArray(recovered) ? recovered.map((e) => e.content || '').join('\n\n') : String(recovered || '');
  const recBlocks = recText.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  const perEntry = truth.map((t) => {
    let best = 0, bestIdx = -1;
    recBlocks.forEach((rb, i) => { const s = diceSim(t.content, rb); if (s > best) { best = s; bestIdx = i; } });
    return {
      name: t.name,
      recovery: Math.round(best * 100),
      matchedBlock: bestIdx,
      status: best >= 0.85 ? 'full' : best >= 0.5 ? 'partial' : 'missing',
    };
  });

  const overall = perEntry.length ? Math.round(perEntry.reduce((a, e) => a + e.recovery, 0) / perEntry.length) : 0;
  const whole = Math.round(diceSim(truth.map((t) => t.content).join('\n'), recText) * 100);
  const covered = perEntry.filter((e) => e.status !== 'missing').length;

  return {
    overall,            // 逐条还原率均值
    wholeText: whole,   // 整体文本相似度
    entriesTotal: truth.length,
    entriesCovered: covered,
    perEntry,
  };
}
