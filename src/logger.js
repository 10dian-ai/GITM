// logger.js —— 分级日志 + 密钥脱敏（统一出口，杜绝 key 落日志）
import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const CUR = LEVELS[config.logLevel] ?? 20;

/** 把常见密钥形态掩码化 */
export function redact(input) {
  if (input == null) return input;
  let s = typeof input === 'string' ? input : safe(input);
  s = s
    .replace(/\b(sk-[A-Za-z0-9_\-]{4})[A-Za-z0-9_\-]+/g, '$1…')
    .replace(/\b(AIza[0-9A-Za-z_\-]{4})[0-9A-Za-z_\-]+/g, '$1…')
    .replace(/(Bearer\s+[A-Za-z0-9_\-]{4})[A-Za-z0-9_\-.=]+/gi, '$1…')
    .replace(/("?(?:api[_-]?key|x-api-key|authorization|token|key)"?\s*[:=]\s*"?)([^"\s,}]{0,4})[^"\s,}]*/gi, '$1$2…');
  return s;
}

function safe(o) { try { return JSON.stringify(o); } catch { return String(o); } }

function emit(level, msg, meta) {
  if (LEVELS[level] < CUR) return;
  const t = new Date().toISOString();
  const line = `[${t}] ${level.toUpperCase()} ${redact(msg)}` + (meta !== undefined ? ' ' + redact(safe(meta)) : '');
  (level === 'error' ? console.error : console.log)(line);
}

export const log = {
  debug: (m, meta) => emit('debug', m, meta),
  info:  (m, meta) => emit('info', m, meta),
  warn:  (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
  redact,
};
