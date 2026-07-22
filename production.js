(() => {
  const q = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const number = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(value || 0));
  const date = value => value ? new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—';
  const dateTime = value => value ? new Date(value).toLocaleString('ru-RU') : '—';

  function metric(label, value, note, tone = '') {
    return `<article class="production-metric ${tone}"><small>${esc(label)}</small><strong>${esc(value)}</strong><span>${esc(note)}</span></article>`;
  }

  function render(payload) {
    const summary = payload.summary || {};
    q('#productionUpdated').textContent = payload.source?.last_success_at ? `синхронизация ${dateTime(payload.source.last_success_at)}` : `срез ${dateTime(payload.generated_at)}`;
    q('#productionSummary').innerHTML = [
      metric('Активные проекты', number(summary.projects), 'из YouGile'),
      metric('Задачи в работе', number(summary.active_tasks), 'не завершены и не архивны'),
      metric('Просрочено', number(summary.overdue), 'требуют решения', summary.overdue ? 'red' : ''),
      metric('Дедлайн за 7 дней', number(summary.due_week), 'ближайшая нагрузка', summary.due_week ? 'yellow' : ''),
      metric('Без дедлайна', number(summary.without_deadline), 'нельзя прогнозировать сроки', summary.without_deadline ? 'yellow' : ''),
      metric('Без исполнителя', number(summary.without_assignee), 'нет ответственного', summary.without_assignee ? 'red' : ''),
    ].join('');

    const bottleneck = payload.bottleneck;
    q('#productionBottleneck').innerHTML = bottleneck
      ? `<div><p class="eyebrow">Главный тормоз</p><h3>${esc(bottleneck.column_name)}</h3><p>${bottleneck.count} задач лежат здесь в среднем ${number(bottleneck.average_days)} дня. Максимум — ${number(bottleneck.max_days)} дня.</p></div><strong class="metric">${number(bottleneck.average_days)} дн.</strong>`
      : '<div><strong>Пока недостаточно истории, чтобы определить главный тормоз.</strong><p>После нескольких синхронизаций начнёт накапливаться история переходов задач.</p></div>';

    const projects = payload.projects || [];
    q('#productionProjects').innerHTML = projects.length ? projects.map(item => `<div class="production-row"><div><strong>${esc(item.project_name)}</strong><small>${item.active_tasks} активных задач · ${item.without_deadline} без дедлайна</small></div><div><strong>${item.overdue} просрочено</strong><small>${item.due_week} дедлайнов на неделю</small></div><div><strong>${item.active_tasks}</strong><small>в работе</small></div></div>`).join('') : '<div class="empty-state">Активные проекты пока не загружены.</div>';

    const people = payload.people || [];
    q('#productionPeople').innerHTML = people.length ? people.map(item => `<div class="production-row"><div><strong>${esc(item.user_name)}</strong><small>${item.projects} проектов одновременно</small></div><div><strong>${item.active_tasks} задач</strong><small>${item.due_week} дедлайнов на неделю</small></div><div><strong>${item.overdue}</strong><small>просрочено</small></div></div>`).join('') : '<div class="empty-state">Исполнители в задачах пока не определены.</div>';

    const stages = payload.stages || [];
    q('#productionStages').innerHTML = stages.length ? stages.map(item => `<div class="production-row"><div><strong>${esc(item.column_name)}</strong><small>текущая колонка YouGile</small></div><div><strong>${item.count} задач</strong><small>${item.overdue} просрочено</small></div><div><strong>${item.count}</strong><small>всего</small></div></div>`).join('') : '<div class="empty-state">Колонки пока не загружены.</div>';

    const attention = payload.attention || [];
    q('#productionAttention').innerHTML = attention.length ? attention.map(item => `<div class="production-attention-row"><div><strong>${esc(item.title || `Задача ${item.external_id}`)}</strong><small>${esc([item.project_name, item.board_name, item.column_name].filter(Boolean).join(' → '))}<br>${esc((item.assignees || []).join(', ') || 'исполнитель не указан')}</small></div><div><strong>${item.overdue_days} дн.</strong><small>дедлайн ${date(item.deadline_at)}</small></div></div>`).join('') : '<div class="empty-state">Просроченных задач нет.</div>';

    q('#productionNotice').textContent = payload.source?.status === 'healthy'
      ? 'YouGile подключён. Сейчас загрузка считается по количеству задач; для оценки реальной ёмкости команды позже добавим плановые и фактические часы.'
      : `Источник YouGile: ${payload.source?.status || 'неизвестно'}. ${payload.source?.last_error || ''}`;
  }

  async function load() {
    const config = window.ANIX_CONFIG || {};
    if (!config.supabaseUrl || !q('#productionSummary')) return;
    q('#productionNotice').textContent = 'Загружаю проекты, задачи, сроки и исполнителей из YouGile…';
    try {
      const headers = config.supabaseAnonKey ? { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` } : {};
      const response = await fetch(`${config.supabaseUrl}/functions/v1/production-summary`, { headers });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      render(payload);
    } catch (error) {
      q('#productionUpdated').textContent = 'ошибка загрузки';
      q('#productionNotice').textContent = `Не удалось загрузить производство: ${error.message}`;
      q('#productionBottleneck').innerHTML = `<div><strong>${esc(error.message)}</strong><p>Открой вкладку «Источники» и запусти диагностику.</p></div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', load);
  const refresh = q('#refreshProduction');
  if (refresh) refresh.addEventListener('click', load);
  load();
})();