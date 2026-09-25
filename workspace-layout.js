// Compose existing, independently refreshed reports into focused business workspaces.
(() => {
 const q=s=>document.querySelector(s);
 const nav=q('.sidebar nav');
 nav.innerHTML=`<span class="nav-group-label">Управление Anix</span><button class="nav-item active" data-view="overview">Обзор руководителя</button><button class="nav-item" data-view="sales">01 · Продажи</button><button class="nav-item" data-view="marketing">02 · Маркетинг</button><button class="nav-item" data-view="production">03 · Производство</button><button class="nav-item" data-view="business">04 · Бизнес-модель</button><details class="system-nav"><summary>Настройки и источники</summary><button class="nav-item" data-view="content">Редактор контента</button><button class="nav-item" data-view="data">Качество данных</button><button class="nav-item" data-view="sources">Интеграции</button></details>`;
 q('.sidebar-note').innerHTML='Anix · управление по данным<br><span>Результат → причины → действия</span>';
 const main=q('main');
 for(const id of ['marketing','business']){const s=document.createElement('section');s.id=id;s.className='view';main.append(s);}
 const pyramid=(title,rows)=>{const e=document.createElement('details');e.className='metric-method panel';e.open=true;e.innerHTML=`<summary>Пирамида метрик · ${title}</summary><p>Сверху — результат бизнеса. Ниже — показатели, которыми можно управлять. Связь проверяем по истории, она не означает автоматической причинности.</p><div class="metric-layers">${rows.map(([l,m,f])=>`<article><small>${l}</small><strong>${m}</strong><p>${f}</p></article>`).join('')}</div>`;return e;};
 const pyramids={
 sales:pyramid('Продажи',[
 ['Результат','Выручка и валовая прибыль от продаж','Оплаты и себестоимость — финансовый контур; сумма сделок не равна оплатам.'],
 ['Конверсия','Подписанные договоры × средний чек','Отслеживать когорты: лид → диалог → встреча → КП → договор.'],
 ['Качество и скорость','Конверсия этапов · цикл сделки · следующий шаг','Сроки и провалы по этапам показывают, где теряются сделки.'],
 ['Ежедневная работа','Касания · поиск · аналитика · операции CRM','Считать по автору события. Правки, задачи и касания показывать отдельно.']]),
 marketing:pyramid('Маркетинг',[
 ['Результат','Валовая прибыль от привлечённых клиентов','Нужна связь источника → заявки → сделки → оплаты и затрат.'],
 ['Спрос','Квалифицированные заявки · стоимость заявки','CPL = расходы / заявки; без расходов CPL неизвестен.'],
 ['Конверсия','Визит → CTA → форма → успешная заявка','Потери считать по последовательной воронке и одному периоду.'],
 ['Контент и охват','Публикации → охват → переходы → вовлечение','Сайт, Telegram и VK сравнивать по UTM и результату, а не только подписчикам.']]),
 production:pyramid('Производство',[
 ['Результат','Валовая прибыль проекта','Стоимость проекта − прямые затраты; нужен учёт трудозатрат и генераций.'],
 ['Выпуск','Принятые ролики / минуты · сдача в срок','Задача в YouGile не равна принятому клиентом ролику.'],
 ['Качество','Приёмка с первого раза · доля переделок','Нужны критерии приёмки и фиксация возврата на доработку.'],
 ['Поток работы','Цикл этапа · незавершённая работа · блокировки','Из YouGile: задачи, сроки, ответственные, движение по этапам.']]),
 business:pyramid('Бизнес-модель',[
 ['Устойчивость','Операционная прибыль · денежный запас','Выручка − прямые затраты − постоянные расходы; запас / месячный расход.'],
 ['Юнит-экономика','Маржа проекта · CAC · повторные продажи','CAC = затраты на привлечение / новые клиенты; считать по сегментам.'],
 ['Портфель','Средний чек · загрузка · концентрация клиентов','Сравнивать фарму, охрану труда и другие направления по марже и циклу.'],
 ['Управление','Гипотеза → эксперимент → результат → решение','Для гипотезы: метрика успеха, владелец, срок, результат.']])};
 function tabs(rootId,definitions){const root=q('#'+rootId), bar=document.createElement('div');bar.className='workspace-tabs';bar.setAttribute('role','tablist');root.prepend(bar);
 definitions.forEach(([id,label,nodes],index)=>{const panel=document.createElement('div');panel.id=id;panel.className='workspace-panel';panel.setAttribute('role','tabpanel');panel.hidden=index>0;nodes.filter(Boolean).forEach(n=>panel.append(n));root.append(panel);const b=document.createElement('button');b.id=id+'-tab';b.type='button';b.textContent=label;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(index===0));b.setAttribute('aria-controls',id);panel.setAttribute('aria-labelledby',b.id);b.addEventListener('click',()=>{[...root.children].filter(n=>n.classList.contains('workspace-panel')).forEach(n=>n.hidden=n!==panel);bar.querySelectorAll('button').forEach(x=>x.setAttribute('aria-selected',String(x===b)));});bar.append(b);});}
 const sales=q('#sales'), salesChildren=[...sales.children], history=q('.sales-history-panel');
 const flow=salesChildren.filter(n=>n!==history);
 const fold=(title,nodes)=>{const d=document.createElement('details');d.className='report-detail panel';const summary=document.createElement('summary');summary.textContent=title;d.append(summary);nodes.forEach(n=>d.append(n));return d;};
 const primary=flow.slice(0,3), remaining=flow.slice(3);
 const cycle=remaining.filter(n=>n.querySelector('#cycleSummary,#segmentCycles,#cashForecast,#stageAging'));
 const discipline=remaining.filter(n=>n.querySelector('#upcomingSales,#salesStages,#salesMissingData'));
 const results=remaining.filter(n=>!cycle.includes(n)&&!discipline.includes(n));
 const focusedFlow=[...primary,fold('Воронка, конверсии и показатели сотрудников',results),fold('Скорость этапов и прогноз поступлений',cycle),fold('Следующие шаги, состояние карточек и качество данных',discipline)];
 tabs('sales',[['sales-work','Действия сотрудников',[history]],['sales-results','Результаты и воронка',focusedFlow],['sales-plan','Прогноз месяца',[...q('#forecast').children]],['sales-method','Пирамида метрик',[pyramids.sales]]]);
 // Forecast mounts into its original element; preserve its ID and loader contract.
 const forecast=q('#forecast');forecast.classList.remove('view');q('#sales-plan').append(forecast);
 const production=q('#production'), productionChildren=[...production.children];tabs('production',[['production-work','Проекты и сроки',productionChildren],['production-method','Пирамида метрик',[pyramids.production]]]);
 const website=q('#website');website.classList.remove('view');
 const marketing=q('#marketing');marketing.innerHTML='<div class="workspace-intro"><p class="eyebrow">Привлечение и конверсия</p><h2>От контента до заявки</h2><p>Сначала результат и потери, затем гипотеза и следующий шаг.</p></div>';
 const social=document.createElement('section');social.className='panel';social.innerHTML=`<h3>Telegram и VK</h3><p>Переходы на сайт из соцсетей доступны в отчёте Метрики. Охваты, подписчики и реакции требуют данных самих площадок.</p><div class="channel-grid"><article><h3><a href="https://t.me/anixpro" target="_blank" rel="noopener noreferrer">Telegram · @anixpro ↗</a></h3><strong>Нативная статистика не подключена</strong><p>Нужны: подписчики и прирост, охват публикаций за 24 / 48 часов, пересылки, реакции, переходы по UTM, заявки.</p><p>Следующее действие: подключить экспорт статистики канала или источник с доступом к его аналитике. Токен бота сам по себе не даёт полную историю просмотров.</p></article><article><h3><a href="https://vk.ru/anixpro" target="_blank" rel="noopener noreferrer">VK · anixpro ↗</a></h3><strong>Нативная статистика не подключена</strong><p>Нужны: охват, посетители, подписки и отписки, реакции, переходы, заявки по публикациям.</p><p>Следующее действие: настроить серверный доступ к статистике сообщества для сообщества anixpro. Переходы на сайт размечать utm_source=vk.</p></article></div><div id="socialAttribution">Загружаю переходы из Метрики…</div><p class="history-caveat">Отсутствие источника не означает нулевой результат. utm_source=telegram / vk, utm_medium=social, utm_campaign=название_кампании, utm_content=идентификатор_поста.</p>`;
 tabs('marketing',[['marketing-site','Сайт и конверсия',[website]],['marketing-social','Telegram и VK',[social]],['marketing-method','Пирамида метрик',[pyramids.marketing]]]);
 const finance=q('#finance'),decisions=q('#decisions');finance.classList.remove('view');decisions.classList.remove('view');
 tabs('business',[['business-money','Деньги и экономика',[finance]],['business-decisions','Гипотезы и решения',[decisions]],['business-method','Пирамида метрик',[pyramids.business]]]);
 const overview=q('#overview');
 const destinations=[['#stalledMetricGrid','#sales-results'],['#ceoFunnelHealth','#sales-results'],['#ceoProjects','#production-work'],['#ceoCashOverview','#business-money']];
 destinations.forEach(([selector,to])=>{const node=q(selector)?.closest('section.panel');if(node)q(to).append(node);});
 const links=document.createElement('div');links.className='overview-areas';links.innerHTML=[['sales','01','Продажи','Действия сотрудников, воронка и прогноз'],['marketing','02','Маркетинг','Трафик, конверсия, контент и точки потерь'],['production','03','Производство','Сроки, загрузка и скорость этапов'],['business','04','Бизнес-модель','Деньги, экономика и проверка гипотез']].map(([id,n,title,sub])=>`<button data-view-jump="${id}"><small>${n}</small><strong>${title}</strong><span>${sub}</span></button>`).join('');overview.insertBefore(links,q('.attention-command'));
 const weekly=q('#weekly');weekly.classList.remove('view');const d=document.createElement('details');d.className='panel';d.innerHTML='<summary>Изменения за неделю</summary>';d.append(weekly);overview.append(d);
})();
