// exporter.js —— 生成可直接导入 SillyTavern 的 Chat Completion 预设（+ txt / md）
// 字段对齐酒馆默认预设结构；无法还原的采样参数填默认并标 unverified。
const CHAT_HISTORY = { identifier: 'chatHistory', name: 'Chat History', marker: true };

function idOf(e, i) {
  const base = (e.name || `entry_${i + 1}`).toLowerCase().replace(/[^a-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${base || 'entry'}_${i + 1}`;
}

export function buildSillyTavernPreset(entries, meta = {}) {
  const position = meta.position || 'before_prompt';
  const prefill = meta.prefill || '';
  const prompts = [];
  const before = [], after = [], deep = [];

  entries.forEach((e, i) => {
    const identifier = idOf(e, i);
    const p = {
      identifier,
      name: e.name || `Entry ${i + 1}`,
      role: e.role === 'assistant' ? 'assistant' : e.role === 'user' ? 'user' : 'system',
      content: e.content || '',
      system_prompt: false,
      enabled: e.enabled !== false,
    };
    const depth = e.injection?.depth;
    if (depth != null || position === 'in_chat') {
      p.injection_position = 1;                 // 1 = 深度注入(in-chat)
      p.injection_depth = depth ?? 4;
      deep.push(identifier);
    } else if (position === 'after_user') {
      after.push(identifier);
    } else {
      before.push(identifier);
    }
    prompts.push(p);
  });

  if (prefill) {
    prompts.push({ identifier: 'assistant_prefill', name: 'Assistant Prefill', role: 'assistant', content: prefill, system_prompt: false, enabled: true });
    after.push('assistant_prefill');
  }
  prompts.push({ ...CHAT_HISTORY, system_prompt: false, enabled: true });

  const order = [
    ...before.map((id) => ({ identifier: id, enabled: true })),
    { identifier: 'chatHistory', enabled: true },
    ...after.map((id) => ({ identifier: id, enabled: true })),
    ...deep.map((id) => ({ identifier: id, enabled: true })),
  ];

  const s = meta.sampling || {};
  return {
    temperature: s.temperature ?? 1,
    frequency_penalty: s.frequency_penalty ?? 0,
    presence_penalty: s.presence_penalty ?? 0,
    top_p: s.top_p ?? 1,
    top_k: s.top_k ?? 0,
    max_context_unlocked: true,
    openai_max_tokens: s.max_tokens ?? 4096,
    wrap_in_quotes: false,
    names_behavior: 0,
    send_if_empty: '',
    prompts,
    prompt_order: [{ character_id: 100001, order }],
    gitm_meta: {
      recovered_by: 'GITM', recovered_at: new Date().toISOString(),
      injection_position: position, sampling_unverified: true,
      note: '采样参数为默认占位（中间件实际取值无法从调用侧确认）；内容为模型复述，长预设可能漂移。',
    },
  };
}

export function toText(entries, meta = {}) {
  const parts = entries.map((e) => e.content || '');
  if (meta.prefill) parts.push('\n[assistant prefill]\n' + meta.prefill);
  return parts.join('\n\n');
}

export function toMarkdown(entries, meta = {}) {
  let md = `# 还原预设\n\n> 注入位置：${meta.position || 'unknown'} ・ 条目数：${entries.length}\n\n`;
  entries.forEach((e, i) => {
    const conf = e.confidence != null ? ` _(置信度 ${Math.round(e.confidence * 100)}%)_` : '';
    md += `## ${i + 1}. ${e.name || 'entry'} \`${e.role || 'system'}\`${conf}\n\n\`\`\`\n${e.content || ''}\n\`\`\`\n\n`;
  });
  if (meta.prefill) md += `## 预填充 \`assistant\`\n\n\`\`\`\n${meta.prefill}\n\`\`\`\n`;
  return md;
}
