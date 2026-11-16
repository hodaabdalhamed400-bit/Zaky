// لوحة التحكم: الاجتماعات والجدولة والفريق والحساب
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const COLORS = ['#1faec1', '#2d5c8f', '#178a9a', '#3b6fb0', '#7a4fb0', '#c0703a', '#2f8f6b', '#b0475f'];
  const colorFor = (k) => { let h = 0; for (const c of String(k)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const initial = (n) => (String(n).trim()[0] || '?').toUpperCase();
  const ROLE = { owner: 'مالك', admin: 'مدير', member: 'عضو' };
  let me = null;

  function toast(t) { const el = document.createElement('div'); el.className = 'toast2'; el.textContent = t; document.body.append(el); setTimeout(() => el.remove(), 2600); }
  async function api(url, opt = {}) {
    const r = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) }, body: opt.body ? JSON.stringify(opt.body) : undefined });
    if (r.status === 401) { location.href = `/signin?next=${encodeURIComponent(location.pathname)}`; throw new Error('signin'); }
    let d = {}; try { d = await r.json(); } catch {}
    return { ok: r.ok, ...d };
  }
  const link = (id) => `${location.origin}/m/${id}`;

  // ---------- تبويبات ----------
  function tab(name) {
    document.querySelectorAll('.tabs2 button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== name; });
    $('menu').hidden = true;
    if (name === 'team') loadTeam();
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab(t.dataset.tab); if (t.dataset.focus === 'schedule') { $('sTitle').focus(); $('schedForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
    if (!e.target.closest('#menu, #avBtn')) $('menu').hidden = true;
  });
  $('avBtn').onclick = () => { $('menu').hidden = !$('menu').hidden; };
  $('menu').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'signout') { await api('/api/auth/signout', { method: 'POST' }); location.href = '/'; }
    if (a === 'newws') {
      const name = prompt('اسم مساحة العمل الجديدة:'); if (!name) return;
      const code = prompt('كود الشركة:') || '';
      const d = await api('/api/workspaces', { method: 'POST', body: { name, code } });
      if (d.ok) location.reload(); else toast(d.error === 'bad_code' ? 'كود الشركة غلط' : 'تعذّر الإنشاء');
    }
  });

  // ---------- الاجتماعات ----------
  const fmtDay = (t) => new Date(t).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtTime = (t) => new Date(t).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
  const durTxt = (m) => (m >= 60 ? `${m / 60 === Math.floor(m / 60) ? m / 60 : (m / 60).toFixed(1)} ساعة` : `${m} دقيقة`);
  function gcal(m) {
    const f = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const p = new URLSearchParams({ action: 'TEMPLATE', text: m.title, dates: `${f(m.startAt)}/${f(m.startAt + m.duration * 60000)}`, details: `${m.notes ? `${m.notes}\n\n` : ''}رابط الاجتماع: ${link(m.id)}` });
    return `https://calendar.google.com/calendar/render?${p}`;
  }
  function waText(m) {
    const when = m.startAt ? `\n🗓️ ${fmtDay(m.startAt)} — ${fmtTime(m.startAt)} (${durTxt(m.duration)})` : '';
    return `https://wa.me/?text=${encodeURIComponent(`دعوة لاجتماع: ${m.title}${when}\n🔗 ${link(m.id)}`)}`;
  }
  function item(m, i, past) {
    const t = Date.now();
    const live = m.startAt && t >= m.startAt - 10 * 60000 && t <= m.startAt + m.duration * 60000;
    const d = m.startAt ? new Date(m.startAt) : null;
    return `<li class="mi ${live ? 'live' : ''}" style="animation-delay:${i * 50}ms">
      <div class="mi-date">${d ? `<small>${d.toLocaleDateString('ar-EG', { month: 'short' })}</small><b>${d.getDate()}</b><small>${d.toLocaleDateString('ar-EG', { weekday: 'short' })}</small>` : '<b>⚡</b><small>فوري</small>'}</div>
      <div class="mi-body"><h3>${esc(m.title)}</h3>
        <div class="mi-meta">${live ? '<span class="now">● شغّال دلوقتي</span>' : ''}${m.startAt ? `<span>🕒 ${fmtTime(m.startAt)}</span><span>⏱️ ${durTxt(m.duration)}</span>` : ''}${m.creator ? `<span>👤 ${esc(m.creator)}</span>` : ''}</div>
        ${m.notes ? `<div class="mi-meta">📝 ${esc(m.notes.slice(0, 120))}</div>` : ''}</div>
      <div class="mi-actions">
        ${past ? '' : `<a class="chipb go" href="/m/${m.id}">دخول</a>`}
        <button class="chipb" data-copy="${m.id}">نسخ الرابط</button>
        ${!past ? `<a class="chipb" href="${waText(m)}" target="_blank" rel="noopener">واتساب</a>` : ''}
        ${!past && m.startAt ? `<a class="chipb" href="/api/meetings/${m.id}/ics">📲 للتقويم</a><a class="chipb" href="${gcal(m)}" target="_blank" rel="noopener">Google</a>` : ''}
        ${m.canEdit && !past ? `<button class="chipb" data-edit="${m.id}">تعديل</button>` : ''}
        ${m.canEdit ? `<button class="chipb del" data-del="${m.id}">حذف</button>` : ''}
      </div></li>`;
  }
  let meetings = { upcoming: [], past: [] };
  async function loadMeetings() {
    const d = await api('/api/meetings');
    if (!d.ok) return;
    meetings = d;
    $('upList').innerHTML = d.upcoming.length ? d.upcoming.map((m, i) => item(m, i, false)).join('') : '<li class="empty2">مفيش اجتماعات مجدولة — جدول أول اجتماع من فوق 👆</li>';
    $('pastList').innerHTML = d.past.length ? d.past.map((m, i) => item(m, i, true)).join('') : '<li class="empty2">لسه مفيش اجتماعات سابقة</li>';
    $('upCount').textContent = d.upcoming.length ? `(${d.upcoming.length})` : '';
    const next = d.upcoming[0];
    $('hiSub').textContent = next ? `اجتماعك الجاي: ${next.title} — ${fmtDay(next.startAt)} ${fmtTime(next.startAt)}` : `مساحة ${me.workspace.name} · مفيش اجتماعات قادمة`;
  }
  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { try { await navigator.clipboard.writeText(link(c.dataset.copy)); toast('اتنسخ الرابط ✔'); } catch { prompt('انسخ الرابط:', link(c.dataset.copy)); } }
    const dl = e.target.closest('[data-del]');
    if (dl && confirm('حذف الاجتماع ده؟')) { await api(`/api/meetings/${dl.dataset.del}`, { method: 'DELETE' }); toast('اتحذف'); loadMeetings(); }
    const ed = e.target.closest('[data-edit]');
    if (ed) startEdit([...meetings.upcoming, ...meetings.past].find((m) => m.id === ed.dataset.edit));
  });
  let editing = null;
  const pad = (n) => String(n).padStart(2, '0');
  function setDefaults() {
    const d = new Date(Date.now() + 60 * 60000); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
    $('sDate').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    $('sTime').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    $('sDate').min = new Date().toISOString().slice(0, 10);
  }
  function startEdit(m) {
    if (!m) return;
    editing = m.id;
    const d = new Date(m.startAt);
    $('sTitle').value = m.title; $('sNotes').value = m.notes || ''; $('sDur').value = String(m.duration);
    $('sDate').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; $('sTime').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    $('schedTitle').textContent = 'تعديل الاجتماع'; $('sSave').textContent = 'حفظ التعديل'; $('sCancel').hidden = false;
    $('schedForm').scrollIntoView({ behavior: 'smooth' });
  }
  function resetForm() { editing = null; $('schedForm').reset(); setDefaults(); $('schedTitle').textContent = 'جدولة اجتماع جديد'; $('sSave').textContent = 'جدولة الاجتماع'; $('sCancel').hidden = true; }
  $('sCancel').onclick = resetForm;
  $('schedForm').onsubmit = async (e) => {
    e.preventDefault();
    const startAt = new Date(`${$('sDate').value}T${$('sTime').value}`).getTime();
    if (!$('sTitle').value.trim() || !Number.isFinite(startAt)) { $('sMsg').textContent = 'اكتب العنوان واختار اليوم والساعة.'; return; }
    const body = { title: $('sTitle').value.trim(), notes: $('sNotes').value.trim(), startAt, duration: Number($('sDur').value) };
    const d = editing ? await api(`/api/meetings/${editing}`, { method: 'PATCH', body }) : await api('/api/meetings', { method: 'POST', body });
    if (!d.ok) { $('sMsg').textContent = d.error === 'bad_time' ? 'الميعاد مش مظبوط.' : 'تعذّر الحفظ.'; return; }
    if (d.hostKey) store.set(`meet:host:${d.id}`, d.hostKey);
    $('sMsg').className = 'msg ok'; $('sMsg').textContent = editing ? 'اتعدّل ✔' : 'اتجدول ✔ — ابعت الرابط للحضور';
    setTimeout(() => { $('sMsg').textContent = ''; $('sMsg').className = 'msg'; }, 3000);
    resetForm(); loadMeetings();
  };
  $('nowBtn').onclick = async () => {
    const d = await api('/api/meetings', { method: 'POST', body: { title: `اجتماع ${me.user.name.split(' ')[0]}`, startAt: Date.now(), duration: 60 } });
    if (!d.ok) return toast('تعذّر إنشاء الاجتماع');
    store.set(`meet:host:${d.id}`, d.hostKey);
    location.href = `/m/${d.id}`;
  };

  // ---------- الفريق ----------
  const isAdmin = () => ['owner', 'admin'].includes(me.role);
  async function loadTeam() {
    $('inviteBox').hidden = !isAdmin(); $('wsNameBox').hidden = !isAdmin();
    $('invRole').querySelector('[value="admin"]').hidden = me.role !== 'owner';
    $('wsName').value = me.workspace.name;
    const d = await api('/api/workspace/members');
    if (!d.ok) return;
    $('memCount').textContent = `(${d.members.length})`;
    $('memList').innerHTML = d.members.map((m) => {
      const self = m.id === me.user.id;
      const canRole = me.role === 'owner' && !self;
      const canManage = !self && m.role !== 'owner' && (me.role === 'owner' || (me.role === 'admin' && m.role === 'member'));
      return `<li class="pr"><span class="av" style="background:${colorFor(m.id)}">${esc(initial(m.name))}</span>
        <span class="nm"><b>${esc(m.name)}${self ? ' <span class="muted small">(أنت)</span>' : ''}</b><small>${esc(m.email)}</small></span>
        ${canRole ? `<select data-role="${m.id}">${['owner', 'admin', 'member'].map((r) => `<option value="${r}" ${r === m.role ? 'selected' : ''}>${ROLE[r]}</option>`).join('')}</select>` : `<span class="role ${m.role}">${ROLE[m.role]}</span>`}
        ${canManage ? `<button class="chipb" data-reset="${m.id}">كلمة مرور مؤقتة</button><button class="chipb del" data-rm="${m.id}">إزالة</button>` : ''}</li>`;
    }).join('');
  }
  $('memList').addEventListener('change', async (e) => {
    const s = e.target.closest('[data-role]'); if (!s) return;
    const d = await api(`/api/workspace/members/${s.dataset.role}`, { method: 'PATCH', body: { role: s.value } });
    toast(d.ok ? 'اتغيّر الدور ✔' : (d.error === 'last_owner' ? 'لازم يفضل مالك واحد على الأقل' : 'غير مسموح'));
    loadTeam();
  });
  $('memList').addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm && confirm('إزالة العضو ده من الفريق؟')) { const d = await api(`/api/workspace/members/${rm.dataset.rm}`, { method: 'DELETE' }); toast(d.ok ? 'اتشال ✔' : 'غير مسموح'); loadTeam(); }
    const rs = e.target.closest('[data-reset]');
    if (rs && confirm('عمل كلمة مرور مؤقتة جديدة للعضو ده؟ هيتطلع من كل الأجهزة.')) {
      const d = await api(`/api/workspace/members/${rs.dataset.reset}/reset`, { method: 'POST' });
      if (d.password) prompt('كلمة المرور المؤقتة — ابعتها للعضو بشكل خاص:', d.password);
    }
  });
  $('invBtn').onclick = async () => {
    const d = await api('/api/workspace/invites', { method: 'POST', body: { role: $('invRole').value } });
    if (!d.ok) return toast('غير مسموح');
    const url = `${location.origin}/invite/${d.token}`;
    $('invLink').textContent = url; $('invOut').hidden = false;
    $('invWa').href = `https://wa.me/?text=${encodeURIComponent(`انضم لفريق ${me.workspace.name} على smart Meet:\n${url}`)}`;
  };
  $('invCopy').onclick = async () => { try { await navigator.clipboard.writeText($('invLink').textContent); toast('اتنسخ ✔'); } catch { prompt('انسخ:', $('invLink').textContent); } };
  $('wsSave').onclick = async () => { const d = await api('/api/workspace', { method: 'PATCH', body: { name: $('wsName').value } }); if (d.ok) { toast('اتحفظ ✔'); boot(); } };

  // ---------- حسابي ----------
  $('aSave').onclick = async () => { const d = await api('/api/me', { method: 'PATCH', body: { name: $('aName').value } }); if (d.ok) { toast('اتحفظ ✔'); boot(); } };
  $('pSave').onclick = async () => {
    const d = await api('/api/me/password', { method: 'POST', body: { current: $('pCur').value, next: $('pNew').value } });
    $('pMsg').className = d.ok ? 'msg ok' : 'msg';
    $('pMsg').textContent = d.ok ? 'اتغيّرت ✔' : (d.error === 'weak_password' ? '8 حروف على الأقل' : 'كلمة المرور الحالية غلط');
    if (d.ok) { $('pCur').value = ''; $('pNew').value = ''; }
  };
  $('wsSel').onchange = async () => { await api('/api/me', { method: 'PATCH', body: { workspaceId: $('wsSel').value } }); location.reload(); };

  async function boot() {
    const r = await fetch('/api/me', { cache: 'no-store' }); me = await r.json();
    if (!me.user) { location.href = '/signin?next=/app'; return; }
    if (me.user.name) store.set('meet:name', me.user.name);
    $('dash').hidden = false;
    $('avBtn').textContent = initial(me.user.name); $('avBtn').style.background = colorFor(me.user.id);
    $('mName').textContent = me.user.name; $('mEmail').textContent = me.user.email;
    $('aName').value = me.user.name; $('aEmail').value = me.user.email; $('curWrap').hidden = !me.user.hasPassword;
    $('wsSel').innerHTML = me.workspaces.map((w) => `<option value="${esc(w.id)}" ${w.id === me.workspace?.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
    if (!me.workspace) {
      $('hi').textContent = `أهلًا ${me.user.name.split(' ')[0]} 👋`;
      $('hiSub').textContent = 'إنت مش عضو في أي مساحة عمل — اطلب رابط دعوة من مدير فريقك، أو اعمل مساحة جديدة من القائمة.';
      document.querySelectorAll('[data-pane="meetings"], [data-pane="team"], .hello-actions, .tabs2').forEach((el) => { el.hidden = true; });
      return;
    }
    $('hi').textContent = `أهلًا ${me.user.name.split(' ')[0]} 👋`;
    loadMeetings();
  }
  hydrateIcons(); setDefaults(); boot();
  setInterval(() => { if (!document.hidden && me?.workspace) loadMeetings(); }, 60000);
})();
