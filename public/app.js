/* ==========================================================================
   LightFocus — estrelando Miss Minutos (app.js)
   - Tarefa única no centro + animação de dissolução/nuvem subindo ao concluir
   - Sincronização em tempo real com Todoist (ordem exata do Hoje / day_order)
   - Barra lateral gamificada (Vermelho -> Amarelo -> Azul) com olhinhos seguindo o mouse
   - Modo "Presta Atenção" (a cada 5 min quando Play ativo: Luminoso, Sonoro ou Ambos)
   - Player Lo-Fi no cantinho (Web Audio Chillhop Sintetizado + Streams Reais)
   - Log de tempo real por tarefa sincronizado para a Miss Minutos (5h30)
   ========================================================================== */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    TIMES: 'lightfocus_times_v1',
    COMPLETED_IDS: 'lightfocus_completed_ids_v1',
    SUBTASKS_DONE: 'lightfocus_subtasks_done_v1',
    ATTENTION_MODE: 'lightfocus_attention_mode_v1',
    ATTENTION_INTERVAL: 'lightfocus_attention_interval_v1',
    TODOIST_TOKEN: 'lightfocus_todoist_token_v1',
    LOFI_VOLUME: 'lightfocus_lofi_volume_v1'
  };

  const state = {
    tasks: [],
    currentIndex: 0,
    completedIds: new Set(),
    subtasksDone: {},
    timerRunning: false,
    timerSeconds: 0,
    timerStartedAt: null,
    timerIntervalId: null,
    attentionMode: localStorage.getItem(STORAGE_KEYS.ATTENTION_MODE) || 'both',
    attentionIntervalSec: Number(localStorage.getItem(STORAGE_KEYS.ATTENTION_INTERVAL) || 300),
    attentionElapsedSec: 0,
    todoistToken: localStorage.getItem(STORAGE_KEYS.TODOIST_TOKEN) || '',
    timesData: {
      app: 'LightFocus',
      owner: 'Walace Messias',
      agent: 'Miss Minutos · Adm do Tempo',
      timezone: 'America/Sao_Paulo',
      sessions: [],
      taskAverages: {},
      dailySummary: {}
    },
    audioCtx: null,
    lofi: {
      playing: false,
      stationIndex: 0,
      volume: Number(localStorage.getItem(STORAGE_KEYS.LOFI_VOLUME) ?? 45) / 100,
      audioEl: null,
      synthTimer: null,
      noiseNode: null,
      masterGain: null,
      chordStep: 0
    }
  };

  const LOFI_STATIONS = [
    {
      name: 'Lo-Fi Yoga & Chillhop (Zen Synth)',
      sub: 'Acordes Rhodes & Vinil Suave · Zero Falha',
      type: 'synth'
    },
    {
      name: 'SomaFM · Groove Salad Chill',
      sub: 'Ambient / Downtempo Beats',
      type: 'stream',
      url: 'https://ice2.somafm.com/groovesalad-128-mp3'
    },
    {
      name: 'SomaFM · Drone Zone Zen',
      sub: 'Foco Profundo & Meditação',
      type: 'stream',
      url: 'https://ice2.somafm.com/dronezone-128-mp3'
    },
    {
      name: 'Nightride · ChillSynth FM',
      sub: 'Lo-Fi & Warm Synthwave',
      type: 'stream',
      url: 'https://stream.nightride.fm/chillsynth.mp3'
    }
  ];

  const MISS_MINUTOS_QUOTES = {
    startRed: [
      '“Oi, querido! Vamos começar pela primeira da fila? Dá um Play ou conclui direto se já tiver feito! 🧡”',
      '“Respira fundo igual num Yoga, Walace! Uma tarefa por vez e a gente chega no azul rapidinho! ⏰”'
    ],
    celebrateRed: [
      '“Boa, querido! Primeiro passo dado! Já estou subindo aqui na barra! 🧡”',
      '“Isso aí! Uma já foi pro espaço! Mantém esse ritmo gostoso! ✨”',
      '“Adorei ver essa tarefa subindo igual nuvem! Vamos pra próxima? ⏰”'
    ],
    celebrateYellow: [
      '“Olha a gente na faixa amarela, Walace! Já passamos de um terço do dia! ⚡🧡”',
      '“Que orgulho! Seu foco hoje está lindo de ver, querido! Continue assim! 🌟”',
      '“Mais uma concluída com leveza! Estamos quase chegando no céu azul! ✨”'
    ],
    celebrateBlue: [
      '“UAAAU! Faixa Azul Zen atingida! Você está voando hoje, Walace! 💙✨”',
      '“Impecável, querido! Estou radiante aqui no topo da barra vendo você zerar tudo! 🥳⏰”',
      '“Quase lá! Esse é o poder de focar em uma única coisa de cada vez! 💙🧡”'
    ],
    allDone: [
      '“ZEROU O HOJE, QUERIDO!! 🎉💙 100% concluído! Pode descansar em paz que amanhã às 5h30 eu te trago o balanço!”'
    ]
  };

  // ==========================================================================
  // Utilitários de Data, Formatação e Áudio Zen (Web Audio API)
  // ==========================================================================
  function getTodayStr() {
    const fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return fmt.format(new Date());
  }

  function formatMMSS(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function ensureAudioContext() {
    if (!state.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        state.audioCtx = new AudioContextClass();
      }
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      state.audioCtx.resume().catch(() => {});
    }
    return state.audioCtx;
  }

  // Som suave e orgânico ao concluir tarefa (acorde harpa/celesta zen)
  function playZenCompletionSound() {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Acorde Fmaj9 celestial (F4, A4, C5, E5, G5)
    const freqs = [349.23, 440.0, 523.25, 659.25, 783.99];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc2.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.065);
      osc2.frequency.setValueAtTime(freq * 2, now + i * 0.065);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1800, now);

      const start = now + i * 0.065;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.075 / (1 + i * 0.15), start + 0.045);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 2.2);

      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc2.start(start);
      osc.stop(start + 2.3);
      osc2.stop(start + 2.3);
    });
  }

  // Som suave de piano Rhodes/Felt para o Modo "Presta Atenção" (5 em 5 min)
  function playGentlePianoAttentionChord() {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Acorde Cmaj7 / Gmaj7 super macio e aveludado
    const notes = [261.63, 329.63, 392.0, 493.88, 587.33];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const subOsc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sine';
      subOsc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.09);
      subOsc.frequency.setValueAtTime(freq * 0.5, now + idx * 0.09);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1100, now);

      const t0 = now + idx * 0.09;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.06, t0 + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.4);

      osc.connect(filter);
      subOsc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t0);
      subOsc.start(t0);
      osc.stop(t0 + 3.5);
      subOsc.stop(t0 + 3.5);
    });
  }

  // ==========================================================================
  // Animação de Partículas / Nuvem Subindo ao Concluir Tarefa
  // ==========================================================================
  const particleCanvas = document.getElementById('particle-canvas');
  const pCtx = particleCanvas ? particleCanvas.getContext('2d') : null;
  let particles = [];
  let particleAnimId = null;

  function resizeParticleCanvas() {
    if (!particleCanvas) return;
    particleCanvas.width = window.innerWidth;
    particleCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeParticleCanvas);
  resizeParticleCanvas();

  function triggerTaskDissolveParticles(cardElement) {
    if (!particleCanvas || !pCtx || !cardElement) return;
    const rect = cardElement.getBoundingClientRect();
    const colors = [
      'rgba(56, 189, 248, 0.78)',
      'rgba(249, 115, 22, 0.72)',
      'rgba(250, 204, 21, 0.75)',
      'rgba(16, 185, 129, 0.72)',
      'rgba(255, 255, 255, 0.92)'
    ];

    for (let i = 0; i < 68; i++) {
      particles.push({
        x: rect.left + Math.random() * rect.width,
        y: rect.top + Math.random() * rect.height,
        vx: (Math.random() - 0.5) * 1.8,
        vy: -(1.6 + Math.random() * 3.4),
        radius: 4 + Math.random() * 14,
        alpha: 0.85 + Math.random() * 0.15,
        decay: 0.008 + Math.random() * 0.011,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }

    if (!particleAnimId) {
      animateParticles();
    }
  }

  function animateParticles() {
    if (!pCtx || !particleCanvas) return;
    pCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx + Math.sin(p.y * 0.03) * 0.5;
      p.y += p.vy;
      p.radius *= 1.004;
      p.alpha -= p.decay;

      if (p.alpha <= 0.01) {
        particles.splice(i, 1);
        continue;
      }

      pCtx.save();
      pCtx.globalAlpha = Math.max(0, p.alpha);
      pCtx.beginPath();
      pCtx.fillStyle = p.color;
      pCtx.shadowColor = p.color;
      pCtx.shadowBlur = 12;
      pCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      pCtx.fill();
      pCtx.restore();
    }

    if (particles.length > 0) {
      particleAnimId = requestAnimationFrame(animateParticles);
    } else {
      pCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
      particleAnimId = null;
    }
  }

  // ==========================================================================
  // Olhinhos da Miss Minutos Seguindo o Cursor do Mouse (mousemove)
  // ==========================================================================
  function setupEyeTracking() {
    const sockets = document.querySelectorAll('.mm-eye-socket');
    if (!sockets.length) return;

    window.addEventListener('mousemove', (e) => {
      const mouseX = e.clientX;
      const mouseY = e.clientY;

      sockets.forEach((socket) => {
        const pupilGroup = socket.querySelector('.mm-pupil-group');
        const svg = socket.ownerSVGElement;
        if (!pupilGroup || !svg) return;

        const rect = socket.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        const eyeCenterX = rect.left + rect.width / 2;
        const eyeCenterY = rect.top + rect.height / 2;

        const dx = mouseX - eyeCenterX;
        const dy = mouseY - eyeCenterY;
        const angle = Math.atan2(dy, dx);
        const dist = Math.min(5.2, Math.hypot(dx, dy) / 36);

        const offsetX = Math.cos(angle) * dist;
        const offsetY = Math.sin(angle) * dist;

        pupilGroup.style.transform = `translate(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px)`;
      });
    });
  }

  // ==========================================================================
  // Carregamento e Sincronização das Tarefas (Ordem Exata do Hoje)
  // ==========================================================================
  function loadLocalStorageState() {
    try {
      const savedCompleted = JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPLETED_IDS) || '[]');
      if (Array.isArray(savedCompleted)) {
        state.completedIds = new Set(savedCompleted.map(String));
      }
    } catch (e) {}

    try {
      const savedSub = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBTASKS_DONE) || '{}');
      if (savedSub && typeof savedSub === 'object') {
        state.subtasksDone = savedSub;
      }
    } catch (e) {}

    try {
      const savedTimes = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMES) || 'null');
      if (savedTimes && Array.isArray(savedTimes.sessions)) {
        state.timesData = savedTimes;
      }
    } catch (e) {}
  }

  function saveCompletedToStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.COMPLETED_IDS, JSON.stringify(Array.from(state.completedIds)));
      localStorage.setItem(STORAGE_KEYS.SUBTASKS_DONE, JSON.stringify(state.subtasksDone));
    } catch (e) {}
  }

  function recomputeLocalTimesAggregates() {
    const sessions = Array.isArray(state.timesData.sessions) ? state.timesData.sessions : [];
    const taskMap = {};
    const dailyMap = {};

    sessions.forEach((s) => {
      const key = s.taskId || s.content || 'unknown';
      if (!taskMap[key]) {
        taskMap[key] = {
          taskId: s.taskId || null,
          content: s.content || 'Tarefa',
          totalSessions: 0,
          timedSessions: 0,
          completedWithoutTimerCount: 0,
          totalSeconds: 0,
          averageSeconds: 0,
          averageMinutes: 0
        };
      }
      const entry = taskMap[key];
      entry.totalSessions += 1;
      const dur = Math.max(0, Number(s.durationSeconds || 0));
      if (s.completedWithoutTimer || dur === 0) {
        entry.completedWithoutTimerCount += 1;
      } else {
        entry.timedSessions += 1;
        entry.totalSeconds += dur;
      }

      const dKey = s.date || getTodayStr();
      if (!dailyMap[dKey]) {
        dailyMap[dKey] = {
          date: dKey,
          completedTasksCount: 0,
          timedTasksCount: 0,
          quickCompletedCount: 0,
          totalFocusedSeconds: 0,
          totalFocusedMinutes: 0
        };
      }
      const day = dailyMap[dKey];
      day.completedTasksCount += 1;
      if (s.completedWithoutTimer || dur === 0) {
        day.quickCompletedCount += 1;
      } else {
        day.timedTasksCount += 1;
        day.totalFocusedSeconds += dur;
      }
      day.totalFocusedMinutes = Number((day.totalFocusedSeconds / 60).toFixed(1));
    });

    Object.keys(taskMap).forEach((k) => {
      const t = taskMap[k];
      if (t.timedSessions > 0) {
        t.averageSeconds = Math.round(t.totalSeconds / t.timedSessions);
        t.averageMinutes = Number((t.averageSeconds / 60).toFixed(1));
      }
    });

    state.timesData.taskAverages = taskMap;
    state.timesData.dailySummary = dailyMap;
    state.timesData.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEYS.TIMES, JSON.stringify(state.timesData));
    } catch (e) {}
  }

  function applySnapshotTasks(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.tasks)) return;
    const tasks = snapshot.tasks.slice().sort((a, b) => {
      const oA = Number(a.dayOrder ?? 9999);
      const oB = Number(b.dayOrder ?? 9999);
      return oA - oB;
    });

    tasks.forEach((t) => {
      if (t.checked) {
        state.completedIds.add(String(t.id));
      }
    });

    state.tasks = tasks;
    // Posiciona na primeira tarefa ainda não concluída
    const firstPendingIdx = state.tasks.findIndex((t) => !state.completedIds.has(String(t.id)));
    state.currentIndex = firstPendingIdx >= 0 ? firstPendingIdx : 0;

    renderCurrentTask(false);
    updateMissMinutosSidebar(false);
    updateHeaderStats();
  }

  async function initTasksAndTimes() {
    loadLocalStorageState();

    // 1. Carrega snapshot inicial embutido (tasks-seed.js)
    if (window.LIGHTFOCUS_INITIAL_SNAPSHOT) {
      applySnapshotTasks(window.LIGHTFOCUS_INITIAL_SNAPSHOT);
    }

    // 2. Se o servidor local Node estiver ativo, sincroniza estado e tempos
    try {
      const [tasksRes, timesRes] = await Promise.all([
        fetch('/api/tasks', { headers: state.todoistToken ? { 'X-Todoist-Token': state.todoistToken } : {} }),
        fetch('/api/times')
      ]);
      if (tasksRes.ok) {
        const tJson = await tasksRes.json();
        if (tJson && tJson.snapshot) {
          applySnapshotTasks(tJson.snapshot);
        }
      }
      if (timesRes.ok) {
        const tmJson = await timesRes.json();
        if (tmJson && tmJson.data && Array.isArray(tmJson.data.sessions)) {
          // Mescla sessões locais com as do servidor
          const serverSessions = tmJson.data.sessions;
          const localSessions = state.timesData.sessions || [];
          const byId = new Map();
          serverSessions.forEach((s) => byId.set(s.sessionId || `${s.taskId}_${s.endedAt}`, s));
          localSessions.forEach((s) => byId.set(s.sessionId || `${s.taskId}_${s.endedAt}`, s));
          state.timesData.sessions = Array.from(byId.values());
          recomputeLocalTimesAggregates();
          updateHeaderStats();
        }
      }
    } catch (err) {
      // Rodando em modo estático (GitHub Pages): se o usuário tiver colado token Todoist, sincroniza direto
      if (state.todoistToken) {
        syncDirectlyWithTodoistBrowser(state.todoistToken).catch(() => {});
      }
    }
  }

  async function syncDirectlyWithTodoistBrowser(token) {
    const syncBadgeText = document.getElementById('sync-status-text');
    if (syncBadgeText) syncBadgeText.textContent = 'Sincronizando...';

    // Tenta via backend primeiro
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, saveToken: true })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.snapshot) {
          applySnapshotTasks(data.snapshot);
          if (syncBadgeText) syncBadgeText.textContent = 'Hoje Sincronizado';
          return data.snapshot;
        }
      }
    } catch (e) {
      // Continua para chamada direta do navegador (GitHub Pages)
    }

    const body = new URLSearchParams({
      sync_token: '*',
      resource_types: JSON.stringify(['items', 'day_orders', 'projects'])
    });
    const resp = await fetch('https://api.todoist.com/sync/v9/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });
    if (!resp.ok) {
      throw new Error(`Todoist API respondeu ${resp.status}`);
    }
    const syncData = await resp.json();
    const todayStr = getTodayStr();
    const items = (syncData.items || []).filter((item) => !item.checked && !item.is_deleted);
    const dayOrders = syncData.day_orders || {};

    const childrenByParent = {};
    items.forEach((item) => {
      if (item.parent_id) {
        const pid = String(item.parent_id);
        if (!childrenByParent[pid]) childrenByParent[pid] = [];
        childrenByParent[pid].push({
          id: String(item.id),
          content: item.content,
          checked: Boolean(item.checked),
          childOrder: Number(item.child_order ?? 9999)
        });
      }
    });

    const todayTop = items.filter((item) => {
      if (item.parent_id) return false;
      const dueDate = item.due && item.due.date ? String(item.due.date).slice(0, 10) : null;
      return dueDate && dueDate <= todayStr;
    });

    const hasExplicitDayOrders = todayTop.some((item) => dayOrders[String(item.id)] !== undefined);
    todayTop.sort((a, b) => {
      if (hasExplicitDayOrders) {
        const dA = dayOrders[String(a.id)] ?? 999999;
        const dB = dayOrders[String(b.id)] ?? 999999;
        if (dA !== dB) return dA - dB;
      }
      return Number(a.child_order ?? 999999) - Number(b.child_order ?? 999999);
    });

    const formatted = todayTop.map((item, idx) => {
      const desc = item.description || '';
      const estMatch = desc.match(/\[(\d+)\]/) || desc.match(/(\d+)\s*min/i);
      return {
        id: String(item.id),
        content: item.content,
        description: desc,
        dueDate: item.due && item.due.date ? String(item.due.date).slice(0, 10) : todayStr,
        recurring: item.due && item.due.is_recurring ? (item.due.string || 'recorrente') : false,
        priority: `p${5 - Number(item.priority || 1)}`,
        projectId: String(item.project_id || '6CrgFRpqRPQVfgjG'),
        checked: false,
        dayOrder: idx + 1,
        estimatedMinutes: estMatch ? parseInt(estMatch[1], 10) : null,
        subtasks: childrenByParent[String(item.id)] || []
      };
    });

    const snapshot = {
      syncedAt: new Date().toISOString(),
      date: todayStr,
      totalToday: formatted.length,
      tasks: formatted
    };
    applySnapshotTasks(snapshot);
    if (syncBadgeText) syncBadgeText.textContent = 'Hoje Sincronizado (Live)';
    return snapshot;
  }

  // ==========================================================================
  // Renderização da Tarefa Única no Centro & Markdown Leve
  // ==========================================================================
  function formatMarkdownLinks(text) {
    if (!text) return '';
    let safe = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Markdown links [label](url)
    safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1 ↗</a>');
    // Raw URLs
    safe = safe.replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2 ↗</a>');
    // Bold **text**
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return safe.replace(/\n/g, '<br />');
  }

  function renderCurrentTask(animateEnter) {
    const card = document.getElementById('single-task-card');
    const orderBadge = document.getElementById('task-order-badge');
    const recurringBadge = document.getElementById('task-recurring-badge');
    const estimateBadge = document.getElementById('task-estimate-badge');
    const avgBadge = document.getElementById('task-avg-badge');
    const titleEl = document.getElementById('task-title');
    const descBox = document.getElementById('task-description-box');
    const subtasksBox = document.getElementById('subtasks-box');
    const subtasksList = document.getElementById('subtasks-list');
    const subtasksCounter = document.getElementById('subtasks-counter');
    const prevBtn = document.getElementById('btn-prev-task');
    const skipBtn = document.getElementById('btn-skip-task');

    stopTaskTimer(true);

    const total = state.tasks.length;
    const completedCount = state.tasks.filter((t) => state.completedIds.has(String(t.id))).length;

    if (total === 0 || completedCount >= total) {
      if (orderBadge) orderBadge.textContent = `🎉 Dia Concluído (${completedCount}/${total})`;
      if (recurringBadge) recurringBadge.style.display = 'none';
      if (estimateBadge) estimateBadge.style.display = 'none';
      if (avgBadge) avgBadge.style.display = 'none';
      if (titleEl) {
        titleEl.innerHTML = '✨ Todas as tarefas do Hoje foram concluídas, Walace!';
      }
      if (descBox) {
        descBox.style.display = 'block';
        descBox.innerHTML = 'Você zerou a sua fila do Hoje com foco absoluto. A <strong>Miss Minutos</strong> já salvou todas as suas métricas para o feedback das 5h30 da manhã! 🧡⏰';
      }
      if (subtasksBox) subtasksBox.style.display = 'none';
      return;
    }

    // Garante que currentIndex aponte para uma tarefa válida
    if (state.currentIndex < 0 || state.currentIndex >= total) {
      state.currentIndex = 0;
    }

    const task = state.tasks[state.currentIndex];
    const isDone = state.completedIds.has(String(task.id));

    if (orderBadge) {
      orderBadge.textContent = `Tarefa #${task.dayOrder || state.currentIndex + 1} de ${total}${isDone ? ' (Concluída ✓)' : ''}`;
    }

    if (recurringBadge) {
      if (task.recurring) {
        recurringBadge.style.display = 'inline-flex';
        recurringBadge.textContent = `🔄 ${task.recurring}`;
      } else {
        recurringBadge.style.display = 'none';
      }
    }

    if (estimateBadge) {
      if (task.estimatedMinutes) {
        estimateBadge.style.display = 'inline-flex';
        estimateBadge.textContent = `⏱️ Meta: ${task.estimatedMinutes} min`;
      } else {
        estimateBadge.style.display = 'none';
      }
    }

    if (avgBadge) {
      const avgEntry =
        (state.timesData.taskAverages && state.timesData.taskAverages[task.id]) ||
        (state.timesData.taskAverages && state.timesData.taskAverages[task.content]);
      if (avgEntry && avgEntry.averageMinutes > 0) {
        avgBadge.style.display = 'inline-flex';
        avgBadge.textContent = `📊 Sua Média: ${avgEntry.averageMinutes} min`;
      } else {
        avgBadge.style.display = 'none';
      }
    }

    if (titleEl) {
      titleEl.innerHTML = formatMarkdownLinks(task.content);
    }

    const cleanDesc = String(task.description || '').replace(/^\[\d+\]\s*/, '').trim();
    if (descBox) {
      if (cleanDesc) {
        descBox.style.display = 'block';
        descBox.innerHTML = formatMarkdownLinks(cleanDesc);
      } else {
        descBox.style.display = 'none';
        descBox.innerHTML = '';
      }
    }

    if (subtasksBox && subtasksList && subtasksCounter) {
      const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
      if (subs.length > 0) {
        subtasksBox.style.display = 'block';
        const doneSubCount = subs.filter((st) => state.subtasksDone[st.id] || st.checked).length;
        subtasksCounter.textContent = `${doneSubCount}/${subs.length}`;
        subtasksList.innerHTML = '';

        subs.forEach((st) => {
          const checked = Boolean(state.subtasksDone[st.id] || st.checked);
          const itemDiv = document.createElement('label');
          itemDiv.className = `subtask-item${checked ? ' done' : ''}`;
          itemDiv.style.cursor = 'pointer';
          itemDiv.innerHTML = `
            <input type="checkbox" ${checked ? 'checked' : ''} style="margin-top: 3px; accent-color: #f97316; cursor: pointer;" />
            <span>${formatMarkdownLinks(st.content)}</span>
          `;
          const checkbox = itemDiv.querySelector('input');
          checkbox.addEventListener('change', () => {
            state.subtasksDone[st.id] = checkbox.checked;
            saveCompletedToStorage();
            itemDiv.classList.toggle('done', checkbox.checked);
            const newCount = subs.filter((s) => state.subtasksDone[s.id] || s.checked).length;
            subtasksCounter.textContent = `${newCount}/${subs.length}`;
          });
          subtasksList.appendChild(itemDiv);
        });
      } else {
        subtasksBox.style.display = 'none';
      }
    }

    if (prevBtn) prevBtn.disabled = state.currentIndex <= 0;
    if (skipBtn) skipBtn.disabled = total <= 1;

    updateTimerUI();

    if (animateEnter && card) {
      card.classList.remove('task-completing-float-up');
      card.classList.remove('task-entering-zen');
      void card.offsetWidth;
      card.classList.add('task-entering-zen');
    }
  }

  // ==========================================================================
  // Cronômetro da Tarefa + Modo "Presta Atenção" (a cada 5 minutos)
  // ==========================================================================
  function updateTimerUI() {
    const digitsEl = document.getElementById('timer-digits');
    const statusPill = document.getElementById('timer-status-pill');
    const btnToggle = document.getElementById('btn-toggle-timer');
    const btnIcon = document.getElementById('btn-timer-icon');
    const btnText = document.getElementById('btn-timer-text');
    const btnSub = document.getElementById('btn-timer-sub');
    const completeText = document.getElementById('btn-complete-text');
    const completeSub = document.getElementById('btn-complete-sub');
    const card = document.getElementById('single-task-card');
    const track = document.getElementById('timer-progress-track');
    const fill = document.getElementById('timer-progress-fill');

    if (digitsEl) {
      digitsEl.textContent = formatMMSS(state.timerSeconds);
      digitsEl.classList.toggle('running', state.timerRunning);
    }

    if (statusPill) {
      if (state.timerRunning) {
        statusPill.textContent = '⏱️ Focando agora';
        statusPill.classList.add('running');
      } else if (state.timerSeconds > 0) {
        statusPill.textContent = '⏸ Pausado';
        statusPill.classList.remove('running');
      } else {
        statusPill.textContent = 'Pronto p/ focar';
        statusPill.classList.remove('running');
      }
    }

    if (card) {
      card.classList.toggle('timer-running', state.timerRunning);
    }

    if (btnToggle && btnIcon && btnText && btnSub) {
      btnToggle.classList.toggle('is-running', state.timerRunning);
      if (state.timerRunning) {
        btnIcon.textContent = '⏸';
        btnText.textContent = 'Pausar Tempo';
        btnSub.textContent = 'Cronômetro ativo · Presta Atenção monitorando';
      } else if (state.timerSeconds > 0) {
        btnIcon.textContent = '▶';
        btnText.textContent = 'Retomar Tempo';
        btnSub.textContent = `Já focado: ${formatMMSS(state.timerSeconds)}`;
      } else {
        btnIcon.textContent = '▶';
        btnText.textContent = 'Play no Tempo';
        btnSub.textContent = 'Inicia cronômetro + modo Presta Atenção (5 min)';
      }
    }

    if (completeText && completeSub) {
      if (state.timerSeconds > 0 || state.timerRunning) {
        completeText.textContent = `Concluir (${formatMMSS(state.timerSeconds)})`;
        completeSub.textContent = 'Salva o tempo focado p/ Miss Minutos e avança';
      } else {
        completeText.textContent = 'Concluir Direto';
        completeSub.textContent = 'Concluir sem iniciar tempo (vapt-vupt)';
      }
    }

    const currentTask = state.tasks[state.currentIndex];
    if (track && fill && currentTask && currentTask.estimatedMinutes) {
      track.style.display = 'block';
      const targetSec = currentTask.estimatedMinutes * 60;
      const pct = Math.min(100, (state.timerSeconds / targetSec) * 100);
      fill.style.width = `${pct.toFixed(1)}%`;
    } else if (track) {
      track.style.display = 'none';
    }

    updateAttentionCountdownBadge();
  }

  function updateAttentionCountdownBadge() {
    const badge = document.getElementById('attention-countdown-badge');
    const iconEl = document.getElementById('attention-mode-icon');
    const labelEl = document.getElementById('attention-mode-label');

    const modeMap = {
      both: { icon: '✨', label: 'Luz + Som' },
      light: { icon: '💙', label: 'Só Luz (Vídeo)' },
      sound: { icon: '🎹', label: 'Só Piano' },
      off: { icon: '🌙', label: 'Desligado' }
    };
    const m = modeMap[state.attentionMode] || modeMap.both;
    if (iconEl) iconEl.textContent = m.icon;
    if (labelEl) labelEl.textContent = m.label;

    if (!badge) return;
    if (state.attentionMode === 'off') {
      badge.textContent = 'Off';
      return;
    }
    if (!state.timerRunning) {
      badge.textContent = 'Aguardando Play';
      return;
    }
    const remaining = Math.max(0, state.attentionIntervalSec - state.attentionElapsedSec);
    badge.textContent = formatMMSS(remaining);
  }

  function triggerAttentionReminder(isManualTest) {
    if (!isManualTest && (state.attentionMode === 'off' || !state.timerRunning)) return;

    const effectiveMode = state.attentionMode === 'off' && isManualTest ? 'both' : state.attentionMode;
    const overlay = document.getElementById('attention-light-overlay');
    const toast = document.getElementById('attention-toast');
    const toastText = document.getElementById('attention-toast-text');
    const currentTask = state.tasks[state.currentIndex];

    // 1. Modo Luminoso (Pulso azul suave em fade-in/fade-out — ideal para gravação de vídeo)
    if (effectiveMode === 'light' || effectiveMode === 'both') {
      if (overlay) {
        overlay.classList.remove('pulsing');
        void overlay.offsetWidth;
        overlay.classList.add('pulsing');
      }
    }

    // 2. Modo Sonoro (Acorde de piano Rhodes/Felt suave)
    if (effectiveMode === 'sound' || effectiveMode === 'both') {
      playGentlePianoAttentionChord();
    }

    // 3. Toast suave + frase na Miss Minutos
    if (toast && toastText) {
      const minsFocused = Math.max(1, Math.round(state.timerSeconds / 60));
      toastText.textContent = isManualTest
        ? '💙 Teste do Modo Presta Atenção: pulso luminoso azul suave + piano zen!'
        : `💙 Oi, querido! ${minsFocused} min focados em "${currentTask ? currentTask.content.slice(0, 38) : 'sua tarefa'}" — continua comigo! ⏰`;
      toast.classList.add('visible');
      setTimeout(() => {
        toast.classList.remove('visible');
      }, 4600);
    }
  }

  function toggleTaskTimer() {
    ensureAudioContext();
    if (state.timerRunning) {
      state.timerRunning = false;
      if (state.timerIntervalId) {
        clearInterval(state.timerIntervalId);
        state.timerIntervalId = null;
      }
      updateTimerUI();
      return;
    }

    if (!state.timerStartedAt) {
      state.timerStartedAt = new Date().toISOString();
    }
    state.timerRunning = true;
    state.timerIntervalId = setInterval(() => {
      state.timerSeconds += 1;
      if (state.attentionMode !== 'off') {
        state.attentionElapsedSec += 1;
        if (state.attentionElapsedSec >= state.attentionIntervalSec) {
          state.attentionElapsedSec = 0;
          triggerAttentionReminder(false);
        }
      }
      updateTimerUI();
    }, 1000);

    updateTimerUI();
  }

  function stopTaskTimer(resetSeconds) {
    state.timerRunning = false;
    if (state.timerIntervalId) {
      clearInterval(state.timerIntervalId);
      state.timerIntervalId = null;
    }
    state.attentionElapsedSec = 0;
    if (resetSeconds) {
      state.timerSeconds = 0;
      state.timerStartedAt = null;
    }
    updateTimerUI();
  }

  // ==========================================================================
  // Conclusão da Tarefa (Com ou Sem Tempo) + Barra Gamificada da Miss Minutos
  // ==========================================================================
  async function completeCurrentTask() {
    if (!state.tasks.length) return;
    const task = state.tasks[state.currentIndex];
    if (!task) return;

    ensureAudioContext();

    const durationSeconds = state.timerSeconds;
    const completedWithoutTimer = durationSeconds === 0;
    const startedAt = state.timerStartedAt || new Date().toISOString();
    const endedAt = new Date().toISOString();

    stopTaskTimer(false);

    // 1. Dispara som zen suave + partículas subindo + animação do card se desfazendo para cima
    playZenCompletionSound();
    const card = document.getElementById('single-task-card');
    if (card) {
      triggerTaskDissolveParticles(card);
      card.classList.remove('task-entering-zen');
      card.classList.add('task-completing-float-up');
    }

    // 2. Marca tarefa como concluída e registra sessão de tempo
    state.completedIds.add(String(task.id));
    saveCompletedToStorage();

    const sessionEntry = {
      sessionId: `lf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      taskId: String(task.id),
      content: task.content,
      projectId: task.projectId || '6CrgFRpqRPQVfgjG',
      date: getTodayStr(),
      startedAt,
      endedAt,
      durationSeconds,
      durationMinutes: Number((durationSeconds / 60).toFixed(2)),
      estimatedMinutes: task.estimatedMinutes || null,
      completed: true,
      completedWithoutTimer
    };

    state.timesData.sessions.push(sessionEntry);
    recomputeLocalTimesAggregates();
    updateHeaderStats();

    // 3. Atualiza a Barra Gamificada da Miss Minutos com comemoração!
    updateMissMinutosSidebar(true);

    // 4. Sincroniza conclusão e tempo com o servidor local (que grava no store da Miss Minutos) e/ou Todoist API
    syncTaskCompletionRemote(task, sessionEntry);

    // 5. Após a tarefa dissolver suavemente para cima, traz a próxima da fila
    setTimeout(() => {
      const nextIdx = findNextPendingTaskIndex(state.currentIndex);
      if (nextIdx >= 0) {
        state.currentIndex = nextIdx;
      }
      stopTaskTimer(true);
      renderCurrentTask(true);
    }, 820);
  }

  function findNextPendingTaskIndex(fromIndex) {
    const total = state.tasks.length;
    for (let i = fromIndex + 1; i < total; i++) {
      if (!state.completedIds.has(String(state.tasks[i].id))) return i;
    }
    for (let i = 0; i < total; i++) {
      if (!state.completedIds.has(String(state.tasks[i].id))) return i;
    }
    return -1;
  }

  async function syncTaskCompletionRemote(task, sessionEntry) {
    // Envia para /api/tasks/complete se backend Node estiver rodando
    try {
      const resp = await fetch('/api/tasks/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(state.todoistToken ? { 'X-Todoist-Token': state.todoistToken } : {})
        },
        body: JSON.stringify({
          ...sessionEntry,
          token: state.todoistToken || undefined
        })
      });
      if (resp.ok) return;
    } catch (e) {
      // Se estiver no GitHub Pages estático e houver token do Todoist no navegador, fecha direto na Sync API v9
      if (state.todoistToken) {
        try {
          const uuid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `uuid_${Date.now()}`;
          const body = new URLSearchParams({
            commands: JSON.stringify([{ type: 'item_close', uuid, args: { id: String(task.id) } }])
          });
          await fetch('https://api.todoist.com/sync/v9/sync', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${state.todoistToken}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString()
          });
        } catch (err) {}
      }
    }
  }

  // ==========================================================================
  // Barra Lateral Gamificada da Miss Minutos (Vermelho -> Amarelo -> Azul)
  // ==========================================================================
  function updateMissMinutosSidebar(celebrateNow) {
    const total = state.tasks.length || 1;
    const completedCount = state.tasks.filter((t) => state.completedIds.has(String(t.id))).length;
    const pct = Math.min(100, Math.round((completedCount / total) * 100));

    const summaryEl = document.getElementById('mm-progress-summary');
    const marker = document.getElementById('mm-climber-marker');
    const moodPill = document.getElementById('mm-mood-pill');
    const speechBubble = document.getElementById('mm-speech-bubble');

    const mouthSad = document.getElementById('mm-mouth-sad');
    const mouthMedium = document.getElementById('mm-mouth-medium');
    const mouthHappy = document.getElementById('mm-mouth-happy');
    const browLeft = document.getElementById('mm-brow-left');
    const browRight = document.getElementById('mm-brow-right');
    const sweatDrop = document.getElementById('mm-sweat-drop');
    const sparkles = document.getElementById('mm-sparkles');
    const armLeft = document.getElementById('mm-arm-left');
    const armRight = document.getElementById('mm-arm-right');
    const handLeft = document.getElementById('mm-hand-left');
    const handRight = document.getElementById('mm-hand-right');

    if (summaryEl) {
      summaryEl.textContent = `${completedCount} de ${state.tasks.length} concluídas (${pct}%)`;
    }

    if (marker) {
      // Sobe na barra vertical de 0% (base vermelha) até 100% (topo azul suave)
      marker.style.bottom = `${pct}%`;
      if (celebrateNow) {
        marker.classList.remove('celebrate-jump');
        void marker.offsetWidth;
        marker.classList.add('celebrate-jump');
      }
    }

    // Define faixa de humor da Miss Minutos:
    // 0% a 33% = Faixa Vermelha (preocupada/triste)
    // 34% a 74% = Faixa Amarela (média/animando)
    // 75% a 100% = Faixa Azul (super feliz/radiante)
    let zone = 'red';
    if (pct >= 75) {
      zone = 'blue';
    } else if (pct >= 34) {
      zone = 'yellow';
    }

    // Se acabou de concluir uma tarefa, ela comemora feliz!
    const showHappyFace = zone === 'blue' || celebrateNow;

    if (mouthSad && mouthMedium && mouthHappy) {
      mouthSad.style.display = (!showHappyFace && zone === 'red') ? 'block' : 'none';
      mouthMedium.style.display = (!showHappyFace && zone === 'yellow') ? 'block' : 'none';
      mouthHappy.style.display = showHappyFace ? 'block' : 'none';
    }

    if (sweatDrop) {
      sweatDrop.style.opacity = (zone === 'red' && !celebrateNow) ? '0.85' : '0';
    }

    if (sparkles) {
      sparkles.style.opacity = (zone === 'blue' || celebrateNow) ? '1' : '0';
    }

    if (browLeft && browRight) {
      if (zone === 'red' && !celebrateNow) {
        // Sobrancelhas caídas preocupadas
        browLeft.setAttribute('d', 'M 72 82 Q 86 74 98 72');
        browRight.setAttribute('d', 'M 122 72 Q 134 74 148 82');
      } else {
        // Sobrancelhas arqueadas alegres
        browLeft.setAttribute('d', 'M 74 75 Q 87 66 98 74');
        browRight.setAttribute('d', 'M 122 74 Q 133 66 146 75');
      }
    }

    if (armLeft && armRight && handLeft && handRight) {
      if (zone === 'blue' || celebrateNow) {
        // Bracinhos levantados comemorando!
        armLeft.setAttribute('d', 'M 38 118 Q 14 96 18 74');
        handLeft.setAttribute('cy', '70');
        handLeft.setAttribute('cx', '18');
        armRight.setAttribute('d', 'M 182 118 Q 206 96 202 74');
        handRight.setAttribute('cy', '70');
        handRight.setAttribute('cx', '202');
      } else if (zone === 'yellow') {
        armLeft.setAttribute('d', 'M 38 118 Q 18 112 18 98');
        handLeft.setAttribute('cy', '96');
        handLeft.setAttribute('cx', '18');
        armRight.setAttribute('d', 'M 182 118 Q 202 112 202 98');
        handRight.setAttribute('cy', '96');
        handRight.setAttribute('cx', '202');
      } else {
        armLeft.setAttribute('d', 'M 38 118 Q 18 130 22 148');
        handLeft.setAttribute('cy', '150');
        handLeft.setAttribute('cx', '22');
        armRight.setAttribute('d', 'M 182 118 Q 202 130 198 148');
        handRight.setAttribute('cy', '150');
        handRight.setAttribute('cx', '198');
      }
    }

    if (moodPill) {
      moodPill.className = 'mm-mood-pill';
      if (zone === 'blue') {
        moodPill.classList.add('mood-blue');
        moodPill.textContent = '💙 Faixa Azul Zen · Miss Minutos radiante!';
      } else if (zone === 'yellow') {
        moodPill.classList.add('mood-yellow');
        moodPill.textContent = '⚡ Faixa Amarela · Miss Minutos animada!';
      } else {
        moodPill.classList.add('mood-red');
        moodPill.textContent = '😟 Faixa Vermelha · Miss Minutos quer subir!';
      }
    }

    if (speechBubble) {
      let pool = MISS_MINUTOS_QUOTES.startRed;
      if (completedCount >= state.tasks.length && state.tasks.length > 0) {
        pool = MISS_MINUTOS_QUOTES.allDone;
      } else if (celebrateNow || completedCount > 0) {
        if (zone === 'blue') pool = MISS_MINUTOS_QUOTES.celebrateBlue;
        else if (zone === 'yellow') pool = MISS_MINUTOS_QUOTES.celebrateYellow;
        else pool = MISS_MINUTOS_QUOTES.celebrateRed;
      }
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      speechBubble.textContent = chosen;

      if (celebrateNow) {
        speechBubble.classList.add('celebrating');
        setTimeout(() => speechBubble.classList.remove('celebrating'), 1800);
      }
    }
  }

  // ==========================================================================
  // Player Lo-Fi no Cantinho (Synth Zen Rhodes + Streams Ao Vivo)
  // ==========================================================================
  function updateLofiUI() {
    const btnToggle = document.getElementById('btn-lofi-toggle');
    const playIcon = document.getElementById('lofi-play-icon');
    const nameEl = document.getElementById('lofi-station-name');
    const subEl = document.getElementById('lofi-station-sub');
    const eqEl = document.getElementById('lofi-eq');

    const station = LOFI_STATIONS[state.lofi.stationIndex] || LOFI_STATIONS[0];
    if (nameEl) nameEl.textContent = station.name;
    if (subEl) {
      subEl.textContent = state.lofi.playing ? `🎵 Tocando · ${station.sub}` : station.sub;
    }
    if (btnToggle) btnToggle.classList.toggle('playing', state.lofi.playing);
    if (playIcon) playIcon.textContent = state.lofi.playing ? '⏸' : '▶';
    if (eqEl) eqEl.classList.toggle('playing', state.lofi.playing);
  }

  function stopLofiEngine() {
    if (state.lofi.synthTimer) {
      clearInterval(state.lofi.synthTimer);
      state.lofi.synthTimer = null;
    }
    if (state.lofi.noiseNode) {
      try {
        state.lofi.noiseNode.stop();
        state.lofi.noiseNode.disconnect();
      } catch (e) {}
      state.lofi.noiseNode = null;
    }
    if (state.lofi.audioEl) {
      try {
        state.lofi.audioEl.pause();
        state.lofi.audioEl.src = '';
      } catch (e) {}
    }
  }

  function startLofiSynth() {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    if (!state.lofi.masterGain) {
      state.lofi.masterGain = ctx.createGain();
      state.lofi.masterGain.connect(ctx.destination);
    }
    state.lofi.masterGain.gain.setValueAtTime(state.lofi.volume * 0.25, ctx.currentTime);

    // Textura suave de vinil / chuva zen bem baixinha
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.035;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(950, ctx.currentTime);
    noiseFilter.Q.setValueAtTime(0.7, ctx.currentTime);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.16, ctx.currentTime);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(state.lofi.masterGain);
    noise.start();
    state.lofi.noiseNode = noise;

    // Progressão de acordes Lo-Fi Jazz (Fmaj7 -> Em7 -> Dm9 -> Cmaj7)
    const chords = [
      [174.61, 261.63, 349.23, 440.0, 523.25], // Fmaj7
      [164.81, 246.94, 329.63, 392.0, 493.88], // Em7
      [146.83, 220.0, 293.66, 349.23, 440.0, 523.25], // Dm9
      [130.81, 196.0, 261.63, 329.63, 392.0, 493.88] // Cmaj7
    ];

    const playNextChord = () => {
      if (!state.lofi.playing) return;
      const now = ctx.currentTime;
      const chord = chords[state.lofi.chordStep % chords.length];
      state.lofi.chordStep += 1;

      chord.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc.type = i === 0 ? 'sine' : 'triangle';
        // Leve detune estilo fita cassete Lo-Fi
        osc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 0.8, now + i * 0.04);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(720, now);

        const t0 = now + i * 0.04;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.linearRampToValueAtTime(i === 0 ? 0.22 : 0.11, t0 + 0.35);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 3.4);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(state.lofi.masterGain);

        osc.start(t0);
        osc.stop(t0 + 3.5);
      });
    };

    playNextChord();
    state.lofi.synthTimer = setInterval(playNextChord, 3400);
  }

  function startCurrentLofiStation() {
    stopLofiEngine();
    const station = LOFI_STATIONS[state.lofi.stationIndex] || LOFI_STATIONS[0];

    if (station.type === 'synth') {
      startLofiSynth();
      updateLofiUI();
      return;
    }

    if (!state.lofi.audioEl) {
      state.lofi.audioEl = new Audio();
      state.lofi.audioEl.crossOrigin = 'anonymous';
    }
    state.lofi.audioEl.src = station.url;
    state.lofi.audioEl.volume = state.lofi.volume;
    state.lofi.audioEl.play().catch(() => {
      // Fallback imediato para o Synth Lo-Fi caso o stream externo falhe
      state.lofi.stationIndex = 0;
      startLofiSynth();
      updateLofiUI();
    });
    updateLofiUI();
  }

  function toggleLofiPlayback() {
    ensureAudioContext();
    state.lofi.playing = !state.lofi.playing;
    if (state.lofi.playing) {
      startCurrentLofiStation();
    } else {
      stopLofiEngine();
      updateLofiUI();
    }
  }

  // ==========================================================================
  // Modais: Fila do Hoje, Tempos da Miss Minutos e Presta Atenção
  // ==========================================================================
  function updateHeaderStats() {
    const queueCountEl = document.getElementById('header-queue-count');
    const focusedMinEl = document.getElementById('header-focused-minutes');

    const total = state.tasks.length;
    const completed = state.tasks.filter((t) => state.completedIds.has(String(t.id))).length;
    if (queueCountEl) {
      queueCountEl.textContent = `${completed}/${total}`;
    }

    const todayStr = getTodayStr();
    const todaySessions = (state.timesData.sessions || []).filter((s) => s.date === todayStr);
    const totalSec = todaySessions.reduce((acc, s) => acc + Math.max(0, Number(s.durationSeconds || 0)), 0);
    const mins = Math.round(totalSec / 60);
    if (focusedMinEl) {
      focusedMinEl.textContent = `${mins}m`;
    }
  }

  function renderQueueModalList() {
    const container = document.getElementById('queue-list-container');
    if (!container) return;
    container.innerHTML = '';

    state.tasks.forEach((t, idx) => {
      const done = state.completedIds.has(String(t.id));
      const isCurrent = idx === state.currentIndex;
      const div = document.createElement('div');
      div.className = `queue-item${isCurrent ? ' current' : ''}${done ? ' completed' : ''}`;
      div.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
          <span style="font-weight:800; color:var(--mm-orange-dark); min-width:28px;">#${t.dayOrder || idx + 1}</span>
          <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600;">${t.content}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
          ${t.estimatedMinutes ? `<span style="font-size:0.74rem; color:#047857; font-weight:700;">${t.estimatedMinutes}m</span>` : ''}
          <span style="font-size:0.78rem; font-weight:700; color:${done ? '#10b981' : isCurrent ? '#f97316' : '#64748b'};">
            ${done ? '✓ Concluída' : isCurrent ? '🎯 Em Foco' : 'Focar →'}
          </span>
        </div>
      `;
      div.addEventListener('click', () => {
        state.currentIndex = idx;
        renderCurrentTask(true);
        closeModal('modal-queue');
      });
      container.appendChild(div);
    });
  }

  function renderTimesModal() {
    const todayStr = getTodayStr();
    const sessions = Array.isArray(state.timesData.sessions) ? state.timesData.sessions : [];
    const todaySessions = sessions.filter((s) => s.date === todayStr);

    const totalSecToday = todaySessions.reduce((acc, s) => acc + Number(s.durationSeconds || 0), 0);
    const timedCount = todaySessions.filter((s) => !s.completedWithoutTimer && Number(s.durationSeconds || 0) > 0).length;
    const quickCount = todaySessions.filter((s) => s.completedWithoutTimer || Number(s.durationSeconds || 0) === 0).length;

    const statMinEl = document.getElementById('stat-today-minutes');
    const statTimedEl = document.getElementById('stat-timed-count');
    const statQuickEl = document.getElementById('stat-quick-count');
    const logList = document.getElementById('times-log-list');

    if (statMinEl) statMinEl.textContent = `${(totalSecToday / 60).toFixed(1)} min`;
    if (statTimedEl) statTimedEl.textContent = String(timedCount);
    if (statQuickEl) statQuickEl.textContent = String(quickCount);

    if (!logList) return;
    logList.innerHTML = '';

    if (sessions.length === 0) {
      logList.innerHTML = `
        <div style="padding:18px; text-align:center; color:var(--text-muted); font-size:0.86rem;">
          Nenhuma tarefa concluída ainda nesta sessão. Assim que você usar o <strong>Play</strong> ou <strong>Concluir</strong>, os tempos aparecem aqui e no arquivo da Miss Minutos! ⏰
        </div>
      `;
      return;
    }

    sessions
      .slice()
      .reverse()
      .forEach((s) => {
        const row = document.createElement('div');
        row.className = 'queue-item';
        row.style.cursor = 'default';
        const durLabel = s.completedWithoutTimer || !s.durationSeconds
          ? 'Concluída direto (sem timer)'
          : `⏱️ ${formatMMSS(s.durationSeconds)} (${s.durationMinutes} min)`;
        row.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:2px;">
            <strong style="font-size:0.86rem; color:#0f172a;">${s.content}</strong>
            <span style="font-size:0.74rem; color:var(--text-muted);">Data: ${s.date} · ID: ${s.taskId}</span>
          </div>
          <span style="font-size:0.8rem; font-weight:700; color:${s.completedWithoutTimer ? '#f97316' : '#0284c7'};">
            ${durLabel}
          </span>
        `;
        logList.appendChild(row);
      });
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'modal-queue') renderQueueModalList();
    if (id === 'modal-times') renderTimesModal();
    el.classList.add('open');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }

  // ==========================================================================
  // Inicialização & Eventos de Interface
  // ==========================================================================
  function bindEvents() {
    // Splash screen -> Iniciar Sessão Zen
    const btnEnterZen = document.getElementById('btn-enter-zen');
    const splash = document.getElementById('splash-screen');
    if (btnEnterZen && splash) {
      btnEnterZen.addEventListener('click', () => {
        ensureAudioContext();
        splash.classList.add('hidden');
      });
    }

    // Play / Pause no Cronômetro da tarefa
    const btnToggleTimer = document.getElementById('btn-toggle-timer');
    if (btnToggleTimer) {
      btnToggleTimer.addEventListener('click', toggleTaskTimer);
    }

    // Concluir Tarefa (com ou sem tempo)
    const btnCompleteTask = document.getElementById('btn-complete-task');
    if (btnCompleteTask) {
      btnCompleteTask.addEventListener('click', completeCurrentTask);
    }

    // Navegação Anterior / Pular
    const btnPrev = document.getElementById('btn-prev-task');
    const btnSkip = document.getElementById('btn-skip-task');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (state.currentIndex > 0) {
          state.currentIndex -= 1;
          renderCurrentTask(true);
        }
      });
    }
    if (btnSkip) {
      btnSkip.addEventListener('click', () => {
        if (state.tasks.length > 1) {
          state.currentIndex = (state.currentIndex + 1) % state.tasks.length;
          renderCurrentTask(true);
        }
      });
    }

    // Clique na Miss Minutos da barra lateral -> frase de incentivo + pulinho
    const climber = document.getElementById('mm-climber-marker');
    if (climber) {
      climber.addEventListener('click', () => {
        updateMissMinutosSidebar(true);
      });
    }

    // Botões de abrir Modais
    const btnOpenAttention = document.getElementById('btn-open-attention-modal');
    const btnOpenTimes = document.getElementById('btn-open-times-modal');
    const btnOpenQueue = document.getElementById('btn-open-queue-modal');
    if (btnOpenAttention) btnOpenAttention.addEventListener('click', () => openModal('modal-attention'));
    if (btnOpenTimes) btnOpenTimes.addEventListener('click', () => openModal('modal-times'));
    if (btnOpenQueue) btnOpenQueue.addEventListener('click', () => openModal('modal-queue'));

    // Fechar Modais
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeModal(btn.getAttribute('data-close-modal'));
      });
    });
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.remove('open');
      });
    });

    // Seleção do Modo "Presta Atenção"
    const modeCards = document.querySelectorAll('.mode-option-card');
    modeCards.forEach((card) => {
      if (card.getAttribute('data-attention-mode') === state.attentionMode) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
      card.addEventListener('click', () => {
        const mode = card.getAttribute('data-attention-mode');
        state.attentionMode = mode;
        localStorage.setItem(STORAGE_KEYS.ATTENTION_MODE, mode);
        modeCards.forEach((c) => c.classList.toggle('selected', c === card));
        updateAttentionCountdownBadge();
      });
    });

    const intervalSelect = document.getElementById('attention-interval-select');
    if (intervalSelect) {
      intervalSelect.value = String(state.attentionIntervalSec);
      intervalSelect.addEventListener('change', () => {
        state.attentionIntervalSec = Number(intervalSelect.value || 300);
        state.attentionElapsedSec = 0;
        localStorage.setItem(STORAGE_KEYS.ATTENTION_INTERVAL, String(state.attentionIntervalSec));
        updateAttentionCountdownBadge();
      });
    }

    const btnTestAttention = document.getElementById('btn-test-attention-now');
    if (btnTestAttention) {
      btnTestAttention.addEventListener('click', () => {
        ensureAudioContext();
        triggerAttentionReminder(true);
      });
    }

    // Sincronização manual Todoist
    const tokenInput = document.getElementById('todoist-token-input');
    const btnSyncNow = document.getElementById('btn-sync-todoist-now');
    const feedbackEl = document.getElementById('sync-feedback-msg');
    if (tokenInput && state.todoistToken) {
      tokenInput.value = state.todoistToken;
    }
    if (btnSyncNow) {
      btnSyncNow.addEventListener('click', async () => {
        const val = tokenInput ? tokenInput.value.trim() : '';
        if (val) {
          state.todoistToken = val;
          localStorage.setItem(STORAGE_KEYS.TODOIST_TOKEN, val);
        }
        if (feedbackEl) {
          feedbackEl.style.display = 'block';
          feedbackEl.style.color = '#0284c7';
          feedbackEl.textContent = 'Sincronizando ordem exata do Hoje com o Todoist...';
        }
        try {
          const snap = await syncDirectlyWithTodoistBrowser(state.todoistToken);
          renderQueueModalList();
          if (feedbackEl) {
            feedbackEl.style.color = '#047857';
            feedbackEl.textContent = `✓ Sincronizado com sucesso! ${snap.tasks.length} tarefas na ordem exata do Hoje.`;
          }
        } catch (err) {
          if (feedbackEl) {
            feedbackEl.style.color = '#dc2626';
            feedbackEl.textContent = `Usando snapshot sincronizado do conector (${err.message}).`;
          }
        }
      });
    }

    // Exportar JSON de Tempos da Miss Minutos
    const btnExportTimes = document.getElementById('btn-export-times-json');
    if (btnExportTimes) {
      btnExportTimes.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(state.timesData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lightfocus-times.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
    }

    // Controles do Player Lo-Fi no Cantinho
    const btnLofiToggle = document.getElementById('btn-lofi-toggle');
    const btnLofiPrev = document.getElementById('btn-lofi-prev');
    const btnLofiNext = document.getElementById('btn-lofi-next');
    const lofiVol = document.getElementById('lofi-volume');

    if (btnLofiToggle) btnLofiToggle.addEventListener('click', toggleLofiPlayback);
    if (btnLofiPrev) {
      btnLofiPrev.addEventListener('click', () => {
        state.lofi.stationIndex = (state.lofi.stationIndex - 1 + LOFI_STATIONS.length) % LOFI_STATIONS.length;
        if (state.lofi.playing) startCurrentLofiStation();
        else updateLofiUI();
      });
    }
    if (btnLofiNext) {
      btnLofiNext.addEventListener('click', () => {
        state.lofi.stationIndex = (state.lofi.stationIndex + 1) % LOFI_STATIONS.length;
        if (state.lofi.playing) startCurrentLofiStation();
        else updateLofiUI();
      });
    }
    if (lofiVol) {
      lofiVol.value = String(Math.round(state.lofi.volume * 100));
      lofiVol.addEventListener('input', () => {
        const v = Number(lofiVol.value || 45);
        state.lofi.volume = v / 100;
        localStorage.setItem(STORAGE_KEYS.LOFI_VOLUME, String(v));
        if (state.lofi.masterGain && state.audioCtx) {
          state.lofi.masterGain.gain.setValueAtTime(state.lofi.volume * 0.25, state.audioCtx.currentTime);
        }
        if (state.lofi.audioEl) {
          state.lofi.audioEl.volume = state.lofi.volume;
        }
      });
    }

    // Atalhos de Teclado
    window.addEventListener('keydown', (e) => {
      const splashEl = document.getElementById('splash-screen');
      if (splashEl && !splashEl.classList.contains('hidden')) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          ensureAudioContext();
          splashEl.classList.add('hidden');
        }
        return;
      }

      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        toggleTaskTimer();
      } else if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        completeCurrentTask();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupEyeTracking();
    bindEvents();
    updateLofiUI();
    updateAttentionCountdownBadge();
    initTasksAndTimes();
  });
})();
