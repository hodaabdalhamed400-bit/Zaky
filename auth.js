// الحسابات ومساحات العمل والأدوار والجدولة
const express = require('express');
const { st, now, newId, sha, hashPassword, checkPassword } = require('./db');

const COOKIE = 'sm_sess';
const SESSION_DAYS = 30;
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const ROLES = ['owner', 'admin', 'member'];
const LANGS = ['ar', 'en', 'ru', 'zh'];

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// يرجّع { user, workspace, role, tokenHash } أو null
function sessionFromCookie(cookieHeader) {
  const tok = parseCookies(cookieHeader)[COOKIE];
  if (!tok || tok.length > 100) return null;
  const s = st.session.get(sha(tok), now());
  if (!s) return null;
  const user = st.userById.get(s.user_id);
  if (!user) return null;
  let wsId = s.workspace_id;
  let m = wsId ? st.member.get(wsId, user.id) : null;
  if (!m) { // لو اتشال من المساحة، ننقله لأول مساحة تانية عنده
    const first = st.memberships.all(user.id)[0];
    wsId = first?.id || null;
    m = wsId ? st.member.get(wsId, user.id) : null;
    st.setSessionWs.run(wsId, s.token_hash);
  }
  return { user, workspace: wsId ? st.wsById.get(wsId) : null, role: m?.role || null, tokenHash: s.token_hash };
}

module.exports = function createAuth({ ACCESS_CODE, codeMatches, tooManyFailures, recordFailure, newRoomId, hostKeyFor }) {
  const r = express.Router();
  r.use(express.json({ limit: '8kb' }));

  const setCookie = (req, res, token) => {
    res.cookie(COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: SESSION_DAYS * 86400_000,
    });
  };
  function startSession(req, res, userId, workspaceId) {
    const token = newId(32);
    st.insSession.run(sha(token), userId, workspaceId || null, now() + SESSION_DAYS * 86400_000, now());
    setCookie(req, res, token);
  }
  const auth = (req, res, next) => {
    const s = sessionFromCookie(req.headers.cookie);
    if (!s) return res.status(401).json({ error: 'signin' });
    req.s = s; next();
  };
  const inWs = (req, res, next) => (req.s.workspace ? next() : res.status(403).json({ error: 'no_workspace' }));
  const admin = (req, res, next) => (['owner', 'admin'].includes(req.s.role) ? next() : res.status(403).json({ error: 'forbidden' }));
  const limited = (req, res) => {
    if (tooManyFailures(req.ip)) { res.status(429).json({ error: 'too_many' }); return true; }
    return false;
  };

  // إنشاء مساحة جديدة أو الانضمام بدعوة
  function attachWorkspace(userId, { invite, workspaceName, code }, req) {
    if (invite) {
      const inv = st.invite.get(String(invite));
      if (!inv || inv.expires_at < now()) return { error: 'bad_invite' };
      st.insMember.run(inv.workspace_id, userId, inv.role, now());
      st.useInvite.run(inv.token);
      return { workspaceId: inv.workspace_id };
    }
    if (workspaceName) {
      if (ACCESS_CODE && !codeMatches(code)) { recordFailure(req.ip); return { error: 'bad_code' }; }
      const wsId = newId(9);
      st.insWs.run(wsId, clean(workspaceName, 60), now());
      st.insMember.run(wsId, userId, 'owner', now());
      return { workspaceId: wsId };
    }
    return { workspaceId: null };
  }

  const me = (s) => ({
    user: { id: s.user.id, name: s.user.name, email: s.user.email, lang: s.user.lang, hasPassword: !!s.user.pass_hash, google: !!s.user.google_sub },
    workspace: s.workspace ? { id: s.workspace.id, name: s.workspace.name } : null,
    role: s.role,
    workspaces: st.memberships.all(s.user.id),
  });

  r.get('/auth/config', (_req, res) => res.json({ google: GOOGLE_CLIENT_ID || null, codeRequired: !!ACCESS_CODE }));

  r.get('/me', (req, res) => {
    const s = sessionFromCookie(req.headers.cookie);
    res.set('Cache-Control', 'no-store');
    res.json(s ? me(s) : { user: null });
  });

  r.get('/invites/:token', (req, res) => {
    const inv = st.invite.get(String(req.params.token));
    if (!inv || inv.expires_at < now()) return res.status(404).json({ error: 'bad_invite' });
    res.json({ workspace: inv.workspace_name, role: inv.role });
  });

  r.post('/auth/signup', (req, res) => {
    if (limited(req, res)) return;
    const name = clean(req.body?.name, 60);
    const email = clean(req.body?.email, 120).toLowerCase();
    const password = String(req.body?.password || '');
    const { invite, workspaceName, code } = req.body || {};
    if (!name || !emailOk(email)) return res.status(400).json({ error: 'bad_input' });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'weak_password' });
    if (!invite && !clean(workspaceName, 60)) return res.status(400).json({ error: 'need_workspace' });
    if (st.userByEmail.get(email)) return res.status(409).json({ error: 'email_taken' });
    if (!invite && ACCESS_CODE && !codeMatches(code)) { recordFailure(req.ip); return res.status(401).json({ error: 'bad_code' }); }
    if (invite) { const inv = st.invite.get(String(invite)); if (!inv || inv.expires_at < now()) return res.status(400).json({ error: 'bad_invite' }); }
    const id = newId(9);
    st.insUser.run(id, email, name, hashPassword(password), null, LANGS.includes(req.body?.lang) ? req.body.lang : null, now());
    const a = attachWorkspace(id, { invite, workspaceName, code }, req);
    startSession(req, res, id, a.workspaceId);
    res.json({ ok: true });
  });

  r.post('/auth/signin', (req, res) => {
    if (limited(req, res)) return;
    const email = clean(req.body?.email, 120).toLowerCase();
    const u = st.userByEmail.get(email);
    if (!u || !checkPassword(String(req.body?.password || ''), u.pass_hash)) {
      recordFailure(req.ip);
      return res.status(401).json({ error: 'bad_login' });
    }
    let wsId = st.memberships.all(u.id)[0]?.id || null;
    if (req.body?.invite) { const a = attachWorkspace(u.id, { invite: req.body.invite }, req); if (a.workspaceId) wsId = a.workspaceId; }
    startSession(req, res, u.id, wsId);
    res.json({ ok: true });
  });

  // تسجيل الدخول بجوجل: بنتحقق من الـ ID token عند جوجل نفسها
  r.post('/auth/google', async (req, res) => {
    if (!GOOGLE_CLIENT_ID) return res.status(400).json({ error: 'google_off' });
    if (limited(req, res)) return;
    let info;
    try {
      const g = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(req.body?.credential || ''))}`);
      info = g.ok ? await g.json() : null;
    } catch { info = null; }
    if (!info || info.aud !== GOOGLE_CLIENT_ID || String(info.email_verified) !== 'true' || !info.sub) {
      recordFailure(req.ip);
      return res.status(401).json({ error: 'google_failed' });
    }
    const email = String(info.email).toLowerCase();
    let u = st.userByGoogle.get(info.sub) || st.userByEmail.get(email);
    const { invite, workspaceName, code } = req.body || {};
    if (!u) {
      if (!invite && !clean(workspaceName, 60)) return res.json({ needWorkspace: true, name: info.name || '', email });
      if (!invite && ACCESS_CODE && !codeMatches(code)) { recordFailure(req.ip); return res.status(401).json({ error: 'bad_code' }); }
      const id = newId(9);
      st.insUser.run(id, email, clean(info.name || email.split('@')[0], 60), null, info.sub, null, now());
      u = st.userById.get(id);
    } else if (!u.google_sub) st.setGoogle.run(info.sub, u.id);
    let wsId = st.memberships.all(u.id)[0]?.id || null;
    if (invite || (!wsId && workspaceName)) {
      const a = attachWorkspace(u.id, { invite, workspaceName, code }, req);
      if (a.error) return res.status(400).json({ error: a.error });
      wsId = a.workspaceId || wsId;
    }
    startSession(req, res, u.id, wsId);
    res.json({ ok: true });
  });

  r.post('/auth/signout', (req, res) => {
    const s = sessionFromCookie(req.headers.cookie);
    if (s) st.delSession.run(s.tokenHash);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // ---- حسابي ----
  r.patch('/me', auth, (req, res) => {
    const name = clean(req.body?.name, 60);
    if (name) st.setName.run(name, req.s.user.id);
    if (LANGS.includes(req.body?.lang)) st.setLang.run(req.body.lang, req.s.user.id);
    if (req.body?.workspaceId) {
      if (!st.member.get(String(req.body.workspaceId), req.s.user.id)) return res.status(403).json({ error: 'forbidden' });
      st.setSessionWs.run(String(req.body.workspaceId), req.s.tokenHash);
    }
    res.json({ ok: true });
  });
  r.post('/me/password', auth, (req, res) => {
    const { current, next: nw } = req.body || {};
    if (req.s.user.pass_hash && !checkPassword(String(current || ''), req.s.user.pass_hash)) return res.status(401).json({ error: 'bad_login' });
    if (String(nw || '').length < 8) return res.status(400).json({ error: 'weak_password' });
    st.setPass.run(hashPassword(String(nw)), req.s.user.id);
    res.json({ ok: true });
  });
  r.post('/workspaces', auth, (req, res) => {
    const name = clean(req.body?.name, 60);
    if (!name) return res.status(400).json({ error: 'bad_input' });
    const a = attachWorkspace(req.s.user.id, { workspaceName: name, code: req.body?.code }, req);
    if (a.error) return res.status(401).json({ error: a.error });
    st.setSessionWs.run(a.workspaceId, req.s.tokenHash);
    res.json({ ok: true });
  });
  r.post('/workspaces/join', auth, (req, res) => {
    const a = attachWorkspace(req.s.user.id, { invite: req.body?.invite }, req);
    if (a.error || !a.workspaceId) return res.status(400).json({ error: a.error || 'bad_invite' });
    st.setSessionWs.run(a.workspaceId, req.s.tokenHash);
    res.json({ ok: true });
  });

  // ---- إدارة الفريق ----
  r.get('/workspace/members', auth, inWs, (req, res) => res.json({ members: st.members.all(req.s.workspace.id) }));
  r.patch('/workspace', auth, inWs, admin, (req, res) => {
    const name = clean(req.body?.name, 60);
    if (name) st.renameWs.run(name, req.s.workspace.id);
    res.json({ ok: true });
  });
  r.post('/workspace/invites', auth, inWs, admin, (req, res) => {
    const role = ['admin', 'member'].includes(req.body?.role) ? req.body.role : 'member';
    if (role === 'admin' && req.s.role !== 'owner') return res.status(403).json({ error: 'forbidden' });
    const token = newId(18);
    st.insInvite.run(token, req.s.workspace.id, role, req.s.user.id, now() + 7 * 86400_000);
    res.json({ token, role, expiresInDays: 7 });
  });
  r.patch('/workspace/members/:id', auth, inWs, admin, (req, res) => {
    const target = st.member.get(req.s.workspace.id, String(req.params.id));
    const role = String(req.body?.role || '');
    if (!target || !ROLES.includes(role)) return res.status(400).json({ error: 'bad_input' });
    if (req.s.role !== 'owner') return res.status(403).json({ error: 'forbidden' }); // تغيير الأدوار للمالك بس
    if (target.role === 'owner' && role !== 'owner' && st.countOwners.get(req.s.workspace.id).n <= 1) return res.status(400).json({ error: 'last_owner' });
    st.setRole.run(role, req.s.workspace.id, target.user_id);
    res.json({ ok: true });
  });
  r.delete('/workspace/members/:id', auth, inWs, admin, (req, res) => {
    const target = st.member.get(req.s.workspace.id, String(req.params.id));
    if (!target) return res.status(404).json({ error: 'not_found' });
    if (target.role === 'owner' || (req.s.role !== 'owner' && target.role !== 'member')) return res.status(403).json({ error: 'forbidden' });
    st.delMember.run(req.s.workspace.id, target.user_id);
    res.json({ ok: true });
  });
  r.post('/workspace/members/:id/reset', auth, inWs, admin, (req, res) => {
    const target = st.member.get(req.s.workspace.id, String(req.params.id));
    if (!target || target.role === 'owner' || (req.s.role !== 'owner' && target.role !== 'member')) return res.status(403).json({ error: 'forbidden' });
    const temp = newId(6);
    st.setPass.run(hashPassword(temp), target.user_id);
    st.delUserSessions.run(target.user_id);
    res.json({ password: temp });
  });

  // ---- الاجتماعات والجدولة ----
  const pubMeeting = (m, s) => ({
    id: m.id, title: m.title, notes: m.notes || '', startAt: m.start_at, duration: m.duration_min,
    creator: m.creator || null, mine: m.created_by === s.user.id,
    canEdit: m.created_by === s.user.id || ['owner', 'admin'].includes(s.role),
  });
  r.get('/meetings', auth, inWs, (req, res) => {
    const t = now();
    res.set('Cache-Control', 'no-store');
    res.json({
      upcoming: st.upcoming.all(req.s.workspace.id, t).map((m) => pubMeeting(m, req.s)),
      past: st.past.all(req.s.workspace.id, t).map((m) => pubMeeting(m, req.s)),
    });
  });
  function readMeeting(body) {
    const title = clean(body?.title, 80) || 'اجتماع';
    const notes = clean(body?.notes, 500);
    const startAt = body?.startAt == null || body.startAt === '' ? null : Number(body.startAt);
    const duration = Math.min(600, Math.max(5, Number(body?.duration) || 60));
    if (startAt != null && (!Number.isFinite(startAt) || startAt < now() - 86400_000 || startAt > now() + 366 * 86400_000)) return null;
    return { title, notes, startAt, duration };
  }
  r.post('/meetings', auth, inWs, (req, res) => {
    const m = readMeeting(req.body);
    if (!m) return res.status(400).json({ error: 'bad_time' });
    const id = newRoomId();
    st.insMeeting.run(id, req.s.workspace.id, m.title, m.notes, m.startAt, m.duration, req.s.user.id, now());
    res.json({ id, hostKey: hostKeyFor(id) });
  });
  r.patch('/meetings/:id', auth, inWs, (req, res) => {
    const mt = st.meeting.get(String(req.params.id));
    if (!mt || mt.workspace_id !== req.s.workspace.id) return res.status(404).json({ error: 'not_found' });
    if (mt.created_by !== req.s.user.id && !['owner', 'admin'].includes(req.s.role)) return res.status(403).json({ error: 'forbidden' });
    const m = readMeeting(req.body);
    if (!m) return res.status(400).json({ error: 'bad_time' });
    st.updMeeting.run(m.title, m.notes, m.startAt, m.duration, mt.id);
    res.json({ ok: true });
  });
  r.delete('/meetings/:id', auth, inWs, (req, res) => {
    const mt = st.meeting.get(String(req.params.id));
    if (!mt || mt.workspace_id !== req.s.workspace.id) return res.status(404).json({ error: 'not_found' });
    if (mt.created_by !== req.s.user.id && !['owner', 'admin'].includes(req.s.role)) return res.status(403).json({ error: 'forbidden' });
    st.delMeeting.run(mt.id);
    res.json({ ok: true });
  });
  // ملف تقويم (.ics) لأي اجتماع مجدول — بيفتح في تقويم الآيفون وجوجل وأوتلوك
  r.get('/meetings/:id/ics', (req, res) => {
    const mt = st.meeting.get(String(req.params.id));
    if (!mt || !mt.start_at) return res.status(404).send('not found');
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const f = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//smart Meet//AR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${mt.id}@smart-meet`, `DTSTAMP:${f(now())}`, `DTSTART:${f(mt.start_at)}`, `DTEND:${f(mt.start_at + (mt.duration_min || 60) * 60000)}`,
      `SUMMARY:${esc(mt.title)}`, `DESCRIPTION:${esc(`${mt.notes ? `${mt.notes}\n\n` : ''}رابط الاجتماع: ${base}/m/${mt.id}`)}`, `URL:${base}/m/${mt.id}`,
      'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', 'DESCRIPTION:smart Meet', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="meeting-${mt.id}.ics"`);
    res.send(ics);
  });

  return r;
};

module.exports.sessionFromCookie = sessionFromCookie;
module.exports.metaForMeeting = (id) => st.meeting.get(id) || null;
