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
app.post('/api/sync', auth, (req,res) => {
  const body = req.body || {};
  for (const key of ['saved','memories','tasks']) {
    if (Array.isArray(body[key])) db[key] = body[key].slice(0, 500);
  }
  persist();
  res.json({ ok:true, updatedAt:db.updatedAt });
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

app.listen(PORT, () => console.log('Our Little World listening on ' + PORT));
