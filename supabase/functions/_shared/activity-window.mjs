import { moscowDay, DAY } from './time.mjs';
export function activityWindow(filters={}, now=new Date()) {
 const today=moscowDay(now),from=filters.from||today.slice(0,7)+'-01',to=filters.to||today;
 const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
 if(!valid(from)||!valid(to)||from>to||Date.parse(to)-Date.parse(from)>366*DAY)throw Error('invalid_period');
 const monday=new Date(today+'T00:00:00Z');monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
 const since=[from,today.slice(0,7)+'-01',monday.toISOString().slice(0,10)].sort()[0];
 const end=[to,today].sort().at(-1);
 return {from,to,since:new Date(since+'T00:00:00+03:00').toISOString(),until:new Date(Date.parse(end+'T00:00:00+03:00')+DAY).toISOString()};
}
