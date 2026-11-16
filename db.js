// قاعدة البيانات: SQLite مدمجة في Node (node:sqlite) — ملف واحد على قرص Render الدائم
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.removeAllListeners('warning'); // نخفي تحذير "experimental" من الـ logs
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'smart-meet.db');
const db = new DatabaseSync(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    pass_hash TEXT, google_sub TEXT UNIQUE, lang TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS invites (
    token TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    role TEXT NOT NULL, created_by TEXT, expires_at INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL, notes TEXT, start_at INTEGER, duration_min INTEGER,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS meetings_ws ON meetings(workspace_id, start_at);
`);

const now = () => Date.now();
const newId = (n = 12) => crypto.randomBytes(n).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- كلمات المرور (scrypt) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, s, h] = stored.split('$');
  const want = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}

const q = (sql) => db.prepare(sql);
const st = {
  userByEmail: q('SELECT * FROM users WHERE email = ?'),
  userById: q('SELECT * FROM users WHERE id = ?'),
  userByGoogle: q('SELECT * FROM users WHERE google_sub = ?'),
  insUser: q('INSERT INTO users (id,email,name,pass_hash,google_sub,lang,created_at) VALUES (?,?,?,?,?,?,?)'),
  setGoogle: q('UPDATE users SET google_sub = ? WHERE id = ?'),
  setPass: q('UPDATE users SET pass_hash = ? WHERE id = ?'),
  setName: q('UPDATE users SET name = ? WHERE id = ?'),
  setLang: q('UPDATE users SET lang = ? WHERE id = ?'),
  insWs: q('INSERT INTO workspaces (id,name,created_at) VALUES (?,?,?)'),
  wsById: q('SELECT * FROM workspaces WHERE id = ?'),
  renameWs: q('UPDATE workspaces SET name = ? WHERE id = ?'),
  insMember: q('INSERT OR IGNORE INTO members (workspace_id,user_id,role,created_at) VALUES (?,?,?,?)'),
  member: q('SELECT * FROM members WHERE workspace_id = ? AND user_id = ?'),
  memberships: q('SELECT m.role, w.id, w.name FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY m.created_at'),
  members: q(`SELECT u.id, u.name, u.email, m.role, m.created_at, (u.google_sub IS NOT NULL) AS google
              FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?
              ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`),
  setRole: q('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?'),
  delMember: q('DELETE FROM members WHERE workspace_id = ? AND user_id = ?'),
  countOwners: q("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND role = 'owner'"),
  insInvite: q('INSERT INTO invites (token,workspace_id,role,created_by,expires_at) VALUES (?,?,?,?,?)'),
  invite: q('SELECT i.*, w.name AS workspace_name FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = ?'),
  useInvite: q('UPDATE invites SET uses = uses + 1 WHERE token = ?'),
  insSession: q('INSERT INTO sessions (token_hash,user_id,workspace_id,expires_at,created_at) VALUES (?,?,?,?,?)'),
  session: q('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?'),
  setSessionWs: q('UPDATE sessions SET workspace_id = ? WHERE token_hash = ?'),
  delSession: q('DELETE FROM sessions WHERE token_hash = ?'),
  delUserSessions: q('DELETE FROM sessions WHERE user_id = ?'),
  purgeSessions: q('DELETE FROM sessions WHERE expires_at < ?'),
  insMeeting: q('INSERT INTO meetings (id,workspace_id,title,notes,start_at,duration_min,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)'),
  meeting: q('SELECT * FROM meetings WHERE id = ?'),
  updMeeting: q('UPDATE meetings SET title = ?, notes = ?, start_at = ?, duration_min = ? WHERE id = ?'),
  delMeeting: q('DELETE FROM meetings WHERE id = ?'),
  upcoming: q(`SELECT m.*, u.name AS creator FROM meetings m LEFT JOIN users u ON u.id = m.created_by
               WHERE m.workspace_id = ? AND m.start_at IS NOT NULL AND m.start_at + COALESCE(m.duration_min,60)*60000 >= ?
               ORDER BY m.start_at LIMIT 100`),
  past: q(`SELECT m.*, u.name AS creator FROM meetings m LEFT JOIN users u ON u.id = m.created_by
           WHERE m.workspace_id = ? AND (m.start_at IS NULL OR m.start_at + COALESCE(m.duration_min,60)*60000 < ?)
           ORDER BY COALESCE(m.start_at, m.created_at) DESC LIMIT 50`),
};
setInterval(() => st.purgeSessions.run(now()), 6 * 3600_000).unref();

module.exports = { db, st, now, newId, sha, hashPassword, checkPassword, DB_FILE };
