const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'family.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const initial = { ideas: [], saved: [], memories: [], tasks: [], users: [], updatedAt: null };
function load() {
  try { return { ...initial, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; }
  catch { return { ...initial }; }
}
let db = load();
function persist() {
  db.updatedAt = new Date().toISOString();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function verifyInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  params.delete('signature');
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => k + '=' + v);
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  const a = Buffer.from(calculated, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now()/1000 - authDate > 86400) return null;
  try {
    const user = JSON.parse(params.get('user') || '{}');
    if (!user.id) return null;
    return user;
  } catch { return null; }
}

app.use(express.json({ limit: '256kb' }));
app.use((req,res,next) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  next();
});
app.use('/data', (req,res) => res.sendStatus(404));
app.use(express.static(__dirname, { index: 'index.html' }));

function auth(req,res,next) {
  const raw = req.get('X-Telegram-Init-Data') || '';
  const user = verifyInitData(raw);
  if (!user) return res.status(401).json({ error: 'Открой приложение через Telegram-бота.' });
  req.tgUser = user;
  if (!db.users.some(u => String(u.id) === String(user.id))) {
    db.users.push({ id: String(user.id), firstName: user.first_name || '', username: user.username || '', seenAt: new Date().toISOString() });
    persist();
  } else {
    const record = db.users.find(u => String(u.id) === String(user.id));
    record.seenAt = new Date().toISOString();
    persist();
  }
  next();
}
function admin(req,res,next) {
  if (!ADMIN_IDS.includes(String(req.tgUser.id))) return res.status(403).json({ error: 'Нет доступа к админке.' });
  next();
}

app.get('/health', (req,res) => res.json({ ok:true, app:'Our Little World Mini App', botConfigured:!!BOT_TOKEN }));
app.get('/api/bootstrap', auth, (req,res) => res.json({
  ideas: db.ideas, saved: db.saved, memories: db.memories, tasks: db.tasks,
  isAdmin: ADMIN_IDS.includes(String(req.tgUser.id)), user: { id:req.tgUser.id, firstName:req.tgUser.first_name || '' }
}));
app.post('/api/sync', auth, async (req,res) => {
  const body = req.body || {};
  if (Array.isArray(body.saved)) {
    const incoming = body.saved.slice(0, 500);
    const known = new Set(db.saved.map(x => Array.isArray(x) ? String(x[1]) : String(x?.title || '')));
    const added = incoming.filter(x => {
      const title = Array.isArray(x) ? String(x[1] || '') : String(x?.title || '');
      return title && !known.has(title);
    });
    db.saved = [...incoming, ...db.saved].filter((x,i,a) => {
      const title = Array.isArray(x) ? String(x[1] || '') : String(x?.title || '');
      return title && a.findIndex(y => (Array.isArray(y) ? String(y[1] || '') : String(y?.title || '')) === title) === i;
    }).slice(0,500);
    if (added.length) {
      const who = req.tgUser.first_name || 'Алина';
      const lines = added.slice(0,8).map(x => '• ' + (Array.isArray(x) ? (x[0] || '♥') + ' ' + (x[1] || '') : (x.emoji || '♥') + ' ' + (x.title || ''))).join('\\n');
      for (const id of ADMIN_IDS) {
        try { await telegram('sendMessage', { chat_id:id, text:'💗 Душа моя выбрала кое-что на потом!\\n\\n' + who + ' сохранила в планы:\\n' + lines + (added.length > 8 ? '\\n…и ещё ' + (added.length-8) : '') }); }
        catch (e) { console.error('Saved-plan notification failed:', e.message); }
      }
    }
  }
  if (Array.isArray(body.memories)) db.memories = body.memories.slice(0,500);
  if (Array.isArray(body.tasks)) db.tasks = body.tasks.slice(0,500);
  persist();
  res.json({ ok:true, updatedAt:db.updatedAt });
});

app.post('/api/heart', auth, async (req,res) => {
  const count = Math.max(1, Math.min(20, Number(req.body?.count) || 1));
  const who = String(req.tgUser.first_name || 'Алина').slice(0,60);
  const message = '💌 ' + who + ' соскучилась и отправляет тебе ' + '💗'.repeat(count) + '\\n\\nПередай ей обнимашки. Она сейчас думает о тебе.';
  let delivered = 0;
  for (const id of ADMIN_IDS) {
    try { await telegram('sendMessage', { chat_id:id, text:message }); delivered++; }
    catch (e) { console.error('Heart notification failed:', e.message); }
  }
  if (!delivered) return res.status(503).json({error:'Не удалось отправить сердечки. Проверь настройки бота.'});
  res.json({ok:true});
});

app.get('/api/weather', async (req,res) => {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=50.60&longitude=36.60&current=temperature_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m&daily=precipitation_probability_max,weather_code,temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=Europe%2FMoscow';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Weather provider unavailable');
    const data = await response.json();
    const c = data.current || {};
    const badCode = [51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99].includes(Number(c.weather_code));
    const bad = badCode || Number(c.precipitation || 0) >= 0.2 || Number(c.wind_speed_10m || 0) >= 35 || Number(c.apparent_temperature ?? c.temperature_2m) <= -10 || Number(c.apparent_temperature ?? c.temperature_2m) >= 32;
    res.setHeader('Cache-Control','public, max-age=600');
    res.json({ok:true,city:'Белгород',temperature:c.temperature_2m,feelsLike:c.apparent_temperature,precipitation:c.precipitation,wind:c.wind_speed_10m,code:c.weather_code,bad,probability:data.daily?.precipitation_probability_max?.[0] ?? null,high:data.daily?.temperature_2m_max?.[0] ?? null,low:data.daily?.temperature_2m_min?.[0] ?? null});
  } catch (e) { res.status(502).json({ok:false,error:'Прогноз временно недоступен'}); }
});
app.get('/api/admin/overview', auth, admin, (req,res) => res.json({
  users:db.users, ideas:db.ideas, savedCount:db.saved.length, memoriesCount:db.memories.length,
  tasks:db.tasks, updatedAt:db.updatedAt
}));
app.post('/api/admin/ideas', auth, admin, (req,res) => {
  const { emoji='💗', title, description='', mood='cozy', who='all', budget='free', duration='short', tip='' } = req.body || {};
  if (!title || String(title).trim().length > 100) return res.status(400).json({error:'Добавь название до 100 символов.'});
  const idea = { id:crypto.randomUUID(), emoji:String(emoji).slice(0,8), title:String(title).trim(), description:String(description).slice(0,500), mood, who, budget, duration, tip:String(tip).slice(0,300), createdAt:new Date().toISOString() };
  db.ideas.unshift(idea); persist(); res.json({ok:true,idea});
});
app.delete('/api/admin/ideas/:id', auth, admin, (req,res) => {
  const before = db.ideas.length; db.ideas = db.ideas.filter(x => x.id !== req.params.id);
  if (before === db.ideas.length) return res.status(404).json({error:'Идея не найдена.'});
  persist(); res.json({ok:true});
});
app.post('/api/admin/announcement', auth, admin, async (req,res) => {
  if (!BOT_TOKEN) return res.status(503).json({error:'Добавь BOT_TOKEN в секреты хостинга.'});
  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 3500) return res.status(400).json({error:'Текст пустой или слишком длинный.'});
  const recipients = [...new Set(db.users.map(u => String(u.id)))];
  const results = await Promise.allSettled(recipients.map(chat_id => fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/sendMessage', {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({chat_id,text})
  })));
  res.json({ok:true,recipients:recipients.length,sent:results.filter(x=>x.status==='fulfilled').length});
});


async function telegram(method, payload = {}) {
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN is not configured');
  const response = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || ('Telegram API ' + method + ' failed'));
  return data.result;
}

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://alina-love-miniapp.onrender.com';
let polling = false;
let updateOffset = 0;
const pendingBroadcast = new Set();

function adminKeyboard() {
  return { inline_keyboard: [
    [{ text: '📊 Статистика', callback_data: 'adm:stats' }, { text: '👥 Пользователи', callback_data: 'adm:users' }],
    [{ text: '💡 Идеи', callback_data: 'adm:ideas' }, { text: '➕ Добавить идею', callback_data: 'adm:addidea' }],
    [{ text: '📣 Рассылка', callback_data: 'adm:broadcast' }],
    [{ text: '🌐 Открыть Mini App', web_app: { url: WEBAPP_URL } }]
  ] };
}

async function showAdmin(chatId) {
  await telegram('sendMessage', {
    chat_id: chatId,
    text: '⚙️ АДМИН-ПАНЕЛЬ «НАШ МАЛЕНЬКИЙ МИР»\\n\\nУправление прямо в Telegram. Выбери действие:',
    reply_markup: adminKeyboard()
  });
}

async function handleAdminCallback(callback) {
  const fromId = String(callback.from?.id || '');
  const chatId = callback.message?.chat?.id;
  const data = callback.data || '';
  if (!ADMIN_IDS.includes(fromId)) {
    await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Доступ закрыт.' });
    return;
  }
  await telegram('answerCallbackQuery', { callback_query_id: callback.id });
  if (!chatId) return;
  if (data === 'adm:menu') return showAdmin(chatId);
  if (data === 'adm:stats') {
    return telegram('sendMessage', { chat_id: chatId, text:
      '📊 СТАТИСТИКА\\n\\nПользователей: ' + db.users.length +
      '\\nИдей в каталоге: ' + db.ideas.length +
      '\\nСохранённых планов: ' + db.saved.length +
      '\\nВоспоминаний: ' + db.memories.length +
      '\\n\\nОбновлено: ' + (db.updatedAt || 'пока нет данных'),
      reply_markup: { inline_keyboard: [[{ text: '⬅️ В админку', callback_data: 'adm:menu' }]] }
    });
  }
  if (data === 'adm:users') {
    const list = db.users.slice(-30).reverse().map((u,i) => (i+1)+'. '+(u.firstName || 'Без имени')+(u.username ? ' (@'+u.username+')' : '')+' — ID '+u.id).join('\\n');
    return telegram('sendMessage', { chat_id: chatId, text: '👥 ПОЛЬЗОВАТЕЛИ ('+db.users.length+')\\n\\n'+(list || 'Пока никого нет.'), reply_markup: { inline_keyboard: [[{ text: '⬅️ В админку', callback_data: 'adm:menu' }]] } });
  }
  if (data === 'adm:ideas') {
    const list = db.ideas.slice(0,25).map((x,i)=>(i+1)+'. '+(x.emoji||'💗')+' '+x.title).join('\\n');
    return telegram('sendMessage', { chat_id: chatId, text: '💡 ИДЕИ ('+db.ideas.length+')\\n\\n'+(list || 'Дополнительных идей пока нет.')+'\\n\\nЧтобы добавить идею, отправь команду:\\n/addidea Название идеи', reply_markup: { inline_keyboard: [[{ text: '⬅️ В админку', callback_data: 'adm:menu' }]] } });
  }
  if (data === 'adm:addidea') {
    return telegram('sendMessage', { chat_id: chatId, text: '➕ Чтобы добавить идею, отправь одним сообщением:\\n/addidea Название идеи\\n\\nОна появится в подборке «Наш день».', reply_markup: { inline_keyboard: [[{ text: '⬅️ В админку', callback_data: 'adm:menu' }]] } });
  }
  if (data === 'adm:broadcast') {
    pendingBroadcast.add(fromId);
    return telegram('sendMessage', { chat_id: chatId, text: '📣 Пришли следующим сообщением текст рассылки. Я отправлю его всем пользователям, которые уже запускали бота или Mini App. Для отмены напиши /cancel.' });
  }
}

async function configureTelegramBot() {
  if (!BOT_TOKEN) {
    console.log('BOT_TOKEN is missing; Telegram bot polling is disabled.');
    return;
  }
  try {
    const me = await telegram('getMe');
    console.log('Telegram bot connected: @' + me.username);
    await telegram('deleteWebhook', { drop_pending_updates: false });
    await telegram('setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'Открыть наш мир 💗', web_app: { url: WEBAPP_URL } }
    });
    await telegram('setMyCommands', { commands: [
      { command: 'start', description: 'Открыть наш маленький мир 💗' },
      { command: 'app', description: 'Открыть приложение' },
      { command: 'help', description: 'Как пользоваться' },
      { command: 'admin', description: 'Панель администратора' },
      { command: 'addidea', description: 'Добавить идею (админ)' }
    ]});
    console.log('Telegram Mini App menu button configured.');
    pollTelegram();
  } catch (error) {
    console.error('Telegram bot setup failed:', error.message);
    setTimeout(configureTelegramBot, 15000);
  }
}

async function pollTelegram() {
  if (polling) return;
  polling = true;
  while (true) {
    try {
      const updates = await telegram('getUpdates', { offset: updateOffset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      for (const update of updates) {
        updateOffset = update.update_id + 1;
        if (update.callback_query) {
          await handleAdminCallback(update.callback_query);
          continue;
        }
        const message = update.message;
        if (!message?.chat?.id || !message.text) continue;
        const senderId = String(message.from?.id || '');
        const command = message.text.trim().split(/\s+/, 1)[0].split('@')[0].toLowerCase();

        if (command === '/admin') {
          if (!ADMIN_IDS.includes(senderId)) {
            await telegram('sendMessage', { chat_id: message.chat.id, text: '⛔ Эта команда доступна только администратору.' });
          } else {
            await showAdmin(message.chat.id);
          }
          continue;
        }
        if (command === '/cancel' && pendingBroadcast.has(senderId)) {
          pendingBroadcast.delete(senderId);
          await telegram('sendMessage', { chat_id: message.chat.id, text: 'Рассылка отменена.' });
          continue;
        }
        if (command === '/addidea' && ADMIN_IDS.includes(senderId)) {
          const title = message.text.replace(/^\/addidea(?:@\w+)?\s*/i, '').trim();
          if (!title || title.length > 100) {
            await telegram('sendMessage', { chat_id: message.chat.id, text: 'Формат: /addidea Название идеи (до 100 символов).' });
          } else {
            db.ideas.unshift({ id: crypto.randomUUID(), emoji: '💗', title, description: '', mood: 'cozy', who: 'all', budget: 'free', duration: 'short', tip: '', createdAt: new Date().toISOString() });
            persist();
            await telegram('sendMessage', { chat_id: message.chat.id, text: '✅ Идея добавлена: ' + title });
          }
          continue;
        }
        if (pendingBroadcast.has(senderId) && ADMIN_IDS.includes(senderId)) {
          pendingBroadcast.delete(senderId);
          const broadcastText = message.text.trim();
          if (!broadcastText || broadcastText.length > 3500) {
            await telegram('sendMessage', { chat_id: message.chat.id, text: 'Текст пустой или длиннее 3500 символов. Нажми «Рассылка» в /admin и попробуй снова.' });
          } else {
            const recipients = [...new Set(db.users.map(u => String(u.id)))];
            const results = await Promise.allSettled(recipients.map(chat_id => telegram('sendMessage', { chat_id, text: broadcastText })));
            const sent = results.filter(x => x.status === 'fulfilled').length;
            await telegram('sendMessage', { chat_id: message.chat.id, text: '✅ Рассылка завершена. Успешно: ' + sent + ' из ' + recipients.length + '.' });
          }
          continue;
        }

        if (!['/start', '/app', '/help'].includes(command)) continue;
        const user = message.from || {};
        const id = String(user.id || message.chat.id);
        const existing = db.users.find(x => String(x.id) === id);
        if (!existing) {
          db.users.push({ id, firstName: user.first_name || '', username: user.username || '', seenAt: new Date().toISOString() });
        } else {
          existing.firstName = user.first_name || existing.firstName || '';
          existing.username = user.username || existing.username || '';
          existing.seenAt = new Date().toISOString();
        }
        persist();
        const greeting = command === '/help'
          ? 'Нажми кнопку ниже, чтобы открыть наше семейное пространство. Для управления используй /admin (только администратор).'
          : 'Привет! 💗 Здесь живёт наш маленький мир — идеи для совместных дней, времени вдвоём и семейных моментов.';
        await telegram('sendMessage', {
          chat_id: message.chat.id,
          text: greeting,
          reply_markup: { inline_keyboard: [[{ text: 'Открыть наш маленький мир 💗', web_app: { url: WEBAPP_URL } }]] }
        });
      }
    } catch (error) {
      console.error('Telegram polling error:', error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

app.listen(PORT, () => {
  console.log('Our Little World listening on ' + PORT);
  configureTelegramBot();
});
