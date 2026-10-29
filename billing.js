/* Lightfocus v14: planos, teste grátis, paywall, assinatura, suporte, integrações, admin */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LOGOS = {
    todoist: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#E44332"/><path d="M7 11.2l9 5.1 9-5.1M7 16l9 5.1 9-5.1M7 20.8l9 5.1 9-5.1" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    gcal: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="4" fill="#fff"/><path d="M3 9V7a4 4 0 014-4h18a4 4 0 014 4v2z" fill="#4285F4"/><path d="M29 23v2a4 4 0 01-4 4h-2v-6z" fill="#EA4335"/><path d="M3 23h20v6H7a4 4 0 01-4-4z" fill="#34A853"/><path d="M23 9h6v14h-6z" fill="#FBBC04"/><rect x="3" y="3" width="26" height="26" rx="4" fill="none" stroke="rgba(0,0,0,.08)"/><text x="13" y="20.5" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="10" font-weight="700" fill="#1a73e8" text-anchor="middle">31</text></svg>'
  };
  const ICON = {
    close: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 10.5h6M9 13.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v6c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
  };
  window.LFLogos = { src(t) { if (!t) return ''; if (t.source === 'gcal') return '<span class="lf-src" title="Google Agenda">' + LOGOS.gcal + '</span>'; if (t.source === 'todoist' && /^\d+$|^[A-Za-z0-9]{12,}$/.test(String(t.id || '')) && !/^(local|tmp|onb|lf)/i.test(String(t.id || ''))) return '<span class="lf-src" title="Todoist">' + LOGOS.todoist + '</span>'; return ''; } };

  let user = null, info = null, paywallOpen = false;
  const toast = (m) => { const t = document.createElement('div'); t.textContent = m; t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;padding:12px 18px;border-radius:999px;background:var(--bl-invert);color:var(--bl-invert-ink);font:600 14px -apple-system,system-ui,sans-serif;max-width:calc(100vw - 32px);text-align:center'; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); };

  // ---- fetch hook: 402 => paywall
  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const r = await origFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (r.status === 402 && url.indexOf('/api/') !== -1) { r.clone().json().then((d) => { if (d && d.user) user = d.user; showPaywall(d && d.billing); }).catch(() => showPaywall()); }
    } catch (_) {}
    return r;
  };

  async function api(path, body) {
    const r = await origFetch(path, body === undefined ? { credentials: 'include' } : { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let d = {}; try { d = await r.json(); } catch (_) {}
    d.__status = r.status; return d;
  }

  const fmtDate = (iso) => { if (!iso) return '-'; const d = new Date(iso); return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' ' + d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); };
  const fmtLeft = (ms) => { const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return h >= 1 ? `${h}h ${String(m).padStart(2, '0')}min` : `${m} min`; };
  const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function supportUrl() {
    let msg = 'Olá! Preciso de ajuda com o Lightfocus.';
    if (user && user.email) msg += ' Meu e-mail de cadastro: ' + user.email;
    return 'https://wa.me/5532999508293?text=' + encodeURIComponent(msg);
  }
  function supportBtn(extraCls) { return `<a class="bl-btn ${extraCls || ''}" data-bl-support href="${esc(supportUrl())}" target="_blank" rel="noopener">${ICON.chat}<span>Falar com o suporte</span></a>`; }

  // ---- checkout
  async function startPlan(plan, btn) {
    if (btn) btn.disabled = true;
    try {
      const d = await api('/api/billing/checkout', { plan });
      if (d.__status === 401) { localStorage.setItem('lf_pending_plan', plan); goSignup(); toast('Crie sua conta para continuar. Você ganha 2 dias grátis.'); return; }
      if (d.checkoutUrl) { location.href = d.checkoutUrl; return; }
      toast('Pagamento em breve. Fale com o suporte se precisar.');
    } catch (_) { toast('Não foi possível abrir o pagamento agora.'); }
    finally { if (btn) btn.disabled = false; }
  }
  async function openPortal(btn) {
    if (btn) btn.disabled = true;
    const d = await api('/api/billing/portal', {});
    if (btn) btn.disabled = false;
    if (d.portalUrl) location.href = d.portalUrl; else toast('Portal de assinatura em breve.');
  }
  function goSignup() {
    const enter = $('lpEnterAppBtn'); if (enter) enter.click();
    setTimeout(() => { const t = $('authTabRegister'); if (t) t.click(); const n = $('authNameInput') || $('authEmailInput'); if (n) n.focus(); }, 120);
  }

  // ---- overlays
  function overlay(id, inner, cls) {
    closeOverlay(id);
    const o = document.createElement('div'); o.className = 'bl-overlay'; o.id = id; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
    o.innerHTML = `<div class="bl-sheet ${cls || ''}">${inner}</div>`;
    document.body.appendChild(o);
    o.addEventListener('click', (e) => { const c = e.target.closest('[data-bl-close]'); if (c || (e.target === o && id !== 'blPaywall')) closeOverlay(id); });
    return o;
  }
  function closeOverlay(id) { const o = $(id); if (o) o.remove(); if (id === 'blPaywall') paywallOpen = false; }
  const closeBtn = '<button type="button" class="bl-close" data-bl-close aria-label="Fechar">' + ICON.close + '</button>';

  function plansHtml() {
    const mOk = !info || info.monthly.available, lOk = !info || info.lifetime.available;
    return `<div class="bl-plans">
      <div class="bl-plan"><span class="bl-muted">Mensal</span><div class="bl-price">R$ 29<small>/mês</small></div><span class="bl-muted">Cartão, Apple Pay e Google Pay. Cancele quando quiser.</span><button type="button" class="bl-btn bl-btn-dark" data-bl-plan="monthly" ${mOk ? '' : 'disabled'}>${mOk ? 'Assinar mensal' : 'Em breve'}</button></div>
      <div class="bl-plan hi"><span class="bl-badge">94% escolhem este plano</span><span style="opacity:.7;font-size:12.5px">Vitalício</span><div class="bl-price">R$ 99<small> uma vez</small></div><span style="opacity:.7;font-size:12.5px">Cartão, Apple Pay, Google Pay ou Pix. Para sempre.</span><button type="button" class="bl-btn" data-bl-plan="lifetime" ${lOk ? '' : 'disabled'}>${lOk ? 'Garantir vitalício' : 'Em breve'}</button></div>
    </div>`;
  }
  function bindPlans(root) { root.querySelectorAll('[data-bl-plan]').forEach((b) => b.addEventListener('click', () => startPlan(b.getAttribute('data-bl-plan'), b))); }

  function showPaywall(billing) {
    if (paywallOpen) return; paywallOpen = true;
    const disabled = billing && billing.reason === 'disabled';
    const o = overlay('blPaywall', disabled
      ? `<h2>Conta desativada</h2><p class="bl-muted">Fale com o suporte para reativar seu acesso.</p><div class="bl-btns">${supportBtn('bl-btn-dark')}</div>`
      : `<h2>Seu teste grátis terminou</h2><p class="bl-muted">Seus dados e tarefas continuam guardados. Escolha um plano para continuar focando.</p>${plansHtml()}<div class="bl-btns" style="justify-content:space-between"><button type="button" class="bl-btn" data-bl-logout>Sair da conta</button>${supportBtn()}</div>`);
    bindPlans(o);
    const lo = o.querySelector('[data-bl-logout]'); if (lo) lo.addEventListener('click', async () => { await origFetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); location.href = '/?lp=1'; });
  }

  // ---- integrations guide
  function showIntegrations(tab) {
    const steps = {
      todoist: ['Abra o Todoist no navegador em todoist.com e entre na sua conta.', 'Clique na sua foto e vá em <b>Configurações</b>, depois <b>Integrações</b>.', 'Abra a aba <b>Desenvolvedor</b> e copie o <b>token da API</b>.', 'No Lightfocus, abra <b>Configurações</b> e cole o token no campo <b>Token da API do Todoist</b>.', 'Clique em <b>Salvar e Sincronizar</b>. Suas tarefas de Hoje aparecem na fila, na mesma ordem.'],
      gcal: ['Abra o Google Agenda no computador em calendar.google.com.', 'Clique na engrenagem e vá em <b>Configurações</b>. Na lateral, escolha a agenda que quer trazer.', 'Em <b>Integrar agenda</b>, copie o <b>Endereço secreto no formato iCal</b> (termina em .ics).', 'No Lightfocus, abra <b>Configurações</b> e cole o endereço no campo do <b>Google Agenda</b>. Clique em <b>Salvar Google Agenda</b>.', 'Escolha se os eventos entram na fila do dia no seletor <b>Incluir eventos do Google Agenda</b>.']
    };
    let cur = tab === 'gcal' ? 'gcal' : 'todoist';
    const o = overlay('blInteg', `${closeBtn}<h2>Conectar suas ferramentas</h2><p class="bl-muted">Leva menos de 2 minutos. Você pode desconectar quando quiser.</p>
      <div class="bl-tabs" role="tablist"><button type="button" data-t="todoist">${LOGOS.todoist}<span>Todoist</span></button><button type="button" data-t="gcal">${LOGOS.gcal}<span>Google Agenda</span></button></div>
      <ol class="bl-steps" id="blIntegSteps"></ol>
      <div class="bl-btns"><button type="button" class="bl-btn bl-btn-dark" data-bl-go>Abrir configurações</button>${supportBtn()}</div>`);
    const render = () => { o.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === cur)); $('blIntegSteps').innerHTML = steps[cur].map((s) => `<li><span>${s}</span></li>`).join(''); };
    o.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.t; render(); }));
    o.querySelector('[data-bl-go]').addEventListener('click', () => {
      closeOverlay('blInteg');
      const sm = $('settingsModal'); if (sm && sm.classList.contains('hidden')) { const ob = $('openSettingsBtn'); if (ob) ob.click(); }
      setTimeout(() => { const f = $(cur === 'gcal' ? 'gcalConfigForm' : 'todoistConfigForm'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = f.querySelector('input[type=password],input[type=url]'); if (i) i.focus(); } }, 200);
    });
    render();
  }
  window.LFIntegrations = showIntegrations;

  // ---- settings: subscription section
  function planLabel(b) {
    if (!b) return 'Lightfocus';
    return { admin: 'Admin', lifetime: 'Vitalício', monthly: 'Mensal', trial: 'Teste grátis', expired: 'Expirado' }[b.reason === 'expired' ? 'expired' : b.reason === 'disabled' ? 'expired' : b.plan] || 'Lightfocus';
  }
  async function renderSettings() {
    const body = document.querySelector('#settingsModal .settings-body'); if (!body) return;
    const st = await api('/api/billing/status'); if (st.__status !== 200 && st.__status !== 402) return;
    if (st.info) info = st.info;
    const b = st.billing || (st.user && st.user.billing); if (!b) return;
    if (st.email && user) user.email = st.email;
    let sec = $('blSubSection'); if (!sec) { sec = document.createElement('div'); sec.id = 'blSubSection'; const card = body.querySelector('.account-profile-card'); card ? card.after(sec) : body.prepend(sec); }
    let status = '';
    if (b.reason === 'trial') status = `Seu teste termina em <b class="lf-num">${fmtLeft(b.trialMsLeft)}</b> (${fmtDate(b.trialEndsAt)}).`;
    else if (b.reason === 'monthly') status = b.currentPeriodEnd ? `${b.cancelAtPeriodEnd ? 'Acesso até' : 'Renova em'} <b class="lf-num">${fmtDate(b.currentPeriodEnd)}</b>.` : 'Assinatura ativa.';
    else if (b.reason === 'lifetime') status = 'Acesso vitalício ativo. Obrigado por apoiar o Lightfocus.';
    else if (b.reason === 'admin') status = 'Conta administradora, sem cobrança.';
    else status = 'Seu acesso expirou. Seus dados continuam guardados.';
    if (b.status === 'past_due') status += ' Houve uma falha no pagamento, atualize o cartão.';
    const showUpgrade = ['trial', 'monthly', 'expired', 'disabled'].includes(b.reason);
    const showPortal = b.reason === 'monthly' || b.hasStripeCustomer;
    sec.className = 'bl-section';
    sec.innerHTML = `<div class="bl-row"><span class="bl-title">Assinatura</span><span class="bl-pill">${esc(planLabel(b))}</span></div>
      <p class="bl-muted" style="margin:8px 0 0">${status}</p>
      <div class="bl-btns">
        ${showUpgrade ? `<button type="button" class="bl-btn bl-btn-dark" data-bl-plan="lifetime" ${info && !info.lifetime.available ? 'disabled' : ''}>Vitalício por R$ 99</button>` : ''}
        ${b.reason === 'trial' || b.reason === 'expired' ? `<button type="button" class="bl-btn" data-bl-plan="monthly" ${info && !info.monthly.available ? 'disabled' : ''}>Mensal R$ 29</button>` : ''}
        ${showPortal ? `<button type="button" class="bl-btn" data-bl-portal ${info && !info.portalAvailable ? 'disabled' : ''}>Gerenciar assinatura</button>` : ''}
      </div>
      <div class="bl-btns" style="border-top:1px solid var(--bl-line);padding-top:12px">
        <button type="button" class="bl-btn" data-bl-integ>${ICON.link}<span>Como conectar Todoist e Google Agenda</span></button>
        ${supportBtn()}
        ${user && user.isAdmin ? `<button type="button" class="bl-btn bl-btn-dark" data-bl-admin>${ICON.shield}<span>Painel admin</span></button>` : ''}
      </div>`;
    bindPlans(sec);
    const p = sec.querySelector('[data-bl-portal]'); if (p) p.addEventListener('click', () => openPortal(p));
    sec.querySelector('[data-bl-integ]').addEventListener('click', () => showIntegrations('todoist'));
    const a = sec.querySelector('[data-bl-admin]'); if (a) a.addEventListener('click', openAdmin);
    const sf = $('stripeConfigForm'); if (sf) sf.style.display = user && user.isAdmin ? '' : 'none';
  }

  function enhanceTutorial() {
    const foot = document.querySelector('#tutorialModal .tutorial-footer'); if (!foot || $('blTutSupport')) return;
    const w = document.createElement('div'); w.id = 'blTutSupport'; w.className = 'bl-btns bl-support';
    w.innerHTML = `<button type="button" class="bl-btn" data-bl-integ>${ICON.link}<span>Conectar Todoist e Google Agenda</span></button>${supportBtn()}`;
    foot.before(w);
    w.querySelector('[data-bl-integ]').addEventListener('click', () => showIntegrations('todoist'));
    w.querySelector('[data-bl-support]').addEventListener('mouseenter', (e) => { e.currentTarget.href = supportUrl(); });
  }
  function enhanceIntegrationsBar() {
    const bar = document.querySelector('.gcal-inline-bar'); if (!bar || $('blHowConnect')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'blHowConnect'; b.className = 'gcal-mini-badge'; b.style.cursor = 'pointer'; b.textContent = 'Como conectar';
    b.addEventListener('click', () => showIntegrations('gcal')); bar.appendChild(b);
  }

  // ---- admin
  let adminData = null, adminSel = null;
  async function openAdmin() {
    const d = await api('/api/admin/overview');
    if (d.__status !== 200) { toast('Acesso restrito.'); return; }
    adminData = d;
    const o = overlay('blAdmin', `${closeBtn}<h2>Painel admin</h2><p class="bl-muted">Lightfocus · usuários, planos e pagamentos.</p><div id="blAdminBody"></div>`, 'bl-admin');
    renderAdmin(o);
  }
  function renderAdmin() {
    const d = adminData, k = d.kpis, root = $('blAdminBody'); if (!root) return;
    const max = Math.max(1, ...d.signups.map((s) => s.n)), W = 600, H = 100, bw = W / d.signups.length;
    const bars = d.signups.map((s, i) => `<rect x="${(i * bw + 2).toFixed(1)}" y="${(H - (s.n / max) * (H - 14)).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${((s.n / max) * (H - 14)).toFixed(1)}" rx="3" fill="currentColor" opacity="${s.n ? .85 : .12}"><title>${s.date}: ${s.n}</title></rect>`).join('');
    const kpi = (l, v) => `<div class="bl-kpi"><span>${l}</span><b>${v}</b></div>`;
    root.innerHTML = `<div class="bl-kpis">${kpi('Usuários', k.totalUsers)}${kpi('Testes ativos', k.activeTrials)}${kpi('Testes expirados', k.expiredTrials)}${kpi('Mensais pagantes', k.payingMonthly)}${kpi('Vitalícios', k.lifetime)}${kpi('MRR', brl(k.mrr))}${kpi('Receita total', brl(k.totalRevenue))}${kpi('Desativados', k.disabled)}</div>
      <div class="bl-chart"><div class="bl-row"><span class="bl-title">Cadastros nos últimos 30 dias</span><span class="bl-muted lf-num">${d.signups.reduce((a, s) => a + s.n, 0)} no período</span></div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="color:var(--bl-ink)">${bars}</svg></div>
      <div class="bl-toolbar"><input id="blAdmQ" class="bl-input" type="search" placeholder="Buscar por nome ou e-mail"><select id="blAdmF" class="bl-select"><option value="">Todos</option><option value="trial">Teste ativo</option><option value="expired">Expirados</option><option value="monthly">Mensal</option><option value="lifetime">Vitalício</option><option value="disabled">Desativados</option></select></div>
      <div class="bl-grid2"><div class="bl-table-wrap"><table class="bl-table"><thead><tr><th>Usuário</th><th>Plano</th><th>Fim do teste</th><th>Último acesso</th><th>Tarefas</th></tr></thead><tbody id="blAdmRows"></tbody></table></div>
      <div><div class="bl-section bl-detail" id="blAdmDetail" style="margin-top:0"><span class="bl-muted">Selecione um usuário para ver detalhes e ações.</span></div>
      <div class="bl-section"><span class="bl-title">Eventos recentes (Stripe e admin)</span><ul class="bl-events">${d.events.length ? d.events.map((e) => `<li><span>${esc(e.type)}${e.email ? ' · ' + esc(e.email) : ''}${e.note ? ' · ' + esc(e.note) : ''}</span><span>${fmtDate(e.at)}</span></li>`).join('') : '<li><span>Nenhum evento ainda.</span><span></span></li>'}</ul></div></div></div>`;
    const rows = () => {
      const q = ($('blAdmQ').value || '').toLowerCase(), f = $('blAdmF').value;
      $('blAdmRows').innerHTML = d.users.filter((u) => (!q || (u.name + ' ' + u.email).toLowerCase().includes(q)) && (!f || (f === 'disabled' ? u.disabled : u.reason === f))).map((u) => `<tr data-uid="${esc(u.id)}" class="${u.id === adminSel ? 'sel' : ''}"><td><b>${esc(u.name)}</b><br><span class="bl-muted">${esc(u.email)}</span></td><td><span class="bl-tag ${u.entitled && u.reason !== 'trial' ? 'dark' : ''}">${esc(u.disabled ? 'Desativado' : planLabel(u))}</span></td><td class="lf-num">${u.reason === 'trial' || u.reason === 'expired' ? fmtDate(u.trialEndsAt) : '-'}</td><td class="lf-num">${fmtDate(u.lastAccessAt)}</td><td class="lf-num">${u.tasksCount}</td></tr>`).join('') || '<tr><td colspan="5" class="bl-muted">Nenhum usuário.</td></tr>';
      $('blAdmRows').querySelectorAll('tr[data-uid]').forEach((tr) => tr.addEventListener('click', () => { adminSel = tr.dataset.uid; rows(); detail(); }));
    };
    const detail = () => {
      const u = d.users.find((x) => x.id === adminSel), box = $('blAdmDetail'); if (!u) return;
      box.innerHTML = `<div class="bl-row"><span class="bl-title">${esc(u.name)}</span><span class="bl-pill">${esc(u.disabled ? 'Desativado' : planLabel(u))}</span></div>
        <dl><dt>E-mail</dt><dd>${esc(u.email)}</dd><dt>Cadastro</dt><dd>${fmtDate(u.createdAt)}</dd><dt>Fim do teste</dt><dd>${fmtDate(u.trialEndsAt)}</dd><dt>Renovação</dt><dd>${fmtDate(u.currentPeriodEnd)}</dd><dt>Último acesso</dt><dd>${fmtDate(u.lastAccessAt)}</dd><dt>Tarefas</dt><dd>${u.tasksCount}</dd><dt>Todoist</dt><dd>${u.hasTodoist ? 'Conectado' : 'Não'}</dd><dt>Stripe</dt><dd>${u.stripeCustomer ? 'Cliente vinculado' : 'Sem cliente'}</dd></dl>
        <div class="bl-btns"><button type="button" class="bl-btn" data-act="extend_trial">Estender teste 2 dias</button><button type="button" class="bl-btn bl-btn-dark" data-act="grant_lifetime">Liberar vitalício</button>${u.disabled ? '<button type="button" class="bl-btn" data-act="reactivate">Reativar</button>' : (u.role === 'founder' ? '' : '<button type="button" class="bl-btn" data-act="deactivate">Desativar</button>')}</div>`;
      box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
        const labels = { extend_trial: 'estender o teste em 2 dias', grant_lifetime: 'liberar acesso vitalício', deactivate: 'desativar esta conta', reactivate: 'reativar esta conta' };
        if (!confirm(`Confirmar: ${labels[b.dataset.act]} para ${u.email}?`)) return;
        b.disabled = true;
        const r = await api('/api/admin/user-action', { userId: u.id, action: b.dataset.act, days: 2 });
        if (!r.ok) { toast(r.error || 'Não foi possível concluir.'); b.disabled = false; return; }
        toast('Feito.'); const nd = await api('/api/admin/overview'); if (nd.ok) { adminData = nd; renderAdmin(); }
      }));
    };
    $('blAdmQ').addEventListener('input', rows); $('blAdmF').addEventListener('change', rows);
    rows(); detail();
  }
  window.LFAdmin = openAdmin;

  // ---- boot
  async function refreshUser() {
    const d = await api('/api/auth/verify');
    user = d && d.authenticated ? d.user : null;
    if (user && user.billing && !user.billing.entitled) showPaywall(user.billing);
    if (user) {
      const pend = localStorage.getItem('lf_pending_plan');
      if (pend && user.billing && user.billing.reason !== 'lifetime') { localStorage.removeItem('lf_pending_plan'); startPlan(pend); }
    }
    return user;
  }
  document.addEventListener('DOMContentLoaded', async () => {
    try { info = await (await origFetch('/api/billing/info')).json(); } catch (_) { info = null; }
    document.querySelectorAll('[data-lf-plan]').forEach((b) => {
      const plan = b.getAttribute('data-lf-plan');
      if (info && info[plan] && !info[plan].available) { b.disabled = true; b.textContent = 'Em breve'; }
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); startPlan(plan, b); }, true);
    });
    document.querySelectorAll('[data-lf-trial]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); if (user) { const enter = $('lpEnterAppBtn'); if (enter) enter.click(); } else goSignup(); }));
    enhanceTutorial(); enhanceIntegrationsBar();
    const sm = $('settingsModal');
    if (sm) new MutationObserver(() => { if (!sm.classList.contains('hidden')) renderSettings(); }).observe(sm, { attributes: true, attributeFilter: ['class'] });
    const tm = $('tutorialModal');
    if (tm) new MutationObserver(() => { const a = document.querySelector('#blTutSupport [data-bl-support]'); if (a) a.href = supportUrl(); }).observe(tm, { attributes: true, attributeFilter: ['class'] });
    await refreshUser();
    // re-check after login/register
    const af = $('authForm'); if (af) af.addEventListener('submit', () => setTimeout(refreshUser, 1200));
  });
})();
