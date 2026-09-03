(() => {
  'use strict';

  const config = window.ANIX_CONFIG || {};
  const supabaseUrl = String(config.supabaseUrl || '').replace(/\/$/, '');
  const anonKey = String(config.supabaseAnonKey || '');
  const allowedEmail = 'studio@anix-ai.pro';
  const storageKey = 'anix_dashboard_session_v1';
  const maxSessionMs = 8 * 60 * 60 * 1000;
  const nativeFetch = window.fetch.bind(window);

  let activeSession = null;
  let readyResolved = false;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });

  const finishReady = session => {
    activeSession = session;
    if (!readyResolved) {
      readyResolved = true;
      resolveReady(session);
    }
  };

  const authUrl = path => `${supabaseUrl}/auth/v1${path}`;

  const safeJson = async response => {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { message: text }; }
  };

  const authRequest = async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    headers.set('apikey', anonKey);
    headers.set('Content-Type', 'application/json');
    return nativeFetch(authUrl(path), { ...options, headers });
  };

  const loadStoredSession = () => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      sessionStorage.removeItem(storageKey);
      return null;
    }
  };

  const saveSession = session => {
    const normalized = {
      ...session,
      started_at: Number(session.started_at || Date.now()),
    };
    sessionStorage.setItem(storageKey, JSON.stringify(normalized));
    return normalized;
  };

  const clearSession = () => {
    activeSession = null;
    sessionStorage.removeItem(storageKey);
  };

  const jwtExpiryMs = token => {
    try {
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const decoded = JSON.parse(atob(payload));
      return Number(decoded.exp || 0) * 1000;
    } catch {
      return 0;
    }
  };

  const isAllowed = session => String(session?.user?.email || '').toLowerCase() === allowedEmail;

  const refreshSession = async stored => {
    if (!stored?.refresh_token) return null;
    const response = await authRequest('/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: stored.refresh_token }),
    });
    const payload = await safeJson(response);
    if (!response.ok || !payload.access_token) return null;
    return saveSession({ ...payload, started_at: stored.started_at || Date.now() });
  };

  const validateStoredSession = async () => {
    const stored = loadStoredSession();
    if (!stored || !isAllowed(stored)) {
      clearSession();
      return null;
    }
    if (Date.now() - Number(stored.started_at || 0) > maxSessionMs) {
      clearSession();
      return null;
    }
    const expiresAt = jwtExpiryMs(stored.access_token);
    if (expiresAt > Date.now() + 120000) return stored;
    const refreshed = await refreshSession(stored);
    if (!refreshed || !isAllowed(refreshed)) {
      clearSession();
      return null;
    }
    return refreshed;
  };

  const errorMessage = payload => {
    const message = String(payload?.error_description || payload?.msg || payload?.message || payload?.error || 'Не удалось войти.');
    if (/invalid login credentials/i.test(message)) return 'Неверный email или пароль.';
    if (/email not confirmed/i.test(message)) return 'Email пользователя ещё не подтверждён в Supabase.';
    if (/rate limit/i.test(message)) return 'Слишком много попыток. Подожди немного и повтори вход.';
    return message;
  };

  const removeAuthScreen = () => document.querySelector('.auth-screen')?.remove();

  const installUserControls = session => {
    const actions = document.querySelector('.header-actions');
    if (!actions || document.querySelector('#authLogout')) return;
    const wrap = document.createElement('div');
    wrap.className = 'auth-user';
    wrap.innerHTML = `<span class="auth-user-email"></span><button type="button" class="auth-logout" id="authLogout">Выйти</button>`;
    wrap.querySelector('.auth-user-email').textContent = session.user.email;
    actions.appendChild(wrap);
    wrap.querySelector('#authLogout').addEventListener('click', async () => {
      const token = activeSession?.access_token;
      clearSession();
      if (token) {
        try {
          await authRequest('/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}' });
        } catch {}
      }
      location.reload();
    });
  };

  const unlockDashboard = session => {
    removeAuthScreen();
    document.body.classList.remove('auth-locked');
    document.body.classList.add('auth-ready');
    installUserControls(session);
  };

  const showFatal = message => {
    document.body.innerHTML = `<main class="auth-screen"><div class="auth-fatal"><h1>Не удалось запустить защищённый вход</h1><p>${message}</p><p>Проверь <code>runtime-config.js</code> и обнови страницу.</p></div></main>`;
  };

  const showLogin = () => {
    removeAuthScreen();
    const screen = document.createElement('main');
    screen.className = 'auth-screen';
    screen.innerHTML = `
      <section class="auth-card" aria-labelledby="authTitle">
        <div class="auth-brand"><span class="auth-mark">A</span><div><strong>Anix</strong><small>закрытая операционная панель</small></div></div>
        <h1 id="authTitle">Вход в дашборд</h1>
        <p>Внутренние данные доступны только авторизованному владельцу.</p>
        <form class="auth-form" id="authForm">
          <label class="auth-field"><span>Email</span><input id="authEmail" name="email" type="email" autocomplete="username" required value="${allowedEmail}"></label>
          <label class="auth-field"><span>Пароль</span><input id="authPassword" name="password" type="password" autocomplete="current-password" required autofocus></label>
          <p class="auth-error" id="authError" role="alert"></p>
          <button class="auth-submit" id="authSubmit" type="submit">Войти</button>
        </form>
        <p class="auth-security">Пароль отправляется только в Supabase Auth и не хранится в GitHub или коде дашборда. Сессия очищается после закрытия браузера и не живёт дольше 8 часов.</p>
      </section>`;
    document.body.appendChild(screen);

    const form = screen.querySelector('#authForm');
    const submit = screen.querySelector('#authSubmit');
    const error = screen.querySelector('#authError');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      error.textContent = '';
      const email = String(screen.querySelector('#authEmail').value || '').trim().toLowerCase();
      const password = String(screen.querySelector('#authPassword').value || '');
      if (email !== allowedEmail) {
        error.textContent = 'Этот пользователь не имеет доступа к дашборду.';
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Проверяю…';
      try {
        const response = await authRequest('/token?grant_type=password', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        const payload = await safeJson(response);
        if (!response.ok || !payload.access_token) throw new Error(errorMessage(payload));
        const session = saveSession({ ...payload, started_at: Date.now() });
        if (!isAllowed(session)) {
          clearSession();
          throw new Error('Этот пользователь не имеет доступа к дашборду.');
        }
        finishReady(session);
        unlockDashboard(session);
      } catch (loginError) {
        error.textContent = loginError.message || 'Не удалось войти.';
      } finally {
        submit.disabled = false;
        submit.textContent = 'Войти';
      }
    });
  };

  window.ANIX_AUTH = {
    ready,
    getSession: () => activeSession,
    getAccessToken: () => activeSession?.access_token || null,
  };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const isProtectedFunction = supabaseUrl && url.startsWith(`${supabaseUrl}/functions/v1/`);
    if (!isProtectedFunction) return nativeFetch(input, init);

    let session = activeSession || await ready;
    if (!session) throw new Error('Требуется авторизация в Anix Dashboard.');
    if (jwtExpiryMs(session.access_token) <= Date.now() + 120000) {
      session = await refreshSession(session);
      if (!session) {
        clearSession();
        location.reload();
        throw new Error('Сессия истекла.');
      }
      activeSession = session;
    }

    const headers = new Headers(typeof input !== 'string' && input?.headers ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    headers.set('apikey', anonKey);
    headers.set('Authorization', `Bearer ${session.access_token}`);
    return nativeFetch(input, { ...init, headers });
  };

  (async () => {
    if (!supabaseUrl || !anonKey) {
      showFatal('В публичной конфигурации отсутствуют адрес Supabase или publishable key.');
      return;
    }
    const session = await validateStoredSession();
    if (session) {
      activeSession = session;
      finishReady(session);
      unlockDashboard(session);
    } else {
      showLogin();
    }
  })().catch(error => showFatal(error.message || String(error)));
})();