(() => {
  const q = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const number = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(value || 0));
  const money = value => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0))} ₽`;
  const pct = value => value === null || value === undefined ? '—' : `${number(Number(value) * 100)}%`;
  const days = value => value === null || value === undefined ? '—' : `${number(value)} дн.`;
  const dateTime = value => value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  function cycleCard(label, data, note) {
    const value = data?.average_days === null || data?.average_days === undefined ? '—' : days(data.average_days);
    const details = data?.count ? `медиана ${days(data.median_days)} · ${data.count} сделок` : 'пока нет полного маршрута в истории';
    return `<article class="cycle-card"><small>${esc(label)}</small><strong>${esc(value)}</strong><span>${esc(note)}</span><em>${esc(details)}</em></article>`;
  }

  function render(payload) {
    const cycles = payload.cycles || {};
    q('#cycleSummary').innerHTML = [
      cycleCard('Первое письмо → предоплата', cycles.first_touch_to_prepayment, 'полный цикл продажи'),
      cycleCard('Диалог → предоплата', cycles.dialog_to_prepayment, 'цикл после ответа клиента'),
    ].join('');

    const bottleneck = payload.bottleneck;
    q('#bottleneckRecommendation').innerHTML = bottleneck
      ? `<div><p class="eyebrow">Рекомендация</p><h3>Ускорить этап «${esc(bottleneck.stage_name)}»</h3><p>${esc(bottleneck.text)}</p></div><div class="bottleneck-metric"><strong>${days(bottleneck.average_days)}</strong><span>среднее время</span></div>`
      : '<strong>Пока недостаточно истории для определения узкого места.</strong>';

    const health = payload.health || [];
    q('#salesHealth').innerHTML = health.length ? health.map(item => `<div class="health-row ${esc(item.tone)}"><span class="health-dot"></span><div><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></div></div>`).join('') : '<div class="empty-state">Пока недостаточно данных для оценки здоровья отдела.</div>';

    const actions = payload.today_actions || [];
    q('#todayActions').innerHTML = actions.length ? actions.map(item => `<div class="today-action-row"><span>${item.priority}</span><div><strong>${esc(item.lead_name)}</strong><small>${esc(item.stage_name)} · ${days(item.age_days)}</small><p>${esc(item.action)}</p></div></div>`).join('') : '<div class="empty-state">Критичных действий по текущим данным нет.</div>';
    q('#healthUpdated').textContent = `обновлено ${dateTime(payload.generated_at)}`;

    const conversions = payload.conversions || [];
    q('#funnelConversions').innerHTML = conversions.length ? conversions.map((item, index) => `<div class="conversion-row">
      <div><strong>${esc(item.label)}</strong><small>${number(item.count)} вошли в этап за месяц</small></div>
      <div class="conversion-bar"><i style="width:${item.from_previous === null ? 100 : Math.max(3, Math.min(100, item.from_previous * 100))}%"></i></div>
      <div><strong>${index === 0 ? 'база' : pct(item.from_previous)}</strong><small>${index === 0 ? 'старт воронки' : `из «${esc(item.previous_label)}»`}</small></div>
    </div>`).join('') : '<div class="empty-state">Нет переходов текущего месяца.</div>';

    const segmentCycles = payload.segment_cycles || [];
    q('#segmentCycles').innerHTML = segmentCycles.length ? segmentCycles.map(item => `<div class="segment-cycle-row"><div><strong>${esc(item.from_label)} → ${esc(item.to_label)}</strong><small>${item.count ? `${item.count} завершённых переходов` : 'нет полного перехода в истории'}</small></div><div><strong>${days(item.average_days)}</strong><small>медиана ${days(item.median_days)}</small></div></div>`).join('') : '<div class="empty-state">Пока нет истории переходов.</div>';

    const forecast = payload.cash_forecast || {};
    const coverage = Number(forecast.coverage || 0);
    q('#cashForecastCoverage').textContent = forecast.relevant_count ? `бюджеты заполнены у ${forecast.priced_count} из ${forecast.relevant_count}` : 'нет сделок на поздних этапах';
    q('#cashForecast').innerHTML = `<div class="cash-forecast-summary">
      <article><small>Взвешенный прогноз</small><strong>${money(forecast.weighted_amount)}</strong><span>${coverage < .5 ? 'низкая полнота бюджетов' : 'по вероятностям этапов'}</span></article>
      <article><small>Сумма поздней воронки</small><strong>${money(forecast.raw_amount)}</strong><span>${pct(coverage)} карточек с бюджетом</span></article>
    </div>
    <div class="cash-stage-list">${(forecast.by_stage || []).map(item => `<div><span>${esc(item.label)} · ${item.count} сделок</span><strong>${money(item.weighted_amount)}</strong><small>${Math.round(item.probability * 100)}% от ${money(item.amount)}</small></div>`).join('')}</div>
    <p class="history-caveat">${esc(forecast.method || '')}</p>`;

    const stages = payload.stage_aging || [];
    const maxAge = Math.max(1, ...stages.map(item => Number(item.average_days || 0)));
    q('#stageAging').innerHTML = stages.length ? stages.map(stage => {
      const width = Math.max(3, Number(stage.average_days || 0) / maxAge * 100);
      const oldest = (stage.oldest || []).slice(0, 3).map(item => `${item.name} — ${days(item.age_days)}`).join('; ');
      const estimated = stage.estimated_count ? ` · ${stage.estimated_count} оценочно` : '';
      const noTask = stage.without_next_task ? ` · без следующей задачи: ${stage.without_next_task}` : '';
      return `<div class="stage-aging-row">
        <div><strong>${esc(stage.stage_name)}</strong><small>${esc(stage.pipeline_name || 'Воронка')} · ${stage.count} сделок${esc(estimated)}${esc(noTask)}</small></div>
        <div class="aging-bar"><i style="width:${width}%"></i></div>
        <div class="aging-metrics"><strong>${days(stage.average_days)}</strong><small>медиана ${days(stage.median_days)} · максимум ${days(stage.max_days)}</small></div>
        <div class="aging-oldest"><small>${oldest ? `Самые старые: ${esc(oldest)}` : '—'}</small></div>
      </div>`;
    }).join('') : '<div class="empty-state">Нет открытых сделок для расчёта возраста этапов.</div>';

    q('#cycleCoverage').textContent = payload.coverage?.caveat || '';
    q('#cycleUpdated').textContent = `обновлено ${dateTime(payload.generated_at)}`;
  }

  async function load() {
    const config = window.ANIX_CONFIG || {};
    if (!config.supabaseUrl || !q('#cycleSummary')) return;
    try {
      const response = await fetch(`${config.supabaseUrl}/functions/v1/sales-cycle`, { headers: config.supabaseAnonKey ? { apikey: config.supabaseAnonKey } : {} });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      render(payload);
    } catch (error) {
      q('#cycleUpdated').textContent = 'ошибка загрузки';
      q('#healthUpdated').textContent = 'ошибка загрузки';
      q('#bottleneckRecommendation').innerHTML = `<strong>${esc(error.message)}</strong>`;
    }
  }

  document.addEventListener('DOMContentLoaded', load);
  const refresh = q('#refreshSales');
  if (refresh) refresh.addEventListener('click', load);
  load();
})();