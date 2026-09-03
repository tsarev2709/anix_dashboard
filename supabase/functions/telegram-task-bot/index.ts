import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TELEGRAM_API = 'https://api.telegram.org';
const YOUGILE_DEFAULT_BASE = 'https://yougile.com/api-v2';
const DEFAULT_LLM_URL = 'https://llm.anix-ai.pro/v1/chat';
const PIN = '📌';

const env = (name: string) => (Deno.env.get(name) || '').trim();
const listEnv = (name: string) => new Set(env(name).split(',').map(value => value.trim()).filter(Boolean));
const asText = (value: unknown) => String(value ?? '').trim();
const clipped = (value: string, size: number) => value.length <= size ? value : `${value.slice(0, Math.max(0, size - 1)).trim()}…`;
const messageText = (message: any) => asText(message?.text || message?.caption);
const chatIdOf = (message: any) => asText(message?.chat?.id);
const senderName = (user: any) => [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || null;
const containsPin = (reactions: any[]) => (reactions || []).some(reaction => reaction?.type === 'emoji' && reaction?.emoji === PIN);

function sourceUrl(chat: any, messageId: number) {
  if (chat?.username) return `https://t.me/${chat.username}/${messageId}`;
  const id = asText(chat?.id);
  return id.startsWith('-100') ? `https://t.me/c/${id.slice(4)}/${messageId}` : null;
}

function parseJsonObject(value: string) {
  const cleaned = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM did not return a JSON object');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function fallbackTask(original: string, context: any[]) {
  const first = original.split(/\n|(?<=[.!?])\s+/)[0]?.replace(/^\s*[-–—]?\s*/, '') || 'Разобрать задачу из Telegram';
  return {
    title: clipped(first, 90),
    description: [
      'Исходная формулировка:',
      original,
      '',
      'Контекст перед сообщением:',
      context.slice(-8).map(row => `${row.sender_name || 'Участник'}: ${row.message_text}`).join('\n') || 'Нет доступного контекста.',
      '',
      'Задача создана без LLM-нормализации; формулировку стоит уточнить в YouGile.',
    ].join('\n'),
    assignee_hint: null,
    project_hint: null,
    deadline_hint: null,
    confidence: 0,
  };
}

async function normalizeTask(original: string, context: any[]) {
  const url = env('ANIX_LLM_URL') || DEFAULT_LLM_URL;
  const secret = env('ANIX_LLM_GATEWAY_SECRET');
  if (!secret) throw new Error('ANIX_LLM_GATEWAY_SECRET is missing');
  const transcript = context.map(row => `[${row.message_at}] ${row.sender_name || 'Участник'}: ${row.message_text}`).join('\n');
  const systemPrompt = `Ты — операционный ассистент Anix. Превращай сообщение из рабочего Telegram-чата в одну исполнимую задачу для YouGile.
Верни только JSON: {"title":string,"description":string,"assignee_hint":string|null,"project_hint":string|null,"deadline_hint":string|null,"confidence":number}.
Требования: title — глагол действия и ясный результат, максимум 90 символов; description — цель, важный контекст, ожидаемый результат/критерий готовности и ссылка на исходное сообщение, если она дана. Используй контекст чата, но не придумывай факты, ответственного или срок. Не превращай обсуждение в несколько задач. Если данных нет — null и прямо укажи, что нужно уточнить.`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_id: crypto.randomUUID(),
      system_prompt: systemPrompt,
      retrieved_context: transcript,
      messages: [{ role: 'user', content: `Сообщение с реакцией ${PIN}:\n${original}` }],
      model: env('ANIX_LLM_MODEL') || 'qwen3:8b',
      model_parameters: { format: 'json', think: false, temperature: 0.2, num_ctx: 8192 },
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${clipped(text, 500)}`);
  const envelope = JSON.parse(text);
  const parsed = parseJsonObject(asText(envelope?.message?.content));
  if (!asText(parsed.title)) throw new Error('LLM returned an empty title');
  return {
    title: clipped(asText(parsed.title), 90),
    description: asText(parsed.description) || original,
    assignee_hint: asText(parsed.assignee_hint) || null,
    project_hint: asText(parsed.project_hint) || null,
    deadline_hint: asText(parsed.deadline_hint) || null,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
  };
}

async function telegram(method: string, body: Record<string, unknown>) {
  const token = env('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Telegram ${method} HTTP ${response.status}: ${clipped(text, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function notify(chatId: string, messageId: number, text: string) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
  });
}

async function createYouGileTask(task: any) {
  const token = env('YOUGILE_API_KEY');
  const columnId = env('YOUGILE_INBOX_COLUMN_ID');
  if (!token || !columnId) throw new Error('YOUGILE_API_KEY or YOUGILE_INBOX_COLUMN_ID is missing');
  const base = (env('YOUGILE_BASE_URL') || YOUGILE_DEFAULT_BASE).replace(/\/$/, '');
  const assigned = [...listEnv('YOUGILE_DEFAULT_ASSIGNEE_IDS')];
  const required = { title: task.title, columnId, description: task.description };
  const post = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${base}/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { response, body };
  };
  let result = await post(assigned.length ? { ...required, assigned } : required);
  if (!result.response.ok && assigned.length && result.response.status >= 400 && result.response.status < 500) result = await post(required);
  if (!result.response.ok) throw new Error(`YouGile HTTP ${result.response.status}: ${clipped(typeof result.body === 'string' ? result.body : JSON.stringify(result.body), 700)}`);
  return result.body;
}

function youGileUrl(taskId: string, response: any) {
  const direct = response?.url || response?.webUrl || response?.link;
  if (direct) return asText(direct);
  const template = env('YOUGILE_TASK_URL_TEMPLATE');
  return template && taskId ? template.replaceAll('{id}', encodeURIComponent(taskId)) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const expectedSecret = env('TELEGRAM_WEBHOOK_SECRET');
  if (!expectedSecret || req.headers.get('x-telegram-bot-api-secret-token') !== expectedSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const update = await req.json();
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const allowedChats = listEnv('TELEGRAM_ALLOWED_CHAT_IDS');
  const allowedUsers = listEnv('TELEGRAM_ALLOWED_USER_IDS');
  const isAllowedChat = (chatId: string) => !allowedChats.size || allowedChats.has(chatId);
  const isAllowedUser = (userId: string) => !allowedUsers.size || allowedUsers.has(userId);

  const persistMessage = async (message: any) => {
    const text = messageText(message);
    const chatId = chatIdOf(message);
    if (!text || !chatId || !isAllowedChat(chatId)) return;
    const row = {
      chat_id: chatId,
      message_id: Number(message.message_id),
      thread_id: message.message_thread_id || null,
      reply_to_message_id: message.reply_to_message?.message_id || null,
      chat_title: message.chat?.title || message.chat?.username || null,
      sender_id: asText(message.from?.id) || null,
      sender_name: senderName(message.from),
      message_text: text,
      message_at: new Date(Number(message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      raw: message,
    };
    const { error } = await db.from('telegram_chat_messages').upsert(row, { onConflict: 'chat_id,message_id' });
    if (error) throw error;
  };

  const processTask = async (chat: any, targetMessageId: number, reactorId: string, suppliedMessage?: any) => {
    const chatId = asText(chat?.id);
    if (!chatId || !isAllowedChat(chatId) || !isAllowedUser(reactorId)) return;
    if (suppliedMessage) await persistMessage(suppliedMessage);

    const { data: originalRow, error: messageError } = await db.from('telegram_chat_messages')
      .select('*').eq('chat_id', chatId).eq('message_id', targetMessageId).maybeSingle();
    if (messageError) throw messageError;
    if (!originalRow) {
      await notify(chatId, targetMessageId, 'Не вижу текст этого сообщения: бот ещё не был в чате. Ответьте на него командой /task — тогда Telegram передаст мне исходный текст.');
      return;
    }

    const original = originalRow.message_text;
    const link = sourceUrl(chat, targetMessageId);
    const { data: inserted, error: inboxError } = await db.from('telegram_task_inbox').insert({
      chat_id: chatId,
      message_id: targetMessageId,
      reaction_user_id: reactorId || null,
      source_url: link,
      original_text: original,
      status: 'processing',
    }).select('id').single();
    if (inboxError) {
      if (inboxError.code === '23505') return;
      throw inboxError;
    }

    await notify(chatId, targetMessageId, `${PIN} Поймал. Формулирую и ставлю задачу в YouGile…`);
    try {
      let contextQuery = db.from('telegram_chat_messages').select('sender_name,message_text,message_at,message_id,thread_id')
        .eq('chat_id', chatId).lte('message_at', originalRow.message_at).order('message_at', { ascending: false })
        .limit(Math.max(5, Math.min(50, Number(env('TELEGRAM_CONTEXT_MESSAGES')) || 20)));
      if (originalRow.thread_id) contextQuery = contextQuery.eq('thread_id', originalRow.thread_id);
      const { data: contextData, error: contextError } = await contextQuery;
      if (contextError) throw contextError;
      const context = (contextData || []).reverse();

      let task;
      let status = 'created';
      let llmError: string | null = null;
      try {
        task = await normalizeTask(original, context);
      } catch (error) {
        llmError = String(error);
        task = fallbackTask(original, context);
        status = 'created_without_llm';
      }
      if (link) task.description = `${task.description}\n\nИсточник: ${link}`;
      const yougile = await createYouGileTask(task);
      const taskId = asText(yougile?.id || yougile?._id || yougile?.task?.id);
      const taskUrl = youGileUrl(taskId, yougile);
      const { error: updateError } = await db.from('telegram_task_inbox').update({
        context,
        normalized_title: task.title,
        normalized_description: task.description,
        assignee_hint: task.assignee_hint,
        project_hint: task.project_hint,
        deadline_hint: task.deadline_hint,
        confidence: task.confidence,
        status,
        yougile_task_id: taskId || null,
        yougile_response: yougile,
        error: llmError,
        processed_at: new Date().toISOString(),
      }).eq('id', inserted.id);
      if (updateError) throw updateError;
      await db.from('data_sources').update({ status: 'healthy', last_success_at: new Date().toISOString(), last_error: null }).eq('slug', 'telegram_tasks');
      const destination = taskUrl ? `\n${taskUrl}` : taskId ? `\nID: ${taskId}` : '';
      const note = status === 'created_without_llm' ? '\n⚠️ LLM была недоступна — задача создана из исходного текста.' : '';
      await notify(chatId, targetMessageId, `✅ Задача создана в YouGile\n${task.title}${destination}${note}`);
    } catch (error) {
      const detail = String(error);
      await db.from('telegram_task_inbox').update({ status: 'failed', error: detail, processed_at: new Date().toISOString() }).eq('id', inserted.id);
      await db.from('data_sources').update({ status: 'error', last_attempt_at: new Date().toISOString(), last_error: detail }).eq('slug', 'telegram_tasks');
      await notify(chatId, targetMessageId, `❌ Не удалось создать задачу в YouGile. Ошибка записана в CEO-дашборд.\n${clipped(detail, 350)}`);
    }
  };

  const work = async () => {
    const message = update.message || update.edited_message;
    if (message) {
      await persistMessage(message);
      const text = messageText(message);
      if (/^\/task(?:@\w+)?(?:\s|$)/i.test(text) && message.reply_to_message) {
        await processTask(message.chat, Number(message.reply_to_message.message_id), asText(message.from?.id), message.reply_to_message);
      }
    }

    const reaction = update.message_reaction;
    if (reaction && !containsPin(reaction.old_reaction) && containsPin(reaction.new_reaction)) {
      await processTask(reaction.chat, Number(reaction.message_id), asText(reaction.user?.id || reaction.actor_chat?.id));
    }

    if (Math.random() < 0.02) {
      const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
      await db.from('telegram_chat_messages').delete().lt('message_at', cutoff);
    }
  };

  const promise = work().catch(error => console.error('telegram-task-bot', error));
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(promise); else await promise;
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
});
