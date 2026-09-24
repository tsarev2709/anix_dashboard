export const DAY = 86400000;
export function timestampMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value));
  const n = numeric ? Number(value) : Date.parse(value);
  const ms = numeric && n > 0 && n < 100000000000 ? n * 1000 : n;
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}
export function daysSince(value, nowMs = Date.now()) {
  const at = timestampMs(value);
  return at ? Math.max(0, Math.floor((nowMs - at) / DAY)) : null;
}
export const moscowDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(value));
