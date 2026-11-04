// smart Meet (ذكي) — signaling server
// يقدّم الواجهة ويوصّل المشاركين ببعض (WebRTC signaling) عبر Socket.IO.
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const ai = require('./ai');

const PORT = Number(process.env.PORT) || 3000;
const MAX_PARTICIPANTS = Number(process.env.MAX_PARTICIPANTS) || 8;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });

const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOM_ID_RE = /^[a-z0-9-]{3,40}$/;

// roomId -> { title, startedAt, peers: Map<socketId, peerInfo>, log: [] }
const MAX_LOG = 3000;
function logEvent(room, entry) {
  room.log.push({ ts: Date.now(), ...entry });
  if (room.log.length > MAX_LOG) room.log.shift();
}
const rooms = new Map();
// الاجتماعات اللي المنظّم أنهاها للجميع: الرابط بيفضل مقفول 12 ساعة
const endedRooms = new Map();
setInterval(() => { for (const [id, ts] of endedRooms) if (Date.now() - ts > 12 * 3600_000) endedRooms.delete(id); }, 3600_000).unref();

// ---------- كود الشركة ----------
// لو ACCESS_CODE موجود: إنشاء اجتماع جديد محتاج الكود، وكل رابط اجتماع عليه "توقيع" من الخادم
// (آخر 4 حروف في الكود) علشان الضيوف يقدروا يدخلوا بالرابط، والروابط المتألفة ما تشتغلش.
const ACCESS_CODE = (process.env.ACCESS_CODE || '').trim();
const ROOM_SECRET = process.env.ROOM_SECRET || (ACCESS_CODE && `room:${ACCESS_CODE}`);
const CHARS = 'abcdefghijkmnopqrstuvwxyz';
const SIGNED_ID_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{4}$/;

function sign(prefix) {
  const mac = crypto.createHmac('sha256', ROOM_SECRET).update(prefix).digest();
  return Array.from(mac.subarray(0, 4), (b) => CHARS[b % CHARS.length]).join('');
}
function isAuthorizedRoomId(id) {
  if (!ACCESS_CODE) return true;
  if (!SIGNED_ID_RE.test(id)) return false;
  const expected = sign(id.slice(0, 8));
  return crypto.timingSafeEqual(Buffer.from(id.slice(9)), Buffer.from(expected));
}
function codeMatches(code) {
  const a = crypto.createHash('sha256').update(String(code ?? '').trim()).digest();
  const b = crypto.createHash('sha256').update(ACCESS_CODE).digest();
  return crypto.timingSafeEqual(a, b);
}
// حماية من التخمين: 10 محاولات غلط كل 15 دقيقة لكل جهاز/IP
const failures = new Map();
function tooManyFailures(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > 15 * 60_000) { failures.delete(ip); return false; }
  return f.count >= 10;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 15 * 60_000) failures.set(ip, { count: 1, since: Date.now() });
  else f.count++;
  if (failures.size > 10_000) failures.clear();
}

// مفتاح المنظّم: بيتولّد مع الاجتماع ويتحفظ على جهاز اللي عمله بس
const HOST_SECRET = ROOM_SECRET || crypto.randomBytes(32).toString('hex');
const hostKeyFor = (id) => crypto.createHmac('sha256', HOST_SECRET).update(`host:${id}`).digest('hex').slice(0, 32);
function isValidHostKey(id, key) {
  if (typeof key !== 'string' || key.length !== 32) return false;
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(hostKeyFor(id)));
}

function newRoomId() {
  const part = (n) => Array.from(crypto.randomBytes(n), (b) => CHARS[b % CHARS.length]).join('');
  let id;
  do {
    const prefix = `${part(3)}-${part(4)}`;
    id = ACCESS_CODE ? `${prefix}-${sign(prefix)}` : `${prefix}-${part(3)}`;
  } while (rooms.has(id));
  return id;
}

function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    list.push({
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()),
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_PASSWORD || '',
    });
  }
  return list;
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

app.disable('x-powered-by');
app.set('trust proxy', 1); // Render بيحط الـ IP الحقيقي في X-Forwarded-For
app.use(express.json({ limit: '2kb' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.get('/healthz', (_req, res) => res.send('ok'));
// ---------- إصدار المنصة وحالة الأنظمة ----------
const PKG = require('./package.json');
const BOOTED = Date.now();
const riyadh = (ts, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour12: false, ...opts }).formatToParts(new Date(ts))
  .reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
const BUILD = (() => { const p = riyadh(BOOTED, { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); return `${p.year}${p.month}${p.day}.${p.hour}${p.minute}${p.second}`; })();
app.get('/api/status', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    version: PKG.version, build: BUILD, commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null,
    updatedAt: BOOTED, now: Date.now(), uptime: Math.round(process.uptime()),
    services: { server: true, ai: ai.enabled, turn: !!process.env.TURN_URL },
    meetings: rooms.size,
  });
});
app.post('/api/new', (req, res) => {
  if (ACCESS_CODE) {
    if (tooManyFailures(req.ip)) return res.status(429).json({ error: 'too_many' });
    if (!codeMatches(req.body?.code)) {
      recordFailure(req.ip);
      return res.status(401).json({ error: 'bad_code' });
    }
  }
  const id = newRoomId();
  res.json({ id, hostKey: hostKeyFor(id) });
});
app.get('/api/config', (_req, res) => res.json({
  iceServers: iceServers(), maxParticipants: MAX_PARTICIPANTS, ai: ai.enabled, captionCorrection: ai.correctionEnabled, accessCode: !!ACCESS_CODE, languages: Object.keys(ai.LANGS),
}));
app.get('/api/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  res.json({
    exists: !!room, valid: !!room || isAuthorizedRoomId(req.params.id),
    participants: room ? room.peers.size : 0, title: room?.title || null,
    people: room ? [...room.peers.values()].slice(0, 5).map((p) => p.name) : [],
  });
});
app.get('/m/:id', (req, res) => {
  if (!ROOM_ID_RE.test(req.params.id)) return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'room.html'));
});

// ---------- نهاية الاجتماع: ملخص ذكي يظهر على الشاشة للحضور بس ----------
async function finishMeeting(room, id) {
  if (room.finished) return room.finishResult || { summaries: {} };
  room.finished = true;
  const content = room.log.filter((e) => e.type === 'speech' || e.type === 'chat').length;
  const summaries = {};
  let reason = null;
  if (!ai.enabled) reason = 'ai_off';
  else if (!content) reason = 'empty';
  else {
    for (const lang of room.langs) {
      try { summaries[lang] = await ai.summarize(room, lang); } catch (err) { console.error(`summary (${lang}) failed:`, err.message); }
    }
    if (!Object.keys(summaries).length) reason = 'ai_error';
  }
  room.finishResult = { summaries, reason };
  console.log(`meeting ${id} ended: ${Object.keys(summaries).join(',') || 'no'} summary`);
  return room.finishResult;
}

const publicPeer = (p) => ({ id: p.id, name: p.name, state: p.state, host: !!p.host });
const hasHost = (room) => [...room.peers.values()].some((p) => p.host);
const waitlistOf = (room) => [...room.waitlist.values()].map((w) => ({ id: w.id, name: w.name }));
function notifyHosts(room) {
  const list = waitlistOf(room);
  for (const p of room.peers.values()) if (p.host) io.to(p.id).emit('waitlist', list);
}
function admitAll(room) {
  const all = [...room.waitlist.values()];
  room.waitlist.clear();
  all.forEach((w) => w.admit());
  if (all.length) notifyHosts(room);
}

io.on('connection', (socket) => {
  let roomId = null;

  const peer = () => rooms.get(roomId)?.peers.get(socket.id);

  let waitingIn = null; // الاجتماع اللي الشخص مستني يدخله (غرفة الانتظار)

  socket.on('join', (payload = {}, ack) => {
    const id = String(payload.roomId || '');
    if (roomId || waitingIn || !ROOM_ID_RE.test(id)) return ack?.({ error: 'invalid' });

    let room = rooms.get(id);
    if (!room && endedRooms.has(id)) return ack?.({ error: 'ended' });
    if (!room) {
      const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;
      if (tooManyFailures(ip)) return ack?.({ error: 'too_many' });
      if (!isAuthorizedRoomId(id)) { recordFailure(ip); return ack?.({ error: 'notfound' }); }
      room = {
        title: clean(payload.title, 80) || 'اجتماع', startedAt: Date.now(), peers: new Map(), log: [],
        waitlist: new Map(), admitted: new Set(), banned: new Set(), coHosts: new Set(), locked: false, waiting: false,
        langs: new Set(['ar']), finished: false, emptyTimer: null,
      };
      rooms.set(id, room);
    }

    if (room.finished) return ack?.({ error: 'ended' });
    const clientId = clean(payload.clientId, 64) || socket.id;
    const sumLang = String(payload.lang || 'ar').startsWith('ar') ? 'ar' : 'en';
    const isHost = isValidHostKey(id, payload.hostKey) || room.coHosts.has(clientId);
    const name = clean(payload.name, 40) || 'ضيف';
    if (room.banned.has(clientId) && !isHost) return ack?.({ error: 'removed' });
    if (room.locked && !isHost) return ack?.({ error: 'locked' });
    if (room.peers.size >= MAX_PARTICIPANTS) return ack?.({ error: 'full', max: MAX_PARTICIPANTS });

    const enter = (reply) => {
      if (roomId) return;
      waitingIn = null;
      if (rooms.get(id) !== room) return reply({ error: 'ended' });
      if (room.peers.size >= MAX_PARTICIPANTS) return reply({ error: 'full', max: MAX_PARTICIPANTS });
      const s = payload.state || {};
      const info = {
        id: socket.id, name, clientId, host: isHost,
        state: { mic: !!s.mic, cam: !!s.cam, hand: false, screen: false, rec: false },
      };
      roomId = id;
      socket.join(id);
      clearTimeout(room.emptyTimer);
      room.langs.add(sumLang);
      const others = [...room.peers.values()].map(publicPeer);
      room.peers.set(socket.id, info);
      room.admitted.add(clientId);
      logEvent(room, { type: 'join', name });
      reply({
        selfId: socket.id, title: room.title, startedAt: room.startedAt, peers: others,
        host: isHost, settings: { locked: room.locked, waiting: room.waiting },
      });
      socket.to(id).emit('peer-joined', publicPeer(info));
      if (isHost) socket.emit('waitlist', waitlistOf(room));
    };

    // غرفة الانتظار: بتشتغل بس لو فيه منظّم موجود يوافق (علشان محدش يفضل مستني للأبد)
    if (room.waiting && !isHost && hasHost(room) && !room.admitted.has(clientId)) {
      waitingIn = id;
      room.waitlist.set(socket.id, {
        id: socket.id, name,
        admit: () => enter((data) => socket.emit('admitted', data)),
        deny: () => { waitingIn = null; socket.emit('denied'); },
      });
      notifyHosts(room);
      return ack?.({ waiting: true });
    }
    enter((data) => ack?.(data));
  });

  // ---------- أدوات المنظّم ----------
  const hostOnly = (fn) => (arg) => {
    const room = rooms.get(roomId);
    const me = room?.peers.get(socket.id);
    if (!me?.host) return;
    fn(room, me, arg);
  };
  const target = (room, id) => {
    const q = room.peers.get(String(id));
    return q && !q.host ? q : null; // المنظّمين ما يتحكموش في بعض
  };

  socket.on('host:admit', hostOnly((room, _me, id) => {
    const w = room.waitlist.get(String(id));
    if (!w) return;
    room.waitlist.delete(w.id);
    w.admit();
    notifyHosts(room);
  }));
  socket.on('host:admit-all', hostOnly((room) => admitAll(room)));
  socket.on('host:deny', hostOnly((room, _me, id) => {
    const w = room.waitlist.get(String(id));
    if (!w) return;
    room.waitlist.delete(w.id);
    w.deny();
    notifyHosts(room);
  }));
  socket.on('host:mute-all', hostOnly((room, me) => {
    for (const q of room.peers.values()) if (!q.host) io.to(q.id).emit('force-mute', { by: me.name });
    logEvent(room, { type: 'host', name: me.name, text: 'كتم صوت الجميع' });
  }));
  socket.on('host:mute', hostOnly((room, me, id) => {
    const q = target(room, id);
    if (q) io.to(q.id).emit('force-mute', { by: me.name });
  }));
  socket.on('host:remove', hostOnly((room, me, id) => {
    const q = target(room, id);
    if (!q) return;
    room.banned.add(q.clientId);
    room.admitted.delete(q.clientId);
    io.to(q.id).emit('removed', { by: me.name });
    logEvent(room, { type: 'host', name: me.name, text: `أخرج ${q.name} من الاجتماع` });
    setTimeout(() => io.sockets.sockets.get(q.id)?.disconnect(true), 400);
  }));
  socket.on('host:make-host', hostOnly((room, me, id) => {
    const q = target(room, id);
    if (!q) return;
    q.host = true;
    room.coHosts.add(q.clientId);
    io.to(roomId).emit('peer-host', { id: q.id });
    io.to(q.id).emit('waitlist', waitlistOf(room));
    logEvent(room, { type: 'host', name: me.name, text: `خلّى ${q.name} منظّم مشارك` });
  }));
  socket.on('host:end', hostOnly(async (room, me) => {
    const id = roomId;
    const minutes = Math.max(1, Math.round((Date.now() - room.startedAt) / 60000));
    io.to(id).emit('meeting-ended', { by: me.name, minutes });
    for (const w of room.waitlist.values()) w.deny();
    room.waitlist.clear();
    logEvent(room, { type: 'host', name: me.name, text: 'أنهى الاجتماع للجميع' });
    if (rooms.get(id) === room) rooms.delete(id);
    endedRooms.set(id, Date.now());
    const result = await finishMeeting(room, id);
    io.to(id).emit('meeting-summary', result);
  }));

  socket.on('host:settings', hostOnly((room, me, opts = {}) => {
    if ('locked' in opts) room.locked = !!opts.locked;
    if ('waiting' in opts) {
      room.waiting = !!opts.waiting;
      if (!room.waiting) admitAll(room);
    }
    io.to(roomId).emit('room-settings', { locked: room.locked, waiting: room.waiting, by: me.name });
  }));

  socket.on('signal', ({ to, data } = {}) => {
    if (!roomId || !rooms.get(roomId)?.peers.has(to)) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('state', (s = {}) => {
    const p = peer();
    if (!p) return;
    for (const k of ['mic', 'cam', 'hand', 'screen', 'rec']) if (k in s) p.state[k] = !!s[k];
    socket.to(roomId).emit('peer-state', { id: socket.id, state: p.state });
  });

  socket.on('rename', (name) => {
    const p = peer();
    const n = clean(name, 40);
    if (!p || !n) return;
    p.name = n;
    socket.to(roomId).emit('peer-renamed', { id: socket.id, name: n });
  });

  socket.on('chat', (text) => {
    const p = peer();
    const t = clean(text, 2000);
    if (!p || !t) return;
    logEvent(rooms.get(roomId), { type: 'chat', name: p.name, text: t });
    io.to(roomId).emit('chat', { from: socket.id, name: p.name, text: t, ts: Date.now() });
  });

  let reactCount = 0;
  let reactWindow = Date.now();
  socket.on('reaction', (emoji) => {
    const p = peer();
    const e = clean(emoji, 16);
    if (!p || !e) return;
    if (Date.now() - reactWindow > 10_000) { reactWindow = Date.now(); reactCount = 0; }
    if (++reactCount > 25) return; // منع الإغراق
    io.to(roomId).emit('reaction', { from: socket.id, name: p.name, emoji: e });
  });

  let fixCount = 0;
  let fixWindow = Date.now();
  socket.on('caption', async ({ text, final } = {}) => {
    const p = peer();
    const t = clean(text, 500);
    if (!p || !t) return;
    const room = rooms.get(roomId);
    const msg = { from: socket.id, name: p.name, text: t, final: !!final, ts: Date.now() };
    if (!final || !ai.correctionEnabled) {
      if (final) logEvent(room, { type: 'speech', name: p.name, text: t });
      socket.to(roomId).emit('caption', msg);
      return;
    }
    // الجملة الكاملة: نصلّحها بالذكاء الاصطناعي، ونبعت النسخة المصلّحة للكل (ومنهم المتكلم نفسه)
    if (Date.now() - fixWindow > 60_000) { fixWindow = Date.now(); fixCount = 0; }
    let finalText = t;
    if (++fixCount <= 40) {
      const context = room.log.filter((e) => e.type === 'speech').slice(-5).map((e) => `${e.name}: ${e.text}`).join('\n');
      try {
        finalText = await Promise.race([
          ai.fixTranscript(t, { title: room.title, context, speaker: p.name }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
        ]);
      } catch (err) {
        console.error('caption fix failed:', err.message);
      }
    }
    if (!rooms.has(roomId)) return;
    logEvent(room, { type: 'speech', name: p.name, text: finalText });
    io.to(roomId).emit('caption', { ...msg, text: finalText, corrected: finalText !== t, ts: Date.now() });
  });

  // ---------- الذكاء الاصطناعي ----------
  let aiBusy = false;
  let tCount = 0;
  let tWindow = Date.now();

  socket.on('ai-ask', async (question, ack) => {
    if (typeof ack !== 'function') return;
    const p = peer();
    const q = clean(question, 1000);
    if (!p || !q) return ack({ error: 'اكتب سؤالك أولاً.' });
    if (!ai.enabled) return ack({ error: 'المساعد الذكي غير مفعّل على الخادم (ANTHROPIC_API_KEY غير موجود).' });
    if (aiBusy) return ack({ error: 'المساعد يجهز ردك السابق، انتظر لحظة.' });
    aiBusy = true;
    try {
      ack({ answer: await ai.ask(rooms.get(roomId), q, p.name) });
    } catch (err) {
      console.error('ai-ask failed:', err.message);
      ack({ error: ai.friendlyError(err) });
    } finally {
      aiBusy = false;
    }
  });

  socket.on('ai-translate', async ({ text, lang } = {}, ack) => {
    if (typeof ack !== 'function') return;
    const t = clean(text, 500);
    if (!peer() || !t || !ai.LANGS[lang]) return ack({ error: 'invalid' });
    if (!ai.enabled) return ack({ error: 'disabled' });
    if (Date.now() - tWindow > 60_000) { tWindow = Date.now(); tCount = 0; }
    if (++tCount > 60) return ack({ error: 'rate' });
    try {
      const room = rooms.get(roomId);
      // آخر 6 جمل اتقالت قبل الجملة دي كسياق
      const speech = room.log.filter((e) => e.type === 'speech');
      const idx = speech.map((e) => e.text).lastIndexOf(t);
      const before = (idx >= 0 ? speech.slice(0, idx) : speech).slice(-6);
      const context = before.map((e) => `${e.name}: ${e.text}`).join('\n');
      ack({ text: await ai.translate(t, lang, { title: room.title, context }) });
    } catch (err) {
      console.error('ai-translate failed:', err.message);
      ack({ error: ai.friendlyError(err) });
    }
  });

  socket.on('disconnect', () => {
    if (waitingIn) {
      const wroom = rooms.get(waitingIn);
      if (wroom?.waitlist.delete(socket.id)) notifyHosts(wroom);
    }
    const room = rooms.get(roomId);
    if (!room) return;
    const left = room.peers.get(socket.id);
    if (left) logEvent(room, { type: 'leave', name: left.name });
    room.peers.delete(socket.id);
    socket.to(roomId).emit('peer-left', { id: socket.id });
    // لو آخر منظّم خرج، اللي مستنيين يدخلوا علطول (مفيش حد يوافق عليهم)
    if (left?.host && !hasHost(room)) admitAll(room);
    if (room.peers.size === 0) {
      // مهلة دقيقتين قبل قفل الاجتماع (لو حد النت فصل عنده يرجع لنفس الاجتماع)
      const id = roomId;
      clearTimeout(room.emptyTimer);
      room.emptyTimer = setTimeout(() => {
        if (room.peers.size || rooms.get(id) !== room) return;
        rooms.delete(id);
      }, 120_000);
    }
  });
});

server.listen(PORT, () => {
  console.log(`smart Meet running on http://localhost:${PORT}`);
  console.log(ACCESS_CODE ? 'Company access code: ON (new meetings need the code)' : 'Company access code: OFF — set ACCESS_CODE to restrict creating meetings');
  console.log(ai.enabled ? `AI services: ON (assistant: ${ai.model}, translation & caption correction: ${ai.translateModel}${ai.correctionEnabled ? '' : ', correction OFF'})` : 'AI services: OFF — set ANTHROPIC_API_KEY to enable the assistant and translation');
});
