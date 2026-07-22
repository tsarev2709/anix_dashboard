(() => {
  const q = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const formatNumber = value => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
  const formatDateTime = value => value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  async function loadSalesHistory() {
    const config = window.ANIX_CONFIG || {};
    if (!config.supabaseUrl || !q('#salesActivitySummary')) return;
    try {
      const response = await fetch(`${config.supabaseUrl}/functions/v1/sales-history`, { headers: config.supabaseAnonKey ? { apikey: config.supabaseAnonKey } : {} });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const summary = payload.summary || {};
      q('#salesActivitySummary').innerHTML = [
        ['Сегодня', summary.today, 'переходов'],
        ['7 дней', summary.week, 'переходов'],
        ['Месяц', summary.month, 'переходов'],
        ['Вперёд / назад', `${formatNumber(summary.forward)} / ${formatNumber(summary.backward)}`, 'движение по воронке'],
      ].map(([label, value, note]) => `<article class="sales-summary-card neutral"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(note)}</span></article>`).join('');

      const maxStage = Math.max(1, ...(payload.by_stage || []).map(item => item.count));
      q('#salesActivityStages').innerHTML = (payload.by_stage || []).length ? payload.by_stage.slice(0, 10).map(item => `<div class="activity-stage-row"><strong>${escapeHtml(item.stage)}</strong><div class="bar"><i style="width:${Math.max(5, item.count / maxStage * 100)}%"></i></div><span>${formatNumber(item.count)}</span></div>`).join('') : '<p class="empty-state">Переходов за месяц пока нет.</p>';

      q('#salesActivityFeed').innerHTML = (payload.recent || []).length ? payload.recent.slice(0, 12).map(item => {
        const transition = item.from_status_name ? `${item.from_status_name} → ${item.to_status_name}` : `Зафиксировано на этапе «${item.to_status_name}»`;
        const direction = item.direction === 'backward' ? 'назад' : item.direction === 'forward' ? 'вперёд' : 'старт';
        return `<div class="activity-feed-row ${escapeHtml(item.direction)}"><div><strong>${escapeHtml(item.lead_name)}</strong><small>${escapeHtml(item.pipeline_name || 'Воронка')} · ${escapeHtml(transition)}</small><small>${escapeHtml(item.manager_name)} · ${formatDateTime(item.observed_at)}</small></div><span>${direction}</span></div>`;
      }).join('') : '<p class="empty-state">История появится после первых переходов между этапами.</p>';
      q('#salesHistoryUpdated').textContent = `обновлено ${formatDateTime(payload.generated_at)}`;
      q('#salesHistoryCaveat').textContent = payload.caveat || '';
    } catch (error) {
      q('#salesHistoryUpdated').textContent = 'ошибка загрузки';
      q('#salesActivityFeed').innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    }
  }

  document.addEventListener('DOMContentLoaded', loadSalesHistory);
  const refresh = q('#refreshSales');
  if (refresh) refresh.addEventListener('click', loadSalesHistory);
  loadSalesHistory();
})();