(() => {
  const q = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const state = { content: [], sources: [], flags: [], metrics: null, selected: null };

  function endpoint() {
    const config = window.ANIX_CONFIG || {};
    return config.supabaseUrl ? config.supabaseUrl.replace(/\/$/, '') + '/functions/v1/control-center' : '';
  }

  async function request(body) {
    const url = endpoint();
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
      if (state.selected?.id) state.selected = state.content.find(item => item.id === state.selected.id) || null;
      renderContentList();
      renderSources();
      renderFlags();
      renderMetrics();
      if (status) status.textContent = 'Anix Control · ' + payload.viewer.role + ' · ' + new Date(payload.generated_at).toLocaleString('ru-RU');
    } catch (error) {
      if (status) status.textContent = 'Не удалось загрузить Anix Control: ' + error.message;
      [q('#contentEntryList'), q('#sourceControlGrid'), q('#featureFlagGrid'), q('#websiteMetricGrid')].filter(Boolean).forEach(node => {
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
    load();
  });
})();
