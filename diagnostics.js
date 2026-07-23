(() => {
  const q = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const resources = ['auth.css', 'styles.css', 'sales-activity.css', 'sales-cycle.css', 'production.css', 'runtime-config.js', 'auth.js', 'app.js', 'sales-history.js', 'sales-cycle.js', 'sales-flow.js', 'production.js', 'diagnostics.js'];
  const functions = ['source-status', 'sales-summary', 'sales-history', 'sales-cycle', 'production-summary'];

  const row = item => `<div class="diagnostic-row ${item.ok ? 'ok' : 'error'}"><div><strong>${esc(item.name)}</strong><small>${esc(item.kind)}</small></div><span>${esc(item.status)}</span><p>${esc(item.detail || '')}</p></div>`;

  async function checkResource(name) {
    const started = performance.now();
    try {
      const response = await fetch(`${name}?diagnostic=${Date.now()}`, { cache: 'no-store' });
      return { name, kind: 'Файл интерфейса', ok: response.ok, status: `HTTP ${response.status}`, detail: response.ok ? `${Math.round(performance.now() - started)} мс` : 'Файл не опубликован на GitHub Pages.' };
    } catch (error) {
      return { name, kind: 'Файл интерфейса', ok: false, status: 'Сетевая ошибка', detail: error.message };
    }
  }

  async function checkFunction(name) {
    const config = window.ANIX_CONFIG || {};
    if (!config.supabaseUrl) return { name, kind: 'Supabase Edge Function', ok: false, status: 'Нет конфигурации', detail: 'В runtime-config.js не указан supabaseUrl.' };
    const started = performance.now();
    try {
      const headers = config.supabaseAnonKey ? { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` } : {};
      const response = await fetch(`${config.supabaseUrl}/functions/v1/${name}?diagnostic=${Date.now()}`, { headers, cache: 'no-store' });
      let detail = `${Math.round(performance.now() - started)} мс`;
      if (!response.ok) {
        const body = await response.text();
        detail = body.slice(0, 360) || 'Функция вернула ошибку без текста.';
      }
      return { name, kind: 'Supabase Edge Function', ok: response.ok, status: `HTTP ${response.status}`, detail };
    } catch (error) {
      return { name, kind: 'Supabase Edge Function', ok: false, status: 'Сетевая ошибка', detail: error.message };
    }
  }

  async function run() {
    const target = q('#runtimeDiagnostics');
    const summary = q('#diagnosticsSummary');
    if (!target) return;
    target.innerHTML = '<div class="empty-state">Проверяю опубликованные файлы, авторизацию и API…</div>';
    const results = await Promise.all([...resources.map(checkResource), ...functions.map(checkFunction)]);
    const failed = results.filter(item => !item.ok);
    target.innerHTML = results.map(row).join('');
    if (summary) summary.textContent = failed.length ? `${failed.length} проблем из ${results.length} проверок` : `Все ${results.length} проверок пройдены`;
  }

  document.addEventListener('DOMContentLoaded', run);
  const button = q('#runDiagnostics');
  if (button) button.addEventListener('click', run);
})();