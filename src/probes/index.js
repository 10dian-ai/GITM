// probes/index.js —— 探针管线编排。按档位跑 baseline→structural→多轮 extract，
// 全程通过 emit(event) 推送进度（供 SSE 实时展示）。
import { baselineProbe } from './baseline.js';
import { structuralProbe } from './structural.js';
import { extractOnce } from './extract.js';
import { config } from '../config.js';

export async function runPipeline(ctx, mode, emit = () => {}) {
  const plan = config.modes[mode] || config.modes.standard;

  emit({ stage: 'baseline', msg: '基线探测（估算注入量）…' });
  const baseline = await baselineProbe(ctx);
  emit({ stage: 'baseline_done', present: baseline.present, injectedTokens: baseline.injectedTokens });

  let structure = null;
  if (plan.structural) {
    emit({ stage: 'structural', msg: '结构探测（定位注入位置）…' });
    structure = await structuralProbe(ctx);
    emit({ stage: 'structural_done', position: structure.position });
  }

  const runs = [];
  const total = plan.templates.length * plan.rounds;
  let n = 0;
  for (const ti of plan.templates) {
    for (let r = 0; r < plan.rounds; r++) {
      emit({ stage: 'extract', msg: `提取中 ${n + 1}/${total}（模板${ti + 1}·第${r + 1}轮）`, done: n, total });
      const out = await extractOnce(ctx, ti, (piece) => emit({ stage: 'delta', run: n, text: piece }));
      runs.push(out);
      n++;
      emit({ stage: 'run_done', run: n, length: out.text.length });
    }
  }
  return { baseline, structure, runs };
}
