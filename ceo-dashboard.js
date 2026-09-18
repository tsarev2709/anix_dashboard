(() => {
  'use strict';

  const q = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const num = (value, digits = 0) => value === null || value === undefined ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(Number(value || 0));
  const rub = value => value === null || value === undefined ? '—' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(Number(value || 0));
  const percent = value => value === null || value === undefined ? '—' : `${num(Number(value) * 100, 1)}%`;
  const dt = value => value ? new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const day = value => value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const days = value => value === null || value === undefined ? '—' : `${num(value, 1)} дн.`;
  const formatMetric = (value, format) => format === 'money' ? rub(value) : format === 'percent' ? percent(value) : num(value);

  let payload = null;
  let showAll = false;

  function comparisonLine(comparison, format = 'number') {
    if (!comparison || comparison.previous === null || comparison.previous === undefined) return 'Неделю назад: копим историю';
    const current = Number(comparison.current || 0);
    const previous = Number(comparison.previous || 0);
    const arrow = current > previous ? '↑' : current < previous ? '↓' : '→';
    return `Неделю назад: ${formatMetric(previous, format)} ${arrow}`;
  }

  function sourceState(source, label) {
    if (!source) return `${label}: источник не настроен`;
    const stale = source.last_success_at && Date.now() - new Date(source.last_success_at).getTime() > Number(source.freshness_minutes || 60) * 60_000;
    if (source.status === 'error') return `${label}: ошибка синхронизации`;
    if (stale) return `${label}: данные устарели, ${dt(source.last_success_at)}`;
    return `${label}: ${dt(source.last_success_at)}`;
  }

  function metricButton({ label, value, note, tone = '', drilldown, format = 'number' }) {
    const tag = drilldown ? 'button' : 'article';
    const action = drilldown ? ` data-drilldown="${esc(drilldown)}" type="button"` : '';
    return `<${tag} class="decision-metric ${esc(tone)}"${action}><small>${esc(label)}</small><strong>${esc(formatMetric(value, format))}</strong><span>${esc(note || '')}</span></${tag}>`;
  }

  function renderAlerts() {
    const alerts = payload?.alerts || [];
    const summary = payload?.alert_summary || {};
    q('#attentionHeadline').textContent = alerts.length ? `${summary.critical || 0} требуют действия, ${summary.risk || 0} — зона риска` : 'Критичных исключений не найдено';
    q('#attentionSubhead').textContent = alerts.length ? 'Список ранжирован по критичности, сумме и длительности. Красный — только когда действие нельзя откладывать.' : 'По доступным данным продажи, проекты и решения не дают критических сигналов.';
    q('#attentionCounters').innerHTML = [
      ['critical', 'действовать', summary.critical || 0],
      ['risk', 'риск', summary.risk || 0],
      ['info', 'информация', summary.info || 0],
    ].map(([tone, label, value]) => `<div class="attention-counter ${tone}"><strong>${num(value)}</strong><span>${label}</span></div>`).join('');

    const visible = showAll ? alerts : alerts.slice(0, 7);
    q('#ceoAlerts').innerHTML = visible.length ? visible.map(alert => `
      <article class="ceo-alert ${esc(alert.severity)}">
        <span class="ceo-alert-severity" aria-hidden="true"></span>
        <div class="ceo-alert-main"><strong>${esc(alert.title)}</strong><small>${esc(alert.description)}</small></div>
        <div class="ceo-alert-meta"><strong>${esc(alert.object_type)} · ${alert.days !== null ? `${num(alert.days)} дн.` : 'срок не указан'}</strong><small>${esc(alert.owner || 'Ответственный не назначен')}${alert.amount ? ` · ${esc(rub(alert.amount))}` : ''}</small></div>
        <div class="ceo-alert-action"><strong>Следующее действие</strong><small>${esc(alert.next_action)}</small></div>
        <div class="ceo-alert-buttons"><button type="button" class="ceo-link-button" data-drilldown="${esc(alert.drilldown_key)}">Открыть</button>${alert.external_url ? `<a class="ceo-link-button" href="${esc(alert.external_url)}" target="_blank" rel="noopener">${alert.domain === 'operations' ? 'Telegram' : 'amoCRM'} ↗</a>` : ''}</div>
      </article>`).join('') : '<div class="ceo-empty">Исключений по доступным данным нет. Финансовый контур пока неполон, поэтому отсутствие финансовых алертов не означает отсутствие обязательств.</div>';
    q('#showAllAlerts').hidden = alerts.length <= 7;
    q('#showAllAlerts').textContent = showAll ? 'Свернуть список' : `Показать приоритетные исключения (${alerts.length} из ${summary.total || alerts.length})`;
  }

  function renderHeadlineKpis() {
    const sales = payload.sales.summary;
    const projects = payload.projects.summary;
    q('#ceoKpiGrid').innerHTML = [
      { label: 'Действия сегодня', value: payload.alert_summary.critical, note: `${payload.alert_summary.risk} дополнительных зон риска`, tone: payload.alert_summary.critical ? 'critical' : '', drilldown: 'alerts' },
      { label: 'Открытые сделки', value: sales.open_deals, note: `воронка ${rub(sales.pipeline_amount)}`, drilldown: 'open' },
      { label: 'Без движения >14 дней', value: sales.stalled_14_ratio, note: `${sales.stalled_14_count} сделок · ${comparisonLine(payload.sales.comparisons.stalled_14_ratio, 'percent')}`, tone: sales.stalled_14_count ? 'risk' : '', drilldown: 'stalled14', format: 'percent' },
      { label: 'Проекты с просрочками', value: projects.overdue_projects, note: `${projects.deadline_week} проектов с дедлайном в 7 дней`, tone: projects.overdue_projects ? 'critical' : '', drilldown: 'projects_overdue' },
    ].map(item => `<button type="button" class="ceo-kpi-card actionable ${item.tone}" data-drilldown="${esc(item.drilldown)}"><small>${esc(item.label)}</small><strong>${esc(formatMetric(item.value, item.format))}</strong><span>${esc(item.note)}</span></button>`).join('');
  }

  function renderStalled() {
    const sales = payload.sales.summary;
    const comparisons = payload.sales.comparisons;
    q('#stalledMetricGrid').innerHTML = [
      { label: 'Всего открытых сделок', value: sales.open_deals, note: `${sales.priced_open_deals} с заполненным бюджетом`, drilldown: 'open' },
      { label: 'Не двигались >14 дней', value: sales.stalled_14_count, note: `${percent(sales.stalled_14_ratio)} от открытых · ${comparisonLine(comparisons.stalled_14_ratio, 'percent')}`, tone: sales.stalled_14_count ? 'risk' : '', drilldown: 'stalled14' },
      { label: 'Не двигались >30 дней', value: sales.stalled_30_count, note: comparisonLine(comparisons.stalled_30_count), tone: sales.stalled_30_count ? 'critical' : '', drilldown: 'stalled30' },
      { label: 'Сумма зависших >14 дней', value: sales.stalled_14_amount, note: 'только заполненные бюджеты сделок', drilldown: 'stalled14', format: 'money' },
      { label: 'На согласовании с клиентом', value: sales.approval_amount, note: 'КП / переговоры / согласование', drilldown: 'approval', format: 'money' },
      { label: 'Договор / счёт / ТЗ', value: sales.contract_invoice_stage_amount, note: 'сумма бюджетов на этих этапах', drilldown: 'contracts', format: 'money' },
      { label: 'На этапах оплаты', value: sales.payment_stage_amount, note: 'не равно фактически ожидаемой оплате', drilldown: 'payments', format: 'money' },
      { label: 'Без следующего шага', value: sales.without_next_step, note: 'нет незавершённой задачи amoCRM', tone: sales.without_next_step ? 'risk' : '', drilldown: 'without_next_step' },
    ].map(metricButton).join('');
  }

  function inlineDealList(deals) {
    return deals.slice(0, 8).map(deal => `<div class="inline-deal-row"><div><strong>${esc(deal.name)}</strong><small>${esc(deal.responsible_user_name)}</small></div><div><strong>${esc(rub(deal.price))}</strong><small>бюджет</small></div><div><strong>${num(deal.stage_days)} дн.</strong><small>на этапе</small></div><div><strong>${esc(deal.next_step || 'Нет следующего шага')}</strong><small>${deal.next_step_at ? day(deal.next_step_at) : 'дата не назначена'}</small></div></div>`).join('');
  }

  function renderFunnel() {
    const sales = payload.sales.summary;
    const stages = payload.sales.funnel_health || [];
    q('#funnelCoverageNote').textContent = stages.some(stage => stage.completed_duration_sample < 3) ? 'часть норм временная · см. выборку' : 'норма = 1,5 медианы прохождений';
    q('#funnelSummary').innerHTML = [
      { label: 'Лид → выигрыш', value: sales.average_lead_to_win_days === null ? '—' : days(sales.average_lead_to_win_days), note: `выборка: ${sales.lead_to_win_sample} сделок` },
      { label: 'Средний чек выигранных', value: sales.average_won_check === null ? '—' : rub(sales.average_won_check), note: `выборка: ${sales.won_check_sample} сделок с бюджетом` },
      { label: 'Взвешенная поздняя воронка', value: rub(sales.weighted_revenue), note: `заполненность бюджетов: ${percent(sales.weighted_revenue_budget_coverage)}` },
    ].map(item => `<article class="funnel-summary-card"><small>${esc(item.label)}</small><strong>${esc(item.value)}</strong><span>${esc(item.note)}</span></article>`).join('');
    q('#ceoFunnelHealth').innerHTML = stages.length ? stages.map(stage => `
      <article class="funnel-health-row" data-stage-row="${esc(stage.id)}">
        <button type="button" class="funnel-health-summary" data-toggle-stage="${esc(stage.id)}">
          <div class="funnel-stage"><strong>${esc(stage.stage_name)}</strong><small>${esc(stage.pipeline_name || 'Воронка')} · показать список (${stage.count})</small></div>
          <div class="funnel-stat"><strong>${num(stage.count)}</strong><small>сделок</small></div>
          <div class="funnel-stat"><strong>${rub(stage.amount)}</strong><small>сумма</small></div>
          <div class="funnel-stat"><strong>${stage.conversion_to_next === null ? '—' : percent(stage.conversion_to_next)}</strong><small>в ${esc(stage.next_stage_name || 'финал')} · n=${stage.conversion_sample}</small></div>
          <div class="funnel-stat"><strong>${days(stage.average_days)}</strong><small>среднее</small></div>
          <div class="funnel-stat ${stage.over_norm_count ? 'risk' : ''}"><strong>${num(stage.over_norm_count)}</strong><small>дольше нормы ${stage.normal_days} дн.</small></div>
          <span class="funnel-expand">⌄</span>
        </button>
        <div class="funnel-health-detail">
          <div class="age-buckets">${[['0_7','0–7'],['8_14','8–14'],['15_30','15–30'],['30_plus','30+']].map(([bucket,label]) => `<div class="age-bucket"><strong>${num(stage.age_buckets[bucket])}</strong><small>${label} дней</small></div>`).join('')}</div>
          <div class="inline-deal-list">${stage.deals.length ? inlineDealList(stage.deals) : '<div class="ceo-empty">Открытых сделок на этапе нет.</div>'}</div>
          ${stage.deals.length > 8 ? `<button type="button" class="ceo-link-button" data-drilldown="stage:${esc(stage.id)}" style="margin-top:10px">Все сделки (${stage.deals.length})</button>` : ''}
        </div>
      </article>`).join('') : '<div class="ceo-empty">Нет наблюдаемых этапов. Проверь синхронизацию amoCRM.</div>';
  }

  function renderProjects() {
    const summary = payload.projects.summary;
    q('#ceoProjectMetrics').innerHTML = [
      { label: 'Активные проекты', value: summary.active_projects, note: 'есть незавершённые задачи', drilldown: 'projects_all' },
      { label: 'Дедлайн <7 дней', value: summary.deadline_week, note: 'проекты с ближайшими сроками', tone: summary.deadline_week ? 'risk' : '', drilldown: 'projects_week' },
      { label: 'Просрочены', value: summary.overdue_projects, note: 'проекты с просроченными задачами', tone: summary.overdue_projects ? 'critical' : '', drilldown: 'projects_overdue' },
      { label: 'Без движения', value: summary.no_movement, note: 'нет обновлений YouGile >7 дней', tone: summary.no_movement ? 'risk' : '', drilldown: 'projects_stale' },
      { label: 'Без ответственного', value: summary.without_assignee, note: 'есть задачи без исполнителя', tone: summary.without_assignee ? 'risk' : '', drilldown: 'projects_unassigned' },
      { label: 'Ждём клиента', value: summary.waiting_client_materials, note: 'по названиям задач и колонок', drilldown: 'projects_waiting_client' },
      { label: 'Клиент ждёт нас', value: summary.client_waits_us, note: 'явно отмечено в задачах / колонках', tone: summary.client_waits_us ? 'critical' : '', drilldown: 'projects_client_waits' },
    ].map(metricButton).join('');

    const projects = payload.projects.items || [];
    q('#ceoProjects').innerHTML = projects.length ? projects.slice(0, 8).map(project => `<div class="ceo-project-row"><div><strong>${esc(project.name)}</strong><small>${project.active_tasks} задач · ${project.no_movement_days === null ? 'нет даты движения' : `обновлялся ${num(project.no_movement_days)} дн. назад`}</small></div><div><strong class="project-risk-value ${project.overdue_tasks ? 'critical' : ''}">${project.overdue_tasks}</strong><small>просрочено</small></div><div><strong class="project-risk-value ${project.due_week_tasks ? 'risk' : ''}">${project.due_week_tasks}</strong><small>на 7 дней</small></div><div><strong>${project.without_assignee}</strong><small>без исполнителя</small></div><button type="button" class="ceo-link-button" data-drilldown="project:${esc(project.external_id)}">Открыть</button></div>`).join('') : '<div class="ceo-empty">Активных проектов с незавершёнными задачами не найдено.</div>';
  }

  function renderCash() {
    const cash = payload.cash;
    const reliable = [
      { label: 'Взвешенная поздняя воронка', ...cash.weighted_pipeline_revenue },
      { label: 'Бюджеты на этапах оплаты', ...cash.payment_stage_pipeline },
    ];
    const reliableHtml = reliable.map(item => `<article class="cash-card"><small>${esc(item.label)}</small><strong>${rub(item.value)}</strong><span>${esc(item.source)} · заполненность ${percent(item.coverage)}</span></article>`).join('');
    q('#ceoCashOverview').innerHTML = reliableHtml;
    q('#cashMetricGrid').innerHTML = reliableHtml + cash.unavailable.slice(0, 4).map(item => `<article class="cash-card unavailable"><small>${esc(item.label)}</small><strong>Нет данных</strong><span>${esc(item.reason)}</span></article>`).join('');
    q('#cashUnavailable').innerHTML = cash.unavailable.map(item => `<article class="unavailable-item"><strong>${esc(item.label)}</strong><p>${esc(item.reason)}</p></article>`).join('');
  }

  function weeklyTone(metric) {
    if (metric.absolute_change === null || Number(metric.absolute_change) === 0 || metric.direction === 'neutral') return 'neutral';
    const improved = metric.direction === 'up_is_good' ? metric.absolute_change > 0 : metric.absolute_change < 0;
    return improved ? 'good' : 'bad';
  }

  function renderWeekly() {
    const weekly = payload.weekly;
    q('#weeklyNotice').textContent = weekly.comparison_available ? 'Сравниваем с ближайшим достоверным снимком семидневной давности.' : 'Первый снимок сохранён. Сравнение появится после накопления семи дней истории.';
    q('#weeklyComparedAt').textContent = weekly.previous_snapshot_at ? `сравнение с ${dt(weekly.previous_snapshot_at)}` : 'копим историю';
    q('#weeklyMetricGrid').innerHTML = weekly.metrics.map(metric => {
      const tone = weeklyTone(metric);
      const delta = metric.absolute_change === null ? 'История ещё не накоплена' : `${metric.absolute_change > 0 ? '+' : ''}${formatMetric(metric.absolute_change, metric.format)} за неделю`;
      return `<article class="weekly-card"><small>${esc(metric.label)}</small><strong>${esc(formatMetric(metric.current, metric.format))}</strong><span class="weekly-delta ${tone}">${esc(delta)}</span></article>`;
    }).join('');
    const weeklySignals = (payload.alerts || []).filter(alert => alert.domain === 'weekly');
    q('#weeklySignals').innerHTML = weeklySignals.length ? weeklySignals.map(alert => `<article class="ceo-alert ${esc(alert.severity)}"><span class="ceo-alert-severity"></span><div class="ceo-alert-main"><strong>${esc(alert.title)}</strong><small>${esc(alert.description)}</small></div><div class="ceo-alert-action"><strong>Решение</strong><small>${esc(alert.next_action)}</small></div><div class="ceo-alert-buttons"><button type="button" class="ceo-link-button" data-drilldown="${esc(alert.drilldown_key)}">Открыть</button></div></article>`).join('') : '<div class="ceo-empty">Недельных ухудшений по доступным сравнениям не обнаружено. До накопления первого семидневного снимка этот блок остаётся нейтральным.</div>';
  }

  function renderDecisions() {
    const decisions = payload.decisions;
    q('#decisionSummary').innerHTML = [
      { label: 'Активные решения', value: decisions.active, note: 'planned + in progress' },
      { label: 'Review просрочен', value: decisions.overdue, note: 'требует управленческого разбора', tone: decisions.overdue ? 'critical' : '' },
    ].map(metricButton).join('');
    q('#decisionList').innerHTML = decisions.items.length ? decisions.items.map(item => `<div class="decision-row"><div><strong>${esc(item.title)}</strong><small>${esc(item.hypothesis || item.expected_result || 'Гипотеза не заполнена')}</small></div><div><strong>${esc(item.owner_name)}</strong><small>владелец</small></div><div><strong>${esc(item.status)}</strong><small>статус</small></div><div><strong>${day(item.next_review_at || item.check_deadline)}</strong><small>следующий review</small></div></div>`).join('') : '<div class="ceo-empty"><strong>Активных решений пока нет.</strong><br>Таблица и правила просрочки уже созданы. В следующей итерации добавим форму создания, историю review и связь решения с метрикой.</div>';
  }

  function render() {
    const sourceText = [sourceState(payload.sources.amocrm, 'amoCRM'), sourceState(payload.sources.yougile, 'YouGile')].join(' · ');
    q('#ceoAsOf').textContent = `Данные на ${dt(payload.data_as_of)} · ${sourceText}`;
    renderAlerts();
    renderHeadlineKpis();
    renderStalled();
    renderFunnel();
    renderProjects();
    renderCash();
    renderWeekly();
    renderDecisions();
  }

  function ensureDialog() {
    let dialog = q('#ceoDrilldown');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'ceoDrilldown';
    dialog.className = 'ceo-drilldown';
    dialog.innerHTML = '<div class="drilldown-shell"><header class="drilldown-head"><div><p class="eyebrow">Drill-down</p><h3 id="drilldownTitle">Детализация</h3></div><button type="button" class="drilldown-close" aria-label="Закрыть">×</button></header><div class="drilldown-body" id="drilldownBody"></div></div>';
    document.body.appendChild(dialog);
    dialog.querySelector('.drilldown-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    return dialog;
  }

  function dealListFor(key) {
    if (!payload) return [];
    if (key.startsWith('stage:')) {
      const stageId = key.slice(6);
      return payload.sales.funnel_health.find(stage => stage.id === stageId)?.deals || [];
    }
    return payload.sales.deal_lists[key] || [];
  }

  function renderDealTable(deals) {
    if (!deals.length) return '<div class="ceo-empty">В этой выборке сейчас нет сделок.</div>';
    return `<div style="overflow:auto"><table class="drilldown-table"><thead><tr><th>Компания / сделка</th><th>Контакт</th><th>Сумма</th><th>Стадия</th><th>На стадии</th><th>Последнее действие</th><th>Следующий шаг</th><th>Ответственный</th><th></th></tr></thead><tbody>${deals.map(deal => `<tr><td><strong>${esc(deal.company || deal.name)}</strong><small>${esc(deal.pipeline_name || 'Воронка')}</small></td><td>${esc(deal.contact || '—')}</td><td>${deal.price ? esc(rub(deal.price)) : '—'}</td><td>${esc(deal.stage_name)}</td><td>${num(deal.stage_days)} дн.${deal.stage_age_estimated ? '<small>оценочно</small>' : ''}</td><td>${deal.last_activity_at ? day(deal.last_activity_at) : '—'}<small>${deal.stale_days !== null ? `${num(deal.stale_days)} дн. назад` : ''}</small></td><td>${esc(deal.next_step || 'Не назначен')}<small>${deal.next_step_at ? day(deal.next_step_at) : ''}</small></td><td>${esc(deal.responsible_user_name)}</td><td>${deal.external_url ? `<a href="${esc(deal.external_url)}" target="_blank" rel="noopener">amoCRM ↗</a>` : ''}</td></tr>`).join('')}</tbody></table></div><p class="drilldown-note">Контакт отображается только если имя уже присутствует в синхронизированном raw amoCRM. Пустое поле не подменяется названием сделки.</p>`;
  }

  function projectListFor(key) {
    const projects = payload?.projects?.items || [];
    if (key === 'projects_all') return projects;
    if (key === 'projects_overdue') return projects.filter(project => project.overdue_tasks > 0);
    if (key === 'projects_week') return projects.filter(project => project.due_week_tasks > 0);
    if (key === 'projects_stale') return projects.filter(project => Number(project.no_movement_days || 0) > 7);
    if (key === 'projects_unassigned') return projects.filter(project => project.without_assignee > 0);
    if (key === 'projects_waiting_client') return projects.filter(project => project.waiting_client_materials > 0);
    if (key === 'projects_client_waits') return projects.filter(project => project.client_waits_us > 0);
    if (key.startsWith('project:')) return projects.filter(project => String(project.external_id) === key.slice(8));
    return [];
  }

  function renderProjectTable(projects) {
    if (!projects.length) return '<div class="ceo-empty">В этой выборке сейчас нет проектов.</div>';
    return projects.map(project => `<section style="margin:18px 0"><h3 style="margin-bottom:6px">${esc(project.name)}</h3><p style="margin:0 0 10px;color:var(--muted);font-size:11px">${project.active_tasks} активных задач · ${project.overdue_tasks} просрочено · ${project.without_assignee} без исполнителя</p><div style="overflow:auto"><table class="drilldown-table"><thead><tr><th>Задача</th><th>Этап</th><th>Дедлайн</th><th>Просрочка</th><th>Исполнитель</th><th>Обновлена</th></tr></thead><tbody>${project.tasks.map(task => `<tr><td><strong>${esc(task.title)}</strong><small>${esc(task.board_name || '')}</small></td><td>${esc(task.column_name || '—')}</td><td>${day(task.deadline_at)}</td><td>${task.overdue_days ? `${num(task.overdue_days)} дн.` : '—'}</td><td>${esc((task.assignees || []).join(', ') || 'Не назначен')}</td><td>${day(task.updated_at)}</td></tr>`).join('')}</tbody></table></div></section>`).join('');
  }

  function openDrilldown(key) {
    if (!payload) return;
    if (key === 'alerts') {
      showAll = true;
      renderAlerts();
      q('#ceoAlerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (key === 'decisions') {
      window.ANIX_NAVIGATE?.('decisions');
      return;
    }
    if (key === 'telegram_task_failures') {
      const items = payload.operations?.telegram_task_failures || [];
      const dialog = ensureDialog();
      q('#drilldownTitle').textContent = `Недоставленные задачи из Telegram (${items.length})`;
      q('#drilldownBody').innerHTML = items.length ? `<div style="overflow:auto"><table class="drilldown-table"><thead><tr><th>Сообщение</th><th>Статус</th><th>Когда</th><th>Ошибка</th><th></th></tr></thead><tbody>${items.map(item => `<tr><td><strong>${esc(item.normalized_title || item.original_text || 'Задача')}</strong></td><td>${esc(item.status)}</td><td>${dt(item.created_at)}</td><td>${esc(item.error || 'Обработка длится более 15 минут')}</td><td>${item.source_url ? `<a href="${esc(item.source_url)}" target="_blank" rel="noopener">Telegram ↗</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="ceo-empty">Ошибок постановки задач сейчас нет.</div>';
      dialog.showModal();
      return;
    }
    const labels = {
      open: 'Все открытые сделки', stalled14: 'Сделки без движения более 14 дней', stalled30: 'Сделки без движения более 30 дней', without_next_step: 'Сделки без следующего шага', approval: 'Сделки на согласовании с клиентом', contracts: 'Договор / счёт / ТЗ', payments: 'Сделки на этапах оплаты', projects_all: 'Активные проекты', projects_overdue: 'Проекты с просрочками', projects_week: 'Проекты с дедлайном в 7 дней', projects_stale: 'Проекты без обновлений', projects_unassigned: 'Проекты без назначенного исполнителя', projects_waiting_client: 'Проекты, где ждём материалы клиента', projects_client_waits: 'Проекты, где клиент ждёт Anix',
    };
    const dialog = ensureDialog();
    const projectMode = key.startsWith('project') || key.startsWith('projects_');
    const items = projectMode ? projectListFor(key) : dealListFor(key);
    let title = labels[key] || 'Детализация';
    if (key.startsWith('stage:')) title = payload.sales.funnel_health.find(stage => stage.id === key.slice(6))?.stage_name || 'Сделки на этапе';
    if (key.startsWith('project:')) title = projectListFor(key)[0]?.name || 'Проект';
    q('#drilldownTitle').textContent = `${title} (${items.length})`;
    q('#drilldownBody').innerHTML = projectMode ? renderProjectTable(items) : renderDealTable(items);
    dialog.showModal();
  }

  function renderError(error) {
    const message = `Не удалось загрузить CEO-дайджест: ${error.message || error}`;
    q('#ceoAsOf').textContent = message;
    for (const selector of ['#ceoAlerts','#ceoKpiGrid','#stalledMetricGrid','#funnelSummary','#ceoFunnelHealth','#ceoProjectMetrics','#ceoProjects','#ceoCashOverview','#weeklyMetricGrid','#weeklySignals','#cashMetricGrid','#cashUnavailable','#decisionSummary','#decisionList']) {
      if (q(selector)) q(selector).innerHTML = `<div class="ceo-error">${esc(message)}</div>`;
    }
  }

  async function load() {
    const config = window.ANIX_CONFIG || {};
    if (!config.supabaseUrl) return renderError(new Error('Supabase не настроен'));
    const buttons = [q('#refreshCeo'), q('#refreshWeekly'), q('#refreshCash')].filter(Boolean);
    buttons.forEach(button => { button.disabled = true; });
    try {
      const response = await fetch(`${String(config.supabaseUrl).replace(/\/$/, '')}/functions/v1/ceo-digest`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      payload = data;
      window.ANIX_CEO_SNAPSHOT = data;
      render();
    } catch (error) {
      renderError(error);
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  document.addEventListener('click', event => {
    const drilldown = event.target.closest('[data-drilldown]');
    if (drilldown) openDrilldown(drilldown.dataset.drilldown);
    const toggle = event.target.closest('[data-toggle-stage]');
    if (toggle) q(`[data-stage-row="${CSS.escape(toggle.dataset.toggleStage)}"]`)?.classList.toggle('open');
  });
  q('#showAllAlerts')?.addEventListener('click', () => { showAll = !showAll; renderAlerts(); });
  q('#refreshCeo')?.addEventListener('click', load);
  q('#refreshWeekly')?.addEventListener('click', load);
  q('#refreshCash')?.addEventListener('click', load);
  load();
})();
