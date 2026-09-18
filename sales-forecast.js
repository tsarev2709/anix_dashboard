(() => {
  'use strict';
  const root = document.querySelector('[data-sales-forecast]');
  if (!root) return;
  const compact = root.dataset.salesForecast === 'compact';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => value == null ? '—' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
  const num = value => value == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
  const pct = value => value == null ? '—' : `${num(value * 100)}%`;
  const day = value => value ? String(value).slice(0, 10).split('-').reverse().join('.') : '—';
  let timezone = 'Europe/Moscow';
  const dateTime = value => value ? new Date(value).toLocaleString('ru-RU', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const card = (label, value, note = '') => `<article class="forecast-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`;
  const panel = (title, html) => `<section class="panel forecast-panel"><h3>${esc(title)}</h3>${html}</section>`;
  const table = (head, rows, empty) => rows.length ? `<div class="forecast-scroll" tabindex="0" role="region" aria-label="${esc(head[0])}"><table class="forecast-table"><thead><tr>${head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="forecast-empty">${esc(empty || 'Нет данных за выбранный период.')}</p>`;
  const sourceName = source => ({ manual: 'вручную', observed: 'по истории', fallback: 'резервная', unconfigured: 'не задана', system: 'системная' }[source] || source);
  const link = deal => deal.url && /^https:\/\/[a-z0-9-]+\.(amocrm\.ru|kommo\.com)\/leads\/detail\/\d+$/.test(deal.url) ? `<a href="${esc(deal.url)}" target="_blank" rel="noopener noreferrer">${esc(deal.name)}</a>` : esc(deal.name);
  const nowMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit' }).format(new Date());
  root.innerHTML = `<div class="forecast-heading"><div><p class="eyebrow">Продажи / месяц</p><h2>${compact ? 'Прогноз Anix' : 'Что закроем в этом месяце'}</h2><p>Факт и прогноз сделок из amoCRM. Поступления денег здесь не учитываются.</p></div>${compact ? '<a class="forecast-full" href="index.html#forecast" target="_blank" rel="noopener">Открыть полный Dashboard ↗</a>' : ''}</div>
    <form class="forecast-filters"><label>Месяц<input type="month" name="month" min="2000-01" max="2199-12" required value="${nowMonth}"></label>${compact ? '' : '<label>Менеджер<select name="manager"><option value="0">Все менеджеры</option></select></label><label>Воронка<select name="pipeline"><option value="0">Все воронки</option></select></label>'}<button type="submit">Обновить</button></form>
    <p class="forecast-status" role="status" aria-live="polite">Загрузка…</p><div class="forecast-result"></div>`;
  const form = root.querySelector('form'), status = root.querySelector('.forecast-status'), result = root.querySelector('.forecast-result');
  let generation = 0;
  const config = window.ANIX_CONFIG || {};
  const endpoint = `${String(config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/sales-forecast`;
  function render(payload) {
    timezone = payload.timezone;
    const f = payload.forecast, a = payload.actual, d = payload.discipline;
    const field = payload.configuration.field_state;
    const notices = [];
    if (field?.state !== 'ready') notices.push('Поле потенциальной даты не подключено однозначно. Прогноз недоступен до проверки настройки и синхронизации.');
    if (f.unweighted_deals_count) notices.push(`Нет вероятности у ${f.unweighted_deals_count} сделок на ${money(f.unweighted_amount)}. Полный взвешенный прогноз пока не рассчитан; известная часть: ${money(f.known_weighted_amount)}.`);
    if (payload.source?.status !== 'healthy' || !payload.source?.last_success_at || Date.now() - Date.parse(payload.source.last_success_at) > 90 * 60000) notices.push('Данные amoCRM могут быть устаревшими. Проверьте последнюю синхронизацию.');
    result.innerHTML = notices.map(n => `<p class="forecast-warning" role="note">${esc(n)}</p>`).join('') +
      `<div class="forecast-kpis">${card('Факт месяца', money(a.amount), 'Выигранные сделки по дате закрытия')}${card('Взвешенный прогноз', money(f.weighted_forecast_amount), 'Открытые сделки × вероятность стадии')}${card('Потенциал сделок', money(f.potential_pipeline_amount), 'Полная сумма ожидаемых сделок')}</div>` +
      (compact ? `<div class="forecast-kpis forecast-secondary">${card('Просрочена дата сделки', num(d.overdue_close_date))}${card('Без следующего шага', num(d.without_next_step))}</div>` : `<div class="forecast-kpis forecast-secondary">${card('Выиграно / проиграно', `${a.won_count} / ${a.lost_count}`)}${card('Новые / открытые карточки', `${a.new_deals_count} / ${a.open_deals_count}`)}${card('Средний чек', money(a.average_won_amount))}${card('Доля побед', pct(a.closed_win_rate), 'Среди закрытых в выбранном месяце')}${card('Средний цикл победы', a.average_won_days == null ? '—' : `${num(a.average_won_days)} дн.`)}</div>`) +
      panel(compact ? 'Основные ожидаемые сделки' : 'Из чего складывается прогноз', table(compact ? ['Сделка / менеджер', 'Сумма / прогноз', 'Этап / вероятность', 'Дата'] : ['Сделка / менеджер', 'Сумма', 'Этап', 'Вероятность', 'Взвешенная сумма', 'Потенциальная дата', 'Следующий шаг', 'Дней на стадии'],
        (compact ? payload.deals.slice(0, 7) : payload.deals).map(l => compact ? [
          `${link(l)}<small>${esc(l.manager_name)}</small>`, `${money(l.price)}<small>${money(l.weighted_amount)}</small>`, `${esc(l.stage_name)}<small>${pct(l.probability)}</small>`, day(l.expected_close_date),
        ] : [
          `${link(l)}<small>${esc(l.manager_name)}</small>`, money(l.price), esc(l.stage_name), `${pct(l.probability)}<small>${esc(sourceName(l.probability_source))}</small>`, money(l.weighted_amount), `${day(l.expected_close_date)}${l.overdue_days ? `<small class="forecast-danger">Просрочена на ${num(l.overdue_days)} дн.</small>` : ''}`, `${esc(l.next_step || 'Нет задачи')}<small>${dateTime(l.next_step_at)}</small>`, num(l.stage_age_days),
        ]), 'На выбранный месяц нет открытых сделок с потенциальной датой.'));
    if (!compact && field?.state === 'missing') {
      result.insertAdjacentHTML('afterbegin', '<div class="forecast-warning"><p>В amoCRM нет поля потенциальной даты. Можно добавить отдельное поле типа «Дата»; существующее поле «срок» сохранится.</p><button type="button" class="forecast-connect-date">Добавить дату сделки в amoCRM</button><p class="forecast-setup-status" role="status"></p></div>');
      const connect = result.querySelector('.forecast-connect-date');
      connect.addEventListener('click', async () => {
        connect.disabled = true;
        const message = result.querySelector('.forecast-setup-status');
        message.textContent = 'Проверяю поля и подключаю дату…';
        try {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'connect_date_field' }) });
          const body = await response.json();
          if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
          await load();
        } catch (error) { message.textContent = `Не удалось подключить: ${error.message}`; connect.disabled = false; }
      });
    }
    if (field?.state === 'awaiting_sync') result.insertAdjacentHTML('afterbegin', '<p class="forecast-warning">Поле подключено. Дождитесь следующей синхронизации amoCRM и заполните даты в нужных сделках.</p>');
    if (compact) return;
    const discipline = [['Без следующего шага', d.without_next_step], ['Просроченные задачи', d.overdue_tasks], ['Просрочена дата сделки', d.overdue_close_date], ['Без даты (все / обязательные)', `${d.without_date} / ${d.required_without_date}`], ['Без активности >14 / >30 дней', `${d.stalled_14} / ${d.stalled_30}`]];
    result.insertAdjacentHTML('beforeend', panel('Где нужно действовать сегодня', `<p class="forecast-hint">Текущее состояние всех открытых сделок выбранного менеджера и воронки.</p><div class="forecast-kpis forecast-secondary">${discipline.map(([label, value]) => card(label, value)).join('')}</div>` + table(['Сделка', 'Что исправить', 'Следующий шаг'], payload.issues.slice(0, 50).map(l => [link(l), esc([l.overdue_days ? `Дата просрочена на ${l.overdue_days} дн.` : '', !l.has_next_step ? 'Нет следующего шага' : '', l.overdue_tasks ? `Просроченных задач: ${l.overdue_tasks}` : '', l.requires_expected_date && !l.expected_close_date ? 'Нужна потенциальная дата' : '', l.invalid_date ? 'Некорректная дата в CRM' : '', l.inactive_days > 14 ? `Нет активности ${l.inactive_days} дн.` : ''].filter(Boolean).join(' · ')), `${esc(l.next_step || '—')}<small>${dateTime(l.next_step_at)}</small>`]), 'Нет исключений.') + (payload.issues.length > 50 ? `<p class="forecast-hint">Показаны первые 50 из ${payload.issues.length} исключений.</p>` : '')));
    for (const [title, rows] of [['По менеджерам', payload.by_manager], ['По стадиям', payload.by_stage]]) result.insertAdjacentHTML('beforeend', panel(title, table(['Группа', 'Факт', 'Взвешенный прогноз', 'Потенциал', 'Сделок в прогнозе'], rows.map(r => [esc(r.name), money(r.fact_amount), money(r.weighted_forecast_amount), money(r.potential_pipeline_amount), num(r.expected_deals_count)]))));
    result.insertAdjacentHTML('beforeend', panel('Качество данных', `<div class="forecast-kpis forecast-secondary">${card('Заполнена дата', pct(payload.quality.date_coverage))}${card('Есть следующий шаг', pct(payload.quality.next_step_coverage))}${card('Заполнен бюджет', pct(payload.quality.budget_coverage))}${card('Известна вероятность', pct(payload.quality.probability_coverage), 'Среди сделок выбранного месяца')}</div>`) +
      panel('История прогноза', `<p class="forecast-hint">Первый успешный срез дня. Чтобы сравнить с итоговым фактом, сложите факт и взвешенный прогноз на дату среза. История не восстанавливается задним числом.</p>` + table(['Дата среза', 'Факт на дату', 'Ожидалось дополнительно', 'Потенциал'], payload.snapshots.map(s => [day(s.snapshot_date), money(s.fact_amount), money(s.weighted_forecast_amount), money(s.potential_pipeline_amount)]), 'Срезы появятся после успешной синхронизации.')) +
      panel('События CRM за месяц', `<p class="forecast-hint">Всего ${num(a.crm_events_count)} событий карточек, включая автоматические. Это не счётчик действий менеджера.</p>` + table(['Дата', 'События'], payload.by_day.map(r => [day(r.date), num(r.count)]))) +
      panel('Причины проигрыша', table(['Причина', 'Сделки'], payload.loss_reasons.map(r => [esc(r.name), num(r.count)]))) +
      `<details class="panel forecast-settings"><summary>Вероятности и обязательность даты</summary><p class="forecast-hint">Проценты задаются для стадий, полученных из amoCRM. Пустое значение снимает ручную настройку. Флажок даты включает контроль в отчёте, а не обязательность поля в самой CRM.</p><p class="forecast-hint">Поле даты: ${esc(field?.candidates?.map(c => c.name).join(', ') || 'не найдено')} · ${esc(field?.state || 'не синхронизировано')}. Историческая модель: ${payload.configuration.observed_enabled ? 'включена' : 'выключена'}, минимум ${num(payload.configuration.min_sample_size)} завершённых сделок.</p><div class="forecast-stage-settings">${payload.configuration.stages.filter(s => s.outcome === 'open').map(s => `<form class="forecast-stage-form" data-pipeline="${s.pipeline_external_id}" data-stage="${s.status_external_id}"><div><strong>${esc(s.name)}</strong><small>${esc(s.pipeline_name)} · по истории ${pct(s.observed_probability)} (${s.sample_size} сделок)</small></div><label>Вероятность, %<input name="probability" type="number" min="0" max="100" step="0.1" value="${s.manual_override == null ? '' : num(s.manual_override * 100).replace(',', '.')}" placeholder="Не задана"></label><label class="forecast-check"><input name="required" type="checkbox" ${s.requires_expected_date ? 'checked' : ''}> Нужна дата</label><button type="submit">Сохранить</button><span class="forecast-save-status" role="status"></span></form>`).join('')}</div></details>` +
      `<details class="panel"><summary>Как читать показатели</summary><ul class="forecast-notes">${payload.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul></details>`);
    result.querySelectorAll('.forecast-stage-form').forEach(stageForm => stageForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = stageForm.querySelector('button'), message = stageForm.querySelector('.forecast-save-status');
      const raw = stageForm.elements.probability.value;
      button.disabled = true;
      message.textContent = 'Сохраняю…';
      try {
        const response = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pipeline_external_id: Number(stageForm.dataset.pipeline), status_external_id: Number(stageForm.dataset.stage), manual_override: raw === '' ? null : Number(raw) / 100, requires_expected_date: stageForm.elements.required.checked }) });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
        await load();
      } catch (error) { message.textContent = `Не сохранено: ${error.message}`; }
      finally { button.disabled = false; }
    }));
  }
  async function load() {
    const id = ++generation;
    const params = new URLSearchParams(new FormData(form));
    status.textContent = 'Загружаю прогноз…';
    result.replaceChildren();
    window.ANIX_FORECAST_SNAPSHOT = null;
    root.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`${endpoint}?${params}`);
      const payload = await response.json();
      if (id !== generation) return;
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      for (const name of ['manager', 'pipeline']) {
        const select = form.elements[name];
        if (!select) continue;
        const selected = select.value;
        const options = name === 'manager' ? payload.options.managers : payload.options.pipelines;
        select.innerHTML = `<option value="0">${name === 'manager' ? 'Все менеджеры' : 'Все воронки'}</option>` + options.map(o => `<option value="${o.external_id}">${esc(o.name)}</option>`).join('');
        select.value = selected;
      }
      render(payload);
      status.textContent = `Синхронизация: ${dateTime(payload.source?.last_success_at)} · часовой пояс: ${payload.timezone}`;
      window.ANIX_FORECAST_SNAPSHOT = payload;
    } catch (error) {
      if (id === generation) status.textContent = `Прогноз не загружен: ${error.message}. Нажмите «Обновить», чтобы повторить.`;
    } finally { if (id === generation) root.removeAttribute('aria-busy'); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (form.reportValidity()) load(); });
  form.addEventListener('change', () => { if (form.reportValidity()) load(); });
  if (location.hash === '#forecast' && window.ANIX_NAVIGATE) window.ANIX_NAVIGATE('forecast');
  load();
})();
