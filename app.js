const snapshot = {
  generatedAt: new Date().toISOString(),
  statuses: [
    { name: 'Продажи', status: 'green', note: 'amoCRM подключена' },
    { name: 'Производство', status: 'yellow', note: 'Не видна загрузка' },
    { name: 'Финансы', status: 'yellow', note: 'Пока вручную' },
    { name: 'Команда', status: 'red', note: 'Нет фактических часов' },
    { name: 'Маркетинг', status: 'red', note: 'Системы пока нет' }
  ],
  metrics: [
    { label: 'Открытых сделок', value: '—', delta: 'загрузка из amoCRM', direction: 'up' },
    { label: 'Объём воронки', value: '—', delta: 'загрузка из amoCRM', direction: 'up' },
    { label: 'Активные проекты', value: '4', delta: 'демо до подключения YouGile', direction: 'down' },
    { label: 'Денег на счетах', value: '—', delta: 'подключим Точку', direction: 'down' }
  ],
  funnel: [{ label: 'Загрузка…', value: 1 }],
  projects: [
    { name: 'Авиандр', meta: 'финализация', progress: 82, status: 'yellow', label: 'риск' },
    { name: 'РЧК', meta: 'препродакшн', progress: 54, status: 'green', label: 'по плану' },
    { name: 'Мултон LMS', meta: 'разработка', progress: 68, status: 'green', label: 'по плану' },
    { name: 'Сиреневый туман', meta: 'питчдек', progress: 36, status: 'red', label: 'горит' }
  ],
  dataAudit: [
    { metric: 'Выручка и остаток денег', status: 'manual', label: 'Вручную', reason: 'Можно считать, но пока нет автоматической загрузки из Точки.' },
    { metric: 'Воронка продаж', status: 'measured', label: 'Измеряем', reason: 'amoCRM подключена и синхронизируется автоматически.' },
    { metric: 'Скорость прохождения сделки', status: 'measured', label: 'Измеряем', reason: 'История наблюдаемых переходов по этапам уже сохраняется.' },
    { metric: 'Маржинальность проекта', status: 'missing', label: 'Не хватает', reason: 'Нет связки доходов проекта с зарплатами, подрядчиками и софтом.' },
    { metric: 'Загрузка сотрудников', status: 'missing', label: 'Не хватает', reason: 'В YouGile нет плановых и фактических трудозатрат.' },
    { metric: 'Причина задержки', status: 'missing', label: 'Не хватает', reason: 'Нужно различать ожидание клиента, внутреннюю очередь, правки и производство.' }
  ]
};

const sourceFallback = [
  { slug: 'amocrm', name: 'amoCRM', category: 'Продажи', connection_mode: 'edge', effective_status: 'not_configured' },
  { slug: 'yougile', name: 'YouGile', category: 'Производство', connection_mode: 'edge', effective_status: 'not_configured' },
  { slug: 'tochka', name: 'Точка', category: 'Финансы', connection_mode: 'edge', effective_status: 'not_configured' },
  { slug: 'telegram', name: 'Telegram', category: 'Коммуникации', connection_mode: 'edge', effective_status: 'not_configured' },
  { slug: 'google', name: 'Google Workspace', category: 'Операции', connection_mode: 'chatgpt_connector', effective_status: 'not_configured' },
  { slug: 'anix_bridge', name: 'Anix Bridge', category: 'Локальный шлюз', connection_mode: 'local_bridge', effective_status: 'not_configured' }
];

const qs = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(Number(value || 0));
const number = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0));
const dateTime = value => value ? new Date(value).toLocaleString('ru-RU') : '—';
const shortDate = value => value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—';
const pct = value => value === null || value === undefined ? '—' : `${Math.round(Number(value || 0) * 100)}%`;
const kpiValue = item => item.isMoney ? money(item.fact) : item.fact === null ? 'нет данных' : number(item.fact);
const forecastValue = item => item.isMoney ? money(item.forecast) : item.forecast === null ? '—' : number(item.forecast);
const planValue = item => item.isMoney ? money(item.plan) : `${number(item.plan)} ${item.unit || ''}`.trim();
const stageLabel = item => item.pipeline_name ? `${item.pipeline_name} → ${item.status_name || item.name || 'Этап'}` : (item.status_name || item.name || 'Этап не определён');

function renderOverview() {
  qs('#statusGrid').innerHTML = snapshot.statuses.map(item => `<article class="status-card"><div class="status-row"><strong>${esc(item.name)}</strong><span class="dot ${item.status}"></span></div><small>${esc(item.note)}</small></article>`).join('');
  qs('#metricGrid').innerHTML = snapshot.metrics.map(item => `<article class="metric-card"><small>${esc(item.label)}</small><strong>${esc(item.value)}</strong><span class="delta ${item.direction}">${esc(item.delta)}</span></article>`).join('');
  const maxFunnel = Math.max(1, ...snapshot.funnel.map(x => x.value));
  qs('#funnel').innerHTML = snapshot.funnel.map(item => `<div class="funnel-row"><strong>${esc(item.label)}</strong><div class="bar"><i style="width:${Math.max(5, item.value / maxFunnel * 100)}%"></i></div><span>${number(item.value)}</span></div>`).join('');
}

renderOverview();
qs('#projects').innerHTML = snapshot.projects.map(item => `<div class="project-row"><div><strong>${esc(item.name)}</strong><div class="project-meta">${esc(item.meta)}</div></div><div class="bar"><i style="width:${item.progress}%"></i></div><span class="pill ${item.status}">${esc(item.label)}</span></div>`).join('');
qs('#missingPreview').innerHTML = snapshot.dataAudit.filter(x => x.status === 'missing').slice(0, 3).map(item => `<article class="missing-card"><strong>${esc(item.metric)}</strong><p>${esc(item.reason)}</p></article>`).join('');
const measuredCount = snapshot.dataAudit.filter(x => x.status === 'measured').length;
const manualCount = snapshot.dataAudit.filter(x => x.status === 'manual').length;
qs('#coverageLabel').textContent = `Покрытие данных: ${Math.round((measuredCount + manualCount * .5) / snapshot.dataAudit.length * 100)}%`;
qs('#dataAudit').innerHTML = snapshot.dataAudit.map(item => `<div class="audit-row"><strong>${esc(item.metric)}</strong><span class="audit-status ${item.status}">${esc(item.label)}</span><p>${esc(item.reason)}</p></div>`).join('');

const titles = { overview: 'Обзор компании', sales: 'Управление продажами', production: 'Производство', finance: 'Финансы', data: 'Качество данных', sources: 'Источники данных' };
function switchView(view) {
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === view));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  qs('#page-title').textContent = titles[view];
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-view-jump]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.viewJump)));

function renderSources(sources) {
  qs('#sourcesGrid').innerHTML = sources.map(source => `<article class="source-card"><div class="source-head"><div><small>${esc(source.category)}</small><h3>${esc(source.name)}</h3></div><span class="source-state ${source.effective_status}">${source.effective_status === 'healthy' ? 'Подключён' : source.effective_status === 'warning' ? 'Устарели данные' : source.effective_status === 'error' ? 'Ошибка' : 'Не настроен'}</span></div><p>Режим: ${esc(source.connection_mode)}</p><p>${source.last_success_at ? `Последняя синхронизация: ${dateTime(source.last_success_at)}` : 'Синхронизаций ещё не было'}</p>${source.last_error ? `<p class="source-error">${esc(source.last_error)}</p>` : ''}</article>`).join('');
}

async function loadSources() {
  const config = window.ANIX_CONFIG || {};
  if (!config.supabaseUrl) { qs('#sourceNotice').textContent = 'Supabase пока не привязан.'; renderSources(sourceFallback); return; }
  qs('#sourceNotice').textContent = 'Проверяю состояние источников…';
  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/source-status`, { headers: config.supabaseAnonKey ? { apikey: config.supabaseAnonKey } : {} });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || 'Неизвестная ошибка');
    renderSources(payload.sources);
    qs('#sourceNotice').textContent = `Статусы обновлены: ${dateTime(payload.generated_at)}`;
    qs('#globalSync').textContent = '● Supabase доступен';
  } catch (error) {
    qs('#sourceNotice').textContent = `Не удалось получить статусы: ${error.message}`;
    renderSources(sourceFallback);
  }
}

function renderKpis(kpis) {
  qs('#salesKpis').innerHTML = kpis.map(item => {
    const completion = item.completion === null ? null : Math.min(1.25, item.completion);
    const matched = item.matched_statuses?.map(status => status.pipeline_name ? `${status.pipeline_name} → ${status.name}` : status.name).join(', ');
    let sourceNote = 'источник данных не подключён';
    if (item.source === 'tasks') {
      sourceNote = item.key === 'touches'
        ? `по выполненным задачам: ${number(item.task_breakdown?.first_touches || 0)} первых касаний + ${number(item.task_breakdown?.follow_ups || 0)} follow-up`
        : `по выполненным задачам звонков / встреч: ${number(item.task_breakdown?.calls || 0)}`;
    } else if (item.measurable) {
      sourceNote = matched ? `по этапам amoCRM: ${matched}` : 'подходящий этап в amoCRM пока не найден — KPI не включён в общий прогноз';
    }
    return `<div class="kpi-row ${item.status}">
      <div class="kpi-name"><strong>${esc(item.label)}</strong><small>${esc(sourceNote)}</small></div>
      <div><small>План</small><strong>${planValue(item)}</strong></div>
      <div><small>Факт</small><strong>${kpiValue(item)}</strong></div>
      <div><small>Прогноз</small><strong>${forecastValue(item)}</strong></div>
      <div class="kpi-progress"><span>${item.completion === null ? 'не измеряем' : pct(item.completion)}</span><div class="bar"><i style="width:${completion === null ? 0 : completion * 100}%"></i></div></div>
    </div>`;
  }).join('');
}

function renderPyramid(kpis) {
  const reversed = [...kpis].reverse();
  qs('#metricPyramid').innerHTML = reversed.map((item, index) => {
    const width = 52 + index * (46 / Math.max(1, reversed.length - 1));
    return `<div class="pyramid-step ${item.status}" style="width:${width}%"><div><strong>${esc(item.label)}</strong><small>${item.measurable ? `${kpiValue(item)} из ${planValue(item)}` : 'данных пока нет'}</small></div><span>${item.completion === null ? '—' : pct(item.completion)}</span></div>`;
  }).join('');
}

function renderManager(managers, summary) {
  const manager = managers[0];
  if (!manager) { qs('#managerPerformance').innerHTML = '<p class="empty-state">Ответственный пользователь в сделках не определён.</p>'; return; }
  const initial = String(manager.name || 'П').trim().charAt(0).toUpperCase();
  qs('#managerPerformance').innerHTML = `<article class="manager-card">
    <div class="manager-avatar">${esc(initial)}</div>
    <div><p class="eyebrow">Основной активный продавец</p><h3>${esc(manager.name)}</h3><p class="manager-note">${manager.email ? esc(manager.email) : 'Пользователь amoCRM'}${manager.is_admin ? ' · администратор' : ''}. Основным считаем пользователя с наибольшим числом выполненных действий месяца.</p></div>
  </article>
  <div class="manager-stats">
    <div><small>Выполнено задач месяца</small><strong>${number(manager.completed_tasks_month)}</strong></div>
    <div><small>Новых сделок по событиям</small><strong>${number(manager.created_month)}</strong></div>
    <div><small>Открыто в работе</small><strong>${number(manager.open)}</strong></div>
    <div><small>Доля открытых сделок</small><strong>${summary.open_leads ? pct(manager.open / summary.open_leads) : '—'}</strong></div>
  </div>`;
}

function renderSales(payload) {
  const { summary, stages, recent, source, generated_at, period, kpis, managers, attention, upcoming, missing_data } = payload;
  const score = summary.overall_forecast;
  const scoreClass = score === null ? 'neutral' : score >= 1 ? 'green' : score >= .8 ? 'yellow' : score >= .6 ? 'orange' : 'red';
  qs('#salesScore').textContent = pct(score);
  qs('#salesScore').className = scoreClass;
  qs('#salesVerdict').textContent = score === null ? 'Для прогноза пока недостаточно измеримых KPI' : score >= 1 ? 'По измеримым KPI отдел идёт к выполнению плана' : score >= .8 ? 'План достижим, но есть показатели риска' : score >= .6 ? 'Темп ниже плана — нужна коррекция воронки' : 'По измеримым этапам план месяца под угрозой';
  qs('#salesPeriod').textContent = `${period.elapsed_days} из ${period.days_in_month} дней месяца`;

  const budgetKnown = summary.priced_open_leads > 0;
  qs('#salesMetricGrid').innerHTML = [
    { label: 'Прогноз KPI', value: pct(score), note: score === null ? 'недостаточно измеримых данных' : 'среднее по реально измеримым KPI', tone: scoreClass },
    { label: 'Новых сделок', value: number(summary.new_leads_month), note: `${number(summary.imported_or_created_month)} создано или импортировано в amoCRM`, tone: 'neutral' },
    { label: 'Открытых сделок', value: number(summary.open_leads), note: `${number(summary.total_leads)} всего в базе`, tone: 'neutral' },
    { label: 'Объём воронки', value: budgetKnown ? money(summary.pipeline_value) : '—', note: budgetKnown ? `бюджет заполнен у ${number(summary.priced_open_leads)} сделок · средний чек ${money(summary.average_open_check)}` : 'бюджеты открытых сделок не заполнены', tone: 'neutral' }
  ].map(item => `<article class="sales-summary-card ${item.tone}"><small>${item.label}</small><strong>${item.value}</strong><span>${item.note}</span></article>`).join('');

  renderKpis(kpis);
  renderPyramid(kpis);
  renderManager(managers, summary);

  qs('#upcomingSales').innerHTML = upcoming.length ? upcoming.map(item => `<div class="sales-list-row"><div class="date-chip"><strong>${shortDate(item.at)}</strong><small>${new Date(item.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small></div><div><strong>${esc(item.name)}</strong><small>${esc(stageLabel(item))} · ${esc(item.responsible_user_name)}</small></div></div>`).join('') : '<div class="empty-state"><strong>Ближайшие задачи не видны</strong><p>В синхронизированных сделках нет поля ближайшей задачи. Это важный пробел дисциплины продаж.</p></div>';

  qs('#attentionCount').textContent = `${attention.length} показано`;
  qs('#salesAttention').innerHTML = attention.length ? attention.map(lead => `<div class="attention-row"><div><strong>${esc(lead.name)}</strong><small>${esc(stageLabel(lead))} · ${esc(lead.responsible_user_name)}</small></div><div><strong>${lead.stale_days} дн.</strong><small>без обновления</small></div><span>${lead.price > 0 ? money(lead.price) : 'бюджет не указан'}</span></div>`).join('') : '<p class="empty-state">Сделок без движения более пяти дней нет.</p>';

  const maxCount = Math.max(1, ...stages.map(stage => stage.count));
  qs('#salesStages').innerHTML = stages.length ? stages.map(stage => `<div class="funnel-row sales-funnel"><strong>${esc(stage.pipeline_name ? `${stage.pipeline_name} → ${stage.name}` : stage.name)}</strong><div class="bar"><i style="width:${Math.max(5, stage.count / maxCount * 100)}%"></i></div><span>${number(stage.count)}<small>${stage.priced_count ? ` · ${money(stage.value)}` : ' · бюджеты не указаны'}</small></span></div>`).join('') : '<p>Открытых сделок нет.</p>';
  qs('#recentLeads').innerHTML = recent.length ? recent.map(lead => `<div class="recent-row"><div><strong>${esc(lead.name || `Сделка #${lead.external_id}`)}</strong><small>${esc(stageLabel(lead))} · ${esc(lead.responsible_user_name)} · ${dateTime(lead.updated_at_source)}</small></div><span>${lead.price > 0 ? money(lead.price) : '—'}</span></div>`).join('') : '<p>Сделок пока нет.</p>';

  qs('#salesMissingData').innerHTML = missing_data.map(item => `<article class="missing-card priority-${item.priority}"><strong>${esc(item.metric)}</strong><p>${esc(item.reason)}</p></article>`).join('');
  qs('#salesUpdated').textContent = source?.last_success_at ? `синхронизация ${dateTime(source.last_success_at)}` : `срез ${dateTime(generated_at)}`;
  qs('#overviewSalesUpdated').textContent = source?.last_success_at ? dateTime(source.last_success_at) : 'amoCRM';
  qs('#salesNotice').textContent = 'Импортированная база отделена от фактических действий продавца. Касания и звонки считаются по выполненным задачам, этапные KPI — по реальным переходам в amoCRM.';

  snapshot.metrics[0] = { label: 'Открытых сделок', value: String(summary.open_leads), delta: `${summary.completed_tasks_month} выполненных задач в месяце`, direction: 'up' };
  snapshot.metrics[1] = { label: 'Объём воронки', value: budgetKnown ? money(summary.pipeline_value) : 'нет данных', delta: budgetKnown ? `прогноз KPI ${pct(score)}` : 'бюджеты сделок не заполнены', direction: score !== null && score >= .8 ? 'up' : 'down' };
  snapshot.funnel = stages.map(stage => ({ label: stage.pipeline_name ? `${stage.pipeline_name} → ${stage.name}` : stage.name, value: stage.count }));
  snapshot.sales = payload;
  renderOverview();
}

async function loadSales() {
  const config = window.ANIX_CONFIG || {};
  if (!config.supabaseUrl) return;
  qs('#salesNotice').textContent = 'Загружаю реальные сделки, KPI и прогнозы…';
  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/sales-summary`, { headers: config.supabaseAnonKey ? { apikey: config.supabaseAnonKey } : {} });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    renderSales(payload);
  } catch (error) {
    qs('#salesNotice').textContent = `Не удалось загрузить продажи: ${error.message}`;
    qs('#salesVerdict').textContent = 'Данные продаж временно недоступны';
  }
}

qs('#refreshSources').addEventListener('click', loadSources);
qs('#refreshSales').addEventListener('click', loadSales);
loadSources();
loadSales();
qs('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `anix-dashboard-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});