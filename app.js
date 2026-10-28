/**
 * LightFocus v2 — Foco Leve · Estrelinha da Miss Minutos
 * 100% SVGs (Zero Emojis), Proteção por Senha, Pulso Luminoso ao Concluir,
 * Sincronização Bidirecional Todoist + Estimativa de Tempo por Tarefa + Gamificação
 */
(function () {
  'use strict';

  const STORAGE_KEYS = {
    AUTH_TOKEN: 'lightfocus_auth_token',
    COMPLETED_TODAY: 'lightfocus_completed_today_v2',
    CURRENT_INDEX: 'lightfocus_current_idx_v2',
    ATTENTION_ENABLED: 'lightfocus_attention_5m_v2',
    LOFI_VOLUME: 'lightfocus_lofi_vol_v2',
    LOFI_STATION: 'lightfocus_lofi_station_v2',
    TASK_TIMES_LOCAL: 'lightfocus_task_times_cache_v2',
    ESTIMATES_LOCAL: 'lightfocus_estimates_cache_v2',
    GAMIFICATION: 'lightfocus_gamification_v2'
  };

  const SVG_ICONS = {
    check: '<svg class="ui-svg" width="14" height="14" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
    flame: '<svg class="ui-svg" width="15" height="15" viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    star: '<svg class="ui-svg" width="15" height="15" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    zap: '<svg class="ui-svg" width="15" height="15" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    award: '<svg class="ui-svg" width="15" height="15" viewBox="0 0 24 24"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>',
    clock: '<svg class="ui-svg" width="15" height="15" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
  };

  const BADGE_DEFS = [
    { id: 'first_check', name: 'Primeiro Pulso', desc: 'Concluiu a 1ª tarefa do dia', icon: SVG_ICONS.zap, check: (g, doneCount) => doneCount >= 1 },
    { id: 'combo_3', name: 'Fluxo Contínuo', desc: 'Sequência de 3 tarefas concluídas', icon: SVG_ICONS.flame, check: (g, doneCount) => g.streak >= 3 || doneCount >= 3 },
    { id: 'focus_25m', name: 'Imersão Pura', desc: '25+ minutos de foco cronometrado', icon: SVG_ICONS.clock, check: (g, doneCount, focusSec) => focusSec >= 1500 },
    { id: 'half_day', name: 'Meio Caminho Zen', desc: '50% da fila do Hoje concluída', icon: SVG_ICONS.star, check: (g, doneCount, focusSec, pct) => pct >= 50 },
    { id: 'master_day', name: 'Mestre do Tempo', desc: '100% da fila do Hoje concluída', icon: SVG_ICONS.award, check: (g, doneCount, focusSec, pct) => pct >= 100 }
  ];

  const FOCUS_LEVELS = [
    { minXp: 0, title: 'Nível 1 · Brisa Calma' },
    { minXp: 150, title: 'Nível 2 · Ritmo Fluido' },
    { minXp: 350, title: 'Nível 3 · Foco Solar' },
    { minXp: 650, title: 'Nível 4 · Guardião TVA' },
    { minXp: 1000, title: 'Nível 5 · Mestre do Tempo' }
  ];

  // Remove qualquer emoji nativo que venha nos textos do Todoist para manter 100% SVGs limpos
  function stripEmojis(str) {
    if (!str) return '';
    return String(str)
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatCleanDescription(raw) {
    const cleaned = stripEmojis(raw || '');
    if (!cleaned) return '';
    const lines = cleaned.split(/\r?\n/);
    return lines
      .map((line) => {
        let safe = escapeHtml(line.trim());
        if (!safe) return '<div style="height:6px"></div>';
        safe = safe.replace(
          /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
        );
        safe = safe.replace(
          /(^|\s)(https?:\/\/[^\s<]+)/g,
          '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>'
        );
        safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        if (/^#{1,3}\s+/.test(safe)) {
          return '<div style="font-weight:700;color:#0f172a;margin-top:6px;">' + safe.replace(/^#{1,3}\s+/, '') + '</div>';
        }
        return '<div>' + safe + '</div>';
      })
      .join('');
  }

  const state = {
    authToken: localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) || '',
    authenticated: false,
    tasks: [],
    currentIndex: 0,
    completedIds: new Set(),
    estimates: {},
    timerRunning: false,
    timerSeconds: 0,
    timerInterval: null,
    activeTaskStartedAt: null,
    attentionEnabled: true,
    attentionRemainingSec: 300,
    attentionInterval: null,
    lofiPlaying: false,
    lofiStationIdx: 0,
    lofiVolume: 0.35,
    audioCtx: null,
    lofiNodes: null,
    historyData: { tasks: {}, sessions: [] },
    gamification: { xp: 0, streak: 0, lastDate: '' },
    descExpanded: false
  };

  function getTodayKey() {
    return new Date().toLocaleDateString('sv-SE');
  }

  function authHeaders(extra) {
    const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    if (state.authToken) h['x-lightfocus-auth'] = state.authToken;
    return h;
  }

  async function apiFetch(url, options) {
    const opts = Object.assign({}, options || {});
    opts.headers = authHeaders(opts.headers);
    return fetch(url, opts);
  }

  function loadLocalState() {
    try {
      const savedCompleted = JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPLETED_TODAY) || '{}');
      const today = getTodayKey();
      if (savedCompleted.date === today && Array.isArray(savedCompleted.ids)) {
        state.completedIds = new Set(savedCompleted.ids);
      }
      const savedEst = JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES_LOCAL) || '{}');
      if (savedEst && typeof savedEst === 'object') state.estimates = savedEst;

      const savedGam = JSON.parse(localStorage.getItem(STORAGE_KEYS.GAMIFICATION) || '{}');
      if (savedGam && typeof savedGam === 'object') {
        state.gamification.xp = Number(savedGam.xp) || 0;
        state.gamification.streak = savedGam.lastDate === today ? (Number(savedGam.streak) || 0) : 0;
        state.gamification.lastDate = today;
      }
      const savedHistory = JSON.parse(localStorage.getItem(STORAGE_KEYS.TASK_TIMES_LOCAL) || '{}');
      if (savedHistory && savedHistory.tasks) state.historyData = savedHistory;
    } catch (_) {}
  }

  function saveLocalState() {
    try {
      const today = getTodayKey();
      localStorage.setItem(
        STORAGE_KEYS.COMPLETED_TODAY,
        JSON.stringify({ date: today, ids: Array.from(state.completedIds) })
      );
      localStorage.setItem(STORAGE_KEYS.ESTIMATES_LOCAL, JSON.stringify(state.estimates));
      localStorage.setItem(STORAGE_KEYS.GAMIFICATION, JSON.stringify(state.gamification));
    } catch (_) {}
  }

  // Sons Sintetizados Web Audio API (Suaves & Zen)
  function ensureAudioCtx() {
    if (!state.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) state.audioCtx = new AudioContext();
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
    return state.audioCtx;
  }

  function playZenCompleteSound() {
    try {
      const ctx = ensureAudioCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      [528, 660, 792, 1056].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.001, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.11, now + idx * 0.08 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.95);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 1.0);
      });
    } catch (_) {}
  }

  function playAttentionBell() {
    try {
      const ctx = ensureAudioCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      [432, 648].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.14);
        gain.gain.setValueAtTime(0.001, now + idx * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.09, now + idx * 0.14 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 1.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.14);
        osc.stop(now + idx * 0.14 + 1.45);
      });
    } catch (_) {}
  }

  // Pulso Luminoso Assinatura LightFocus a cada Check!
  function triggerCheckLightPulse() {
    const el = document.getElementById('lightfocus-check-pulse');
    if (!el) return;
    el.classList.remove('pulsing-check');
    void el.offsetWidth;
    el.classList.add('pulsing-check');
  }
  function formatDuration(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function formatMinutesHuman(min) {
    const m = Math.max(0, Math.round(min || 0));
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? (h + 'h ' + rem + 'm') : (h + 'h');
  }

  function getTaskEstimate(task) {
    if (!task) return 15;
    if (state.estimates[task.id] != null) return Number(state.estimates[task.id]) || 15;
    if (task.estimatedMinutes != null) return Number(task.estimatedMinutes) || 15;
    return 15;
  }

  async function setTaskEstimate(taskId, minutes) {
    const cleanMin = Math.max(1, Math.min(480, Math.round(Number(minutes) || 15)));
    state.estimates[taskId] = cleanMin;
    const t = state.tasks.find((x) => String(x.id) === String(taskId));
    if (t) t.estimatedMinutes = cleanMin;
    saveLocalState();
    renderCurrentTask();
    renderPlanningSummary();
    try {
      await apiFetch('/api/tasks/estimate', {
        method: 'POST',
        body: JSON.stringify({ taskId: String(taskId), estimatedMinutes: cleanMin })
      });
    } catch (_) {}
  }

  async function loadTasksFromServer(forceSync) {
    const syncIcon = document.getElementById('sync-icon');
    const syncText = document.getElementById('sync-text');
    if (syncIcon) syncIcon.classList.add('spinning');
    if (syncText) syncText.textContent = 'Sincronizando Todoist...';

    try {
      const endpoint = forceSync ? '/api/sync' : '/api/tasks';
      const res = await apiFetch(endpoint, { method: forceSync ? 'POST' : 'GET' });
      if (res.status === 401) {
        showAuthLock();
        return;
      }
      const data = await res.json();
      if (Array.isArray(data.tasks) && data.tasks.length > 0) {
        state.tasks = data.tasks.map((t, idx) => ({
          ...t,
          orderIndex: idx + 1,
          title: stripEmojis(t.title || t.content || 'Tarefa'),
          description: stripEmojis(t.description || ''),
          subtasks: Array.isArray(t.subtasks)
            ? t.subtasks.map((s) => ({ ...s, title: stripEmojis(s.title || s.content || '') }))
            : []
        }));
        state.tasks.forEach((t) => {
          if (t.completed) state.completedIds.add(String(t.id));
          if (t.estimatedMinutes) state.estimates[t.id] = t.estimatedMinutes;
        });
      }
      if (syncText) {
        syncText.textContent = data.liveSync ? 'Todoist Ao Vivo' : 'Todoist Sincronizado';
      }
    } catch (_) {
      if (Array.isArray(window.LIGHTFOCUS_TASKS_SEED) && state.tasks.length === 0) {
        state.tasks = window.LIGHTFOCUS_TASKS_SEED.map((t, idx) => ({
          ...t,
          orderIndex: idx + 1,
          title: stripEmojis(t.title || ''),
          description: stripEmojis(t.description || '')
        }));
      }
    } finally {
      if (syncIcon) syncIcon.classList.remove('spinning');
    }

    try {
      const hRes = await apiFetch('/api/history');
      if (hRes.ok) {
        const hData = await hRes.json();
        if (hData && hData.tasks) state.historyData = hData;
      }
    } catch (_) {}

    selectFirstPendingIfNeeded();
    renderAll();
  }

  function selectFirstPendingIfNeeded() {
    if (!state.tasks.length) return;
    if (state.currentIndex >= state.tasks.length) state.currentIndex = 0;
    const curr = state.tasks[state.currentIndex];
    if (curr && state.completedIds.has(String(curr.id))) {
      const nextIdx = state.tasks.findIndex((t) => !state.completedIds.has(String(t.id)));
      if (nextIdx !== -1) state.currentIndex = nextIdx;
    }
  }

  function getTotalFocusSecondsToday() {
    const today = getTodayKey();
    let sum = 0;
    const sessions = (state.historyData && state.historyData.sessions) || [];
    sessions.forEach((s) => {
      if (s.date === today) sum += Number(s.durationSeconds) || 0;
    });
    return sum + state.timerSeconds;
  }

  function renderGamification() {
    const total = state.tasks.length || 1;
    const doneCount = state.tasks.filter((t) => state.completedIds.has(String(t.id))).length;
    const pct = Math.min(100, Math.round((doneCount / total) * 100));
    const focusSec = getTotalFocusSecondsToday();

    const xp = state.gamification.xp || doneCount * 50 + Math.floor(focusSec / 60) * 5;
    state.gamification.xp = xp;

    let currentLevel = FOCUS_LEVELS[0];
    let nextLevel = FOCUS_LEVELS[1];
    for (let i = 0; i < FOCUS_LEVELS.length; i++) {
      if (xp >= FOCUS_LEVELS[i].minXp) {
        currentLevel = FOCUS_LEVELS[i];
        nextLevel = FOCUS_LEVELS[i + 1] || null;
      }
    }

    const lvlLabel = document.getElementById('gamification-level-label');
    const xpFill = document.getElementById('xp-mini-fill');
    const xpText = document.getElementById('gamification-xp-text');
    const streakText = document.getElementById('gamification-streak-text');

    if (lvlLabel) lvlLabel.textContent = currentLevel.title;
    if (xpText) xpText.textContent = xp + ' XP';
    if (streakText) streakText.textContent = Math.max(1, state.gamification.streak || doneCount) + 'x';
    if (xpFill) {
      if (!nextLevel) {
        xpFill.style.width = '100%';
      } else {
        const span = nextLevel.minXp - currentLevel.minXp;
        const prog = Math.min(100, Math.round(((xp - currentLevel.minXp) / span) * 100));
        xpFill.style.width = prog + '%';
      }
    }

    const mmDone = document.getElementById('mm-completed-count');
    const mmTotal = document.getElementById('mm-total-count');
    const mmFill = document.getElementById('mm-bar-fill');
    const mmPct = document.getElementById('mm-percent-badge');
    const mmSpeech = document.getElementById('mm-speech-bubble');
    const mmFocusTime = document.getElementById('mm-total-focus-time');

    if (mmDone) mmDone.textContent = String(doneCount);
    if (mmTotal) mmTotal.textContent = String(state.tasks.length);
    if (mmFill) mmFill.style.height = pct + '%';
    if (mmPct) mmPct.textContent = pct + '% do Hoje';
    if (mmFocusTime) mmFocusTime.textContent = formatMinutesHuman(Math.round(focusSec / 60));

    if (mmSpeech) {
      if (pct === 100 && state.tasks.length > 0) {
        mmSpeech.textContent = 'Linha do tempo 100% limpa, Walace! Todas as tarefas do Hoje concluídas.';
      } else if (state.timerRunning) {
        mmSpeech.textContent = 'Relógio rodando suave. Foco só nesta tarefa agora!';
      } else if (doneCount > 0) {
        mmSpeech.textContent = 'Excelente ritmo! Já concluímos ' + doneCount + ' de ' + state.tasks.length + ' tarefas hoje.';
      } else {
        mmSpeech.textContent = 'Respira fundo, Walace. Uma tarefa por vez, sem pressa!';
      }
    }

    // Renderiza insígnias SVG na barra lateral e no modal
    const sideRow = document.getElementById('sidebar-badges-row');
    const modalGrid = document.getElementById('achievements-modal-grid');
    if (sideRow) {
      sideRow.innerHTML = BADGE_DEFS.map((b) => {
        const unlocked = b.check(state.gamification, doneCount, focusSec, pct);
        return (
          '<div class="badge-icon-circle ' +
          (unlocked ? 'unlocked' : '') +
          '" title="' +
          escapeHtml(b.name + ': ' + b.desc) +
          '">' +
          b.icon +
          '</div>'
        );
      }).join('');
    }
    if (modalGrid) {
      modalGrid.innerHTML = BADGE_DEFS.map((b) => {
        const unlocked = b.check(state.gamification, doneCount, focusSec, pct);
        return (
          '<div class="ach-card ' +
          (unlocked ? 'unlocked' : '') +
          '">' +
          '<div class="badge-icon-circle ' +
          (unlocked ? 'unlocked' : '') +
          '">' +
          b.icon +
          '</div>' +
          '<div><div style="font-size:0.82rem;font-weight:700;">' +
          escapeHtml(b.name) +
          '</div><div style="font-size:0.72rem;color:#64748b;">' +
          escapeHtml(b.desc) +
          '</div></div></div>'
        );
      }).join('');
    }
  }

  function renderCurrentTask() {
    const card = document.getElementById('single-task-card');
    const celeb = document.getElementById('all-done-celebration');
    if (!state.tasks.length) return;

    const pendingCount = state.tasks.filter((t) => !state.completedIds.has(String(t.id))).length;
    if (pendingCount === 0) {
      if (card) card.style.display = 'none';
      if (celeb) celeb.style.display = 'flex';
      return;
    }
    if (card) card.style.display = 'flex';
    if (celeb) celeb.style.display = 'none';

    const task = state.tasks[state.currentIndex] || state.tasks[0];
    const isCompleted = state.completedIds.has(String(task.id));
    const estMin = getTaskEstimate(task);

    const orderText = document.getElementById('task-order-text');
    const recBadge = document.getElementById('task-recurring-badge');
    const recText = document.getElementById('task-recurring-text');
    const estText = document.getElementById('task-estimate-badge-text');
    const avgBadge = document.getElementById('task-avg-badge');
    const avgText = document.getElementById('task-avg-text');
    const titleEl = document.getElementById('task-title');
    const checkCircle = document.getElementById('btn-check-circle-main');
    const descWrapper = document.getElementById('task-description-wrapper');
    const descBox = document.getElementById('task-description-box');
    const expandBtn = document.getElementById('btn-toggle-desc-expand');

    if (orderText) orderText.textContent = '#' + (state.currentIndex + 1) + ' de ' + state.tasks.length + ' Hoje';
    if (recBadge) {
      if (task.isRecurring) {
        recBadge.style.display = 'inline-flex';
        if (recText) recText.textContent = stripEmojis(task.recurringString || 'Recorrente');
      } else {
        recBadge.style.display = 'none';
      }
    }
    if (estText) estText.textContent = 'Est: ' + estMin + 'm';

    const histEntry = state.historyData && state.historyData.tasks && state.historyData.tasks[task.title];
    if (avgBadge) {
      if (histEntry && histEntry.averageSeconds > 0) {
        avgBadge.style.display = 'inline-flex';
        if (avgText) avgText.textContent = 'Média: ' + formatMinutesHuman(Math.round(histEntry.averageSeconds / 60));
      } else {
        avgBadge.style.display = 'none';
      }
    }

    if (titleEl) titleEl.textContent = stripEmojis(task.title);
    if (checkCircle) {
      checkCircle.classList.toggle('checked', isCompleted);
    }

    // Descrição formatada limpa sem cortar bordas no celular
    const cleanDesc = formatCleanDescription(task.description || '');
    if (descWrapper && descBox) {
      if (cleanDesc) {
        descWrapper.style.display = 'flex';
        descBox.innerHTML = cleanDesc;
        descBox.classList.toggle('expanded', state.descExpanded);
        if (expandBtn) {
          const isLong = (task.description || '').length > 180 || (task.description || '').split('\n').length > 4;
          expandBtn.style.display = isLong ? 'inline-flex' : 'none';
          const expTxt = document.getElementById('desc-expand-text');
          if (expTxt) expTxt.textContent = state.descExpanded ? 'Recolher detalhes' : 'Expandir detalhes';
        }
      } else {
        descWrapper.style.display = 'none';
      }
    }

    // Subtarefas
    const subBox = document.getElementById('subtasks-box');
    const subList = document.getElementById('subtasks-list');
    const subCount = document.getElementById('subtasks-counter');
    if (subBox && subList) {
      const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
      if (subs.length > 0) {
        subBox.style.display = 'block';
        const doneSubs = subs.filter((s) => s.completed).length;
        if (subCount) subCount.textContent = doneSubs + '/' + subs.length;
        subList.innerHTML = subs
          .map(
            (s) =>
              '<div class="subtask-item ' +
              (s.completed ? 'done' : '') +
              '">' +
              SVG_ICONS.check +
              '<span>' +
              escapeHtml(stripEmojis(s.title)) +
              '</span></div>'
          )
          .join('');
      } else {
        subBox.style.display = 'none';
      }
    }

    const prevBtn = document.getElementById('btn-prev-task');
    const nextBtn = document.getElementById('btn-next-task');
    if (prevBtn) prevBtn.disabled = state.currentIndex <= 0;
    if (nextBtn) nextBtn.disabled = state.currentIndex >= state.tasks.length - 1;

    updateTimerUI();
  }
  function updateTimerUI() {
    const digits = document.getElementById('timer-digits');
    const pill = document.getElementById('timer-status-pill');
    const fill = document.getElementById('timer-progress-fill');
    const btnPlay = document.getElementById('btn-play-timer');
    const btnLabel = document.getElementById('play-btn-label');
    const btnSub = document.getElementById('play-btn-sub');
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    const card = document.getElementById('single-task-card');

    if (digits) {
      digits.textContent = formatDuration(state.timerSeconds);
      digits.classList.toggle('running', state.timerRunning);
    }
    if (pill) {
      pill.textContent = state.timerRunning ? 'Em foco leve...' : 'Pronto para iniciar';
      pill.classList.toggle('running', state.timerRunning);
    }
    if (btnPlay) btnPlay.classList.toggle('is-running', state.timerRunning);
    if (btnLabel) btnLabel.textContent = state.timerRunning ? 'Pausar Tempo' : 'Iniciar Foco';
    if (btnSub) btnSub.textContent = state.timerRunning ? 'Cronômetro ativo' : 'Dar Play na tarefa';
    if (iconPlay) iconPlay.style.display = state.timerRunning ? 'none' : 'inline-block';
    if (iconPause) iconPause.style.display = state.timerRunning ? 'inline-block' : 'none';
    if (card) card.classList.toggle('timer-running', state.timerRunning);

    const task = state.tasks[state.currentIndex];
    const estSec = getTaskEstimate(task) * 60;
    if (fill) {
      const pct = Math.min(100, Math.round((state.timerSeconds / Math.max(60, estSec)) * 100));
      fill.style.width = pct + '%';
    }
  }

  function toggleTimer() {
    ensureAudioCtx();
    if (state.timerRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  }

  function startTimer() {
    if (state.timerRunning) return;
    state.timerRunning = true;
    if (!state.activeTaskStartedAt) state.activeTaskStartedAt = new Date().toISOString();
    state.timerInterval = setInterval(() => {
      state.timerSeconds += 1;
      updateTimerUI();
      if (state.timerSeconds % 15 === 0) renderGamification();
    }, 1000);
    updateTimerUI();
    renderGamification();
  }

  function pauseTimer() {
    state.timerRunning = false;
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    updateTimerUI();
    renderGamification();
  }

  async function completeTaskById(taskId, fromMainCard) {
    const task = state.tasks.find((t) => String(t.id) === String(taskId));
    if (!task) return;

    const alreadyDone = state.completedIds.has(String(task.id));
    if (alreadyDone && !fromMainCard) {
      // Desmarcar e reabrir no Todoist
      state.completedIds.delete(String(task.id));
      task.completed = false;
      saveLocalState();
      renderAll();
      try {
        await apiFetch('/api/tasks/uncomplete', {
          method: 'POST',
          body: JSON.stringify({ taskId: String(task.id) })
        });
      } catch (_) {}
      return;
    }

    // Dispara o pulso luminoso assinatura do LightFocus e som zen!
    triggerCheckLightPulse();
    playZenCompleteSound();

    const elapsed = fromMainCard ? Math.max(1, state.timerSeconds) : getTaskEstimate(task) * 60;
    pauseTimer();

    state.completedIds.add(String(task.id));
    task.completed = true;
    state.gamification.xp = (state.gamification.xp || 0) + 60;
    state.gamification.streak = (state.gamification.streak || 0) + 1;
    state.gamification.lastDate = getTodayKey();
    saveLocalState();

    // Sincronização bidirecional real com o Todoist + registro de tempo
    apiFetch('/api/tasks/complete', {
      method: 'POST',
      body: JSON.stringify({ taskId: String(task.id), taskTitle: task.title })
    }).catch(() => {});

    apiFetch('/api/log-time', {
      method: 'POST',
      body: JSON.stringify({
        taskId: String(task.id),
        taskTitle: task.title,
        durationSeconds: elapsed,
        startedAt: state.activeTaskStartedAt || new Date().toISOString(),
        completedAt: new Date().toISOString()
      })
    }).catch(() => {});

    state.timerSeconds = 0;
    state.activeTaskStartedAt = null;
    state.descExpanded = false;

    if (fromMainCard) {
      const card = document.getElementById('single-task-card');
      if (card) card.classList.add('task-completing-float-up');
      setTimeout(() => {
        if (card) {
          card.classList.remove('task-completing-float-up');
          card.classList.add('task-entering-zen');
          setTimeout(() => card.classList.remove('task-entering-zen'), 550);
        }
        selectFirstPendingIfNeeded();
        renderAll();
      }, 680);
    } else {
      selectFirstPendingIfNeeded();
      renderAll();
    }
  }

  function renderPlanningSummary() {
    const pending = state.tasks.filter((t) => !state.completedIds.has(String(t.id)));
    const totalMin = pending.reduce((acc, t) => acc + getTaskEstimate(t), 0);
    const etaDate = new Date(Date.now() + totalMin * 60000);
    const etaStr =
      String(etaDate.getHours()).padStart(2, '0') + ':' + String(etaDate.getMinutes()).padStart(2, '0');

    const elTasks = document.getElementById('plan-stat-tasks');
    const elMin = document.getElementById('plan-stat-minutes');
    const elEta = document.getElementById('plan-stat-eta');
    if (elTasks) elTasks.textContent = String(pending.length);
    if (elMin) elMin.textContent = formatMinutesHuman(totalMin);
    if (elEta) elEta.textContent = pending.length > 0 ? etaStr : 'Concluído';
  }

  function renderQueueDrawer() {
    renderPlanningSummary();
    const container = document.getElementById('queue-list-container');
    if (!container) return;

    container.innerHTML = state.tasks
      .map((t, idx) => {
        const done = state.completedIds.has(String(t.id));
        const isCurrent = idx === state.currentIndex && !done;
        const est = getTaskEstimate(t);
        return (
          '<div class="queue-item-v2 ' +
          (isCurrent ? 'active-current ' : '') +
          (done ? 'completed-row' : '') +
          '" data-idx="' +
          idx +
          '">' +
          '<div class="queue-left">' +
          '<button class="queue-check-btn ' +
          (done ? 'checked' : '') +
          '" data-check-id="' +
          escapeHtml(t.id) +
          '" title="Concluir ou reabrir no Todoist">' +
          SVG_ICONS.check +
          '</button>' +
          '<div class="queue-title-wrap" data-select-idx="' +
          idx +
          '">' +
          '<div class="queue-title-text">#' +
          (idx + 1) +
          ' · ' +
          escapeHtml(stripEmojis(t.title)) +
          '</div>' +
          '</div></div>' +
          '<div class="queue-right-est">' +
          '<input type="number" min="1" max="480" class="queue-est-input" data-est-id="' +
          escapeHtml(t.id) +
          '" value="' +
          est +
          '" title="Minutos estimados" />' +
          '<span class="queue-est-unit">min</span>' +
          '</div></div>'
        );
      })
      .join('');

    container.querySelectorAll('[data-check-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-check-id');
        completeTaskById(id, false);
      });
    });

    container.querySelectorAll('[data-select-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number(el.getAttribute('data-select-idx'));
        if (!Number.isNaN(idx)) {
          pauseTimer();
          state.currentIndex = idx;
          state.timerSeconds = 0;
          state.descExpanded = false;
          renderAll();
          const modal = document.getElementById('modal-queue');
          if (modal) modal.style.display = 'none';
        }
      });
    });

    container.querySelectorAll('[data-est-id]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const id = inp.getAttribute('data-est-id');
        setTaskEstimate(id, inp.value);
      });
    });
  }

  function renderHistoryModal() {
    const container = document.getElementById('history-content-container');
    if (!container) return;
    const tasksMap = (state.historyData && state.historyData.tasks) || {};
    const entries = Object.values(tasksMap);
    if (entries.length === 0) {
      container.innerHTML =
        '<div style="padding:18px;text-align:center;color:#64748b;font-size:0.85rem;">Nenhuma tarefa cronometrada concluída ainda hoje.</div>';
      return;
    }
    container.innerHTML = entries
      .map(
        (item) =>
          '<div class="queue-item-v2">' +
          '<div class="queue-title-text">' +
          escapeHtml(stripEmojis(item.taskTitle || 'Tarefa')) +
          '</div>' +
          '<div style="font-family:var(--font-mono);font-size:0.78rem;font-weight:700;color:#0369a1;">' +
          'Média: ' +
          formatMinutesHuman(Math.round((item.averageSeconds || 0) / 60)) +
          ' (' +
          (item.completionsCount || 1) +
          'x)</div></div>'
      )
      .join('');
  }

  function renderAll() {
    renderCurrentTask();
    renderGamification();
    renderQueueDrawer();
  }

  // Modo Presta Atenção (5 min)
  function startAttentionLoop() {
    if (state.attentionInterval) clearInterval(state.attentionInterval);
    state.attentionInterval = setInterval(() => {
      if (!state.attentionEnabled) return;
      state.attentionRemainingSec -= 1;
      if (state.attentionRemainingSec <= 0) {
        triggerAttentionPulse();
        state.attentionRemainingSec = 300;
      }
      const tag = document.getElementById('attention-countdown');
      if (tag) tag.textContent = formatDuration(state.attentionRemainingSec);
    }, 1000);
  }

  function triggerAttentionPulse() {
    playAttentionBell();
    const overlay = document.getElementById('attention-light-overlay');
    const toast = document.getElementById('attention-toast');
    if (overlay) {
      overlay.classList.remove('pulsing');
      void overlay.offsetWidth;
      overlay.classList.add('pulsing');
    }
    if (toast) {
      toast.classList.add('visible');
      setTimeout(() => toast.classList.remove('visible'), 5200);
    }
  }

  // Lo-Fi Ambient Synth
  const LOFI_STATIONS = [
    { name: 'Chuva Suave & Rhodes Zen', baseFreq: 220 },
    { name: 'Brisa Celeste 432Hz', baseFreq: 216 },
    { name: 'Noite Calma na TVA', baseFreq: 196 }
  ];

  function toggleLofi() {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    if (state.lofiPlaying) {
      stopLofi();
    } else {
      startLofi();
    }
  }

  function startLofi() {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    stopLofi();
    const st = LOFI_STATIONS[state.lofiStationIdx % LOFI_STATIONS.length];
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.value = st.baseFreq;
    osc2.frequency.value = st.baseFreq * 1.5;
    gain.gain.value = state.lofiVolume * 0.08;
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start();
    osc2.start();
    state.lofiNodes = { osc1, osc2, gain };
    state.lofiPlaying = true;
    updateLofiUI();
  }

  function stopLofi() {
    if (state.lofiNodes) {
      try {
        state.lofiNodes.osc1.stop();
        state.lofiNodes.osc2.stop();
      } catch (_) {}
      state.lofiNodes = null;
    }
    state.lofiPlaying = false;
    updateLofiUI();
  }

  function updateLofiUI() {
    const st = LOFI_STATIONS[state.lofiStationIdx % LOFI_STATIONS.length];
    const nameEl = document.getElementById('lofi-station-name');
    const playIcon = document.getElementById('lofi-icon-play');
    const pauseIcon = document.getElementById('lofi-icon-pause');
    if (nameEl) nameEl.textContent = st.name;
    if (playIcon) playIcon.style.display = state.lofiPlaying ? 'none' : 'inline-block';
    if (pauseIcon) pauseIcon.style.display = state.lofiPlaying ? 'inline-block' : 'none';
  }

  // Olhinhos da Miss Minutos seguindo o cursor
  function setupEyeTracking() {
    document.addEventListener('mousemove', (e) => {
      const pairs = [
        ['mm-pupil-left', 'mm-pupil-right', 'mm-shine-left', 'mm-shine-right'],
        ['splash-pupil-left', 'splash-pupil-right', null, null]
      ];
      pairs.forEach(([lId, rId, slId, srId]) => {
        const l = document.getElementById(lId);
        const r = document.getElementById(rId);
        if (!l || !r) return;
        const rect = l.getBoundingClientRect();
        if (!rect.width) return;
        const dx = (e.clientX - rect.left) / window.innerWidth;
        const dy = (e.clientY - rect.top) / window.innerHeight;
        const ox = Math.max(-3.5, Math.min(3.5, dx * 7));
        const oy = Math.max(-3.5, Math.min(3.5, dy * 7));
        l.setAttribute('transform', 'translate(' + ox.toFixed(1) + ',' + oy.toFixed(1) + ')');
        r.setAttribute('transform', 'translate(' + ox.toFixed(1) + ',' + oy.toFixed(1) + ')');
        if (slId && srId) {
          const sl = document.getElementById(slId);
          const sr = document.getElementById(srId);
          if (sl) sl.setAttribute('transform', 'translate(' + ox.toFixed(1) + ',' + oy.toFixed(1) + ')');
          if (sr) sr.setAttribute('transform', 'translate(' + ox.toFixed(1) + ',' + oy.toFixed(1) + ')');
        }
      });
    });
  }

  function showAuthLock() {
    const splash = document.getElementById('splash-screen');
    const form = document.getElementById('auth-gate-form');
    const unlocked = document.getElementById('auth-unlocked-box');
    if (splash) splash.classList.remove('hidden');
    if (form) form.style.display = 'flex';
    if (unlocked) unlocked.style.display = 'none';
  }

  async function checkInitialAuth() {
    try {
      const res = await apiFetch('/api/auth/verify');
      const data = await res.json();
      if (data && data.authenticated) {
        state.authenticated = true;
        const form = document.getElementById('auth-gate-form');
        const unlocked = document.getElementById('auth-unlocked-box');
        if (form) form.style.display = 'none';
        if (unlocked) unlocked.style.display = 'block';
        await loadTasksFromServer(false);
        return;
      }
    } catch (_) {}
    showAuthLock();
  }

  function bindEvents() {
    const authForm = document.getElementById('auth-gate-form');
    if (authForm) {
      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const inp = document.getElementById('auth-password-input');
        const err = document.getElementById('auth-error-msg');
        const password = inp ? inp.value : '';
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
          });
          const data = await res.json();
          if (res.ok && data.ok) {
            state.authToken = data.token;
            state.authenticated = true;
            localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token);
            if (err) err.style.display = 'none';
            const splash = document.getElementById('splash-screen');
            if (splash) splash.classList.add('hidden');
            ensureAudioCtx();
            await loadTasksFromServer(false);
          } else {
            if (err) err.style.display = 'block';
          }
        } catch (_) {
          if (err) err.style.display = 'block';
        }
      });
    }

    const startBtn = document.getElementById('splash-start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        ensureAudioCtx();
        const splash = document.getElementById('splash-screen');
        if (splash) splash.classList.add('hidden');
      });
    }

    const lockBtn = document.getElementById('btn-logout-lock');
    if (lockBtn) {
      lockBtn.addEventListener('click', async () => {
        pauseTimer();
        await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
        state.authToken = '';
        state.authenticated = false;
        showAuthLock();
      });
    }

    const playBtn = document.getElementById('btn-play-timer');
    if (playBtn) playBtn.addEventListener('click', toggleTimer);

    const compBtn = document.getElementById('btn-complete-task');
    if (compBtn) {
      compBtn.addEventListener('click', () => {
        const t = state.tasks[state.currentIndex];
        if (t) completeTaskById(t.id, true);
      });
    }

    const mainCheck = document.getElementById('btn-check-circle-main');
    if (mainCheck) {
      mainCheck.addEventListener('click', () => {
        const t = state.tasks[state.currentIndex];
        if (t) completeTaskById(t.id, true);
      });
    }

    const prevBtn = document.getElementById('btn-prev-task');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (state.currentIndex > 0) {
          pauseTimer();
          state.currentIndex -= 1;
          state.timerSeconds = 0;
          state.descExpanded = false;
          renderAll();
        }
      });
    }

    const nextBtn = document.getElementById('btn-next-task');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (state.currentIndex < state.tasks.length - 1) {
          pauseTimer();
          state.currentIndex += 1;
          state.timerSeconds = 0;
          state.descExpanded = false;
          renderAll();
        }
      });
    }

    const expandBtn = document.getElementById('btn-toggle-desc-expand');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        state.descExpanded = !state.descExpanded;
        renderCurrentTask();
      });
    }

    // Estimador inline no card
    const estBadge = document.getElementById('task-estimate-badge');
    const inlineEst = document.getElementById('card-inline-estimator');
    if (estBadge && inlineEst) {
      estBadge.addEventListener('click', () => {
        inlineEst.style.display = inlineEst.style.display === 'none' ? 'flex' : 'none';
      });
    }
    document.querySelectorAll('.est-pill-btn[data-est-min]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = state.tasks[state.currentIndex];
        if (!t) return;
        setTaskEstimate(t.id, btn.getAttribute('data-est-min'));
        if (inlineEst) inlineEst.style.display = 'none';
      });
    });
    const customEstInp = document.getElementById('card-custom-est-input');
    if (customEstInp) {
      customEstInp.addEventListener('change', () => {
        const t = state.tasks[state.currentIndex];
        if (!t) return;
        setTaskEstimate(t.id, customEstInp.value);
      });
    }

    // Sincronização manual Todoist
    const syncBadge = document.getElementById('todoist-sync-badge');
    const syncDrawerBtn = document.getElementById('btn-sync-drawer-top');
    if (syncBadge) syncBadge.addEventListener('click', () => loadTasksFromServer(true));
    if (syncDrawerBtn) syncDrawerBtn.addEventListener('click', () => loadTasksFromServer(true));

    // Modais
    const openQueue = document.getElementById('btn-open-queue');
    const closeQueue = document.getElementById('close-queue-modal');
    const modalQueue = document.getElementById('modal-queue');
    if (openQueue && modalQueue) {
      openQueue.addEventListener('click', () => {
        renderQueueDrawer();
        modalQueue.style.display = 'flex';
      });
    }
    if (closeQueue && modalQueue) closeQueue.addEventListener('click', () => (modalQueue.style.display = 'none'));

    const openHist = document.getElementById('btn-open-history');
    const closeHist = document.getElementById('close-history-modal');
    const modalHist = document.getElementById('modal-history');
    if (openHist && modalHist) {
      openHist.addEventListener('click', () => {
        renderHistoryModal();
        modalHist.style.display = 'flex';
      });
    }
    if (closeHist && modalHist) closeHist.addEventListener('click', () => (modalHist.style.display = 'none'));

    const openAch = document.getElementById('btn-open-achievements');
    const closeAch = document.getElementById('close-achievements-modal');
    const modalAch = document.getElementById('modal-achievements');
    if (openAch && modalAch) {
      openAch.addEventListener('click', () => {
        renderGamification();
        modalAch.style.display = 'flex';
      });
    }
    if (closeAch && modalAch) closeAch.addEventListener('click', () => (modalAch.style.display = 'none'));

    // Modo Presta Atenção
    const attBtn = document.getElementById('btn-attention-toggle');
    if (attBtn) {
      attBtn.addEventListener('click', () => {
        state.attentionEnabled = !state.attentionEnabled;
        attBtn.classList.toggle('active-mode', state.attentionEnabled);
        attBtn.setAttribute('aria-pressed', String(state.attentionEnabled));
      });
    }

    // Lo-Fi
    const lofiToggle = document.getElementById('lofi-toggle-btn');
    const lofiPrev = document.getElementById('lofi-prev-station');
    const lofiNext = document.getElementById('lofi-next-station');
    const lofiVol = document.getElementById('lofi-volume');
    if (lofiToggle) lofiToggle.addEventListener('click', toggleLofi);
    if (lofiPrev) {
      lofiPrev.addEventListener('click', () => {
        state.lofiStationIdx = (state.lofiStationIdx + LOFI_STATIONS.length - 1) % LOFI_STATIONS.length;
        if (state.lofiPlaying) startLofi();
        else updateLofiUI();
      });
    }
    if (lofiNext) {
      lofiNext.addEventListener('click', () => {
        state.lofiStationIdx = (state.lofiStationIdx + 1) % LOFI_STATIONS.length;
        if (state.lofiPlaying) startLofi();
        else updateLofiUI();
      });
    }
    if (lofiVol) {
      lofiVol.addEventListener('input', () => {
        state.lofiVolume = Number(lofiVol.value) / 100;
        if (state.lofiNodes && state.lofiNodes.gain) {
          state.lofiNodes.gain.gain.value = state.lofiVolume * 0.08;
        }
      });
    }

    // Atalhos de Teclado
    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target && e.target.tagName) || '')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggleTimer();
      } else if (e.code === 'Enter') {
        e.preventDefault();
        const t = state.tasks[state.currentIndex];
        if (t) completeTaskById(t.id, true);
      } else if (e.code === 'KeyA') {
        triggerAttentionPulse();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadLocalState();
    bindEvents();
    setupEyeTracking();
    startAttentionLoop();
    updateLofiUI();
    checkInitialAuth();
  });
})();
