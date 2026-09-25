import { timestampMs, DAY } from './time.mjs';
// Operational defaults for a five-person team. Old prospecting cards are a backlog,
// not individual emergencies. Dates and current stage govern admission, value ranks ties.
export function salesAttention(item, now=Date.now()) {
 const late=/кп|предлож|переговор|согласован|договор|счет|счёт|предоплат|постоплат/.test(String(item.stage_name||'').toLowerCase());
 const early=/поиск|новая компания|первое касание/.test(String(item.stage_name||'').toLowerCase());
 const idle=item.stale_days;
 const overdue=Number(item.overdue_task_days||0);
 const next=timestampMs(item.next_step_at);
 const promised=timestampMs(item.expected_close_date);
 const closing=promised>0&&promised<=now+7*DAY&&promised>=now-30*DAY;
 const future=next>now;
 const dueSoon=next>now&&next<=now+2*DAY;
 if(early&&!closing&&!dueSoon)return {bucket:'backlog',reason:'Холодная база до диалога — пакетная обработка'};
 const dormant=idle!=null&&idle>60&&!late&&!closing&&!dueSoon&&!(overdue>0&&overdue<=14);
 if(dormant)return {bucket:'backlog',reason:'Ранняя сделка без обновлений более 60 дней'};
 const reasons=[];let urgent=false,score=0;
 if(overdue>=2&&(late||closing||!early&&idle!=null&&idle<=30)){reasons.push(`задача просрочена на ${overdue} дн.`);urgent=true;score+=60+Math.min(overdue,14);}
 if(closing&&(!future||overdue>=2)){reasons.push('плановая дата договора прошла или наступит в течение 7 дней');urgent=true;score+=80;}
 if(late&&!item.has_next_step&&idle!=null&&idle>=3){reasons.push('поздний этап без следующего шага ≥3 дней');score+=45;}
 if(late&&idle!=null&&idle>=14&&!future){reasons.push(`поздний этап без обновлений ${idle} дн.`);score+=35;}
 if(dueSoon){reasons.push('следующий шаг в ближайшие 48 часов');score+=25;}
 if(!late&&idle!=null&&idle>=14&&idle<=60&&!item.has_next_step){reasons.push('активная ранняя сделка без следующего шага');score+=10;}
 if(!reasons.length)return {bucket:'monitor',reason:'Нет сигнала для текущего списка внимания'};
 return {bucket:'attention',severity:urgent?'critical':'risk',score:score+(late?20:0),reasons};
}
export function attentionQueue(alerts,limit=100){
 const rank={critical:0,risk:1,info:2};
 const unique=[...new Map(alerts.map(a=>[a.id,a])).values()].sort((a,b)=>(rank[a.severity]??2)-(rank[b.severity]??2)||Number(b.priority_score||0)-Number(a.priority_score||0)||Number(b.amount||0)-Number(a.amount||0)||String(a.id).localeCompare(String(b.id)));
 const items=unique.slice(0,limit);
 return {items,summary:{total:items.length,critical:items.filter(a=>a.severity==='critical').length,risk:items.filter(a=>a.severity==='risk').length,info:items.filter(a=>a.severity==='info').length,candidates:unique.length,deferred:Math.max(0,unique.length-limit),deferred_critical:unique.slice(limit).filter(a=>a.severity==='critical').length,limit}};
}
