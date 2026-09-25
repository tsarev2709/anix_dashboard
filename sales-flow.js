(() => {
  const q = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const number = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0));
  const pct = value => `${Math.round(Number(value || 0) * 100)}%`;

  function tone(completion) {
    return completion >= 1 ? 'green' : completion >= .8 ? 'yellow' : completion >= .6 ? 'orange' : 'red';
  }

  function render(payload) {
    if (!q('#monthlyFlow')) return;
    q('#kpiMethod').textContent = payload.kpi_method || 'КПЭ считается по событиям текущего месяца.';
    q('#flowUpdated').textContent = `${payload.period?.elapsed_days || '—'} из ${payload.period?.days_in_month || '—'} дней месяца`;

    const kpis = payload.kpis || [];
    q('#monthlyFlow').innerHTML = [...kpis].reverse().map((item, index, list) => {
      const width = 54 + index * (44 / Math.max(1, list.length - 1));
      return `<div class="pyramid-step ${tone(item.completion)}" style="width:${width}%"><div><strong>${esc(item.label)}</strong><small>${number(item.fact)} событий из плана ${number(item.plan)} · прогноз ${number(item.forecast)}</small></div><span>${pct(item.completion)}</span></div>`;
    }).join('');

    const managers = payload.managers || [];
    q('#managerKpiBreakdown').innerHTML = managers.length ? managers.map(manager => {
      const items = manager.kpi_items || [];
      return `<article class="manager-flow-card">
        <div class="manager-flow-head"><div><p class="eyebrow">${manager.is_admin ? 'Администратор / продажи' : 'Продажи'}</p><h3>${esc(manager.name)}</h3></div><strong class="${tone(manager.kpi_completion)}">${pct(manager.kpi_completion)}</strong></div>
        <div class="manager-flow-grid">${items.map(item => `<div><small>${esc(item.label)}</small><strong>${number(item.fact)} / ${number(item.plan)}</strong><span>${pct(item.completion)}</span></div>`).join('')}</div>
      </article>`;
    }).join('') : '<div class="empty-state">Ответственные сотрудники в amoCRM пока не определены.</div>';
  }

  async function load() {
    const config = window.ANIX_CONFIG || {};
    if (!config.supabaseUrl || !q('#monthlyFlow')) return;
    try {
      const headers = config.supabaseAnonKey ? { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` } : {};
      const response = await fetch(`${config.supabaseUrl}/functions/v1/sales-summary`, { headers });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      render(payload);
    } catch (error) {
      q('#flowUpdated').textContent = 'ошибка загрузки';
      q('#kpiMethod').textContent = `Не удалось загрузить событийный КПЭ: ${error.message}`;
      q('#monthlyFlow').innerHTML = '<div class="empty-state">Динамика месяца временно недоступна.</div>';
      q('#managerKpiBreakdown').innerHTML = '<div class="empty-state">Разбивка по сотрудникам временно недоступна.</div>';
    }
  }

  document.addEventListener('DOMContentLoaded', load);
  const refresh = q('#refreshSales');
  if (refresh) refresh.addEventListener('click', load);
  load();
})();