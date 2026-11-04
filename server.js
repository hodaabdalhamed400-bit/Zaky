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

function newRoomId() {
  const chars = 'abcdefghijkmnopqrstuvwxyz';
  const part = (n) => Array.from(crypto.randomBytes(n), (b) => chars[b % chars.length]).join('');
  let id;
  do id = `${part(3)}-${part(4)}-${part(3)}`;
  while (rooms.has(id));
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
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/api/new', (_req, res) => res.json({ id: newRoomId() }));
app.get('/api/config', (_req, res) => res.json({
  iceServers: iceServers(), maxParticipants: MAX_PARTICIPANTS, ai: ai.enabled, languages: Object.keys(ai.LANGS),
}));
app.get('/api/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  res.json({ exists: !!room, participants: room ? room.peers.size : 0, title: room?.title || null });
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

  socket.on('caption', ({ text, final } = {}) => {
    const p = peer();
    const t = clean(text, 500);
    if (!p || !t) return;
    if (final) logEvent(rooms.get(roomId), { type: 'speech', name: p.name, text: t });
    socket.to(roomId).emit('caption', { from: socket.id, name: p.name, text: t, final: !!final, ts: Date.now() });
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
      ack({ text: await ai.translate(t, lang) });
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
  console.log(ai.enabled ? `AI services: ON (assistant: ${ai.model}, translation: ${ai.translateModel})` : 'AI services: OFF — set ANTHROPIC_API_KEY to enable the assistant and translation');
});
