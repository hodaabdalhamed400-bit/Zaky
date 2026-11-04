/* Zaky Meet — منطق غرفة الاجتماع (WebRTC mesh + Socket.IO signaling) */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const roomId = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const params = new URLSearchParams(location.search);
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initial = (name) => (String(name).trim()[0] || '?').toUpperCase();
  const COLORS = ['#1faec1', '#2d5c8f', '#178a9a', '#3b6fb0', '#7a4fb0', '#c0703a', '#2f8f6b', '#b0475f'];
  const colorFor = (key) => { let h = 0; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const fmtClock = (ts) => new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  document.title = BRAND.title;
  renderBrand();
  hydrateIcons();

  // ===================== الحالة =====================
  const me = {
    id: null,
    name: store.get('meet:name') || '',
    mic: store.get('meet:mic') !== '0',
    cam: store.get('meet:cam') !== '0',
    hand: false,
    screen: false,
    rec: false,
    host: false,
  };
  let roomSettings = { locked: false, waiting: false };
  let waitlist = [];
  // معرّف ثابت للجهاز (علشان إعادة الاتصال والطرد) + مفتاح المنظّم لو الجهاز ده هو اللي عمل الاجتماع
  const clientId = store.get('meet:cid') || (() => {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    store.set('meet:cid', id);
    return id;
  })();
  const hostKey = store.get(`meet:host:${roomId}`) || '';
  let micTrack = null;
  let camTrack = null;
  let fxTrack = null; // الكاميرا بعد الفلاتر
  let screenTrack = null;
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  let socket = null;
  let startedAt = Date.now();
  let meetingTitle = params.get('t') || 'اجتماع';
  const peers = new Map(); // id -> { id, name, state, pc, stream, tile, audioSender, videoSender, pending, initiator }
  const localStream = new MediaStream();

  // ===================== Toasts =====================
  function toast(msg, ms = 3000) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('toasts').append(el);
    setTimeout(() => el.remove(), ms);
  }

  // ===================== الوسائط =====================
  async function getTrack(kind, deviceId) {
    const constraints = kind === 'audio'
      ? { audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true } }
      : { video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } };
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    return s.getTracks()[0];
  }

  function setLocalTrack(kind, track) {
    localStream.getTracks().filter((t) => t.kind === kind).forEach((t) => localStream.removeTrack(t));
    if (track) localStream.addTrack(track);
  }

  const camOut = () => (me.cam && (fxTrack || camTrack)) || null;
  const currentVideo = () => (me.screen && screenTrack) || camOut();

  function pushTracksToPeers() {
    for (const p of peers.values()) {
      p.audioSender?.replaceTrack(micTrack).catch(() => {});
      p.videoSender?.replaceTrack(currentVideo()).catch(() => {});
    }
  }

  async function enableMic(on) {
    if (on && !micTrack) {
      try {
        micTrack = await getTrack('audio', store.get('meet:micId'));
        setLocalTrack('audio', micTrack);
        watchLevel('me', localStream);
      } catch (e) {
        toast('تعذر تشغيل الميكروفون — تأكد من السماح بالوصول إليه.');
        on = false;
      }
    }
    if (micTrack) micTrack.enabled = on;
    me.mic = on;
    store.set('meet:mic', on ? '1' : '0');
    pushTracksToPeers();
  }

  async function enableCam(on) {
    if (on && !camTrack) {
      try {
        camTrack = await getTrack('video', store.get('meet:camId'));
      } catch (e) {
        toast('تعذر تشغيل الكاميرا — تأكد من السماح بالوصول إليها.');
        on = false;
      }
    }
    if (!on && camTrack) { camTrack.stop(); camTrack = null; }
    me.cam = on;
    store.set('meet:cam', on ? '1' : '0');
    await refreshFx();
  }

  // ===================== فلاتر الكاميرا =====================
  async function refreshFx() {
    if (window.CamFX && camTrack && me.cam && CamFX.active()) fxTrack = await CamFX.apply(camTrack);
    else { window.CamFX?.stop(); fxTrack = null; }
    if (!me.screen) setLocalTrack('video', camOut());
    $('fxPreview') && ($('fxPreview').srcObject = camOut() ? new MediaStream([camOut()]) : null);
    renderSelf();
    pushTracksToPeers();
  }
  const FX_GROUPS = {
    lens: [['none', '🚫', 'بدون', '#334155,#1e293b'], ['beauty', '✨', 'تجميل', '#f9a8d4,#a855f7'], ['makeup', '💄', 'مكياج', '#fb7185,#be185d'],
      ['glam', '💎', 'جلام', '#fcd34d,#f472b6'], ['dog', '🐶', 'كلب', '#d97706,#78350f'], ['cat', '🐱', 'قطة', '#a78bfa,#4c1d95'],
      ['flowers', '🌸', 'ورد', '#f9a8d4,#16a34a'], ['butterfly', '🦋', 'فراشات', '#60a5fa,#7c3aed'], ['hearts', '😍', 'قلوب', '#fb7185,#e11d48'],
      ['gold', '🌟', 'ذهبي', '#fcd34d,#b45309'], ['glasses', '🕶️', 'نظارة', '#1faec1,#132e4d'], ['baby', '👶', 'بيبي', '#fde68a,#f9a8d4'],
      ['alien', '👽', 'فضائي', '#4ade80,#065f46'], ['bigmouth', '😮', 'بق كبير', '#fb923c,#c2410c'], ['bignose', '👃', 'مناخير', '#fdba74,#9a3412'],
      ['thin', '🥢', 'نحيف', '#5eead4,#0f766e'], ['chubby', '🐹', 'تخين', '#fca5a5,#b91c1c']],
    bg: [['none', '🚫', 'بدون'], ['blur', '🌫️', 'تغبيش'], ['brand', '🔷', 'ذكي'], ['office', '🏢', 'مكتب'], ['space', '🪐', 'الفضاء']],
    color: [['none', '🚫', 'طبيعي'], ['warm', '🌅', 'دافي'], ['cool', '❄️', 'بارد'], ['vivid', '🌈', 'حيوي'], ['vintage', '📜', 'قديم'], ['bw', '⚫', 'أبيض وأسود'], ['noir', '🎬', 'سينما']],
  };
  function loadFxState() {
    if (!window.CamFX) return;
    try { const st = JSON.parse(store.get('meet:fx2') || '{}'); for (const k of Object.keys(FX_GROUPS)) if (st[k]) CamFX.set(k, st[k]); } catch { /* ignore */ }
  }
  function renderFxPanel() {
    if (!window.CamFX) return;
    for (const [group, items] of Object.entries(FX_GROUPS)) {
      const html = items.map(([id, ic, label, grad], i) => (group === 'lens'
        ? `<button class="lens ${CamFX.state.lens === id ? 'on' : ''}" data-fxg="lens" data-fxv="${id}" style="--i:${i};--g:linear-gradient(145deg,${grad})">
             <span class="lens-orb">${ic}</span><small>${label}</small></button>`
        : `<button class="fx-chip ${CamFX.state[group] === id ? 'on' : ''}" data-fxg="${group}" data-fxv="${id}" style="--i:${i}">
             <span>${ic}</span><small>${label}</small></button>`)).join('');
      $(`fx-${group}`).innerHTML = html;
      if (group === 'lens' && $('lobbyLens')) $('lobbyLens').innerHTML = html;
    }
    const lon = $('lobbyLens')?.querySelector('.lens.on');
    if (lon && !$('lobbyLens').hidden) lon.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    const on = $('fx-lens').querySelector('.lens.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    const cur = FX_GROUPS.lens.find(([id]) => id === CamFX.state.lens);
    $('fxLensName').textContent = cur && cur[0] !== 'none' ? `${cur[1]} ${cur[2]}` : '';
    const hint = $('fxHint'); const ht = { dog: 'افتح بقك 👅', hearts: 'اضحك 😁' }[CamFX.state.lens] || '';
    if (hint.textContent !== ht) { hint.textContent = ht; hint.style.animation = 'none'; void hint.offsetWidth; hint.style.animation = ''; }
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fxg]');
    if (!b || !window.CamFX) return;
    CamFX.set(b.dataset.fxg, b.dataset.fxv);
    store.set('meet:fx2', JSON.stringify(CamFX.state));
    renderFxPanel();
    if (!me.cam) { toast('افتح الكاميرا علشان الفلتر يشتغل 📷'); return; }
    if (CamFX.needsAI() && !CamFX.aiReady()) { $('fxLoading').hidden = false; $('lbFxLoading').hidden = false; }
    await refreshFx();
    $('fxLoading').hidden = true; $('lbFxLoading').hidden = true;
    if (!$('lobby').hidden) refreshPreview();
    $('fxReset').hidden = !CamFX.active();
  });
  $('fxReset').onclick = async () => {
    for (const k of Object.keys(FX_GROUPS)) CamFX.set(k, 'none');
    store.set('meet:fx2', '{}');
    renderFxPanel(); await refreshFx(); $('fxReset').hidden = true;
  };
  window.addEventListener('camfx-error', () => toast('الفلاتر الذكية مش مدعومة على الجهاز ده — جرّب فلاتر الألوان'));

  // ===================== مستوى الصوت (من يتكلم) =====================
  let audioCtx = null;
  const meters = new Map(); // key -> { analyser, data, source }
  function watchLevel(key, stream) {
    if (!audioCtx || !stream.getAudioTracks().length) return;
    meters.get(key)?.source.disconnect();
    try {
      const source = audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      meters.set(key, { analyser, source, data: new Uint8Array(analyser.fftSize) });
    } catch { /* ignore */ }
  }
  setInterval(() => {
    for (const [key, m] of meters) {
      m.analyser.getByteTimeDomainData(m.data);
      let sum = 0;
      for (const v of m.data) sum += (v - 128) ** 2;
      const rms = Math.sqrt(sum / m.data.length);
      const muted = key === 'me' ? !me.mic : !peers.get(key)?.state.mic;
      const tile = key === 'me' ? $('tile-me') : peers.get(key)?.tile;
      tile?.classList.toggle('speaking', rms > 4 && !muted);
      if (key === 'me') $('micBtn').classList.toggle('talking', rms > 4 && !muted);
    }
  }, 200);

  // ===================== البلاطات (Tiles) =====================
  // ===================== تشغيل الصوت =====================
  // بعض المتصفحات (خصوصًا على الموبايل) بتمنع تشغيل الصوت تلقائيًا؛ ساعتها بنطلب ضغطة واحدة.
  const blockedAudio = new Set();
  function playAudio(a) {
    a.play().then(() => blockedAudio.delete(a)).catch(() => {
      blockedAudio.add(a);
      $('unmuteBar').hidden = false;
    });
  }
  function unlockAudio() {
    audioCtx?.resume?.();
    for (const a of [...blockedAudio]) playAudio(a);
    if (!blockedAudio.size) $('unmuteBar').hidden = true;
    setTimeout(() => { if (!blockedAudio.size) $('unmuteBar').hidden = true; }, 300);
  }
  document.addEventListener('click', () => { if (blockedAudio.size) unlockAudio(); }, true);
  document.addEventListener('touchend', () => { if (blockedAudio.size) unlockAudio(); }, true);

  function makeTile(id, name, isMe) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.id = `tile-${id}`;
    el.innerHTML = `
      <video autoplay playsinline muted></video>${isMe ? '' : '<audio autoplay></audio>'}
      <div class="avatar"></div>
      <div class="badges"><span class="mic-off" hidden>${icon('micOff', 18)}</span><span class="hand" hidden>${icon('hand', 18)}</span><span class="host" hidden>منظّم</span></div>
      <div class="label"><span class="nm"></span></div>`;
    $('grid').append(el);
    updateTile(el, { name, isMe, key: isMe ? me.id || 'me' : id });
    return el;
  }

  function updateTile(el, { name, isMe, state, key, stream }) {
    if (!el) return;
    if (name !== undefined) {
      el.querySelector('.nm').textContent = isMe ? `${name} · أنت` : name;
      const av = el.querySelector('.avatar');
      av.textContent = initial(name);
      av.style.setProperty('--avatar', colorFor(key || name));
    }
    if (stream) {
      const v = el.querySelector('video');
      if (v.srcObject !== stream) v.srcObject = stream;
      v.play().catch(() => {});
    }
    if (state) {
      el.classList.toggle('video-on', !!(state.cam || state.screen));
      el.classList.toggle('screen', !!state.screen);
      el.classList.toggle('spotlight', !!state.screen);
      el.classList.toggle('mirror', !!isMe && !state.screen);
      el.querySelector('.mic-off').hidden = !!state.mic;
      el.querySelector('.hand').hidden = !state.hand;
      if ('host' in state) el.querySelector('.host').hidden = !state.host;
    }
  }

  function renderSelf() {
    updateTile($('tile-me'), { name: me.name, isMe: true, state: me, key: me.id, stream: localStream });
  }

  function layout() {
    const grid = $('grid');
    const n = grid.children.length;
    grid.dataset.count = String(Math.min(n, 7));
    grid.toggleAttribute('data-many', n > 6);
    grid.classList.toggle('has-spotlight', !!grid.querySelector('.tile.spotlight'));
    $('count').textContent = n;
    $('peopleBadge').textContent = n;
    renderPeople();
  }

  function renderPeople() {
    const all = [{ id: me.id, name: me.name, state: me, isMe: true }, ...[...peers.values()].map((p) => ({ ...p, isMe: false }))];
    const hostTools = me.host ? `
      <div class="host-box">
        <p class="section-title">أدوات المنظّم</p>
        <div class="switch-row sm"><div><b>غرفة الانتظار</b><p class="muted small">الضيوف يستنّوا موافقتك قبل ما يدخلوا</p></div>
          <button class="toggle" role="switch" aria-checked="${roomSettings.waiting}" data-host="waiting"><i></i></button></div>
        <div class="switch-row sm"><div><b>قفل الاجتماع</b><p class="muted small">محدش جديد يقدر يدخل</p></div>
          <button class="toggle" role="switch" aria-checked="${roomSettings.locked}" data-host="locked"><i></i></button></div>
        <button class="btn btn-ghost btn-block" data-host="mute-all">${icon('micOff', 18)} كتم صوت الجميع</button>
      </div>` : '';
    const waiting = me.host && waitlist.length ? `
      <p class="section-title">في الانتظار (${waitlist.length})</p>
      <ul class="people waiting-list">${waitlist.map((w) => `
        <li><span class="av" style="--avatar:${colorFor(w.id)}">${esc(initial(w.name))}</span>
          <span class="nm">${esc(w.name)}</span>
          <span class="ic"><button class="mini ok" data-host="admit" data-id="${esc(w.id)}">قبول</button>
          <button class="mini" data-host="deny" data-id="${esc(w.id)}">رفض</button></span></li>`).join('')}
      </ul>${waitlist.length > 1 ? '<button class="btn btn-ghost btn-block" data-host="admit-all">قبول الكل</button>' : ''}` : '';
    $('peopleExtra').innerHTML = hostTools + waiting;
    $('people').innerHTML = all.map((p) => `
      <li>
        <span class="av" style="--avatar:${colorFor(p.id || p.name)}">${esc(initial(p.name))}</span>
        <span class="nm">${esc(p.name)}${p.isMe ? ' <span class="muted small">(أنت)</span>' : ''}${p.state.host ? ' <span class="host-tag">منظّم</span>' : ''}</span>
        <span class="ic">
          ${p.state.hand ? `<span title="رافع يده" style="color:var(--warn)">${icon('hand', 18)}</span>` : ''}
          ${p.state.screen ? `<span title="يشارك الشاشة">${icon('screen', 18)}</span>` : ''}
          <span class="${p.state.mic ? '' : 'off'}">${icon(p.state.mic ? 'mic' : 'micOff', 18)}</span>
          <span class="${p.state.cam ? '' : 'off'}">${icon(p.state.cam ? 'cam' : 'camOff', 18)}</span>
          ${me.host && !p.isMe && !p.state.host ? `<button class="mini icon" data-host="menu" data-id="${esc(p.id)}" aria-label="خيارات">${icon('more', 16)}</button>` : ''}
        </span>
      </li>
      ${me.host && !p.isMe && !p.state.host && openMenu === p.id ? `
      <li class="row-menu">
        ${p.state.mic ? `<button class="mini" data-host="mute" data-id="${esc(p.id)}">${icon('micOff', 16)} كتم</button>` : ''}
        <button class="mini" data-host="make-host" data-id="${esc(p.id)}">${icon('users', 16)} منظّم مشارك</button>
        <button class="mini danger" data-host="remove" data-id="${esc(p.id)}">${icon('close', 16)} إخراج</button>
      </li>` : ''}`).join('');
    $('peopleBadge').textContent = all.length + (me.host && waitlist.length ? ` +${waitlist.length}` : '');
  }
  let openMenu = null;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-host]');
    if (!b || !me.host) return;
    const id = b.dataset.id;
    const act = b.dataset.host;
    const name = peers.get(id)?.name || '';
    if (act === 'menu') { openMenu = openMenu === id ? null : id; renderPeople(); return; }
    if (act === 'waiting' || act === 'locked') { socket.emit('host:settings', { [act]: !roomSettings[act] }); return; }
    if (act === 'mute-all') { socket.emit('host:mute-all'); toast('تم كتم صوت الجميع'); return; }
    if (act === 'admit' || act === 'deny') { socket.emit(`host:${act}`, id); return; }
    if (act === 'admit-all') { socket.emit('host:admit-all'); return; }
    if (act === 'mute') { socket.emit('host:mute', id); toast(`تم كتم ${name}`); }
    if (act === 'make-host') { socket.emit('host:make-host', id); }
    if (act === 'remove') {
      if (!confirm(`إخراج ${name} من الاجتماع؟ مش هيقدر يدخل تاني.`)) return;
      socket.emit('host:remove', id);
    }
    openMenu = null;
    renderPeople();
  });

  // ===================== WebRTC =====================
  function createPeer(info, initiator) {
    const p = {
      id: info.id, name: info.name, state: { ...info.state, host: !!info.host }, initiator,
      stream: new MediaStream(), pending: [], audioSender: null, videoSender: null,
    };
    const pc = new RTCPeerConnection({ iceServers });
    p.pc = pc;

    if (initiator) {
      p.audioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      p.videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
      p.audioSender.replaceTrack(micTrack);
      p.videoSender.replaceTrack(currentVideo());
    }

    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('signal', { to: p.id, data: { candidate: e.candidate } }); };
    pc.ontrack = (e) => {
      p.stream.getTracks().filter((t) => t.kind === e.track.kind).forEach((t) => p.stream.removeTrack(t));
      p.stream.addTrack(e.track);
      if (e.track.kind === 'audio') {
        // الصوت في عنصر مستقل: لو الكاميرا مقفولة، الفيديو ما بيشتغلش، فما يوقفش الصوت معاه
        const a = p.tile.querySelector('audio');
        a.srcObject = new MediaStream([e.track]);
        playAudio(a);
        watchLevel(p.id, a.srcObject);
      } else {
        updateTile(p.tile, { stream: new MediaStream([e.track]) });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && p.initiator) {
        pc.restartIce();
        negotiate(p, true);
      }
    };

    p.tile = makeTile(p.id, p.name, false);
    updateTile(p.tile, { state: p.state });
    peers.set(p.id, p);
    layout();
    return p;
  }

  async function negotiate(p, iceRestart = false) {
    try {
      const offer = await p.pc.createOffer({ iceRestart });
      await p.pc.setLocalDescription(offer);
      socket.emit('signal', { to: p.id, data: { sdp: p.pc.localDescription } });
    } catch (e) { console.error('offer failed', e); }
  }

  async function onSignal({ from, data }) {
    let p = peers.get(from);
    if (!p) return;
    const pc = p.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          for (const t of pc.getTransceivers()) {
            const kind = t.receiver.track.kind;
            t.direction = 'sendrecv';
            if (kind === 'audio') p.audioSender = t.sender;
            if (kind === 'video') p.videoSender = t.sender;
          }
          await p.audioSender?.replaceTrack(micTrack);
          await p.videoSender?.replaceTrack(currentVideo());
          await pc.setLocalDescription(await pc.createAnswer());
          socket.emit('signal', { to: from, data: { sdp: pc.localDescription } });
        }
        for (const c of p.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else p.pending.push(data.candidate);
      }
    } catch (e) { console.error('signal error', e); }
  }

  function removePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    p.pc.close();
    p.tile.remove();
    meters.get(id)?.source.disconnect();
    meters.delete(id);
    peers.delete(id);
    layout();
  }

  const sendState = () => socket?.emit('state', { mic: me.mic, cam: me.cam, hand: me.hand, screen: me.screen, rec: me.rec });

  // ===================== الاتصال بالخادم =====================
  function connect() {
    socket = io({ transports: ['websocket', 'polling'] });
    let joinedOnce = false;

    socket.on('connect', () => {
      setStatus(true);
      // عند إعادة الاتصال نبدأ من جديد مع كل المشاركين
      for (const id of [...peers.keys()]) removePeer(id);
      socket.emit('join', {
        roomId, name: me.name, title: meetingTitle, clientId, hostKey,
        lang: translateTo || speakLang(),
        state: { mic: me.mic, cam: me.cam },
      }, onJoined);
    });
    function onJoined(res) {
        $('waitingRoom').hidden = true;
        if (res?.waiting) { $('waitingRoom').hidden = false; return; }
        if (res?.error === 'full') { alert(`الاجتماع ممتلئ (الحد الأقصى ${res.max} مشاركين).`); location.href = '/'; return; }
        if (res?.error === 'too_many') { alert('محاولات غلط كتير — استنى ربع ساعة وحاول تاني.'); location.href = '/'; return; }
        if (res?.error === 'locked') { alert('المنظّم قفل الاجتماع، ومحدش جديد يقدر يدخل دلوقتي.'); location.href = '/'; return; }
        if (res?.error === 'ended') { alert('الاجتماع ده انتهى.'); location.href = '/'; return; }
        if (res?.error === 'removed') { alert('المنظّم أخرجك من الاجتماع ده.'); location.href = '/'; return; }
        if (res?.error) { alert('رابط الاجتماع غير صحيح أو منتهي. اطلب الرابط تاني من منظّم الاجتماع.'); location.href = '/'; return; }
        me.id = res.selfId;
        me.host = !!res.host;
        roomSettings = res.settings || roomSettings;
        if (me.host && !joinedOnce) toast('إنت منظّم الاجتماع — أدواتك في قايمة الحضور 👥', 4500);
        startedAt = res.startedAt;
        meetingTitle = res.title;
        $('meetingTitle').textContent = meetingTitle;
        document.title = `${meetingTitle} — ${BRAND.title}`;
        renderSelf();
        for (const info of res.peers) negotiate(createPeer(info, true));
        sendState();
        if (!joinedOnce) addMinute('sys', `بدأتَ حضور الاجتماع "${meetingTitle}"`);
        if (!joinedOnce) {
          try {
            const recent = JSON.parse(store.get('meet:recent') || '[]').filter((r) => r.id !== roomId);
            recent.unshift({ id: roomId, title: meetingTitle, ts: Date.now() });
            store.set('meet:recent', JSON.stringify(recent.slice(0, 12)));
          } catch { /* ignore */ }
        }
        joinedOnce = true;
        layout();
    }
    socket.on('admitted', onJoined);
    socket.on('meeting-ended', showEnded);
    socket.on('meeting-summary', showSummary);
    socket.on('denied', () => { alert('المنظّم ما وافقش على دخولك.'); location.href = '/'; });
    socket.on('disconnect', () => setStatus(false));

    // ----- أحداث المنظّم -----
    socket.on('waitlist', (list) => {
      const added = list.filter((w) => !waitlist.some((x) => x.id === w.id));
      waitlist = list;
      added.forEach((w) => toast(`🚪 ${w.name} مستني يدخل — وافق من قايمة الحضور`, 5000));
      document.querySelectorAll('[data-panel="people"]').forEach((b) => b.classList.toggle('attention', waitlist.length > 0));
      renderPeople();
    });
    socket.on('room-settings', (st) => {
      roomSettings = { locked: st.locked, waiting: st.waiting };
      renderPeople();
      toast(`${st.by}: ${st.locked ? '🔒 الاجتماع مقفول' : '🔓 الاجتماع مفتوح'} · غرفة الانتظار ${st.waiting ? 'شغّالة' : 'مقفولة'}`);
    });
    socket.on('force-mute', async ({ by }) => {
      if (me.mic) { await enableMic(false); sendState(); refreshControls(); }
      toast(`🔇 ${by} كتم صوتك — تقدر تفتحه لما تحب تتكلم`, 4500);
    });
    socket.on('removed', ({ by }) => {
      alert(`${by} أخرجك من الاجتماع.`);
      leave();
    });
    socket.on('peer-host', ({ id }) => {
      if (id === me.id) { me.host = true; toast('بقيت منظّم مشارك 🎉 — أدواتك في قايمة الحضور', 4500); renderSelf(); }
      const p = peers.get(id);
      if (p) { p.state.host = true; updateTile(p.tile, { state: p.state }); }
      renderPeople();
    });

    socket.on('peer-joined', (info) => {
      createPeer(info, false);
      toast(`${info.name} انضم للاجتماع`);
      addMinute('sys', `${info.name} انضم`);
    });
    socket.on('peer-left', ({ id }) => {
      const p = peers.get(id);
      if (p) { toast(`${p.name} غادر الاجتماع`); addMinute('sys', `${p.name} غادر`); }
      removePeer(id);
    });
    socket.on('signal', onSignal);
    socket.on('peer-state', ({ id, state }) => {
      const p = peers.get(id);
      if (!p) return;
      if (state.hand && !p.state.hand) toast(`✋ ${p.name} رفع يده`);
      p.state = { ...state, host: p.state.host };
      updateTile(p.tile, { state: p.state });
      updateRecIndicator();
      layout();
    });
    socket.on('peer-renamed', ({ id, name }) => {
      const p = peers.get(id);
      if (!p) return;
      p.name = name;
      updateTile(p.tile, { name, key: id });
      renderPeople();
    });
    socket.on('chat', onChat);
    socket.on('reaction', onReaction);
    socket.on('caption', showCaption);
  }

  function setStatus(ok) {
    const s = $('status');
    s.classList.toggle('bad', !ok);
    s.querySelector('span').textContent = ok ? 'متصل' : 'جاري إعادة الاتصال…';
  }

  setInterval(() => {
    const t = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    $('timer').textContent = [t / 3600, (t % 3600) / 60, t % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');
  }, 1000);

  // ===================== أزرار التحكم =====================
  function refreshControls() {
    const mic = $('micBtn'); const cam = $('camBtn');
    mic.classList.toggle('off', !me.mic);
    mic.querySelector('[data-icon]').innerHTML = icon(me.mic ? 'mic' : 'micOff');
    cam.classList.toggle('off', !me.cam);
    cam.querySelector('[data-icon]').innerHTML = icon(me.cam ? 'cam' : 'camOff');
    const setActive = (sel, on) => document.querySelectorAll(sel).forEach((el) => el.classList.toggle('active', on));
    setActive('[data-action="hand"]', me.hand);
    setActive('[data-action="screen"]', me.screen);
    setActive('[data-action="captions"]:not(.toggle)', captionsOn);
    $('translateTool').classList.toggle('active', captionsOn || !!translateTo);
    $('captionsToggle').setAttribute('aria-checked', String(captionsOn));
    const rec = document.querySelector('[data-action="record"]');
    rec.classList.toggle('active', me.rec);
    rec.querySelector('.lbl').textContent = me.rec ? 'إيقاف التسجيل' : 'تسجيل';
    renderSelf();
    renderPeople();
    layout();
  }

  const bump = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 600); };
  $('micBtn').onclick = async () => { await enableMic(!me.mic); bump($('micBtn'), me.mic ? 'flip' : 'shake'); sendState(); refreshControls(); };
  $('camBtn').onclick = async () => { await enableCam(!me.cam); bump($('camBtn'), me.cam ? 'flip' : 'shake'); sendState(); refreshControls(); };

  // ترتيب ظهور مربعات الخدمات واحد ورا التاني
  document.querySelectorAll('.tile-btn').forEach((t, i) => t.style.setProperty('--i', i));
  // موجة الضغطة
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.ctl, .tile-btn');
    if (!b) return;
    const r = b.getBoundingClientRect();
    const w = document.createElement('span');
    w.className = 'ripple';
    w.style.left = `${e.clientX - r.left}px`;
    w.style.top = `${e.clientY - r.top}px`;
    b.append(w);
    setTimeout(() => w.remove(), 650);
  });
  // المنظّم يختار: يخرج بس، ولا ينهي الاجتماع للكل
  $('leaveBtn').onclick = () => {
    if (!me.host) return leave();
    $('leaveModal').hidden = false;
  };
  $('leaveModal').addEventListener('click', (e) => {
    const b = e.target.closest('[data-leave]');
    if (e.target === $('leaveModal') || b?.dataset.leave === 'cancel') { $('leaveModal').hidden = true; return; }
    if (b?.dataset.leave === 'self') leave();
    if (b?.dataset.leave === 'all') { $('leaveModal').hidden = true; socket.emit('host:end'); }
  });
  $('moreBtn').onclick = () => toggleTools();

  function toggleTools(force) {
    const open = force ?? $('tools').hidden;
    $('tools').hidden = !open;
    $('emojiBar').hidden = true;
    const btn = $('moreBtn');
    btn.classList.toggle('active', open);
    btn.querySelector('[data-icon]').innerHTML = icon(open ? 'close' : 'more');
  }
  // الضغط على الفيديو يقفل القوايم المفتوحة
  $('stage').addEventListener('click', () => { if (!$('tools').hidden || !$('emojiBar').hidden) toggleTools(false); });

  function teardown() {
    if (me.rec) stopRecording();
    stopCaptions();
    for (const id of [...peers.keys()]) removePeer(id);
    window.CamFX?.stop();
    [micTrack, camTrack, screenTrack].forEach((t) => t?.stop());
  }
  function leave() {
    teardown();
    socket?.disconnect();
    location.href = '/';
  }

  // ===================== نهاية الاجتماع + الملخص =====================
  let summaryText = '';
  function showEnded({ by, minutes }) {
    teardown();
    $('endScreen').hidden = false;
    $('endBy').textContent = by ? `${by} أنهى الاجتماع` : 'انتهى الاجتماع';
    $('endStats').textContent = `${meetingTitle} · ${minutes} دقيقة`;
    $('endSummary').innerHTML = '<div class="spinner"></div><p class="muted">جاري تجهيز ملخص الاجتماع بالذكاء الاصطناعي…</p>';
    $('endActions').hidden = true;
  }
  function renderSummaryHtml(text) {
    const out = [];
    let list = false;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('## ')) { if (list) { out.push('</ul>'); list = false; } out.push(`<h3>${esc(line.slice(3))}</h3>`); }
      else if (/^[-•]\s+/.test(line)) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${esc(line.replace(/^[-•]\s+/, ''))}</li>`); }
      else { if (list) { out.push('</ul>'); list = false; } out.push(`<p>${esc(line)}</p>`); }
    }
    if (list) out.push('</ul>');
    return out.join('');
  }
  function showSummary({ summaries = {}, reason }) {
    const lang = (translateTo || speakLang()).startsWith('ar') ? 'ar' : 'en';
    summaryText = summaries[lang] || summaries.ar || Object.values(summaries)[0] || '';
    const note = [];
    if (summaryText) {
      $('endSummary').innerHTML = `<div class="summary" dir="${lang === 'ar' || !summaries.en ? 'rtl' : 'ltr'}">${renderSummaryHtml(summaryText)}</div>`;
    } else {
      const why = { ai_off: 'الملخص الذكي مش مفعّل على الخادم.', empty: 'مفيش كلام اتكتب أو اتقال في المحادثة علشان يتلخّص. (فعّلوا "تحويل الكلام لنص" المرة الجاية.)', ai_error: 'حصلت مشكلة في تجهيز الملخص.' }[reason] || '';
      $('endSummary').innerHTML = `<p class="muted">${why}</p>`;
      summaryText = minutes.map((m) => `[${fmtClock(m.ts)}] ${m.who ? `${m.who}: ` : ''}${m.text}`).join('\n');
      if (summaryText) note.push('تقدر تحمّل محضر الاجتماع الكامل بدل الملخص.');
    }
    $('endNote').textContent = note.join(' ');
    $('endActions').hidden = !summaryText;
  }
  $('endActions').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-end]')?.dataset.end;
    if (!act) return;
    const plain = `ملخص اجتماع: ${meetingTitle}\n\n${summaryText.replace(/^## /gm, '▪ ')}`;
    if (act === 'whatsapp') window.open(`https://wa.me/?text=${encodeURIComponent(plain.slice(0, 3500))}`, '_blank');
    if (act === 'copy') { try { await navigator.clipboard.writeText(plain); toast('اتنسخ ✔'); } catch { prompt('انسخ الملخص:', plain); } }
    if (act === 'download') download(new Blob(['\ufeff' + plain], { type: 'text/plain;charset=utf-8' }), `summary-${roomId}.txt`);
  });

  document.addEventListener('click', (e) => {
    const panelBtn = e.target.closest('[data-panel]');
    if (panelBtn) { openPanel(panelBtn.dataset.panel); return; }
    const actBtn = e.target.closest('[data-action]');
    if (!actBtn) return;
    const actions = {
      record: toggleRecording, screen: toggleScreen, captions: toggleCaptions, hand: toggleHand, invite,
      reactions: () => { const show = $('emojiBar').hidden; toggleTools(false); $('emojiBar').hidden = !show; },
    };
    if (actBtn.closest('#tools') && actBtn.dataset.action !== 'record') toggleTools(false);
    actions[actBtn.dataset.action]?.();
  });

  // ---- لوحة التفاعلات ----
  const EMO_SETS = [
    ['😀', '😂', '🤣', '😍', '🥰', '😎', '🤩', '😮', '😢', '🤔', '😅', '🙏'],
    ['👍', '👎', '👌', '✌️', '🤝', '💪', '🙌', '👋', '✋', '☝️', '🫶', '🤞'],
    ['💡', '✅', '❌', '📈', '💰', '🎯', '📌', '⏰', '📊', '🧠', '🏆', '⭐'],
    ['🎉', '🥳', '🎊', '🎈', '🎁', '🍀', '☕', '🌟', '✨', '💯', '❤️', '🔥'],
  ];
  const renderEmoSet = (i) => {
    $('emoGrid').innerHTML = EMO_SETS[i].map((e, k) => `<button style="--k:${k}">${e}</button>`).join('');
    document.querySelectorAll('.emo-tabs button').forEach((t) => t.classList.toggle('on', Number(t.dataset.set) === i));
  };
  renderEmoSet(0);
  let lastReact = 0;
  $('emojiBar').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-set]');
    if (tab) { renderEmoSet(Number(tab.dataset.set)); return; }
    const fx = e.target.closest('[data-fx]');
    const b = e.target.closest('.emo-grid button');
    if (!fx && !b) return;
    if (Date.now() - lastReact < 350) return;
    lastReact = Date.now();
    (fx || b).classList.remove('sent'); void (fx || b).offsetWidth; (fx || b).classList.add('sent');
    socket.emit('reaction', fx ? `fx:${fx.dataset.fx}` : b.textContent);
    if (fx) setTimeout(() => { $('emojiBar').hidden = true; }, 250);
  });

  function toggleHand() {
    me.hand = !me.hand;
    sendState();
    refreshControls();
    toast(me.hand ? 'رفعت يدك ✋' : 'أنزلت يدك');
  }

  async function invite() {
    const url = `${location.origin}/m/${roomId}${meetingTitle && meetingTitle !== 'اجتماع' ? `?t=${encodeURIComponent(meetingTitle)}` : ''}`;
    const text = `انضم لاجتماع "${meetingTitle}" على ${BRAND.title}`;
    if (navigator.share) {
      try { await navigator.share({ title: BRAND.title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast('تم نسخ رابط الدعوة ✔'); }
    catch { prompt('انسخ رابط الدعوة:', url); }
  }

  // ===================== مشاركة الشاشة =====================
  async function toggleScreen() {
    if (me.screen) return stopScreen();
    if (!navigator.mediaDevices.getDisplayMedia) { toast('مشاركة الشاشة غير مدعومة على هذا الجهاز.'); return; }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      screenTrack = s.getVideoTracks()[0];
      screenTrack.contentHint = 'detail';
      screenTrack.onended = stopScreen;
      me.screen = true;
      setLocalTrack('video', screenTrack);
      pushTracksToPeers();
      sendState();
      refreshControls();
      toggleTools(false);
    } catch { /* المستخدم ألغى */ }
  }
  function stopScreen() {
    if (!me.screen) return;
    screenTrack?.stop();
    screenTrack = null;
    me.screen = false;
    setLocalTrack('video', camOut());
    pushTracksToPeers();
    sendState();
    refreshControls();
  }

  // ===================== الترجمة النصية (Live captions) =====================
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let captionsOn = false;
  // اللغة الافتراضية حسب لغة موبايل/متصفح الشخص (علشان الضيف الأجنبي ما يتكتبش كلامه على إنه عربي)
  const navLang = (navigator.language || 'ar').toLowerCase();
  const DEFAULT_SPEAK = navLang.startsWith('ar')
    ? (navLang === 'ar-ae' ? 'ar-AE' : /^ar-(sa|kw|qa|bh|om)$/.test(navLang) ? 'ar-SA' : 'ar-EG')
    : ({ en: navLang === 'en-gb' ? 'en-GB' : 'en-US', fr: 'fr-FR', tr: 'tr-TR', ur: 'ur-PK', hi: 'hi-IN', zh: 'zh-CN', es: 'es-ES', de: 'de-DE' }[navLang.slice(0, 2)] || 'en-US');
  const DEFAULT_TR = navLang.startsWith('ar') ? 'ar'
    : (['en', 'fr', 'tr', 'ur', 'hi', 'zh', 'es', 'de'].includes(navLang.slice(0, 2)) ? navLang.slice(0, 2) : 'en');
  const speakLang = () => store.get('meet:lang') || DEFAULT_SPEAK;
  let translateTo = store.get('meet:tr') ?? DEFAULT_TR;
  let aiOn = false;
  let aiFix = false;
  function toggleCaptions() { captionsOn ? stopCaptions() : startCaptions(); refreshControls(); }
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const SR_ERRORS = {
    'not-allowed': isIOS
      ? 'الآيفون رافض التعرف على الكلام. فعّل الإملاء: الإعدادات ← عام ← لوحة المفاتيح ← تفعيل الإملاء، واسمح للموقع باستخدام الميكروفون.'
      : 'المتصفح مش سامح بالتعرف على الكلام — اسمح للموقع باستخدام الميكروفون.',
    'service-not-allowed': isIOS
      ? 'خدمة التعرف على الكلام مقفولة. فعّل الإملاء وSiri: الإعدادات ← عام ← لوحة المفاتيح ← تفعيل الإملاء.'
      : 'خدمة التعرف على الكلام مش متاحة على المتصفح ده — جرّب Chrome.',
    'audio-capture': 'مش قادر يوصل للميكروفون — اقفل الميكروفون وافتحه تاني، أو اقفل أي تطبيق تاني بيستخدمه.',
    'network': 'التعرف على الكلام محتاج إنترنت — اتأكد من الاتصال.',
    'language-not-supported': 'اللغة المختارة مش مدعومة على جهازك — جرّب "العربية (السعودية)" أو English.',
  };
  function capStatus(text, kind = '') {
    const el = $('captionStatus');
    el.textContent = text;
    el.className = `cap-status ${kind}`;
    el.hidden = !text;
  }
  let srFailures = [];
  function startCaptions(fromLobby = false) {
    if (!SR) {
      const msg = isIOS ? 'تحويل الكلام لنص على الآيفون محتاج Safari (مش Chrome).' : 'تحويل الكلام لنص محتاج Chrome أو Edge أو Safari حديث.';
      toast(msg); capStatus(msg, 'err');
      return;
    }
    captionsOn = true;
    srFailures = [];
    recognizer = new SR();
    recognizer.lang = speakLang();
    recognizer.continuous = !isIOS; // Safari على الآيفون أثبت مع جمل منفصلة وإعادة التشغيل
    recognizer.interimResults = true;
    recognizer.onstart = () => capStatus(me.mic ? '🎙️ بيسمعك دلوقتي… اتكلم' : '🔇 الميكروفون مقفول — افتحه علشان كلامك يتكتب', me.mic ? 'ok' : 'warn');
    recognizer.onresult = (e) => {
      if (!me.mic) return;
      const r = e.results[e.results.length - 1];
      const text = r[0].transcript.trim();
      if (!text) return;
      srFailures = [];
      capStatus(`🎙️ آخر كلام اتسمع: "${text}"`, 'ok');
      socket.emit('caption', { text, final: r.isFinal });
      // لو التصحيح الذكي شغّال، النسخة النهائية المصلّحة هترجع من الخادم وهي اللي تتسجل في المحضر
      showCaption({ from: me.id, name: me.name, text, final: r.isFinal && !aiFix, ts: Date.now() });
    };
    recognizer.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      const msg = SR_ERRORS[e.error] || `حصلت مشكلة في التعرف على الكلام (${e.error}).`;
      if (['not-allowed', 'service-not-allowed', 'language-not-supported'].includes(e.error)) {
        stopCaptions(); refreshControls(); toast(msg, 6000);
      }
      capStatus(msg, 'err');
    };
    recognizer.onend = () => {
      if (!captionsOn) return;
      // حماية من حلقة إعادة تشغيل سريعة لو الخدمة بتفشل على طول
      const now = Date.now();
      srFailures = srFailures.filter((t) => now - t < 10000).concat(now);
      if (srFailures.length > 8) {
        stopCaptions(); refreshControls();
        capStatus('التعرف على الكلام بيقف لوحده على الجهاز ده. جرّب تقفله وتفتحه تاني، أو استخدم Chrome على الكمبيوتر.', 'err');
        return;
      }
      setTimeout(() => { if (captionsOn && recognizer) try { recognizer.start(); } catch { /* ignore */ } }, 250);
    };
    try {
      recognizer.start();
      if (!fromLobby) toast(window.innerWidth < 820 ? 'تم التفعيل — اقفل اللوحة علشان تشوف الكلام على الشاشة' : 'تم تفعيل تحويل الكلام إلى نص', 4000);
    } catch (err) {
      capStatus('مقدرتش أشغّل التعرف على الكلام — جرّب تاني.', 'err');
    }
  }
  function stopCaptions() {
    captionsOn = false;
    try { recognizer?.abort(); } catch { /* ignore */ }
    recognizer = null;
    if (!$('captionStatus').classList.contains('err')) capStatus('');
  }
  const captionEls = new Map();
  function showCaption({ from, name, text, final, ts, corrected }) {
    let el = captionEls.get(from);
    if (!el) {
      el = document.createElement('div');
      el.className = 'cap';
      $('captions').append(el);
      captionEls.set(from, el);
    }
    el.innerHTML = `<b>${esc(name)}:</b>${esc(text)}${corrected ? ' <span class="fixed" title="اتصلّح بالذكاء الاصطناعي">✨</span>' : ''}`;
    const seq = (el._seq = (el._seq || 0) + 1);
    const expire = (ms) => {
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.remove(); if (captionEls.get(from) === el) captionEls.delete(from); }, ms);
    };
    expire(final ? 4000 : 7000);
    if (final) addMinute('speech', text, name, ts);
    // ترجمة كلام المشاركين الآخرين للغة اللي اخترتها
    // ما نترجمش عربي لعربي (توفير): لو الجملة أغلبها حروف عربية واللغة المطلوبة عربي
    const arabicRatio = (text.match(/[\u0600-\u06FF]/g) || []).length / Math.max(1, text.replace(/\s/g, '').length);
    const alreadyTarget = translateTo === 'ar' && arabicRatio > 0.5;
    if (final && translateTo && aiOn && from !== me.id && !alreadyTarget) {
      expire(9000);
      socket.emit('ai-translate', { text, lang: translateTo }, (res) => {
        if (res?.text && el._seq === seq && el.isConnected) {
          el.innerHTML = `<b>${esc(name)}:</b><span class="tr">${esc(res.text)}</span><span class="orig">${esc(text)}</span>`;
          expire(6000);
        } else if (res?.error && res.error !== 'rate' && !showCaption._warned) {
          showCaption._warned = true;
          toast(`الترجمة: ${res.error}`);
        }
      });
    }
  }

  // لوحة الترجمة
  $('setLang').value = speakLang();
  $('setTranslate').value = translateTo;
  $('setLang').onchange = () => {
    store.set('meet:lang', $('setLang').value);
    if (captionsOn) { stopCaptions(); startCaptions(); }
  };
  $('setTranslate').onchange = () => {
    translateTo = $('setTranslate').value;
    store.set('meet:tr', translateTo);
    refreshControls();
    toast(translateTo ? 'تم تفعيل الترجمة الفورية لكلام المشاركين' : 'تم إيقاف الترجمة');
  };

  // ===================== المساعد الذكي =====================
  const mdLite = (t) => esc(t)
    .replace(/^#{1,6}\s*(.+)$/gm, '<b>$1</b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  let aiBusy = false;
  function aiBubble(cls, who, html) {
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = `<div class="who">${who}</div><div class="bubble">${html}</div>`;
    $('aiThread').append(li);
    $('aiThread').scrollTop = $('aiThread').scrollHeight;
    return li;
  }
  function setAiBusy(b) {
    aiBusy = b;
    document.querySelectorAll('#aiQuick button, #aiForm button').forEach((x) => { x.disabled = b || !aiOn; });
  }
  function aiAsk(question) {
    question = question.trim();
    if (!question || aiBusy) return;
    if (!aiOn) { toast('المساعد الذكي غير مفعّل على الخادم.'); return; }
    aiBubble('mine', 'أنت', esc(question));
    const pending = aiBubble('ai pending', '✨ المساعد الذكي', '<span class="dots">بيفكر</span>');
    setAiBusy(true);
    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      setAiBusy(false);
      if (res?.answer) {
        pending.className = 'ai';
        pending.querySelector('.bubble').innerHTML = `${mdLite(res.answer)}<br><button class="share-ai">↗ شارك الرد في المحادثة</button>`;
        pending.querySelector('.share-ai').onclick = (e) => {
          const msg = `✨ المساعد الذكي:\n${res.answer}`;
          socket.emit('chat', msg.length > 2000 ? `${msg.slice(0, 1997)}…` : msg);
          e.target.remove();
          toast('تمت مشاركة الرد في المحادثة');
        };
      } else {
        pending.className = 'ai';
        pending.querySelector('.bubble').textContent = `⚠️ ${res?.error || 'لم يصل رد من المساعد.'}`;
      }
      $('aiThread').scrollTop = $('aiThread').scrollHeight;
      if (currentPanel !== 'assistant') toast('✨ رد المساعد الذكي جاهز');
    };
    socket.emit('ai-ask', question, finish);
    setTimeout(() => finish({ error: 'استغرق الرد وقتًا طويلًا، حاول مرة أخرى.' }), 180000);
  }
  $('aiForm').onsubmit = (e) => { e.preventDefault(); aiAsk($('aiInput').value); $('aiInput').value = ''; };
  $('aiQuick').onclick = (e) => { const b = e.target.closest('button[data-q]'); if (b) aiAsk(b.dataset.q); };
  $('aiSummary').onclick = () => { openPanel('assistant'); aiAsk('اكتب ملخصًا منظمًا للاجتماع: أهم النقاط، القرارات، المهام ومسؤول كل مهمة، والخطوات التالية.'); };

  // ===================== التفاعلات =====================
  const FX = {
    confetti: { emoji: '🎉', label: 'احتفال' },
    hearts: { emoji: '💖', label: 'بيبعت حب' },
    applause: { emoji: '👏', label: 'بيصقّف' },
    rocket: { emoji: '🚀', label: 'انطلاق' },
    fire: { emoji: '🔥', label: 'نار' },
  };
  // مكان طلوع التفاعل: من مربع الشخص اللي بعته
  function originFor(from) {
    const stage = $('stage').getBoundingClientRect();
    const tile = from === me.id ? $('tile-me') : peers.get(from)?.tile;
    if (!tile) return { x: stage.width * (.2 + Math.random() * .6), y: stage.height - 20 };
    const r = tile.getBoundingClientRect();
    return { x: r.left - stage.left + r.width / 2, y: r.top - stage.top + r.height * .7 };
  }
  function pulseTile(from) {
    const tile = from === me.id ? $('tile-me') : peers.get(from)?.tile;
    if (!tile) return;
    tile.classList.remove('reacted'); void tile.offsetWidth; tile.classList.add('reacted');
    setTimeout(() => tile.classList.remove('reacted'), 900);
  }
  function floatEmoji(emoji, name, from) {
    const o = originFor(from);
    const el = document.createElement('div');
    el.className = 'float-emoji';
    el.style.left = `${o.x}px`;
    el.style.top = `${o.y}px`;
    el.style.setProperty('--dx', `${(Math.random() - .5) * 120}px`);
    el.style.setProperty('--rot', `${(Math.random() - .5) * 50}deg`);
    el.innerHTML = `<span class="fe">${esc(emoji)}</span><small>${esc(name)}</small>`;
    $('reactionsLayer').append(el);
    pulseTile(from);
    setTimeout(() => el.remove(), 3200);
  }
  function onReaction({ from, name, emoji }) {
    if (emoji.startsWith('fx:')) {
      const kind = emoji.slice(3);
      if (!FX[kind]) return;
      runEffect(kind, from);
      banner(`${FX[kind].emoji} ${name} — ${FX[kind].label}`);
      pulseTile(from);
      return;
    }
    floatEmoji(emoji, name, from);
  }
  function banner(text) {
    const el = document.createElement('div');
    el.className = 'fx-banner';
    el.textContent = text;
    $('reactionsLayer').append(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ---- مؤثرات كبيرة على Canvas ----
  const fxCanvas = $('fxCanvas');
  const fctx = fxCanvas.getContext('2d');
  let parts = [];
  let fxRunning = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function sizeFx() {
    const r = $('stage').getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    fxCanvas.width = r.width * dpr; fxCanvas.height = r.height * dpr;
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', sizeFx);
  const COLORS_FX = ['#1faec1', '#4fd1e0', '#a78bfa', '#f59e0b', '#f43f5e', '#22c55e', '#ffffff'];
  function spawn(kind, o) {
    const W = fxCanvas.clientWidth, H = fxCanvas.clientHeight;
    const rnd = (a, b) => a + Math.random() * (b - a);
    if (kind === 'confetti') {
      for (let i = 0; i < 140; i++) parts.push({ t: 'rect', x: W / 2 + rnd(-40, 40), y: H * .55, vx: rnd(-9, 9), vy: rnd(-16, -6), g: .35, w: rnd(6, 11), h: rnd(3, 6), rot: rnd(0, 6), vr: rnd(-.3, .3), c: COLORS_FX[i % COLORS_FX.length], life: rnd(110, 160) });
    } else if (kind === 'hearts') {
      for (let i = 0; i < 34; i++) parts.push({ t: 'emoji', s: ['💖', '❤️', '💕', '💗'][i % 4], x: rnd(0, W), y: H + rnd(0, 120), vx: rnd(-.6, .6), vy: rnd(-4.5, -2.2), g: 0, size: rnd(20, 40), sway: rnd(0, 6), life: rnd(140, 200) });
    } else if (kind === 'applause') {
      for (let i = 0; i < 26; i++) parts.push({ t: 'emoji', s: '👏', x: o.x + rnd(-30, 30), y: o.y, vx: rnd(-5, 5), vy: rnd(-11, -5), g: .22, size: rnd(22, 38), life: rnd(80, 120), spin: rnd(-.08, .08) });
    } else if (kind === 'rocket') {
      parts.push({ t: 'rocket', x: W * .2, y: H + 30, vx: W * .006, vy: -H * .014, life: 90, trail: [] });
    } else if (kind === 'fire') {
      for (let i = 0; i < 60; i++) parts.push({ t: 'flame', x: rnd(0, W), y: H + rnd(0, 40), vx: rnd(-.4, .4), vy: rnd(-5, -2.5), g: 0, r: rnd(8, 22), life: rnd(50, 90) });
      for (let i = 0; i < 8; i++) parts.push({ t: 'emoji', s: '🔥', x: rnd(0, W), y: H + 20, vx: 0, vy: rnd(-4, -2.5), g: 0, size: rnd(26, 42), life: rnd(90, 130) });
    }
  }
  function burst(x, y) {
    for (let i = 0; i < 70; i++) {
      const a = (Math.PI * 2 * i) / 70, sp = 2 + Math.random() * 5;
      parts.push({ t: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: .06, r: 2.4, c: COLORS_FX[i % COLORS_FX.length], life: 70 + Math.random() * 30 });
    }
  }
  function runEffect(kind, from) {
    if (reducedMotion) { floatEmoji(FX[kind].emoji, '', from); return; }
    sizeFx();
    spawn(kind, originFor(from));
    if (!fxRunning) { fxRunning = true; requestAnimationFrame(tickFx); }
  }
  function tickFx() {
    const W = fxCanvas.clientWidth, H = fxCanvas.clientHeight;
    fctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.life--;
      p.vy += p.g || 0;
      p.x += p.vx + (p.sway ? Math.sin(p.life / 10) * .8 : 0);
      p.y += p.vy;
      const a = Math.max(0, Math.min(1, p.life / 40));
      fctx.globalAlpha = a;
      if (p.t === 'rect') {
        p.rot += p.vr; p.vx *= .99;
        fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.fillStyle = p.c; fctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); fctx.restore();
      } else if (p.t === 'emoji') {
        fctx.save(); fctx.translate(p.x, p.y); if (p.spin) fctx.rotate(p.life * p.spin);
        fctx.font = `${p.size}px serif`; fctx.textAlign = 'center'; fctx.textBaseline = 'middle'; fctx.fillText(p.s, 0, 0); fctx.restore();
      } else if (p.t === 'spark') {
        p.vx *= .97; p.vy *= .97;
        fctx.fillStyle = p.c; fctx.beginPath(); fctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); fctx.fill();
      } else if (p.t === 'flame') {
        p.r *= .985;
        const g = fctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, 'rgba(255,240,180,.9)'); g.addColorStop(.4, 'rgba(251,146,60,.7)'); g.addColorStop(1, 'rgba(239,68,68,0)');
        fctx.fillStyle = g; fctx.beginPath(); fctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); fctx.fill();
      } else if (p.t === 'rocket') {
        p.trail.push({ x: p.x, y: p.y }); if (p.trail.length > 18) p.trail.shift();
        p.trail.forEach((q, i) => { fctx.globalAlpha = i / 18 * .7; fctx.fillStyle = i % 2 ? '#fb923c' : '#fde68a'; fctx.beginPath(); fctx.arc(q.x, q.y + 10, 6 * i / 18 + 1, 0, Math.PI * 2); fctx.fill(); });
        fctx.globalAlpha = 1;
        fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(Math.atan2(p.vy, p.vx) + Math.PI / 4); fctx.font = '40px serif'; fctx.textAlign = 'center'; fctx.textBaseline = 'middle'; fctx.fillText('🚀', 0, 0); fctx.restore();
        if (p.life <= 1 || p.y < H * .25) { p.life = 0; burst(p.x, p.y); setTimeout(() => burst(W * (.3 + Math.random() * .4), H * (.25 + Math.random() * .2)), 250); }
      }
    }
    fctx.globalAlpha = 1;
    parts = parts.filter((p) => p.life > 0 && p.y < H + 200 && p.y > -200);
    if (parts.length) requestAnimationFrame(tickFx);
    else { fxRunning = false; fctx.clearRect(0, 0, W, H); }
  }

  // ===================== المحادثة =====================
  let unread = 0;
  function onChat(m) {
    const list = $('messages');
    list.querySelector('.empty')?.remove();
    const li = document.createElement('li');
    if (m.from === me.id) li.className = 'mine';
    li.innerHTML = `<div class="who">${esc(m.from === me.id ? 'أنت' : m.name)} · ${fmtClock(m.ts)}</div><div class="bubble">${esc(m.text)}</div>`;
    list.append(li);
    list.scrollTop = list.scrollHeight;
    addMinute('chat', m.text, m.name, m.ts);
    if (currentPanel !== 'chat' && m.from !== me.id) {
      unread++;
      $('chatBadge').hidden = false;
      $('chatBadge').textContent = unread;
      toast(`💬 ${m.name}: ${m.text.slice(0, 60)}`);
    }
  }
  $('messages').innerHTML = '<li class="empty">لا توجد رسائل بعد</li>';
  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const t = $('chatInput').value.trim();
    if (!t) return;
    socket.emit('chat', t);
    $('chatInput').value = '';
  };

  // ===================== محضر الاجتماع =====================
  const minutes = [];
  function addMinute(type, text, who, ts = Date.now()) {
    minutes.push({ type, text, who, ts });
    const li = document.createElement('li');
    if (type === 'sys') li.className = 'sys';
    const tag = type === 'chat' ? '💬 ' : type === 'speech' ? '🎙️ ' : '';
    li.innerHTML = `<time>${fmtClock(ts)}</time>${tag}${who ? `<b>${esc(who)}:</b> ` : ''}${esc(text)}`;
    $('minutes').append(li);
  }
  $('downloadMinutes').onclick = () => {
    const lines = [
      `محضر اجتماع: ${meetingTitle}`,
      `التاريخ: ${new Date(startedAt).toLocaleString('ar-EG')}`,
      `كود الاجتماع: ${roomId}`,
      `الحاضرون حاليًا: ${[me.name, ...[...peers.values()].map((p) => p.name)].join('، ')}`,
      '----------------------------------------',
      ...minutes.map((m) => `[${fmtClock(m.ts)}] ${m.type === 'chat' ? '(محادثة) ' : m.type === 'speech' ? '(كلام) ' : ''}${m.who ? `${m.who}: ` : ''}${m.text}`),
    ];
    download(new Blob(['﻿' + lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `minutes-${roomId}.txt`);
  };

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ===================== التسجيل =====================
  // يرسم كل البلاطات على Canvas ويخلط كل الأصوات، ثم يحفظ ملف فيديو على جهازك.
  let recorder = null;
  let recChunks = [];
  let recTimer = null;
  let recMix = null;
  function toggleRecording() { me.rec ? stopRecording() : startRecording(); }
  function startRecording() {
    if (!audioCtx || !window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { toast('التسجيل غير مدعوم على هذا المتصفح.'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    const draw = () => {
      ctx.fillStyle = '#0b1020';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const tiles = [...$('grid').children];
      const n = tiles.length;
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const w = canvas.width / cols; const h = canvas.height / rows;
      tiles.forEach((tile, i) => {
        const x = (i % cols) * w; const y = Math.floor(i / cols) * h;
        const v = tile.querySelector('video');
        ctx.fillStyle = '#172039';
        ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
        if (tile.classList.contains('video-on') && v.videoWidth) {
          const contain = tile.classList.contains('screen');
          const s = contain ? Math.min((w - 8) / v.videoWidth, (h - 8) / v.videoHeight) : Math.max((w - 8) / v.videoWidth, (h - 8) / v.videoHeight);
          const dw = v.videoWidth * s; const dh = v.videoHeight * s;
          ctx.save();
          ctx.beginPath(); ctx.rect(x + 4, y + 4, w - 8, h - 8); ctx.clip();
          ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
          ctx.restore();
        } else {
          const av = tile.querySelector('.avatar');
          ctx.fillStyle = getComputedStyle(av).getPropertyValue('--avatar') || '#1f6f5c';
          const r = Math.min(w, h) * 0.18;
          ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = `bold ${r}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(av.textContent, x + w / 2, y + h / 2);
        }
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x + 12, y + h - 44, Math.min(w - 24, 260), 30);
        ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.direction = 'rtl';
        ctx.fillText(tile.querySelector('.nm').textContent, x + Math.min(w - 24, 260) + 4, y + h - 29);
      });
    };
    recTimer = setInterval(draw, 1000 / 24);

    const dest = audioCtx.createMediaStreamDestination();
    recMix = [];
    const addAudio = (stream) => {
      if (!stream.getAudioTracks().length) return;
      const src = audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      src.connect(dest);
      recMix.push(src);
    };
    if (micTrack) addAudio(localStream);
    for (const p of peers.values()) addAudio(p.stream);

    const out = new MediaStream([...canvas.captureStream(24).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      .find((t) => MediaRecorder.isTypeSupported(t)) || '';
    recChunks = [];
    const rec = new MediaRecorder(out, mime ? { mimeType: mime } : undefined);
    recorder = rec;
    rec.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    rec.onstop = () => {
      out.getTracks().forEach((t) => t.stop());
      const type = rec.mimeType || 'video/webm';
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      download(new Blob(recChunks, { type }), `meeting-${roomId}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`);
      toast('تم حفظ التسجيل على جهازك ✔');
    };
    recorder.start(1000);
    me.rec = true;
    sendState();
    updateRecIndicator();
    refreshControls();
    toast('بدأ التسجيل — سيتم إعلام المشاركين');
    addMinute('sys', `${me.name} بدأ تسجيل الاجتماع`);
  }
  function stopRecording() {
    if (!recorder) return;
    clearInterval(recTimer);
    recorder.stop();
    recMix?.forEach((s) => s.disconnect());
    recorder = null;
    me.rec = false;
    sendState();
    updateRecIndicator();
    refreshControls();
    addMinute('sys', `${me.name} أوقف التسجيل`);
  }
  function updateRecIndicator() {
    $('recChip').hidden = !(me.rec || [...peers.values()].some((p) => p.state.rec));
  }

  // ===================== اللوحة الجانبية =====================
  const PANEL_TITLES = { chat: 'المحادثة', people: 'المشاركون', minutes: 'محضر الاجتماع', settings: 'الإعدادات', assistant: '✨ المساعد الذكي', translate: 'الترجمة', filters: 'فلاتر الكاميرا' };
  let currentPanel = null;
  function openPanel(name) {
    // نفس الزرار مرتين = قفل (على الكمبيوتر)
    if (currentPanel === name && !$('panel').hidden && window.innerWidth >= 900) { closePanel(); return; }
    currentPanel = name;
    $('panel').hidden = false;
    $('meeting').classList.add('panel-open');
    $('panelTitle').textContent = PANEL_TITLES[name];
    $('panelTitle').classList.toggle('sr-only', name !== 'settings');
    document.querySelectorAll('.tabs [data-panel]').forEach((t) => t.classList.toggle('active', t.dataset.panel === name));
    document.querySelectorAll('.ctl[data-panel]').forEach((t) => t.classList.toggle('active', t.dataset.panel === name));
    document.querySelectorAll('.panel-body').forEach((b) => b.classList.toggle('show', b.dataset.view === name));
    if (name === 'chat') {
      unread = 0;
      $('chatBadge').hidden = true;
      setTimeout(() => $('chatInput').focus(), 50);
    }
    if (name === 'settings') fillSettings();
    if (name === 'filters') {
      renderFxPanel();
      $('fxPreview').srcObject = camOut() ? new MediaStream([camOut()]) : null;
      $('fxNoCam').hidden = me.cam;
      $('fxReset').hidden = !window.CamFX?.active();
    }
    if (name === 'assistant' && aiOn) setTimeout(() => $('aiInput').focus(), 50);
    toggleTools(false);
    if (name === 'people') renderPeople();
  }
  function closePanel() {
    $('panel').hidden = true;
    $('meeting').classList.remove('panel-open');
    document.querySelectorAll('.ctl[data-panel]').forEach((t) => t.classList.remove('active'));
    currentPanel = null;
  }
  $('panelClose').onclick = closePanel;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('panelClose').click(); });

  async function fillSettings() {
    $('setName').value = me.name;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const fill = (sel, kind, current) => {
        const list = devices.filter((d) => d.kind === kind);
        sel.innerHTML = list.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || `جهاز ${i + 1}`)}</option>`).join('') || '<option value="">لا يوجد</option>';
        if (current) sel.value = current;
      };
      fill($('setMic'), 'audioinput', micTrack?.getSettings().deviceId || store.get('meet:micId'));
      fill($('setCam'), 'videoinput', camTrack?.getSettings().deviceId || store.get('meet:camId'));
    } catch { /* ignore */ }
  }
  $('saveSettings').onclick = async () => {
    const name = $('setName').value.trim();
    if (name && name !== me.name) {
      me.name = name;
      store.set('meet:name', name);
      socket.emit('rename', name);
      renderSelf();
    }
    const micId = $('setMic').value; const camId = $('setCam').value;
    if (micId && micId !== micTrack?.getSettings().deviceId) {
      store.set('meet:micId', micId);
      if (micTrack) {
        const wasOn = me.mic;
        micTrack.stop(); micTrack = null;
        await enableMic(true);
        if (!wasOn) await enableMic(false);
      }
    }
    if (camId && camId !== camTrack?.getSettings().deviceId) {
      store.set('meet:camId', camId);
      if (camTrack) { camTrack.stop(); camTrack = null; await enableCam(true); }
    }
    refreshControls();
    toast('تم حفظ الإعدادات');
    $('panelClose').click();
  };

  // ===================== شاشة ما قبل الدخول =====================
  const preview = document.querySelector('.preview');
  function refreshPreview() {
    preview.classList.toggle('video-on', !!camTrack && me.cam);
    $('previewVideo').srcObject = localStream;
    const nm = $('lobbyName').value.trim();
    $('previewAvatar').textContent = initial(nm || '؟');
    $('previewAvatar').style.setProperty('--avatar', colorFor(nm || 'x'));
    $('lbYou').textContent = nm ? `${nm} · أنت` : '';
    $('lbHello').textContent = nm ? `أهلاً يا ${nm.split(' ')[0]} 👋` : 'أهلاً بيك 👋';
    $('chkCam').className = `lb-check ${me.cam && camTrack ? 'ok' : 'off'}`;
    $('chkMic').className = `lb-check ${me.mic && micTrack ? 'ok' : 'off'}`;
    $('pFx').hidden = !(me.cam && camTrack);
    if (!(me.cam && camTrack)) $('lobbyLens').hidden = true;
    $('pMic').classList.toggle('off', !me.mic);
    $('pMic').innerHTML = icon(me.mic ? 'mic' : 'micOff');
    $('pCam').classList.toggle('off', !me.cam);
    $('pCam').innerHTML = icon(me.cam ? 'cam' : 'camOff');
  }
  $('pMic').onclick = async () => { await enableMic(!me.mic); bump($('pMic'), me.mic ? 'flip' : 'shake'); refreshPreview(); lobbyMeter(); };
  $('pCam').onclick = async () => { await enableCam(!me.cam); bump($('pCam'), me.cam ? 'flip' : 'shake'); refreshPreview(); };
  $('pFx').onclick = () => {
    const show = $('lobbyLens').hidden;
    $('lobbyLens').hidden = !show;
    $('pFx').classList.toggle('active', show);
    if (show) renderFxPanel();
  };
  $('lbCode').onclick = () => invite();

  // ---- مقياس المايك في شاشة الدخول ----
  let lbAudio = null; let lbAnalyser = null; let lbSrc = null; let lbRaf = 0;
  function lobbyMeter() {
    if (!micTrack || !me.mic) { $('lbPreview').style.setProperty('--lvl', 0); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!lbAudio) lbAudio = new AC();
      lbAudio.resume?.();
      lbSrc?.disconnect();
      lbSrc = lbAudio.createMediaStreamSource(new MediaStream([micTrack]));
      lbAnalyser = lbAudio.createAnalyser(); lbAnalyser.fftSize = 256;
      lbSrc.connect(lbAnalyser);
    } catch { return; }
    const data = new Uint8Array(lbAnalyser.frequencyBinCount);
    const bars = [...$('lbMeter').children];
    let heard = false;
    cancelAnimationFrame(lbRaf);
    const tick = () => {
      if ($('lobby').hidden || !lbAnalyser) return;
      lbAnalyser.getByteFrequencyData(data);
      let sum = 0; for (let i = 2; i < 40; i++) sum += data[i];
      const lvl = me.mic ? Math.min(1, sum / (38 * 140)) : 0;
      $('lbPreview').style.setProperty('--lvl', lvl.toFixed(3));
      bars.forEach((b, i) => { const v = data[3 + i * 5] / 255; b.style.transform = `scaleY(${(.15 + v * (me.mic ? 1 : 0)).toFixed(2)})`; });
      if (lvl > .12 && !heard) { heard = true; $('chkMic').classList.add('heard'); $('chkMic').querySelector('b').textContent = 'المايك سامعك'; }
      lbRaf = requestAnimationFrame(tick);
    };
    tick();
  }
  // بعض المتصفحات محتاجة ضغطة قبل تشغيل الصوت
  document.addEventListener('pointerdown', () => { lbAudio?.resume?.(); }, { once: true });

  // ---- نجوم/جزيئات خفيفة في الخلفية ----
  (() => {
    const cv = $('lbStars'); if (!cv) return;
    const c = cv.getContext('2d'); let w; let h; let pts = [];
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const size = () => {
      const d = Math.min(2, devicePixelRatio || 1); w = cv.width = innerWidth * d; h = cv.height = innerHeight * d;
      pts = Array.from({ length: Math.round(Math.min(70, innerWidth / 14)) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 1.6 + .4) * d, v: (Math.random() * .35 + .1) * d, p: Math.random() * 6 }));
    };
    size(); addEventListener('resize', size);
    const draw = (t) => {
      if ($('lobby').hidden) return;
      c.clearRect(0, 0, w, h);
      for (const p of pts) {
        if (!reduce) { p.y -= p.v; if (p.y < -5) { p.y = h + 5; p.x = Math.random() * w; } }
        const a = .25 + (Math.sin(t / 700 + p.p) + 1) * .3;
        c.fillStyle = `rgba(79,209,224,${a})`; c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  })();
  $('lobbyName').value = me.name;
  $('lobbySpeak').innerHTML = $('setLang').innerHTML;
  $('lobbyTr').innerHTML = $('setTranslate').innerHTML;
  $('lobbySpeak').value = speakLang();
  $('lobbyTr').value = translateTo;
  $('lobbyCap').checked = store.get('meet:cap') !== '0';
  $('lobbyName').oninput = refreshPreview;
  preview.classList.add('mirror');

  async function initLobby() {
    $('meetingCode').textContent = roomId;
    $('lbCodeTxt').textContent = roomId;
    try {
      const cfg = await (await fetch('/api/config')).json();
      if (cfg.iceServers?.length) iceServers = cfg.iceServers;
      aiOn = !!cfg.ai;
      aiFix = !!cfg.captionCorrection;
      const info = await (await fetch(`/api/rooms/${encodeURIComponent(roomId)}`)).json();
      if (info.title) meetingTitle = info.title;
      $('lobbyTitle').textContent = meetingTitle;
      const ppl = info.people || [];
      $('lbFaces').innerHTML = ppl.map((n, i) => `<span class="lb-face" style="--avatar:${colorFor(n)};--i:${i}" title="${esc(n)}">${esc(initial(n))}</span>`).join('')
        + (info.participants > ppl.length ? `<span class="lb-face more" style="--i:${ppl.length}">+${info.participants - ppl.length}</span>` : '');
      $('lobbyInfo').innerHTML = info.participants
        ? `<b>${esc(ppl.slice(0, 2).join(' و '))}</b>${info.participants > 2 ? ` و${info.participants - 2} كمان` : ''} ${info.participants === 1 ? 'موجود' : 'موجودين'} في الاجتماع دلوقتي <i class="live-dot"></i>`
        : 'محدش دخل لسه — هتكون أول واحد ✨';
      $('chkNet').className = 'lb-check ok';
      if (info.participants >= cfg.maxParticipants) $('lobbyErr').textContent = 'الاجتماع ممتلئ حاليًا.';
      if (info.valid === false) {
        $('lobbyInfo').textContent = '';
        $('lobbyErr').textContent = 'رابط الاجتماع غير صحيح. اطلب الرابط تاني من منظّم الاجتماع.';
        $('joinBtn').disabled = true;
      }
    } catch { $('lobbyInfo').textContent = ''; $('chkNet').className = 'lb-check off'; }

    if (!navigator.mediaDevices?.getUserMedia) {
      $('lobbyErr').textContent = 'المتصفح لا يسمح بالكاميرا/الميكروفون — افتح الموقع عبر https.';
      me.mic = false; me.cam = false;
    } else {
      if (me.mic) await enableMic(true);
      loadFxState();
      if (me.cam) await enableCam(true);
    }
    $('aiOff').hidden = aiOn;
    setAiBusy(false);
    $('setTranslate').disabled = !aiOn;
    $('lobbyTr').disabled = !aiOn;
    if (!aiOn) $('lobbyTr').value = '';
    $('translateNote').textContent = aiOn
      ? 'الترجمة بتشتغل على كلام المشاركين اللي مفعّلين "تحويل الكلام إلى نص".'
      : 'الترجمة للغات أخرى تحتاج تفعيل الذكاء الاصطناعي على الخادم. تحويل الكلام لنص شغال عادي.';
    refreshPreview();
    lobbyMeter();
    if (!$('lobbyName').value) $('lobbyName').focus();
  }

  $('joinBtn').onclick = () => {
    const name = $('lobbyName').value.trim();
    if (!name) { $('lobbyErr').textContent = 'اكتب اسمك أولاً.'; $('lobbyName').focus(); return; }
    me.name = name;
    store.set('meet:name', name);
    // AudioContext لازم يبدأ بعد ضغطة المستخدم
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { audioCtx = new AC(); audioCtx.resume?.(); }
    watchLevel('me', localStream);

    const jr = $('joinBtn').getBoundingClientRect();
    const warp = document.createElement('div');
    warp.className = 'join-warp';
    warp.style.setProperty('--x', `${jr.left + jr.width / 2}px`); warp.style.setProperty('--y', `${jr.top + jr.height / 2}px`);
    document.body.append(warp);
    setTimeout(() => warp.remove(), 1100);
    cancelAnimationFrame(lbRaf); lbSrc?.disconnect();
    $('lobby').hidden = true;
    $('meeting').hidden = false;
    document.body.classList.add('in-meeting');
    $('meetingTitle').textContent = meetingTitle;
    // إعدادات اللغة من شاشة الدخول
    store.set('meet:lang', $('lobbySpeak').value);
    $('setLang').value = $('lobbySpeak').value;
    if (aiOn) {
      translateTo = $('lobbyTr').value;
      store.set('meet:tr', translateTo);
      $('setTranslate').value = translateTo;
    }
    store.set('meet:cap', $('lobbyCap').checked ? '1' : '0');

    makeTile('me', me.name, true);
    refreshControls();
    connect();
    // لازم يبدأ هنا (جوه ضغطة الزرار) علشان الآيفون يسمح بالتعرف على الكلام
    if ($('lobbyCap').checked && SR) { startCaptions(true); refreshControls(); }
  };
  $('lobbyName').addEventListener('keydown', (e) => e.key === 'Enter' && $('joinBtn').click());

  window.addEventListener('beforeunload', () => { if (me.rec) stopRecording(); });

  initLobby();
})();
