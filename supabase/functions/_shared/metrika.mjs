const METRICS = 'ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds';
// Cache only sanitized reports, never the OAuth credential. Per Edge isolate.
export function createMetrikaReader() {
  let cache;
  return async function readMetrika({ token, counterId = '103290769', fetcher = fetch, now = Date.now(), days = 7, detailed = false }) {
    days = [7,30,90].includes(Number(days)) ? Number(days) : 7;
    const base = { counter_id: String(counterId), period_days: days };
    const cacheKey = `${counterId}:${days}:${detailed}`;
    if (!token) return { ...base, available: false, error: 'not_configured' };
    if (!/^\d+$/.test(String(counterId))) return { ...base, available: false, error: 'invalid_counter' };
    if (cache && cache.key === cacheKey && cache.until > now) return cache.report;
    const query = async extra => {
      const params = new URLSearchParams({ ids: String(counterId), metrics: METRICS,
        date1: `${days-1}daysAgo`, date2: 'today', accuracy: 'full', lang: 'ru', ...extra });
      const response = await fetcher('https://api-metrika.yandex.net/stat/v1/data?' + params,
        { headers: { Authorization: 'OAuth ' + token }, signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw new Error([401, 403].includes(response.status) ? 'access_denied' : response.status === 429 ? 'rate_limited' : 'upstream_error');
      const body = await response.json();
      if (!Array.isArray(body.totals) || body.totals.length !== 5 || body.totals.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('invalid_response');
      return body;
    };
    try {
      const [summary, daily, sources] = await Promise.all([
        query({}), query({ dimensions: 'ym:s:date', sort: 'ym:s:date', limit: String(days) }),
        query({ dimensions: 'ym:s:lastSignTrafficSource', sort: '-ym:s:visits', limit: '10', include_undefined: 'true' }),
      ]);
      const rows = report => (report.data || []).map(row => ({ label: String(row.dimensions?.[0]?.name || 'Не определено'), visits: row.metrics?.[0] ?? null }));
      const report = { ...base, available: true, fetched_at: new Date(now).toISOString(),
        date1: summary.query?.date1, date2: summary.query?.date2,
        totals: Object.fromEntries(['visits', 'users', 'pageviews', 'bounce_rate', 'duration_seconds'].map((key, i) => [key, summary.totals[i]])),
        sampled: [summary, daily, sources].some(r => r.sampled === true),
        daily: rows(daily), sources: rows(sources), attribution: 'last_significant' };
      if (detailed) {
        const extra = await Promise.allSettled([
          query({dimensions:'ym:s:startURL',sort:'-ym:s:visits',limit:'50'}),
          query({dimensions:'ym:s:deviceCategory',sort:'-ym:s:visits',limit:'10'}),
          query({dimensions:'ym:s:UTMSource,ym:s:UTMCampaign,ym:s:UTMContent',sort:'-ym:s:visits',limit:'50',include_undefined:'true'}),
          query({date1:`${2*days-1}daysAgo`,date2:`${days}daysAgo`}),
        ]);
        const detailedRows = r => (r.data||[]).map(row=>({label:(row.dimensions||[]).map(d=>d.name||'Не размечено').join(' / '),visits:row.metrics?.[0]??null,users:row.metrics?.[1]??null,bounce_rate:row.metrics?.[3]??null,duration_seconds:row.metrics?.[4]??null}));
        report.details = Object.fromEntries(['pages','devices','campaigns','previous'].map((key,i)=>[key,extra[i].status==='fulfilled'?{available:true,rows:key==='previous'?undefined:detailedRows(extra[i].value),totals:extra[i].value.totals,sampled:extra[i].value.sampled===true,total_rows:extra[i].value.total_rows}:{available:false}]));
        try {
          const response = await fetcher(`https://api-metrika.yandex.net/management/v1/counter/${counterId}/goals`,{headers:{Authorization:'OAuth '+token},signal:AbortSignal.timeout(10000),redirect:'error'});
          if(!response.ok) throw Error('goals_unavailable');
          const goals=(await response.json()).goals;
          if(!Array.isArray(goals)) throw Error('goals_unavailable');
          const selected=goals.slice(0,20);
          if(!selected.length) report.goals={available:true,rows:[],total:0};
          else {
            const params=new URLSearchParams({ids:String(counterId),metrics:selected.flatMap(g=>[`ym:s:goal${Number(g.id)}reaches`,`ym:s:goal${Number(g.id)}conversionRate`]).join(','),date1:`${days-1}daysAgo`,date2:'today',accuracy:'full'});
            const res=await fetcher('https://api-metrika.yandex.net/stat/v1/data?'+params,{headers:{Authorization:'OAuth '+token},signal:AbortSignal.timeout(10000),redirect:'error'});
            if(!res.ok) throw Error('goals_unavailable');
            const result=await res.json();
            if(!Array.isArray(result.totals)||result.totals.length!==selected.length*2) throw Error('goals_unavailable');
            report.goals={available:true,total:goals.length,sampled:result.sampled===true,rows:selected.map((g,i)=>({id:g.id,name:g.name,type:g.type,reaches:result.totals[2*i],conversion_rate:result.totals[2*i+1]}))};
          }
        } catch {report.goals={available:false,rows:[]};}
      }
      cache = { key: cacheKey, until: now + 300000, report };
      return report;
    } catch (error) {
      const allowed = ['access_denied', 'rate_limited', 'upstream_error', 'invalid_response'];
      return { ...base, available: false, error: allowed.includes(error?.message) ? error.message : 'unavailable' };
    }
  };
}
