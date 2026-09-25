(() => {
  const q = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const state = { content: [], sources: [], flags: [], metrics: null, metrika: null, selected: null };

  function endpoint() {
    const config = window.ANIX_CONFIG || {};
    return config.supabaseUrl ? config.supabaseUrl.replace(/\/$/, '') + '/functions/v1/control-center' : '';
  }

  async function request(body) {
    const url = endpoint() + '?days=' + (q('#marketingPeriod')?.value || '7');
    if (!url) throw new Error('В runtime-config.js не указан Supabase URL.');
    const options = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' };
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Не удалось выполнить запрос.');
    return payload;
  }

  function metricCard(label, item, note) {
    const value = item?.available ? String(item.value ?? 0) : '—';
    const detail = item?.available ? note : 'Источник пока находится в другом контуре Supabase';
    return '<article class="website-health-card"><small>' + esc(label) + '</small><strong>' + esc(value) + '</strong><span>' + esc(detail) + '</span></article>';
  }

  function renderMetrics() {
    const target = q('#websiteMetricGrid');
    if (!target) return;
    const m = state.metrics || {};
    target.innerHTML = [
      metricCard('Заявки с сайта', m.leads, 'за последние 30 дней'),
      metricCard('AI-диалоги', m.chats, 'за последние 30 дней'),
      metricCard('Передано в CRM', m.qualified, 'квалифицированные диалоги'),
      metricCard('Fallback-ответы', m.fallbacks, 'локальная модель или RAG недоступны'),
    ].join('');
  }

  function renderMetrika() {
    const target = q('#metrikaReport');
    if (!target) return;
    const m = state.metrika;
    const errors = { not_configured: 'Подключение ожидает OAuth-доступа к счётчику.', access_denied: 'Нет доступа к счётчику. Проверьте срок действия токена и право чтения.', rate_limited: 'Яндекс ограничил частоту запросов. Обновите позже.' };
    renderMarketingDetails(m);
    renderSocialAttribution(m);
    if (!m?.available) {
      target.innerHTML = '<div class="control-empty">' + esc(errors[m?.error] || 'Статистика временно недоступна.') + '</div>';
      return;
    }
    const number = value => value == null ? '—' : Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
    const cards = [['Визиты', 'visits', ''], ['Посетители', 'users', ''], ['Просмотры', 'pageviews', ''], ['Отказы', 'bounce_rate', '%'], ['Среднее время', 'duration_seconds', ' с']];
    const table = (title, rows) => '<div><h4>' + esc(title) + '</h4><table><thead><tr><th scope="col">' + esc(title) + '</th><th scope="col">Визиты</th></tr></thead><tbody>' + (rows.length ? rows.map(r => '<tr><td>' + esc(r.label) + '</td><td>' + esc(number(r.visits)) + '</td></tr>').join('') : '<tr><td colspan="2">Нет визитов</td></tr>') + '</tbody></table></div>';
    target.innerHTML = '<p>' + esc((m.date1 || '') + ' — ' + (m.date2 || '') + ' · обновлено ' + new Date(m.fetched_at).toLocaleString('ru-RU')) + '</p><div class="website-health-grid">' + cards.map(([label, key, unit]) => '<article class="website-health-card"><small>' + esc(label) + '</small><strong>' + esc(number(m.totals[key]) + unit) + '</strong></article>').join('') + '</div><div class="metrika-tables">' + table('По дням', m.daily) + table('Источники переходов', m.sources) + '</div><p class="history-caveat">Источники: последний значимый переход. Часовой пояс счётчика. Данные могут обновляться с задержкой.' + (m.sampled ? ' Яндекс применил выборку.' : '') + '</p>';
  }

  function renderSocialAttribution(m) {
    const target=q('#socialAttribution'); if(!target)return;
    const report=m?.details?.campaigns;
    if(!m?.available||!report?.available){target.innerHTML='<h3>Переходы на сайт</h3><p>UTM-отчёт Метрики недоступен. Данных для сравнения каналов пока нет.</p>';return;}
    const rows=report.rows.filter(r=>/^(telegram|tg|vk|vkontakte) \/ /i.test(r.label));
    target.innerHTML='<h3>Переходы на сайт по размеченным публикациям</h3><p>'+esc(m.date1+' — '+m.date2)+'</p>'+(rows.length?'<div class="report-scroll"><table class="report-table"><thead><tr><th>Канал / кампания / публикация</th><th>Визиты</th><th>Отказы, %</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.label)+'</td><td>'+esc(r.visits)+'</td><td>'+esc(r.bounce_rate)+'</td></tr>').join('')+'</tbody></table></div>':'<p>В полученных строках нет UTM-переходов telegram / tg / vk / vkontakte. Это не означает, что переходов вообще не было.</p>')+'<p class="history-caveat">Это посещения сайта, а не охват публикаций. Срез из первых 50 UTM-сегментов; '+(report.total_rows>report.rows.length?'список неполный. ':'')+(report.sampled?'Метрика применила выборку. ':'')+'Период меняется во вкладке «Сайт и конверсия».</p>';
  }

  function renderMarketingDetails(m) {
    const target=q('#marketingDetails'); if(!target)return;
    if(!m?.available){target.innerHTML='<p>Рекомендации появятся после получения статистики сайта.</p>';return;}
    const n=v=>v==null?'—':Number(v).toLocaleString('ru-RU',{maximumFractionDigits:1});
    const reportTable=(title,r)=>`<details class="report-detail"><summary>${esc(title)}</summary>${r?.available?`<div class="report-scroll"><table class="report-table"><thead><tr><th>Сегмент</th><th>Визиты</th><th>Отказы, %</th><th>Время, с</th></tr></thead><tbody>${r.rows.map(x=>`<tr><td>${esc(x.label)}</td><td>${n(x.visits)}</td><td>${n(x.bounce_rate)}</td><td>${n(x.duration_seconds)}</td></tr>`).join('')}</tbody></table></div><p class="history-caveat">${r.total_rows>r.rows.length?`Показаны ${r.rows.length} из ${r.total_rows} сегментов. `:''}${r.sampled?'Применена выборка.':''}</p>`:'<p>Этот срез недоступен.</p>'}</details>`;
    const suggestions=[]; const pages=m.details?.pages;
    const poor=pages?.rows?.filter(x=>x.visits>=30&&x.bounce_rate>=40).sort((a,b)=>b.visits-a.visits)[0];
    if(poor)suggestions.push(['Проверить входную страницу',`${poor.label}: ${n(poor.visits)} визитов, ${n(poor.bounce_rate)}% отказов.`, 'Проверить соответствие первого экрана источнику трафика, мобильную загрузку и заметность CTA. Сравнить конверсию цели до и после изменения. Порог 30 визитов / 40% — эвристика, не норматив.']);
    const devices=m.details?.devices?.rows||[],mobile=devices.find(x=>/мобил|smartphone/i.test(x.label)),desktop=devices.find(x=>/пк|desktop/i.test(x.label));
    if(mobile?.visits>=30&&desktop?.visits>=30&&mobile.bounce_rate-desktop.bounce_rate>=15)suggestions.push(['Проверить мобильный путь',`Отказы на мобильных выше на ${n(mobile.bounce_rate-desktop.bounce_rate)} п.п.`, 'Проверить размер кнопок, поля формы и скорость на телефоне. Гипотеза: интерфейс затрудняет обращение; подтвердить по целям и записям сессий.']);
    const goals=m.goals;
    if(!goals?.available||!goals.rows.length)suggestions.push(['Сделать путь до заявки измеримым',goals?.available?'В счётчике нет целей.':'Цели не удалось получить.', 'Нужны события CTA, начало формы и успешная отправка. Затем настроить последовательную составную цель. Без неё точное место потери заявки неизвестно.']);
    const untagged=m.details?.campaigns?.rows?.filter(x=>x.label.includes('Не размечено')).reduce((sum,x)=>sum+(x.visits||0),0)||0;
    if(untagged)suggestions.push(['Разметить публикации и кампании',`${n(untagged)} визитов в показанных строках имеют неполные UTM.`, 'Добавить source, medium, campaign и content к ссылкам Telegram и VK. Прямые и органические переходы могут быть без UTM — это само по себе не ошибка.']);
    if(!suggestions.length)suggestions.push(['Проверить конверсию целевых страниц',`За период ${n(m.totals.visits)} визитов. Явных сигналов по заданным порогам нет.`, 'Выбрать страницу с наибольшим трафиком, сформулировать одну гипотезу для CTA и сравнить конверсию на сопоставимом трафике.']);
    let comparison='Предыдущий период недоступен.';const prev=m.details?.previous;if(prev?.available){const a=m.totals.visits,b=prev.totals[0];comparison=`Визиты: ${n(a)} против ${n(b)} за предыдущие ${m.period_days} дней · ${b?n((a-b)/b*100)+'%':'процент не рассчитывается при нулевой базе'}. Текущий период включает неполный сегодняшний день.`;}
    target.innerHTML=`<p>${esc(comparison)}</p><h3>Что улучшать дальше</h3><p class="history-caveat">Ниже — проверяемые гипотезы по данным, а не доказанные причины потерь.</p>${suggestions.map(([title,fact,action])=>`<article class="marketing-next"><strong>${esc(title)}</strong><p>${esc(fact)}</p><p>${esc(action)}</p></article>`).join('')}${reportTable('Входные страницы · трафик и отказы',m.details?.pages)}${reportTable('Устройства · мобильные и компьютер',m.details?.devices)}${reportTable('Кампании и публикации · UTM',m.details?.campaigns)}<details class="report-detail" open><summary>Цели и конверсии</summary>${goals?.available?`<div class="report-scroll"><table class="report-table"><thead><tr><th>Цель</th><th>Достижения</th><th>Конверсия, %</th></tr></thead><tbody>${goals.rows.map(g=>`<tr><td>${esc(g.name)}</td><td>${n(g.reaches)}</td><td>${n(g.conversion_rate)}</td></tr>`).join('')}</tbody></table></div><p>Показаны ${goals.rows.length} из ${goals.total} целей. ${goals.sampled?'Применена выборка.':''}</p>`:'<p>Статистика целей недоступна.</p>'}<p class="history-caveat">Достижения разных целей не складываются в последовательную воронку. Отказы — определение Метрики, не доля потерянных заявок. Для точного оттока нужна составная цель с последовательными шагами.</p></details>`;
  }

  function renderContentList() {
    const target = q('#contentEntryList');
    if (!target) return;
    if (!state.content.length) {
      target.innerHTML = '<div class="control-empty">Материалов пока нет. Создай первый черновик.</div>';
      return;
    }
    target.innerHTML = state.content.map(item =>
      '<button class="control-list-button' + (state.selected?.id === item.id ? ' active' : '') + '" type="button" data-content-id="' + esc(item.id) + '">' +
      '<strong>' + esc(item.title) + '</strong><small>' + esc(item.content_type + ' · ' + item.status + ' · ' + item.slug) + '</small></button>'
    ).join('');
    target.querySelectorAll('[data-content-id]').forEach(button => button.addEventListener('click', () => {
      state.selected = state.content.find(item => item.id === button.dataset.contentId) || null;
      fillEditor();
      renderContentList();
    }));
  }

  function fillEditor() {
    const item = state.selected || {};
    const values = {
      contentSlug: item.slug || '',
      contentTitle: item.title || '',
      contentType: item.content_type || 'page',
      contentStatus: item.status || 'draft',
      contentRepo: item.source_repo || 'tsarev2709/anix_landing',
      contentPath: item.source_path || '',
      contentBody: item.body || '',
    };
    Object.entries(values).forEach(([id, value]) => { const node = q('#' + id); if (node) node.value = value; });
    const slug = q('#contentSlug');
    if (slug) slug.disabled = Boolean(item.id);
  }

  function renderSources() {
    const target = q('#sourceControlGrid');
    if (!target) return;
    if (!state.sources.length) {
      target.innerHTML = '<div class="control-empty">Источники пока не загрузились.</div>';
      return;
    }
    target.innerHTML = state.sources.map(item => {
      const enabled = item.enabled !== false;
      const status = enabled ? (item.status || 'not_configured') : 'paused';
      return '<article class="integration-control"><div class="integration-control-head"><div><strong>' + esc(item.name) + '</strong><small>' + esc(item.category + ' · ' + status) + '</small></div>' +
        '<button type="button" class="switch-button ' + (enabled ? 'on' : 'off') + '" data-source="' + esc(item.slug) + '" data-enabled="' + enabled + '">' + (enabled ? 'Включено' : 'На паузе') + '</button></div>' +
        '<p>' + esc(item.last_error || (item.last_success_at ? 'Последняя успешная синхронизация: ' + new Date(item.last_success_at).toLocaleString('ru-RU') : 'Подключение ещё не подтверждено.')) + '</p></article>';
    }).join('');
    target.querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await request({ action: 'set_source_enabled', slug: button.dataset.source, enabled: button.dataset.enabled !== 'true' });
        await load();
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    }));
  }

  function renderFlags() {
    const target = q('#featureFlagGrid');
    if (!target) return;
    if (!state.flags.length) {
      target.innerHTML = '<div class="control-empty">Переключатели пока не загрузились.</div>';
      return;
    }
    target.innerHTML = state.flags.map(item =>
      '<div class="flag-row"><div><strong>' + esc(item.key) + '</strong><small>' + esc(item.description || '') + '</small></div>' +
      '<button type="button" class="switch-button ' + (item.enabled ? 'on' : 'off') + '" data-flag="' + esc(item.key) + '" data-enabled="' + item.enabled + '">' + (item.enabled ? 'Включено' : 'Выключено') + '</button></div>'
    ).join('');
    target.querySelectorAll('[data-flag]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await request({ action: 'set_feature_flag', key: button.dataset.flag, enabled: button.dataset.enabled !== 'true' });
        await load();
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    }));
  }

  async function load() {
    const status = q('#controlLoadStatus');
    if (status) status.textContent = 'Обновляю данные…';
    try {
      const payload = await request();
      state.content = payload.content || [];
      state.sources = payload.sources || [];
      state.flags = payload.feature_flags || [];
      state.metrics = payload.website_metrics || null;
      state.metrika = payload.metrika || null;
      if (state.selected?.id) state.selected = state.content.find(item => item.id === state.selected.id) || null;
      renderContentList();
      renderSources();
      renderFlags();
      renderMetrics();
      renderMetrika();
      if (status) status.textContent = 'Anix Control · ' + payload.viewer.role + ' · ' + new Date(payload.generated_at).toLocaleString('ru-RU');
    } catch (error) {
      if (status) status.textContent = 'Не удалось загрузить Anix Control: ' + error.message;
      [q('#contentEntryList'), q('#sourceControlGrid'), q('#featureFlagGrid'), q('#websiteMetricGrid'), q('#metrikaReport'), q('#socialAttribution')].filter(Boolean).forEach(node => {
        node.innerHTML = '<div class="control-empty">' + esc(error.message) + '</div>';
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    q('#newContentEntry')?.addEventListener('click', () => {
      state.selected = null;
      fillEditor();
      renderContentList();
      q('#contentTitle')?.focus();
    });

    q('#contentEditor')?.addEventListener('submit', async event => {
      event.preventDefault();
      const message = q('#contentSaveMessage');
      const button = q('#contentSave');
      button.disabled = true;
      message.className = 'control-message';
      message.textContent = 'Сохраняю версию…';
      try {
        const payload = await request({
          action: 'save_content',
          entry: {
            slug: q('#contentSlug').value,
            title: q('#contentTitle').value,
            content_type: q('#contentType').value,
            status: q('#contentStatus').value,
            source_repo: q('#contentRepo').value,
            source_path: q('#contentPath').value,
            body: q('#contentBody').value,
          },
        });
        state.selected = payload.entry;
        message.className = 'control-message success';
        message.textContent = 'Сохранено. Новая версия записана в журнал.';
        await load();
      } catch (error) {
        message.className = 'control-message error';
        message.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    q('#refreshControl')?.addEventListener('click', load);
    q('#marketingPeriod')?.addEventListener('change', load);
    load();
  });
})();
