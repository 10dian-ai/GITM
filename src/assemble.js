// assemble.js —— 多轮结果对齐/合并/置信度/动态内容（纯函数，易单测）
// 相比整行多数表决，这里用字符二元组 Dice 相似度做模糊匹配：
// 轻微漂移也能对上，并给出 0~1 连续置信度，而非非黑即白。

/** 字符二元组集合 */
function bigrams(s) {
  const n = normalize(s);
  const set = new Set();
  for (let i = 0; i < n.length - 1; i++) set.add(n.slice(i, i + 2));
  return set;
}
/** Dice 相似度 0~1 */
export function diceSim(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (A.size === 0 && B.size === 0) return normalize(a) === normalize(b) ? 1 : 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

function normalize(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * 合并多轮复述。
 * @returns {merged, confidence, runCount, segments:[{text,confidence,dynamic}]}
 */
export function mergeRuns(runs) {
  const texts = runs.map((r) => (typeof r === 'string' ? r : r.text) || '').filter(Boolean);
  if (texts.length === 0) return { merged: '', confidence: 0, runCount: 0, segments: [] };
  if (texts.length === 1) {
    const segs = texts[0].split('\n').map((t) => ({ text: t, confidence: 0.5, dynamic: false }));
    return { merged: texts[0], confidence: 0.5, runCount: 1, segments: segs };
  }

  // 取最长的一轮作骨架（按下标，避免相同副本被值相等过滤掉导致置信度塌陷）
  let si = 0;
  for (let i = 1; i < texts.length; i++) if (texts[i].length > texts[si].length) si = i;
  const skeleton = texts[si];
  const others = texts.filter((_, i) => i !== si).map((t) => t.split('\n'));

  const segments = skeleton.split('\n').map((line) => {
    if (!normalize(line)) return { text: line, confidence: 1, dynamic: false }; // 空行
    let simSum = 0, exact = 0;
    for (const lines of others) {
      let best = 0, bestExact = false;
      for (const cand of lines) {
        const s = diceSim(line, cand);
        if (s > best) { best = s; bestExact = normalize(cand) === normalize(line); }
      }
      simSum += best;
      if (bestExact) exact++;
    }
    const confidence = round2((1 + simSum) / texts.length); // 含骨架自身
    // 动态内容：各轮都能高相似匹配，但没有一轮完全一致 => 可能是宏/随机/时间
    const dynamic = confidence >= 0.7 && exact === 0;
    return { text: line, confidence, dynamic };
  });

  const merged = segments.map((s) => s.text).join('\n');
  const scored = segments.filter((s) => normalize(s.text));
  const confidence = scored.length ? round2(scored.reduce((a, s) => a + s.confidence, 0) / scored.length) : 0;
  return { merged, confidence, runCount: texts.length, segments };
}

/** 把合并文本切成条目：按空行 / XML 标签 / Markdown 标题断开 */
export function splitIntoEntries(merged) {
  if (!merged) return [];
  return merged.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).map((b, i) => {
    let role = 'system';
    if (/^(assistant|ai|char|角色)[:：]/i.test(b)) role = 'assistant';
    else if (/^(user|用户|you)[:：]/i.test(b)) role = 'user';
    return { id: `e${i + 1}`, name: guessName(b) || `entry_${i + 1}`, role, content: b };
  });
}

function guessName(block) {
  const tag = block.match(/^<\s*([a-zA-Z0-9_\-]{2,30})\s*>/);
  if (tag) return tag[1];
  const md = block.match(/^#{1,6}\s*(.{2,40})/);
  if (md) return md[1].trim();
  const colon = block.match(/^([^\n:：]{2,30})[:：]/);
  if (colon) return colon[1].trim();
  return null;
}
