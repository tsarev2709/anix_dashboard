(() => {
  const q = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const formatNumber = value => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
  const formatDateTime = value => value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const shortDay = value => new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

  const actionDescription = item => {
    if (item.kind === 'transition') return `${item.from_status || 'Предыдущий этап'} → ${item.to_status || 'Новый этап'}`;
    return [item.text, item.result].filter(Boolean).join(' · ') || item.label;
  };

  async function loadSalesHistory() {
    const config = window.ANIX_CONFIG || {};
    if (!config.supabaseUrl || !q('#salesActivitySummary')) return;
    q('#salesHistoryUpdated').textContent = 'загружаю задачи и события…';
    try {
      const response = await fetch(`${config.supabaseUrl}/functions/v1/sales-activity`, { headers: config.supabaseAnonKey ? { apikey: config.supabaseAnonKey } : {} });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const summary = payload.summary || {};
      q('#salesActivitySummary').innerHTML = [
        ['Сегодня', summary.today, 'всех действий'],
        ['7 дней', summary.week, 'всех действий'],
        ['Месяц', summary.month, `${formatNumber(summary.completed_tasks_month)} задач + ${formatNumber(summary.transitions_month)} переходов`],
        ['Просрочено', summary.overdue_tasks, `из ${formatNumber(summary.pending_tasks)} открытых задач`],
      ].map(([label, value, note]) => `<article class="sales-summary-card ${label === 'Просрочено' && Number(value) ? 'red' : 'neutral'}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(formatNumber(value))}</strong><span>${escapeHtml(note)}</span></article>`).join('');

      const kinds = payload.by_kind || [];
      const maxKind = Math.max(1, ...kinds.map(item => item.count));
      const daily = payload.daily || [];
      const maxDaily = Math.max(1, ...daily.map(item => item.count));
      q('#salesActivityStages').innerHTML = `
        <div class="activity-days">${daily.map(item => `<div class="activity-day" title="${shortDay(item.date)}: ${item.count}"><div class="activity-day-bar"><i style="height:${Math.max(4, item.count / maxDaily * 100)}%"></i></div><small>${shortDay(item.date)}</small><strong>${formatNumber(item.count)}</strong></div>`).join('')}</div>
        <div class="activity-kind-list">${kinds.length ? kinds.map(item => `<div class="activity-stage-row"><strong>${escapeHtml(item.label)}</strong><div class="bar"><i style="width:${Math.max(5, item.count / maxKind * 100)}%"></i></div><span>${formatNumber(item.count)}</span></div>`).join('') : '<p class="empty-state">Действий за месяц пока нет.</p>'}</div>`;

      q('#salesActivityFeed').innerHTML = (payload.recent || []).length ? payload.recent.slice(0, 18).map(item => `<div class="activity-feed-row ${escapeHtml(item.kind)}"><div><strong>${escapeHtml(item.label)}${item.lead_name ? ` · ${escapeHtml(item.lead_name)}` : ''}</strong><small>${escapeHtml(actionDescription(item))}</small><small>${escapeHtml(item.user_name)} · ${formatDateTime(item.at)}${item.pipeline_name ? ` · ${escapeHtml(item.pipeline_name)}` : ''}</small></div><span>${item.kind === 'transition' ? 'этап' : 'задача'}</span></div>`).join('') : '<p class="empty-state">История появится после синхронизации задач и событий amoCRM.</p>';

      const topManager = (payload.managers || []).find(item => !item.is_admin) || (payload.managers || [])[0];
      const managerNote = topManager ? `Основной продавец: ${topManager.name} — ${formatNumber(topManager.actions)} действий за месяц.` : 'Активный продавец пока не определён.';
      q('#salesHistoryUpdated').textContent = `обновлено ${formatDateTime(payload.generated_at)}`;
      q('#salesHistoryCaveat').textContent = `${managerNote} Переход по этапу считается результативным действием; выполненная задача — операционным действием. Follow-up, ВКС, звонки и КП определяются по типу и тексту задачи amoCRM.`;
    } catch (error) {
      q('#salesHistoryUpdated').textContent = 'нужна миграция или деплой функции';
      q('#salesActivityFeed').innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
      q('#salesHistoryCaveat').textContent = 'Примените миграцию crm_activity в Supabase и повторно запустите Sync amoCRM.';
    }
  }

  document.addEventListener('DOMContentLoaded', loadSalesHistory);
  const refresh = q('#refreshSales');
  if (refresh) refresh.addEventListener('click', loadSalesHistory);
  loadSalesHistory();
})();