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
const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(Number(value || 0));
const dateTime = value => value ? new Date(value).toLocaleString('ru-RU') : '—';

function renderOverview() {
  qs('#statusGrid').innerHTML = snapshot.statuses.map(item => `<article class="status-card"><div class="status-row"><strong>${item.name}</strong><span class="dot ${item.status}"></span></div><small>${item.note}</small></article>`).join('');
  qs('#metricGrid').innerHTML = snapshot.metrics.map(item => `<article class="metric-card"><small>${item.label}</small><strong>${item.value}</strong><span class="delta ${item.direction}">${item.delta}</span></article>`).join('');
  const maxFunnel = Math.max(1, ...snapshot.funnel.map(x => x.value));
  qs('#funnel').innerHTML = snapshot.funnel.map(item => `<div class="funnel-row"><strong>${item.label}</strong><div class="bar"><i style="width:${Math.max(5, item.value / maxFunnel * 100)}%"></i></div><span>${item.value}</span></div>`).join('');
}

renderOverview();
qs('#projects').innerHTML = snapshot.projects.map(item => `<div class="project-row"><div><strong>${item.name}</strong><div class="project-meta">${item.meta}</div></div><div class="bar"><i style="width:${item.progress}%"></i></div><span class="pill ${item.status}">${item.label}</span></div>`).join('');
qs('#missingPreview').innerHTML = snapshot.dataAudit.filter(x => x.status === 'missing').slice(0, 3).map(item => `<article class="missing-card"><strong>${item.metric}</strong><p>${item.reason}</p></article>`).join('');
const measuredCount = snapshot.dataAudit.filter(x => x.status === 'measured').length;
const manualCount = snapshot.dataAudit.filter(x => x.status === 'manual').length;
qs('#coverageLabel').textContent = `Покрытие данных: ${Math.round((measuredCount + manualCount * .5) / snapshot.dataAudit.length * 100)}%`;
qs('#dataAudit').innerHTML = snapshot.dataAudit.map(item => `<div class="audit-row"><strong>${item.metric}</strong><span class="audit-status ${item.status}">${item.label}</span><p>${item.reason}</p></div>`).join('');

const titles = { overview: 'Обзор компании', sales: 'Продажи', production: 'Производство', finance: 'Финансы', data: 'Качество данных', sources: 'Источники данных' };
function switchView(view) {
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === view));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  qs('#page-title').textContent = titles[view];
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-view-jump]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.viewJump)));

function renderSources(sources) {
  qs('#sourcesGrid').innerHTML = sources.map(source => `<article class="source-card"><div class="source-head"><div><small>${source.category}</small><h3>${source.name}</h3></div><span class="source-state ${source.effective_status}">${source.effective_status === 'healthy' ? 'Подключён' : source.effective_status === 'warning' ? 'Устарели данные' : source.effective_status === 'error' ? 'Ошибка' : 'Не настроен'}</span></div><p>Режим: ${source.connection_mode}</p><p>${source.last_success_at ? `Последняя синхронизация: ${dateTime(source.last_success_at)}` : 'Синхронизаций ещё не было'}</p>${source.last_error ? `<p class="source-error">${source.last_error}</p>` : ''}</article>`).join('');
}

async function loadSources() {
  const config = window.ANIX_CONFIG || {};
  if (!config.supabaseUrl) {
    qs('#sourceNotice').textContent = 'Supabase пока не привязан.';
    renderSources(sourceFallback);
    return;
  }
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

function renderSales(payload) {
  const { summary, stages, recent, source, generated_at } = payload;
  qs('#salesMetricGrid').innerHTML = [
    { label: 'Все сделки', value: summary.total_leads, note: 'в базе amoCRM' },
    { label: 'Открытые сделки', value: summary.open_leads, note: 'сейчас в работе' },
    { label: 'Объём воронки', value: money(summary.pipeline_value), note: 'сумма открытых сделок' },
    { label: 'Средний открытый чек', value: money(summary.average_open_check), note: 'по заполненным бюджетам' }
  ].map(item => `<article class="metric-card"><small>${item.label}</small><strong>${item.value}</strong><span class="delta up">${item.note}</span></article>`).join('');

  const maxCount = Math.max(1, ...stages.map(stage => stage.count));
  qs('#salesStages').innerHTML = stages.length ? stages.map(stage => `<div class="funnel-row"><strong>${stage.name}</strong><div class="bar"><i style="width:${Math.max(5, stage.count / maxCount * 100)}%"></i></div><span>${stage.count}<small> · ${money(stage.value)}</small></span></div>`).join('') : '<p>Открытых сделок нет.</p>';
  qs('#recentLeads').innerHTML = recent.length ? recent.map(lead => `<div class="project-row"><div><strong>${lead.name || `Сделка #${lead.external_id}`}</strong><div class="project-meta">${lead.status_name || 'Этап не определён'} · ${dateTime(lead.updated_at_source)}</div></div><span>${money(lead.price)}</span></div>`).join('') : '<p>Сделок пока нет.</p>';

  qs('#salesUpdated').textContent = source?.last_success_at ? `синхронизация ${dateTime(source.last_success_at)}` : `срез ${dateTime(generated_at)}`;
  qs('#overviewSalesUpdated').textContent = source?.last_success_at ? dateTime(source.last_success_at) : 'amoCRM';
  qs('#salesNotice').textContent = `Данные загружены из amoCRM. Последняя успешная синхронизация: ${dateTime(source?.last_success_at)}.`;

  snapshot.metrics[0] = { label: 'Открытых сделок', value: String(summary.open_leads), delta: `${summary.total_leads} всего`, direction: 'up' };
  snapshot.metrics[1] = { label: 'Объём воронки', value: money(summary.pipeline_value), delta: `средний чек ${money(summary.average_open_check)}`, direction: 'up' };
  snapshot.funnel = stages.map(stage => ({ label: stage.name, value: stage.count }));
  renderOverview();
}

async function loadSales() {
  const config = window.ANIX_CONFIG || {};
  if (!config.supabaseUrl) return;
  qs('#salesNotice').textContent = 'Загружаю реальные сделки и этапы…';
  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/sales-summary`, { headers: config.supabaseAnonKey ? { apikey: config.supabaseAnonKey } : {} });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    renderSales(payload);
  } catch (error) {
    qs('#salesNotice').textContent = `Не удалось загрузить продажи: ${error.message}`;
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
