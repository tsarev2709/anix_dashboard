(() => {
  const q = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const number = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(value || 0));
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

    const stages = payload.stage_aging || [];
    const maxAge = Math.max(1, ...stages.map(item => Number(item.average_days || 0)));
    q('#stageAging').innerHTML = stages.length ? stages.map(stage => {
      const width = Math.max(3, Number(stage.average_days || 0) / maxAge * 100);
      const oldest = (stage.oldest || []).slice(0, 3).map(item => `${item.name} — ${days(item.age_days)}`).join('; ');
      const estimated = stage.estimated_count ? ` · ${stage.estimated_count} оценочно` : '';
      return `<div class="stage-aging-row">
        <div><strong>${esc(stage.stage_name)}</strong><small>${esc(stage.pipeline_name || 'Воронка')} · ${stage.count} сделок${esc(estimated)}</small></div>
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
      q('#bottleneckRecommendation').innerHTML = `<strong>${esc(error.message)}</strong>`;
    }
  }

  document.addEventListener('DOMContentLoaded', load);
  const refresh = q('#refreshSales');
  if (refresh) refresh.addEventListener('click', load);
  load();
})();