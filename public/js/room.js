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
  };
  let micTrack = null;
  let camTrack = null;
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

  const currentVideo = () => (me.screen && screenTrack) || (me.cam && camTrack) || null;

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
    if (!me.screen) setLocalTrack('video', camTrack);
    pushTracksToPeers();
  }

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
      <div class="badges"><span class="mic-off" hidden>${icon('micOff', 18)}</span><span class="hand" hidden>${icon('hand', 18)}</span></div>
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
    $('people').innerHTML = all.map((p) => `
      <li>
        <span class="av" style="--avatar:${colorFor(p.id || p.name)}">${esc(initial(p.name))}</span>
        <span class="nm">${esc(p.name)}${p.isMe ? ' <span class="muted small">(أنت)</span>' : ''}</span>
        <span class="ic">
          ${p.state.hand ? `<span title="رافع يده" style="color:var(--warn)">${icon('hand', 18)}</span>` : ''}
          ${p.state.screen ? `<span title="يشارك الشاشة">${icon('screen', 18)}</span>` : ''}
          <span class="${p.state.mic ? '' : 'off'}">${icon(p.state.mic ? 'mic' : 'micOff', 18)}</span>
          <span class="${p.state.cam ? '' : 'off'}">${icon(p.state.cam ? 'cam' : 'camOff', 18)}</span>
        </span>
      </li>`).join('');
  }

  // ===================== WebRTC =====================
  function createPeer(info, initiator) {
    const p = {
      id: info.id, name: info.name, state: { ...info.state }, initiator,
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
      socket.emit('join', { roomId, name: me.name, title: meetingTitle, state: { mic: me.mic, cam: me.cam } }, (res) => {
        if (res?.error === 'full') { alert(`الاجتماع ممتلئ (الحد الأقصى ${res.max} مشاركين).`); location.href = '/'; return; }
        if (res?.error === 'too_many') { alert('محاولات غلط كتير — استنى ربع ساعة وحاول تاني.'); location.href = '/'; return; }
        if (res?.error) { alert('رابط الاجتماع غير صحيح أو منتهي. اطلب الرابط تاني من منظّم الاجتماع.'); location.href = '/'; return; }
        me.id = res.selfId;
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
      });
    });
    socket.on('disconnect', () => setStatus(false));

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
      p.state = state;
      updateTile(p.tile, { state });
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
    socket.on('reaction', ({ name, emoji }) => floatEmoji(emoji, name));
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

  $('micBtn').onclick = async () => { await enableMic(!me.mic); sendState(); refreshControls(); };
  $('camBtn').onclick = async () => { await enableCam(!me.cam); sendState(); refreshControls(); };
  $('leaveBtn').onclick = () => leave();
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

  function leave() {
    if (me.rec) stopRecording();
    stopCaptions();
    for (const id of [...peers.keys()]) removePeer(id);
    socket?.disconnect();
    [micTrack, camTrack, screenTrack].forEach((t) => t?.stop());
    location.href = '/';
  }

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

  $('emojiBar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    socket.emit('reaction', b.textContent);
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
    setLocalTrack('video', camTrack);
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
  function floatEmoji(emoji, name) {
    const el = document.createElement('div');
    el.className = 'float-emoji';
    el.style.insetInlineStart = `${10 + Math.random() * 75}%`;
    el.innerHTML = `${esc(emoji)}<small>${esc(name)}</small>`;
    $('reactionsLayer').append(el);
    setTimeout(() => el.remove(), 3100);
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
  const PANEL_TITLES = { chat: 'المحادثة', people: 'المشاركون', minutes: 'محضر الاجتماع', settings: 'الإعدادات', assistant: '✨ المساعد الذكي', translate: 'الترجمة' };
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
    document.querySelectorAll('.dk[data-panel]').forEach((t) => t.classList.toggle('active', t.dataset.panel === name));
    document.querySelectorAll('.panel-body').forEach((b) => b.classList.toggle('show', b.dataset.view === name));
    if (name === 'chat') {
      unread = 0;
      $('chatBadge').hidden = true;
      setTimeout(() => $('chatInput').focus(), 50);
    }
    if (name === 'settings') fillSettings();
    if (name === 'assistant' && aiOn) setTimeout(() => $('aiInput').focus(), 50);
    toggleTools(false);
    if (name === 'people') renderPeople();
  }
  function closePanel() {
    $('panel').hidden = true;
    $('meeting').classList.remove('panel-open');
    document.querySelectorAll('.dk[data-panel]').forEach((t) => t.classList.remove('active'));
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
    $('previewAvatar').textContent = initial($('lobbyName').value || '؟');
    $('pMic').classList.toggle('off', !me.mic);
    $('pMic').innerHTML = icon(me.mic ? 'mic' : 'micOff');
    $('pCam').classList.toggle('off', !me.cam);
    $('pCam').innerHTML = icon(me.cam ? 'cam' : 'camOff');
  }
  $('pMic').onclick = async () => { await enableMic(!me.mic); refreshPreview(); };
  $('pCam').onclick = async () => { await enableCam(!me.cam); refreshPreview(); };
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
    try {
      const cfg = await (await fetch('/api/config')).json();
      if (cfg.iceServers?.length) iceServers = cfg.iceServers;
      aiOn = !!cfg.ai;
      aiFix = !!cfg.captionCorrection;
      const info = await (await fetch(`/api/rooms/${encodeURIComponent(roomId)}`)).json();
      if (info.title) meetingTitle = info.title;
      $('lobbyTitle').textContent = meetingTitle;
      $('lobbyInfo').textContent = info.participants
        ? `${info.participants} ${info.participants === 1 ? 'مشارك' : 'مشاركين'} في الاجتماع الآن`
        : 'لا يوجد أحد في الاجتماع بعد — ستكون أول المنضمين.';
      if (info.participants >= cfg.maxParticipants) $('lobbyErr').textContent = 'الاجتماع ممتلئ حاليًا.';
      if (info.valid === false) {
        $('lobbyInfo').textContent = '';
        $('lobbyErr').textContent = 'رابط الاجتماع غير صحيح. اطلب الرابط تاني من منظّم الاجتماع.';
        $('joinBtn').disabled = true;
      }
    } catch { $('lobbyInfo').textContent = ''; }

    if (!navigator.mediaDevices?.getUserMedia) {
      $('lobbyErr').textContent = 'المتصفح لا يسمح بالكاميرا/الميكروفون — افتح الموقع عبر https.';
      me.mic = false; me.cam = false;
    } else {
      if (me.mic) await enableMic(true);
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
    $('lobbyName').focus();
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

    $('lobby').hidden = true;
    $('meeting').hidden = false;
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
