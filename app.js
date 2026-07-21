const snapshot = {
  generatedAt: new Date().toISOString(),
  statuses: [
    { name: 'Продажи', status: 'yellow', note: 'Есть активность, мало истории' },
    { name: 'Производство', status: 'yellow', note: 'Не видна загрузка' },
    { name: 'Финансы', status: 'green', note: 'Остаток контролируется' },
    { name: 'Команда', status: 'red', note: 'Нет фактических часов' },
    { name: 'Маркетинг', status: 'red', note: 'Системы пока нет' }
  ],
  metrics: [
    { label: 'Денег на счетах', value: '1,84 млн ₽', delta: '+12% к началу месяца', direction: 'up' },
    { label: 'Воронка продаж', value: '6,3 млн ₽', delta: 'взвешенный прогноз: 2,1 млн ₽', direction: 'up' },
    { label: 'Активные проекты', value: '4', delta: '1 проект в зоне риска', direction: 'down' },
    { label: 'Выручка месяца', value: '1,25 млн ₽', delta: '62% от условного плана', direction: 'down' }
  ],
  funnel: [
    { label: 'Касания', value: 218 }, { label: 'Ответы', value: 31 }, { label: 'Созвоны', value: 12 }, { label: 'КП', value: 7 }, { label: 'Сделки', value: 2 }
  ],
  projects: [
    { name: 'Авиандр', meta: 'финализация', progress: 82, status: 'yellow', label: 'риск' },
    { name: 'РЧК', meta: 'препродакшн', progress: 54, status: 'green', label: 'по плану' },
    { name: 'Мултон LMS', meta: 'разработка', progress: 68, status: 'green', label: 'по плану' },
    { name: 'Сиреневый туман', meta: 'питчдек', progress: 36, status: 'red', label: 'горит' }
  ],
  dataAudit: [
    { metric: 'Выручка и остаток денег', status: 'manual', label: 'Вручную', reason: 'Можно считать, но пока нет автоматической загрузки из Точки.' },
    { metric: 'Воронка продаж', status: 'measured', label: 'Измеряем', reason: 'amoCRM уже хранит сделки и этапы. Нужно проверить дисциплину заполнения.' },
    { metric: 'Скорость прохождения сделки', status: 'missing', label: 'Не хватает', reason: 'Нужно сохранять дату входа и выхода с каждого этапа.' },
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
qs('#statusGrid').innerHTML = snapshot.statuses.map(item => `<article class="status-card"><div class="status-row"><strong>${item.name}</strong><span class="dot ${item.status}"></span></div><small>${item.note}</small></article>`).join('');
qs('#metricGrid').innerHTML = snapshot.metrics.map(item => `<article class="metric-card"><small>${item.label}</small><strong>${item.value}</strong><span class="delta ${item.direction}">${item.delta}</span></article>`).join('');
const maxFunnel = Math.max(...snapshot.funnel.map(x => x.value));
qs('#funnel').innerHTML = snapshot.funnel.map((item, index) => { const previous = index ? snapshot.funnel[index - 1].value : null; const conversion = previous ? `${Math.round(item.value / previous * 100)}%` : '100%'; return `<div class="funnel-row"><strong>${item.label}</strong><div class="bar"><i style="width:${Math.max(5, item.value / maxFunnel * 100)}%"></i></div><span>${item.value}<small> · ${conversion}</small></span></div>`; }).join('');
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
  qs('#sourcesGrid').innerHTML = sources.map(source => `<article class="source-card"><div class="source-head"><div><small>${source.category}</small><h3>${source.name}</h3></div><span class="source-state ${source.effective_status}">${source.effective_status === 'healthy' ? 'Подключён' : source.effective_status === 'warning' ? 'Устарели данные' : source.effective_status === 'error' ? 'Ошибка' : 'Не настроен'}</span></div><p>Режим: ${source.connection_mode}</p><p>${source.last_success_at ? `Последняя синхронизация: ${new Date(source.last_success_at).toLocaleString('ru-RU')}` : 'Синхронизаций ещё не было'}</p>${source.last_error ? `<p class="source-error">${source.last_error}</p>` : ''}</article>`).join('');
}

async function loadSources() {
  const config = window.ANIX_CONFIG || {};
  if (!config.supabaseUrl) {
    qs('#sourceNotice').textContent = 'Supabase пока не привязан. Создай проект и вставь публичный Project URL и anon key в runtime-config.js.';
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
    qs('#sourceNotice').textContent = `Статусы обновлены: ${new Date(payload.generated_at).toLocaleString('ru-RU')}`;
    qs('#globalSync').textContent = '● Supabase доступен';
  } catch (error) {
    qs('#sourceNotice').textContent = `Не удалось получить статусы: ${error.message}`;
    renderSources(sourceFallback);
  }
}

qs('#refreshSources').addEventListener('click', loadSources);
loadSources();
qs('#exportBtn').addEventListener('click', () => { const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `anix-dashboard-snapshot-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); });
