/* واجهة متعددة اللغات: العربية (الأصل) + English + Русский + 中文
   النصوص الأصلية مكتوبة بالعربي في الصفحات والكود، والملف ده بيترجمها وقت العرض
   من قاموس /i18n/<lang>.js — ومحتوى المستخدمين (المحادثة، الكلام، المحضر) مش بيتترجم. */
(() => {
  'use strict';
  const LANGS = { ar: { name: 'العربية', locale: 'ar-EG', dir: 'rtl' }, en: { name: 'English', locale: 'en-US', dir: 'ltr' },
    ru: { name: 'Русский', locale: 'ru-RU', dir: 'ltr' }, zh: { name: '中文', locale: 'zh-CN', dir: 'ltr' } };
  const get = () => { try { return localStorage.getItem('meet:ui'); } catch { return null; } };
  const qs = new URLSearchParams(location.search).get('lang');
  let lang = (qs && LANGS[qs] && qs) || get();
  if (!LANGS[lang]) {
    const nav = (navigator.languages || [navigator.language || 'ar']).map((l) => String(l).slice(0, 2).toLowerCase());
    // العربي هو الافتراضي (ناس كتير عندنا موبايلاتهم إنجليزي) — التحويل التلقائي للروسي والصيني بس
    const first = nav[0];
    lang = (first === 'ru' || first === 'zh') ? first : 'ar';
  }
  if (qs && LANGS[qs]) try { localStorage.setItem('meet:ui', qs); } catch { /* ignore */ }

  const html = document.documentElement;
  html.lang = lang;
  html.dir = LANGS[lang].dir;
  html.dataset.ui = lang;

  const I18N = window.I18N = {
    lang, langs: LANGS, locale: LANGS[lang].locale,
    t: (s) => s,
    set(l) {
      if (!LANGS[l] || l === lang) return;
      try { localStorage.setItem('meet:ui', l); } catch { /* ignore */ }
      fetch('/api/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: l }) }).catch(() => {}).finally(() => location.reload());
    },
    picker(cls = '') {
      const s = document.createElement('select');
      s.className = `lang-pick ${cls}`;
      s.setAttribute('aria-label', 'Language');
      s.setAttribute('translate', 'no');
      s.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}"${k === lang ? ' selected' : ''}>🌐 ${v.name}</option>`).join('');
      s.onchange = () => I18N.set(s.value);
      return s;
    },
  };
  const mountPickers = () => document.querySelectorAll('[data-lang-picker]:not(.mounted)').forEach((el) => { el.classList.add('mounted'); el.append(I18N.picker(el.dataset.langPicker)); });
  document.addEventListener('DOMContentLoaded', mountPickers);
  if (lang === 'ar') return;

  // تحميل القاموس قبل باقي الصفحة (سكريبت متزامن في الـ head)
  document.write(`<script src="/i18n/${lang}.js?v=${window.I18N_V || '1'}"><\/script>`);

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'NOSCRIPT']);
  const ATTRS = ['placeholder', 'title', 'aria-label', 'data-q', 'content', 'alt'];
  let dict = null, pats = [];
  function prepare() {
    if (dict) return true;
    if (!window.I18N_DICT) return false;
    dict = new Map(Object.entries(window.I18N_DICT));
    pats = (window.I18N_PATS || []).map(([src, out]) => {
      const re = new RegExp(`^${src.split('{}').map((p) => p.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('(.+?)')}$`);
      return [re, out];
    });
    return true;
  }
  const AR = /[؀-ۿ]/;
  function tr(s) {
    if (!s || !AR.test(s) || !prepare()) return s;
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const core = m[2].replace(/\s+/g, ' ');
    let out = dict.get(core);
    if (out === undefined) {
      for (const [re, rep] of pats) {
        const g = core.match(re);
        if (g) { let i = 0; out = rep.replace(/\{\}/g, () => tr(g[++i] ?? '')); break; }
      }
    }
    return out === undefined ? s : m[1] + out + m[3];
  }
  I18N.t = tr;
  const noTr = (el) => el && el.closest && el.closest('[translate="no"]');
  function walk(root) {
    if (root.nodeType === 3) {
      if (!SKIP.has(root.parentNode?.nodeName) && !noTr(root.parentNode)) { const v = tr(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; }
      return;
    }
    if (root.nodeType !== 1 || (SKIP.has(root.nodeName) && root.nodeName !== 'TEXTAREA') || root.getAttribute('translate') === 'no') return;
    for (const a of ATTRS) {
      const v = root.getAttribute(a);
      if (v && AR.test(v) && !(a === 'content' && root.nodeName !== 'META')) { const t = tr(v); if (t !== v) root.setAttribute(a, t); }
    }
    if (root.nodeName === 'INPUT' && (root.type === 'button' || root.type === 'submit') && AR.test(root.value)) root.value = tr(root.value);
    if (root.nodeName === 'TEXTAREA') return;
    for (let c = root.firstChild; c; c = c.nextSibling) walk(c);
  }
  const obs = new MutationObserver((recs) => {
    if (!prepare()) return;
    for (const r of recs) {
      if (r.type === 'childList') r.addedNodes.forEach(walk);
      else if (r.type === 'characterData') walk(r.target);
      else if (r.type === 'attributes') walk(r.target);
    }
  });
  obs.observe(html, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  document.addEventListener('DOMContentLoaded', () => { prepare(); walk(document.head); walk(document.body); });
  // رسائل التأكيد والنوافذ
  for (const fn of ['alert', 'confirm', 'prompt']) {
    const orig = window[fn].bind(window);
    window[fn] = (msg, ...rest) => orig(tr(String(msg ?? '')), ...rest);
  }
})();
