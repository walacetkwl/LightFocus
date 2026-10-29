/* Lightfocus — Landing, Stripe checkout, PWA install, Janela App, time-ending notifications */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isMini = qs.has('mini') || window.name === 'lightfocus_mini';
  if (isMini) document.documentElement.classList.add('lf-mini');
  let forceApp = qs.has('app') || isMini || standalone || localStorage.getItem('lf_enter_app') === '1';
  let forceLanding = qs.has('lp') || location.hash === '#landing';

  window.LF_LANDING = {
    shouldShow(authenticated) {
      if (forceLanding) return true;
      if (forceApp) return false;
      return !authenticated;
    }
  };
  const refresh = () => window.LF && window.LF.updateAuthUI && window.LF.updateAuthUI();
  const toast = (m) => (window.LF && window.LF.showToast ? window.LF.showToast(m) : console.log(m));

  function enterApp() { forceLanding = false; forceApp = true; localStorage.setItem('lf_enter_app', '1'); if (location.hash === '#landing') history.replaceState(null, '', location.pathname); refresh(); window.scrollTo(0, 0); }
  function showLanding() { forceLanding = true; if (window.LF) window.LF.closeAllModals(); refresh(); window.scrollTo(0, 0); }

  function openModal(id) { const m = $(id); if (m) m.classList.remove('hidden'); }
  function closeModal(id) { const m = $(id); if (m) m.classList.add('hidden'); }

  /* ---------- PWA install ---------- */
  let deferredPrompt = null;
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; document.body.classList.add('pwa-installable'); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; toast('Lightfocus instalado como app ✨'); closeModal('pwaInstallModal'); });
  async function installPwa() {
    if (standalone) { toast('Você já está usando o app instalado.'); return; }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (_) {}
      deferredPrompt = null;
      return;
    }
    const ins = $('pwaInstallStatusInstruction');
    if (ins) {
      const ua = navigator.userAgent;
      ins.textContent = /iPhone|iPad/.test(ua)
        ? 'No Safari: toque em Compartilhar → "Adicionar à Tela de Início".'
        : /Android/.test(ua)
        ? 'No Chrome: menu ⋮ → "Instalar app" ou "Adicionar à tela inicial".'
        : 'No Chrome: clique no ícone de instalar (⊕) na barra de endereço ou menu ⋮ → "Transmitir, salvar e compartilhar" → "Instalar Lightfocus".';
    }
    openModal('pwaInstallModal');
  }

  /* ---------- Janela App (390x740) ---------- */
  async function openMiniWindow() {
    const url = location.origin + '/?mini=1';
    const w = 390, h = 740;
    const left = Math.max(0, (screen.availWidth || 1280) - w - 24), top = 40;
    const win = window.open(url, 'lightfocus_mini', `popup=yes,width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`);
    if (win) { win.focus(); return; }
    if ('documentPictureInPicture' in window) {
      try {
        const pip = await window.documentPictureInPicture.requestWindow({ width: w, height: h });
        const f = pip.document.createElement('iframe');
        f.src = url; f.style.cssText = 'border:0;width:100%;height:100%';
        pip.document.body.style.margin = '0'; pip.document.body.appendChild(f);
        return;
      } catch (_) {}
    }
    toast('Permita pop-ups para abrir o Lightfocus em janela.');
  }

  /* ---------- Stripe checkout ---------- */
  let payMethod = 'pix';
  let stripeCfg = null;
  async function loadStripeCfg() {
    try { stripeCfg = await (await fetch('/api/config/stripe')).json(); } catch (_) { stripeCfg = null; }
    const pixInput = $('checkoutPixKeyInput');
    if (pixInput && stripeCfg && stripeCfg.pixKey) pixInput.value = stripeCfg.pixKey;
    return stripeCfg;
  }
  function setPay(m) {
    payMethod = m;
    document.querySelectorAll('[data-lp-pay]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-lp-pay') === m));
    document.querySelectorAll('[data-checkout-tab]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-checkout-tab') === m));
    const pp = $('checkoutPanelPix'), pc = $('checkoutPanelCard');
    if (pp) pp.classList.toggle('hidden', m !== 'pix');
    if (pc) pc.classList.toggle('hidden', m !== 'card');
    const lbl = $('proceedStripeRedirectLabel');
    if (lbl) lbl.textContent = m === 'pix' ? 'Pagar R$ 99 no PIX (Stripe)' : 'Pagar no cartão em até 12x (Stripe)';
  }
  async function startCheckout(btn) {
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    try {
      const r = await fetch('/api/checkout/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentMethod: payMethod, installments: ($('installmentSelector') || {}).value || 1 }) });
      const d = await r.json();
      if (d.checkoutUrl) { location.href = d.checkoutUrl; return; }
      await loadStripeCfg();
      setPay(payMethod);
      openModal('stripeCheckoutModal');
    } catch (_) { openModal('stripeCheckoutModal'); }
    finally { if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.innerHTML = orig; } }
  }

  /* ---------- Time-ending notifications ---------- */
  const NKEY = 'lf_notify_time_ending', TKEY = 'lf_notify_threshold';
  const notifyOn = () => localStorage.getItem(NKEY) !== '0';
  const threshold = () => Number(localStorage.getItem(TKEY) || 2);
  function syncNotifyUI() {
    ['notifyTimeEndingToggle', 'settingsNotifyTimeEndingToggle'].forEach((id) => { const el = $(id); if (el) el.checked = notifyOn(); });
    const sel = $('notifyThresholdSelect'); if (sel) sel.value = String(threshold());
    const b = $('notifPermissionBadge');
    if (b) {
      const perm = 'Notification' in window ? Notification.permission : 'unsupported';
      b.textContent = !notifyOn() ? 'Desativado' : perm === 'granted' ? 'Ativo' : perm === 'denied' ? 'Bloqueado no navegador' : perm === 'unsupported' ? 'Só aviso visual' : 'Permitir';
    }
  }
  async function setNotify(on) {
    localStorage.setItem(NKEY, on ? '1' : '0');
    if (on && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (_) {} }
    syncNotifyUI();
    try { fetch('/api/settings', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notifyTimeEnding: on }) }); } catch (_) {}
    toast(on ? 'Avisos de tempo acabando ativados' : 'Avisos de tempo acabando desativados');
  }
  function beep() {
    try { const C = new (window.AudioContext || window.webkitAudioContext)(); const o = C.createOscillator(), g = C.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.12, C.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, C.currentTime + 0.6); o.connect(g).connect(C.destination); o.start(); o.stop(C.currentTime + 0.6); } catch (_) {}
  }
  async function notify(title, body) {
    beep(); toast(`${title} — ${body}`);
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      const opts = { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'lightfocus-time', renotify: true };
      if (reg && reg.showNotification) reg.showNotification(title, opts); else new Notification(title, opts);
    } catch (_) {}
  }
  let firedKey = '';
  setInterval(() => {
    if (!notifyOn() || !window.LF) return;
    const s = window.LF.state; if (!s || !s.timerRunning) return;
    const t = window.LF.getCurrentTask() || {};
    const est = Math.max(60, Number(t.estimatedMinutes || 15) * 60);
    const left = est - Number(s.timerSeconds || 0);
    const th = threshold() * 60, id = t.id || t.title || 'x';
    if (th > 0 && left <= th && left > 0 && firedKey !== id + ':warn' && firedKey !== id + ':end') { firedKey = id + ':warn'; notify('Lightfocus · tempo acabando', `Faltam ${Math.ceil(left / 60)} min para "${t.title || t.content || 'sua tarefa'}".`); }
    if (left <= 0 && firedKey !== id + ':end') { firedKey = id + ':end'; notify('Lightfocus · tempo esgotado', `Hora de concluir "${t.title || t.content || 'sua tarefa'}" e ir para a próxima.`); }
  }, 1000);

  /* ---------- Landing motions (reveal + live clock) ---------- */
  function initMotions() {
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('lp-in'); io.unobserve(e.target); } }), { threshold: 0.12 }) : null;
    document.querySelectorAll('#landingPageSection section, #landingPageSection .lp-reveal, #landingPageSection [class*="card"]').forEach((el) => { el.classList.add('lp-reveal'); io ? io.observe(el) : el.classList.add('lp-in'); });
    const clock = $('lpMotionLiveClock');
    if (clock) { let sec = 24 * 60 + 37; setInterval(() => { sec = sec <= 0 ? 25 * 60 : sec - 1; clock.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; }, 1000); }
  }

  function on(id, fn) { const el = $(id); if (el) el.addEventListener('click', (e) => { e.preventDefault(); fn(el, e); }); }

  document.addEventListener('DOMContentLoaded', () => {
    ['lpInstallWebAppBtn', 'lpHeroInstallBtn', 'lpFooterInstallBtn', 'installPwaTopBtn', 'settingsInstallWebAppBtn', 'modalTriggerNativePwaBtn'].forEach((id) => on(id, installPwa));
    ['lpOpenMiniWindowBtn', 'lpHeroWindowBtn', 'lpFooterWindowBtn', 'openMiniWindowBtn', 'settingsOpenMiniWindowBtn', 'modalLaunchMiniWindowBtn'].forEach((id) => on(id, openMiniWindow));
    ['lpEnterAppBtn', 'lpFooterLoginBtn', 'checkoutCreateAccountNowBtn'].forEach((id) => on(id, () => { closeModal('stripeCheckoutModal'); enterApp(); }));
    on('authBackToLpBtn', showLanding);
    on('settingsViewLandingBtn', showLanding);
    on('lpBrandTopLink', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    ['lpHeroBuyBtn', 'lpStripeCheckoutBtn', 'proceedStripeRedirectBtn'].forEach((id) => on(id, (el) => startCheckout(el)));
    document.querySelectorAll('[data-lp-pay],[data-checkout-tab]').forEach((b) => b.addEventListener('click', () => setPay(b.getAttribute('data-lp-pay') || b.getAttribute('data-checkout-tab'))));
    on('lpSelectPixBtn', () => setPay('pix')); on('lpSelectCardBtn', () => setPay('card'));
    on('copyPixKeyBtn', () => { const v = ($('checkoutPixKeyInput') || {}).value || ''; navigator.clipboard && navigator.clipboard.writeText(v); toast('Chave PIX copiada'); });
    document.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', () => closeModal(b.getAttribute('data-close-modal'))));
    ['stripeCheckoutModal', 'pwaInstallModal'].forEach((id) => { const m = $(id); if (m) m.addEventListener('click', (e) => { if (e.target === m) closeModal(id); }); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal('stripeCheckoutModal'); closeModal('pwaInstallModal'); } });
    ['notifyTimeEndingToggle', 'settingsNotifyTimeEndingToggle'].forEach((id) => { const el = $(id); if (el) el.addEventListener('change', () => setNotify(el.checked)); });
    const sel = $('notifyThresholdSelect'); if (sel) sel.addEventListener('change', () => { localStorage.setItem(TKEY, sel.value); toast('Aviso ajustado'); });
    on('testTimeEndingNotifyBtn', async () => { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); syncNotifyUI(); notify('Lightfocus · teste', 'É assim que vou te avisar quando o tempo da tarefa estiver acabando.'); });
    document.querySelectorAll('#landingPageSection a[href^="#lp"]').forEach((a) => a.addEventListener('click', (e) => { const t = document.querySelector(a.getAttribute('href')); if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); } }));
    if (qs.get('checkout') === 'success') { toast('Pagamento confirmado! Bem-vindo ao Lightfocus vitalício ✨'); localStorage.setItem('lf_lifetime', '1'); }
    setPay('pix'); syncNotifyUI(); initMotions(); loadStripeCfg();
    refresh();
  });
})();
