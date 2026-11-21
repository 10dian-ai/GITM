// app.js —— 前端编排：只调后端（后端代发避免跨域），SSE 真流式读取。
const $ = (s) => document.querySelector(s);
let TOKEN = sessionStorage.getItem('gitm_token') || '';
const STATE = { entries: [], meta: {} };

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-gitm-token': TOKEN },
    body: JSON.stringify(body || {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

// ---- 令牌门 ----
$('#enter').onclick = async () => {
  TOKEN = $('#token').value.trim();
  if (!TOKEN) return ($('#gate-msg').textContent = '要先填令牌哦');
  try {
    await api('/api/models', { provider: 'openai', base: 'https://x', key: 'x' }).catch((e) => { if (/令牌/.test(e.message)) throw e; });
    sessionStorage.setItem('gitm_token', TOKEN);
    $('#gate').style.display = 'none';
  } catch (e) { $('#gate-msg').textContent = e.message; }
};
if (!TOKEN) { $('#gate').style.display = 'flex'; } else { $('#gate').style.display = 'none'; }

// ---- 识别 & 模型 ----
let CANDS = [];
$('#detect').onclick = async (ev) => {
  const b = ev.target; b.disabled = true; b.textContent = '识别中…';
  try {
    const r = await api('/api/detect', { base: $('#base').value, key: $('#key').value });
    CANDS = r.candidates; $('#base').value = r.base;
    const badges = $('#fmt-badges'); badges.innerHTML = ''; $('#provider').innerHTML = '';
    if (!CANDS.length) { badges.innerHTML = '<span class="badge">没识别到可用格式</span>'; return; }
    for (const c of CANDS) {
      badges.insertAdjacentHTML('beforeend', `<span class="badge">${c.provider} · ${c.count}</span>`);
      $('#provider').insertAdjacentHTML('beforeend', `<option value="${c.provider}">${c.provider}</option>`);
    }
    fillModels(CANDS[0].models);
    $('#provider').onchange = () => { const c = CANDS.find((x) => x.provider === $('#provider').value); fillModels(c ? c.models : []); };
  } catch (e) { alert('识别失败：' + e.message); }
  finally { b.disabled = false; b.textContent = '自动识别 & 拉模型'; }
};
function fillModels(ms) { const s = $('#model'); s.innerHTML = ''; ms.forEach((m) => s.insertAdjacentHTML('beforeend', `<option>${m}</option>`)); }
const mode = () => document.querySelector('input[name=mode]:checked').value;
const ctxBody = (extra) => ({ provider: $('#provider').value, base: $('#base').value, key: $('#key').value, model: $('#model').value, mode: mode(), ...extra });
const posCN = (p) => ({ before_prompt: '系统前置（聊天记录之前）', after_user: '末条消息之后', in_chat: '聊天记录中间（深度注入）', prefill: '助手预填充', unknown: '未确定' }[p] || p);

// ---- 预探测 ----
$('#probe').onclick = async (ev) => {
  const b = ev.target; b.disabled = true; const out = $('#probe-out'); out.textContent = '探测中…';
  try {
    const r = await api('/api/probe', ctxBody()); const bl = r.baseline;
    const pill = bl.present === true ? '<span class="pill yes">检测到预设</span>'
      : bl.present === false ? '<span class="pill no">几乎无注入</span>'
      : '<span class="pill">无法判定（usage 不可用）</span>';
    let h = `${pill}\n<span class="k">估算注入量</span>：${bl.injectedTokens ?? '—'} tokens`;
    if (bl.fit) h += `  <span class="k">拟合R²</span>：${bl.fit.r2}`;
    if (r.structure) h += `\n<span class="k">注入位置</span>：${posCN(r.structure.position)}`;
    out.innerHTML = h;
  } catch (e) { out.textContent = '探测失败：' + e.message; }
  finally { b.disabled = false; }
};

// ---- 提取（SSE 流式）----
$('#extract').onclick = async (ev) => {
  const b = ev.target; b.disabled = true;
  const prog = $('#progress'); prog.classList.remove('hidden');
  const bar = prog.querySelector('i'), txt = prog.querySelector('span');
  const stream = $('#stream'); stream.classList.remove('hidden'); stream.textContent = '';
  bar.style.width = '4%'; txt.textContent = '连接中…';
  try {
    const res = await fetch('/api/extract-stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gitm-token': TOKEN }, body: JSON.stringify(ctxBody()),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `HTTP ${res.status}`); }
    await readStream(res, (ev) => handleEvent(ev, { bar, txt, stream }));
  } catch (e) { txt.textContent = '失败：' + e.message; }
  finally { b.disabled = false; }
};

async function readStream(res, onEvent) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) if (line.startsWith('data:')) { try { onEvent(JSON.parse(line.slice(5).trim())); } catch {} }
    }
  }
}

function handleEvent(ev, ui) {
  const { bar, txt, stream } = ui;
  switch (ev.stage) {
    case 'baseline': txt.textContent = ev.msg; bar.style.width = '8%'; break;
    case 'baseline_done': txt.textContent = ev.present ? `检测到预设（约${ev.injectedTokens} tokens）` : '几乎无注入'; bar.style.width = '15%'; break;
    case 'structural': txt.textContent = ev.msg; bar.style.width = '20%'; break;
    case 'structural_done': txt.textContent = '位置：' + posCN(ev.position); bar.style.width = '25%'; break;
    case 'extract': txt.textContent = ev.msg; bar.style.width = `${25 + Math.round((ev.done / ev.total) * 60)}%`; break;
    case 'delta': stream.textContent += ev.text; stream.scrollTop = stream.scrollHeight; break;
    case 'run_done': stream.textContent += `\n—— 第${ev.run}轮完成（${ev.length}字）——\n`; break;
    case 'result': bar.style.width = '100%'; txt.textContent = '完成 ♡'; renderResult(ev); break;
    case 'error': txt.textContent = '出错：' + ev.error; break;
  }
}

function renderResult(r) {
  STATE.entries = r.entries; STATE.meta = { position: r.position, sampling: {} };
  // 标记动态段：若条目内任意行在 segments 中为 dynamic
  const dynLines = new Set(r.segments.filter((s) => s.dynamic).map((s) => s.text.trim()));
  $('#overall-conf').textContent = `整体置信度 ${(r.confidence * 100 || 0).toFixed(0)}% · ${posCN(r.position)}`;
  const box = $('#entries'); box.innerHTML = '';
  STATE.entries.forEach((e, i) => {
    const low = e.confidence != null && e.confidence < 0.6;
    const hasDyn = e.content.split('\n').some((l) => dynLines.has(l.trim()));
    const d = document.createElement('div'); d.className = 'entry' + (low ? ' low' : '');
    d.innerHTML = `<div class="entry-h"><span class="role">${e.role}</span>
      <input value="${esc(e.name)}" data-i="${i}" class="name"/>
      ${hasDyn ? '<span class="dyn">含动态</span>' : ''}
      <span class="cf">${e.confidence != null ? '置信 ' + Math.round(e.confidence * 100) + '%' : ''}</span></div>
      <textarea data-i="${i}">${esc(e.content)}</textarea>`;
    box.appendChild(d);
  });
  box.querySelectorAll('textarea').forEach((t) => (t.oninput = () => (STATE.entries[t.dataset.i].content = t.value)));
  box.querySelectorAll('.name').forEach((t) => (t.oninput = () => (STATE.entries[t.dataset.i].name = t.value)));
  $('#result-card').style.display = 'block';
  $('#eval-card').style.display = 'block';
  $('#result-card').scrollIntoView({ behavior: 'smooth' });
}

// ---- 对照评分 ----
$('#do-eval').onclick = async (ev) => {
  const b = ev.target; b.disabled = true;
  try {
    let original = $('#truth').value.trim();
    if (!original) throw new Error('先粘贴原始预设');
    try { original = JSON.parse(original); } catch { /* 当纯文本 */ }
    const r = await api('/api/eval', { original, entries: STATE.entries });
    $('#eval-sum').textContent = `逐条还原率 ${r.overall}% · 整体相似 ${r.wholeText}% · 覆盖 ${r.entriesCovered}/${r.entriesTotal}`;
    const out = $('#eval-out'); out.innerHTML = '';
    r.perEntry.forEach((e) => {
      out.insertAdjacentHTML('beforeend',
        `<div class="ev-row"><span class="nm">${esc(e.name)}</span>
         <div class="ev-bar"><i style="width:${e.recovery}%"></i></div>
         <span>${e.recovery}%</span><span class="st ${e.status}">${e.status}</span></div>`);
    });
  } catch (e) { alert('评分失败：' + e.message); }
  finally { b.disabled = false; }
};

// ---- 导出 ----
async function doExport(format) {
  try {
    const r = await api('/api/export', { entries: STATE.entries, meta: STATE.meta, format });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.content], { type: r.mime })); a.download = r.filename; a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { alert('导出失败：' + e.message); }
}
$('#exp-st').onclick = () => doExport('st');
$('#exp-txt').onclick = () => doExport('txt');
$('#exp-md').onclick = () => doExport('md');

function esc(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
