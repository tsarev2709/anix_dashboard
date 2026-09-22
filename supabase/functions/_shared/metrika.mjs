const METRICS = 'ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds';
// Cache only sanitized reports, never the OAuth credential. Per Edge isolate.
export function createMetrikaReader() {
  let cache;
  return async function readMetrika({ token, counterId = '103290769', fetcher = fetch, now = Date.now() }) {
    const base = { counter_id: String(counterId), period_days: 7 };
    if (!token) return { ...base, available: false, error: 'not_configured' };
    if (!/^\d+$/.test(String(counterId))) return { ...base, available: false, error: 'invalid_counter' };
    if (cache && cache.counterId === String(counterId) && cache.until > now) return cache.report;
    const query = async extra => {
      const params = new URLSearchParams({ ids: String(counterId), metrics: METRICS,
        date1: '6daysAgo', date2: 'today', accuracy: 'full', lang: 'ru', ...extra });
      const response = await fetcher('https://api-metrika.yandex.net/stat/v1/data?' + params,
        { headers: { Authorization: 'OAuth ' + token }, signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw new Error([401, 403].includes(response.status) ? 'access_denied' : response.status === 429 ? 'rate_limited' : 'upstream_error');
      const body = await response.json();
      if (!Array.isArray(body.totals) || body.totals.length !== 5 || body.totals.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('invalid_response');
      return body;
    };
    try {
      const [summary, daily, sources] = await Promise.all([
        query({}), query({ dimensions: 'ym:s:date', sort: 'ym:s:date', limit: '7' }),
        query({ dimensions: 'ym:s:lastSignTrafficSource', sort: '-ym:s:visits', limit: '10', include_undefined: 'true' }),
      ]);
      const rows = report => (report.data || []).map(row => ({ label: String(row.dimensions?.[0]?.name || 'Не определено'), visits: row.metrics?.[0] ?? null }));
      const report = { ...base, available: true, fetched_at: new Date(now).toISOString(),
        date1: summary.query?.date1, date2: summary.query?.date2,
        totals: Object.fromEntries(['visits', 'users', 'pageviews', 'bounce_rate', 'duration_seconds'].map((key, i) => [key, summary.totals[i]])),
        sampled: [summary, daily, sources].some(r => r.sampled === true),
        daily: rows(daily), sources: rows(sources), attribution: 'last_significant' };
      cache = { counterId: String(counterId), until: now + 300000, report };
      return report;
    } catch (error) {
      const allowed = ['access_denied', 'rate_limited', 'upstream_error', 'invalid_response'];
      return { ...base, available: false, error: allowed.includes(error?.message) ? error.message : 'unavailable' };
    }
  };
}
