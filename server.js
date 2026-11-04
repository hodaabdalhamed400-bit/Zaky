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
app.post('/api/new', (req, res) => {
  if (ACCESS_CODE) {
    if (tooManyFailures(req.ip)) return res.status(429).json({ error: 'too_many' });
    if (!codeMatches(req.body?.code)) {
      recordFailure(req.ip);
      return res.status(401).json({ error: 'bad_code' });
    }
  }
  res.json({ id: newRoomId() });
});
app.get('/api/config', (_req, res) => res.json({
  iceServers: iceServers(), maxParticipants: MAX_PARTICIPANTS, ai: ai.enabled, captionCorrection: ai.correctionEnabled, accessCode: !!ACCESS_CODE, languages: Object.keys(ai.LANGS),
}));
app.get('/api/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  res.json({
    exists: !!room, valid: !!room || isAuthorizedRoomId(req.params.id),
    participants: room ? room.peers.size : 0, title: room?.title || null,
  });
});
app.get('/m/:id', (req, res) => {
  if (!ROOM_ID_RE.test(req.params.id)) return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'room.html'));
});

io.on('connection', (socket) => {
  let roomId = null;

  const peer = () => rooms.get(roomId)?.peers.get(socket.id);

  socket.on('join', (payload = {}, ack) => {
    const id = String(payload.roomId || '');
    if (roomId || !ROOM_ID_RE.test(id)) return ack?.({ error: 'invalid' });

    let room = rooms.get(id);
    if (!room) {
      const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;
      if (tooManyFailures(ip)) return ack?.({ error: 'too_many' });
      if (!isAuthorizedRoomId(id)) { recordFailure(ip); return ack?.({ error: 'notfound' }); }
      room = { title: clean(payload.title, 80) || 'اجتماع', startedAt: Date.now(), peers: new Map(), log: [] };
      rooms.set(id, room);
    }
    if (room.peers.size >= MAX_PARTICIPANTS) return ack?.({ error: 'full', max: MAX_PARTICIPANTS });

    const s = payload.state || {};
    const info = {
      id: socket.id,
      name: clean(payload.name, 40) || 'ضيف',
      state: { mic: !!s.mic, cam: !!s.cam, hand: false, screen: false, rec: false },
    };
    roomId = id;
    socket.join(id);
    const others = [...room.peers.values()];
    room.peers.set(socket.id, info);

    logEvent(room, { type: 'join', name: info.name });
    ack?.({ selfId: socket.id, title: room.title, startedAt: room.startedAt, peers: others });
    socket.to(id).emit('peer-joined', info);
  });

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

  socket.on('reaction', (emoji) => {
    const p = peer();
    const e = clean(emoji, 8);
    if (!p || !e) return;
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
    const room = rooms.get(roomId);
    if (!room) return;
    const left = room.peers.get(socket.id);
    if (left) logEvent(room, { type: 'leave', name: left.name });
    room.peers.delete(socket.id);
    socket.to(roomId).emit('peer-left', { id: socket.id });
    if (room.peers.size === 0) rooms.delete(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`smart Meet running on http://localhost:${PORT}`);
  console.log(ACCESS_CODE ? 'Company access code: ON (new meetings need the code)' : 'Company access code: OFF — set ACCESS_CODE to restrict creating meetings');
  console.log(ai.enabled ? `AI services: ON (assistant: ${ai.model}, translation & caption correction: ${ai.translateModel}${ai.correctionEnabled ? '' : ', correction OFF'})` : 'AI services: OFF — set ANTHROPIC_API_KEY to enable the assistant and translation');
});
