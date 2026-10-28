/* ============================================================================
   LightFocus v3 — Apple Liquid Glass Commercial SaaS Edition (app.js)
   - Multi-user SaaS Auth Gate (Entrar / Criar Conta) + Founder pre-seeded login
   - Single-Task Liquid Glass Focus Stage + Soft Refractive Light Pulse
   - Shortcut 'Q': Quick-Add Task Modal with Real-Time Natural Language Parser
   - Shortcut 'Cmd+K / Ctrl+K': Spotlight Search & Command Palette
   - Minimalist Apple Activity Bento, XP Progression & Todoist Sync
   ============================================================================ */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    THEME: 'lf_v3_theme',
    PULSE_5M: 'lf_v3_pulse_5m',
    SUBTASKS: 'lf_v3_subtasks_done'
  };

  const state = {
    authenticated: false,
    authMode: 'login', // 'login' | 'register'
    user: null,
    hasTodoistToken: false,
    tasks: [],
    filter: 'pending', // 'pending' | 'all' | 'completed'
    currentTaskId: null,
    descExpanded: false,
    subtasksDone: loadJsonStorage(STORAGE_KEYS.SUBTASKS, {}),
    timerRunning: false,
    timerSeconds: 0,
    timerStartedAt: null,
    timerInterval: null,
    pulse5mEnabled: localStorage.getItem(STORAGE_KEYS.PULSE_5M) !== '0',
    theme: localStorage.getItem(STORAGE_KEYS.THEME) || 'light',
    timesData: {
      sessions: [],
      taskAverages: {},
      taskEstimates: {},
      dailySummary: {}
    },
    qaPicker: {
      date: 'today',
      est: 15,
      prio: 'p4'
    },
    spotlightIndex: 0,
    spotlightItems: []
  };

  function loadJsonStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveJsonStorage(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  function stripEmojis(str) {
    if (!str) return '';
    return String(str)
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function getTodayDateStr() {
    const fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return fmt.format(new Date());
  }

  function addDaysDateStr(days) {
    const d = new Date(Date.now() + days * 86400000);
    const fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return fmt.format(d);
  }

  function formatDurationMMSS(totalSec) {
    const s = Math.max(0, Math.floor(Number(totalSec || 0)));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function getInitials(name) {
    const parts = String(name || 'Usuario')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) return 'LF';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // ==========================================================================
  // REFRACTIVE LIGHT PULSE & SUBTLE HARMONIC AUDIO
  // ==========================================================================
  function triggerLightPulse() {
    const overlay = document.getElementById('lightPulseOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    void overlay.offsetWidth;
    overlay.classList.add('active');
    setTimeout(() => overlay.classList.remove('active'), 950);
  }

  function playGlassHarmonic(kind) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const notes = kind === 'complete' ? [523.25, 659.25, 783.99, 1046.5] : [587.33, 880];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.065);
        gain.gain.setValueAtTime(0.0001, now + idx * 0.065);
        gain.gain.exponentialRampToValueAtTime(0.045, now + idx * 0.065 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.065 + 0.42);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.065);
        osc.stop(now + idx * 0.065 + 0.45);
      });
    } catch (_) {}
  }

  let toastTimeout = null;
  function showToast(message) {
    const toast = document.getElementById('glassToast');
    const textEl = document.getElementById('glassToastText');
    if (!toast || !textEl) return;
    textEl.textContent = stripEmojis(message);
    toast.classList.remove('hidden');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }

  // ==========================================================================
  // THEME ENGINE (Pearl Light / Obsidian Dark)
  // ==========================================================================
  function applyTheme(theme) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem(STORAGE_KEYS.THEME, state.theme);
    const iconSvg = document.getElementById('themeIconSvg');
    if (iconSvg) {
      if (state.theme === 'dark') {
        iconSvg.innerHTML =
          '<circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.75"/><path d="M12 2V4.5M12 19.5V22M2 12H4.5M19.5 12H22M4.93 4.93L6.7 6.7M17.3 17.3L19.07 19.07M19.07 4.93L17.3 6.7M6.7 17.3L4.93 19.07" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>';
      } else {
        iconSvg.innerHTML =
          '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>';
      }
    }
  }

  // ==========================================================================
  // NATURAL LANGUAGE SCHEDULE PARSER (FOR SHORTCUT 'Q')
  // ==========================================================================
  function parseNaturalLanguageTask(rawInput, fallbackPicker) {
    let text = String(rawInput || '').trim();
    const detected = {
      dueDate: null,
      dueDateLabel: null,
      dueTime: null,
      estimatedMinutes: null,
      priority: null,
      recurring: null,
      labels: []
    };

    // 1. Extract #tags
    text = text.replace(/(?:^|\s)#([a-zA-Z0-9_-]+)/g, (match, tag) => {
      detected.labels.push(tag.toLowerCase());
      return ' ';
    });

    // 2. Extract priority: p1, p2, p3, p4
    text = text.replace(/(?:^|\s)(p[1-4])(?=\s|$)/i, (match, p) => {
      detected.priority = p.toLowerCase();
      return ' ';
    });

    // 3. Extract duration/estimate: 15m, 25min, 45m, 1h, 1h30, 2h
    text = text.replace(/(?:^|\s)(\d{1,2})\s*h(?:\s*(\d{1,2})\s*m(?:in)?)?(?=\s|$)/i, (match, h, m) => {
      const mins = Number(h) * 60 + (m ? Number(m) : 0);
      if (mins > 0 && mins <= 480) detected.estimatedMinutes = mins;
      return ' ';
    });
    if (!detected.estimatedMinutes) {
      text = text.replace(/(?:^|\s)(\d{1,3})\s*(?:m|min|minutos)(?=\s|$)/i, (match, m) => {
        const mins = Number(m);
        if (mins > 0 && mins <= 480) detected.estimatedMinutes = mins;
        return ' ';
      });
    }

    // 4. Extract recurrence: todo dia, todos os dias, diario, semanal, mensal
    text = text.replace(/(?:^|\s)(todo\s+dia|todos\s+os\s+dias|diario|diariamente|semanal|mensal)(?=\s|$)/i, (match, rec) => {
      detected.recurring = rec.toLowerCase();
      return ' ';
    });

    // 5. Extract time: às 14:30, 14:30, às 15h, 9h30
    text = text.replace(/(?:^|\s)(?:as|às)?\s*(\d{1,2}):(\d{2})(?=\s|$)/i, (match, hh, mm) => {
      const h = Number(hh);
      const m = Number(mm);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        detected.dueTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        return ' ';
      }
      return match;
    });
    if (!detected.dueTime) {
      text = text.replace(/(?:^|\s)(?:as|às)\s*(\d{1,2})h(\d{2})?(?=\s|$)/i, (match, hh, mm) => {
        const h = Number(hh);
        const m = mm ? Number(mm) : 0;
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
          detected.dueTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          return ' ';
        }
        return match;
      });
    }

    // 6. Extract relative dates: hoje, amanha, seg, ter, qua, qui, sex, sab, dom, DD/MM
    text = text.replace(/(?:^|\s)(hoje|amanha|amanhã|segunda|seg|terca|terça|ter|quarta|qua|quinta|qui|sexta|sex|sabado|sábado|sab|domingo|dom)(?=\s|$)/i, (match, word) => {
      const w = word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (w === 'hoje') {
        detected.dueDate = getTodayDateStr();
        detected.dueDateLabel = 'Hoje';
      } else if (w === 'amanha') {
        detected.dueDate = addDaysDateStr(1);
        detected.dueDateLabel = 'Amanha';
      } else {
        const mapDay = { dom: 0, domingo: 0, seg: 1, segunda: 1, ter: 2, terca: 2, qua: 3, quarta: 3, qui: 4, quinta: 4, sex: 5, sexta: 5, sab: 6, sabado: 6 };
        const targetDow = mapDay[w];
        if (targetDow !== undefined) {
          const nowDow = new Date().getDay();
          let diff = (targetDow - nowDow + 7) % 7;
          if (diff === 0) diff = 7;
          detected.dueDate = addDaysDateStr(diff);
          detected.dueDateLabel = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }
      }
      return ' ';
    });

    if (!detected.dueDate) {
      text = text.replace(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/, (match, dd, mm) => {
        const d = Number(dd);
        const m = Number(mm);
        if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
          const year = new Date().getFullYear();
          detected.dueDate = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          detected.dueDateLabel = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
          return ' ';
        }
        return match;
      });
    }

    const cleanTitle = stripEmojis(text.replace(/\s{2,}/g, ' ').trim());

    // Apply fallback picker values when not overridden by NLP text
    const picker = fallbackPicker || state.qaPicker;
    let finalDueDate = detected.dueDate;
    let finalDateLabel = detected.dueDateLabel;
    if (!finalDueDate) {
      if (picker.date === 'tomorrow') {
        finalDueDate = addDaysDateStr(1);
        finalDateLabel = 'Amanha';
      } else if (picker.date === 'nextweek') {
        finalDueDate = addDaysDateStr(7);
        finalDateLabel = 'Prox Semana';
      } else {
        finalDueDate = getTodayDateStr();
        finalDateLabel = 'Hoje';
      }
    }

    const finalEst = detected.estimatedMinutes || picker.est || 15;
    const finalPrio = detected.priority || picker.prio || 'p4';

    return {
      cleanTitle: cleanTitle || stripEmojis(rawInput).trim(),
      dueDate: finalDueDate,
      dueDateLabel: finalDateLabel,
      dueTime: detected.dueTime,
      estimatedMinutes: finalEst,
      priority: finalPrio,
      recurring: detected.recurring,
      labels: detected.labels,
      explicitTokens: detected
    };
  }

  // ==========================================================================
  // AUTH GATE & SESSION MANAGEMENT
  // ==========================================================================
  function setAuthMode(mode) {
    state.authMode = mode === 'register' ? 'register' : 'login';
    const tabLogin = document.getElementById('authTabLogin');
    const tabReg = document.getElementById('authTabRegister');
    const nameGroup = document.getElementById('authNameGroup');
    const emailHint = document.getElementById('authEmailHint');
    const submitLabel = document.getElementById('authSubmitLabel');
    const errMsg = document.getElementById('authErrorMsg');

    if (errMsg) errMsg.classList.add('hidden');
    if (tabLogin && tabReg) {
      tabLogin.classList.toggle('active', state.authMode === 'login');
      tabLogin.setAttribute('aria-selected', state.authMode === 'login' ? 'true' : 'false');
      tabReg.classList.toggle('active', state.authMode === 'register');
      tabReg.setAttribute('aria-selected', state.authMode === 'register' ? 'true' : 'false');
    }
    if (nameGroup) {
      nameGroup.classList.toggle('hidden', state.authMode !== 'register');
    }
    if (emailHint) {
      emailHint.classList.toggle('hidden', state.authMode === 'register');
    }
    if (submitLabel) {
      submitLabel.textContent = state.authMode === 'register' ? 'Criar Conta & Entrar' : 'Entrar no Workspace';
    }
  }

  function updateAuthUI() {
    const gate = document.getElementById('authGateOverlay');
    const shell = document.getElementById('appShell');
    if (state.authenticated) {
      if (gate) gate.classList.add('hidden');
      if (shell) shell.classList.remove('hidden');
      renderUserHeaderAndXP();
    } else {
      if (gate) gate.classList.remove('hidden');
      if (shell) shell.classList.add('hidden');
    }
  }

  function renderUserHeaderAndXP() {
    const u = state.user || {
      name: 'Walace Messias',
      email: 'walacetkwl@gmail.com',
      xp: 0,
      level: 1,
      levelTitle: 'Cristal',
      streak: 1,
      nextLevelXp: 150
    };
    const initials = getInitials(u.name);
    const shortName = String(u.name || 'Walace').split(/\s+/)[0];

    const avatarEl = document.getElementById('userInitialsAvatar');
    const nameShortEl = document.getElementById('userNameShort');
    const settingsAvatar = document.getElementById('settingsAvatar');
    const settingsName = document.getElementById('settingsUserName');
    const settingsEmail = document.getElementById('settingsUserEmail');

    if (avatarEl) avatarEl.textContent = initials;
    if (nameShortEl) nameShortEl.textContent = shortName;
    if (settingsAvatar) settingsAvatar.textContent = initials;
    if (settingsName) settingsName.textContent = u.name || 'Walace Messias';
    if (settingsEmail) settingsEmail.textContent = u.email || 'walacetkwl@gmail.com';

    const xp = Number(u.xp || 0);
    const lvl = Number(u.level || 1);
    const title = u.levelTitle || 'Cristal';
    const nextXp = Number(u.nextLevelXp || lvl * 250);
    const pct = Math.min(100, Math.max(8, Math.round((xp / Math.max(1, nextXp)) * 100)));

    const topLevelLabel = document.getElementById('topLevelLabel');
    const topXpValue = document.getElementById('topXpValue');
    const topXpArc = document.getElementById('topXpArc');
    if (topLevelLabel) topLevelLabel.textContent = `Nv ${lvl} · ${title}`;
    if (topXpValue) topXpValue.textContent = `${xp} XP`;
    if (topXpArc) {
      const circum = 56.5;
      topXpArc.style.strokeDashoffset = String((circum - (circum * pct) / 100).toFixed(1));
    }

    const repLvlTitle = document.getElementById('reportLevelTitle');
    const repXpSub = document.getElementById('reportXpSubtitle');
    const repBar = document.getElementById('reportXpBarFill');
    const repStreak = document.getElementById('reportStreakNum');
    const repTotalXp = document.getElementById('reportTotalXpNum');

    if (repLvlTitle) repLvlTitle.textContent = `Nivel ${lvl} · ${title}`;
    if (repXpSub) repXpSub.textContent = `${xp} XP acumulados · Proximo nivel em ${nextXp} XP`;
    if (repBar) repBar.style.width = `${pct}%`;
    if (repStreak) repStreak.textContent = `${u.streak || 1}d`;
    if (repTotalXp) repTotalXp.textContent = String(xp);
  }

  async function checkSessionAndBoot() {
    try {
      const r = await fetch('/api/auth/verify');
      const d = await r.json();
      if (d && d.authenticated) {
        state.authenticated = true;
        state.user = d.user || null;
        state.hasTodoistToken = Boolean(d.hasServerTodoistToken);
        updateAuthUI();
        await loadWorkspaceData();
        return;
      }
    } catch (_) {}
    state.authenticated = false;
    updateAuthUI();
  }

  async function loadWorkspaceData(forceLive) {
    const syncLbl = document.getElementById('syncStatusLabel');
    const syncIcon = document.getElementById('syncIconSvg');
    if (syncLbl) syncLbl.textContent = 'Sincronizando...';
    if (syncIcon) syncIcon.style.transform = 'rotate(180deg)';

    try {
      const [tasksRes, timesRes] = await Promise.all([
        fetch(forceLive ? '/api/tasks?live=1' : '/api/tasks'),
        fetch('/api/times')
      ]);

      if (tasksRes.status === 401) {
        state.authenticated = false;
        updateAuthUI();
        return;
      }

      const tasksJson = await tasksRes.json();
      if (tasksJson && tasksJson.user) {
        state.user = tasksJson.user;
      }
      state.hasTodoistToken = Boolean(tasksJson && tasksJson.hasServerTodoistToken);
      if (tasksJson && tasksJson.snapshot && Array.isArray(tasksJson.snapshot.tasks)) {
        state.tasks = tasksJson.snapshot.tasks.map(normalizeClientTask);
      } else if (window.LIGHTFOCUS_INITIAL_SNAPSHOT && Array.isArray(window.LIGHTFOCUS_INITIAL_SNAPSHOT.tasks)) {
        state.tasks = window.LIGHTFOCUS_INITIAL_SNAPSHOT.tasks.map(normalizeClientTask);
      }

      if (timesRes.ok) {
        const timesJson = await timesRes.json();
        if (timesJson && timesJson.data) {
          state.timesData = timesJson.data;
        }
      }
    } catch (_) {
      if (window.LIGHTFOCUS_INITIAL_SNAPSHOT && Array.isArray(window.LIGHTFOCUS_INITIAL_SNAPSHOT.tasks)) {
        state.tasks = window.LIGHTFOCUS_INITIAL_SNAPSHOT.tasks.map(normalizeClientTask);
      }
    } finally {
      if (syncLbl) {
        syncLbl.textContent = state.hasTodoistToken ? 'Todoist Sincronizado' : 'Cloud Sincronizado';
      }
      if (syncIcon) syncIcon.style.transform = '';
    }

    ensureValidCurrentTask();
    renderUserHeaderAndXP();
    renderAll();
  }

  function normalizeClientTask(t, idx) {
    const id = String(t.id);
    const estFromTimes = state.timesData && state.timesData.taskEstimates && state.timesData.taskEstimates[id];
    return {
      id,
      content: stripEmojis(t.content || 'Tarefa sem titulo'),
      description: String(t.description || '').replace(/\[LF_EST:\d+m\]/gi, '').trim(),
      dueDate: t.dueDate || getTodayDateStr(),
      dueTime: t.dueTime || null,
      recurring: t.recurring || false,
      priority: ['p1', 'p2', 'p3', 'p4'].includes(String(t.priority || '').toLowerCase())
        ? String(t.priority).toLowerCase()
        : 'p4',
      projectName: stripEmojis(t.projectName || 'Hoje · Principal'),
      labels: Array.isArray(t.labels) ? t.labels.map(stripEmojis) : [],
      checked: Boolean(t.checked),
      estimatedMinutes: Number(t.estimatedMinutes || estFromTimes || 15),
      subtasks: Array.isArray(t.subtasks)
        ? t.subtasks.map((s) => ({
            id: String(s.id),
            content: stripEmojis(s.content || ''),
            checked: Boolean(s.checked || state.subtasksDone[s.id])
          }))
        : [],
      dayOrder: Number(t.dayOrder || idx + 1)
    };
  }

  function getFilteredTasks() {
    if (state.filter === 'pending') {
      return state.tasks.filter((t) => !t.checked);
    }
    if (state.filter === 'completed') {
      return state.tasks.filter((t) => t.checked);
    }
    return state.tasks;
  }

  function ensureValidCurrentTask() {
    const list = getFilteredTasks();
    if (list.length === 0) {
      state.currentTaskId = null;
      return;
    }
    const exists = list.some((t) => t.id === state.currentTaskId);
    if (!exists) {
      state.currentTaskId = list[0].id;
    }
  }

  function getCurrentTask() {
    const list = getFilteredTasks();
    if (list.length === 0) return null;
    return list.find((t) => t.id === state.currentTaskId) || list[0];
  }

  // ==========================================================================
  // RENDERING: FOCUS CARD, BENTO PROGRESS RING & AGENDA QUEUE
  // ==========================================================================
  function renderAll() {
    ensureValidCurrentTask();
    renderFocusCard();
    renderDayOverviewAndQueue();
  }

  function renderFocusCard() {
    const list = getFilteredTasks();
    const task = getCurrentTask();

    const counterPill = document.getElementById('taskCounterPill');
    const schedText = document.getElementById('taskScheduleText');
    const prioBadge = document.getElementById('taskPriorityBadge');
    const estLabel = document.getElementById('taskEstimateLabel');
    const heroCheckBtn = document.getElementById('heroCheckBtn');
    const titleEl = document.getElementById('focusTaskTitle');
    const tagsRow = document.getElementById('focusTaskTagsRow');
    const descContainer = document.getElementById('focusDescContainer');
    const descContent = document.getElementById('focusDescContent');
    const toggleDescBtn = document.getElementById('toggleDescExpandBtn');
    const toggleDescLbl = document.getElementById('toggleDescExpandLabel');
    const subtasksBox = document.getElementById('focusSubtasksBox');
    const subtasksBadge = document.getElementById('subtasksProgressBadge');
    const subtasksList = document.getElementById('focusSubtasksList');

    if (!task) {
      if (counterPill) counterPill.textContent = '00 / 00';
      if (schedText) schedText.textContent = 'Agenda Livre';
      if (prioBadge) {
        prioBadge.className = 'glass-badge-priority p4';
        prioBadge.textContent = 'P4';
      }
      if (estLabel) estLabel.textContent = '-- min';
      if (heroCheckBtn) heroCheckBtn.classList.remove('checked');
      if (titleEl) {
        titleEl.textContent =
          state.filter === 'completed'
            ? 'Nenhuma tarefa concluida ainda.'
            : 'Tudo concluido por agora. Pressione Q para criar uma nova tarefa.';
      }
      if (tagsRow) tagsRow.innerHTML = '';
      if (descContainer) descContainer.classList.add('hidden');
      if (subtasksBox) subtasksBox.classList.add('hidden');
      return;
    }

    const idx = list.findIndex((t) => t.id === task.id);
    if (counterPill) {
      counterPill.textContent = `${String(idx + 1).padStart(2, '0')} / ${String(list.length).padStart(2, '0')}`;
    }

    const todayStr = getTodayDateStr();
    const datePart = task.dueDate === todayStr ? 'Hoje' : task.dueDate || 'Hoje';
    const timePart = task.dueTime ? ` · ${task.dueTime}` : '';
    const recPart = task.recurring ? ' · Recorrente' : '';
    if (schedText) schedText.textContent = `${datePart}${timePart}${recPart}`;

    if (prioBadge) {
      prioBadge.className = `glass-badge-priority ${task.priority || 'p4'}`;
      prioBadge.textContent = String(task.priority || 'p4').toUpperCase();
    }

    if (estLabel) {
      estLabel.textContent = `${task.estimatedMinutes || 15} min`;
    }

    if (heroCheckBtn) {
      heroCheckBtn.classList.toggle('checked', Boolean(task.checked));
    }

    if (titleEl) {
      titleEl.textContent = task.content;
    }

    if (tagsRow) {
      const chips = [];
      if (task.projectName) {
        chips.push(`<span class="task-tag-chip">${escapeHtml(task.projectName)}</span>`);
      }
      (task.labels || []).forEach((lbl) => {
        chips.push(`<span class="task-tag-chip">#${escapeHtml(lbl)}</span>`);
      });
      tagsRow.innerHTML = chips.join('');
    }

    // Long description handling with mobile-safe wrapping & expand button
    const cleanDesc = String(task.description || '').trim();
    if (descContainer && descContent && toggleDescBtn && toggleDescLbl) {
      if (cleanDesc) {
        descContainer.classList.remove('hidden');
        descContent.textContent = cleanDesc;
        descContent.classList.toggle('expanded', state.descExpanded);
        const isLong = cleanDesc.length > 180 || cleanDesc.split('\n').length > 3;
        toggleDescBtn.classList.toggle('hidden', !isLong);
        toggleDescLbl.textContent = state.descExpanded
          ? 'Recolher descricao'
          : 'Expandir descricao completa';
      } else {
        descContainer.classList.add('hidden');
      }
    }

    // Subtasks
    if (subtasksBox && subtasksBadge && subtasksList) {
      const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
      if (subs.length > 0) {
        subtasksBox.classList.remove('hidden');
        const doneCount = subs.filter((s) => s.checked || state.subtasksDone[s.id]).length;
        subtasksBadge.textContent = `${doneCount}/${subs.length}`;
        subtasksList.innerHTML = subs
          .map((s) => {
            const isDone = Boolean(s.checked || state.subtasksDone[s.id]);
            return `
              <li class="subtask-row ${isDone ? 'done' : ''}" data-subtask-id="${escapeHtml(s.id)}">
                <span class="subtask-mini-check" aria-hidden="true">
                  <svg class="icon-13" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12.5L9.5 17L19 7.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
                <span>${escapeHtml(s.content)}</span>
              </li>
            `;
          })
          .join('');
      } else {
        subtasksBox.classList.add('hidden');
      }
    }

    updateTimerProgressUI();
  }

  function renderDayOverviewAndQueue() {
    const total = state.tasks.length;
    const completed = state.tasks.filter((t) => t.checked).length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const ringCircle = document.getElementById('dayProgressCircle');
    const ringPct = document.getElementById('dayProgressPct');
    const countEl = document.getElementById('completedSummaryCount');
    const focusedStat = document.getElementById('focusedTodayStat');
    const etaStat = document.getElementById('etaFinishStat');

    if (ringCircle) {
      const circum = 226.2;
      const offset = circum - (circum * pct) / 100;
      ringCircle.style.strokeDashoffset = String(offset.toFixed(1));
    }
    if (ringPct) ringPct.textContent = `${pct}%`;
    if (countEl) countEl.textContent = `${completed} de ${total}`;

    // Calculate focused minutes today
    const todayStr = getTodayDateStr();
    const sessions = (state.timesData && Array.isArray(state.timesData.sessions)) ? state.timesData.sessions : [];
    const todaySec = sessions
      .filter((s) => s.date === todayStr)
      .reduce((acc, s) => acc + Number(s.durationSeconds || 0), 0);
    const totalMins = Math.round((todaySec + state.timerSeconds) / 60);
    if (focusedStat) focusedStat.textContent = `${totalMins}m`;

    // Calculate ETA based on remaining pending tasks' estimated minutes
    const remMins = state.tasks
      .filter((t) => !t.checked)
      .reduce((acc, t) => acc + Number(t.estimatedMinutes || 15), 0);
    if (etaStat) {
      if (remMins <= 0) {
        etaStat.textContent = 'Concluido';
      } else {
        const etaDate = new Date(Date.now() + remMins * 60000);
        const fmt = new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        etaStat.textContent = fmt.format(etaDate);
      }
    }

    // Queue list
    const list = getFilteredTasks();
    const queueBadge = document.getElementById('queueTotalBadge');
    const queueContainer = document.getElementById('agendaQueueList');
    if (queueBadge) queueBadge.textContent = String(list.length);
    if (!queueContainer) return;

    if (list.length === 0) {
      queueContainer.innerHTML = `<div class="history-row"><span class="history-row-meta">Nenhuma tarefa neste filtro.</span></div>`;
      return;
    }

    const current = getCurrentTask();
    queueContainer.innerHTML = list
      .map((t) => {
        const isActive = current && current.id === t.id;
        const timeTag = t.dueTime ? `${t.dueTime} · ` : '';
        return `
          <div class="queue-item-row ${isActive ? 'active-focus' : ''} ${t.checked ? 'completed' : ''}" data-task-id="${escapeHtml(t.id)}" role="listitem">
            <button type="button" class="queue-mini-check" data-check-task-id="${escapeHtml(t.id)}" aria-label="Concluir tarefa">
              <svg class="icon-13" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5L9.5 17L19 7.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <span class="queue-item-text">${escapeHtml(t.content)}</span>
            <span class="queue-item-est">${escapeHtml(timeTag)}${t.estimatedMinutes || 15}m</span>
          </div>
        `;
      })
      .join('');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ==========================================================================
  // TIMER CONSOLE & 5-MINUTE REFRACTIVE PULSE
  // ==========================================================================
  function toggleTimerPlayPause() {
    if (state.timerRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  }

  function startTimer() {
    const task = getCurrentTask();
    if (!task) {
      showToast('Selecione ou crie uma tarefa para focar.');
      return;
    }
    state.timerRunning = true;
    if (!state.timerStartedAt) {
      state.timerStartedAt = new Date().toISOString();
    }
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      state.timerSeconds += 1;
      updateTimerProgressUI();
      if (state.timerSeconds > 0 && state.timerSeconds % 300 === 0 && state.pulse5mEnabled) {
        triggerLightPulse();
        playGlassHarmonic('pulse');
        showToast('5 minutos de foco profundo registrados.');
      }
      if (state.timerSeconds % 60 === 0) {
        renderDayOverviewAndQueue();
      }
    }, 1000);
    updateTimerProgressUI();
  }

  function pauseTimer() {
    state.timerRunning = false;
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    updateTimerProgressUI();
  }

  function resetTimer() {
    pauseTimer();
    state.timerSeconds = 0;
    state.timerStartedAt = null;
    updateTimerProgressUI();
  }

  function updateTimerProgressUI() {
    const display = document.getElementById('timerDisplay');
    const subStatus = document.getElementById('timerSubStatus');
    const dot = document.getElementById('timerStateDot');
    const playLabel = document.getElementById('timerPlayLabel');
    const playIcon = document.getElementById('timerPlayIcon');
    const bar = document.getElementById('timerProgressBar');

    if (display) display.textContent = formatDurationMMSS(state.timerSeconds);
    if (dot) dot.classList.toggle('running', state.timerRunning);

    const task = getCurrentTask();
    const estSec = Math.max(60, Number((task && task.estimatedMinutes) || 15) * 60);
    const pct = Math.min(100, (state.timerSeconds / estSec) * 100);
    if (bar) bar.style.width = `${pct.toFixed(1)}%`;

    if (subStatus) {
      if (state.timerRunning) {
        subStatus.textContent = `Focando · Meta ${Math.round(estSec / 60)}m`;
      } else if (state.timerSeconds > 0) {
        subStatus.textContent = 'Pausado · Pronto para retomar';
      } else {
        subStatus.textContent = 'Pronto para focar';
      }
    }

    if (playLabel) {
      playLabel.textContent = state.timerRunning ? 'Pausar' : state.timerSeconds > 0 ? 'Retomar' : 'Iniciar Foco';
    }
    if (playIcon) {
      if (state.timerRunning) {
        playIcon.innerHTML =
          '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>';
      } else {
        playIcon.innerHTML =
          '<path d="M7 5.5V18.5L18 12L7 5.5Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>';
      }
    }
  }

  // ==========================================================================
  // TASK COMPLETION / UNCOMPLETION / ESTIMATE / NAVIGATION
  // ==========================================================================
  async function toggleTaskChecked(taskId) {
    const target = state.tasks.find((t) => t.id === String(taskId));
    if (!target) return;

    if (target.checked) {
      // Uncomplete
      target.checked = false;
      renderAll();
      showToast('Tarefa reaberta na agenda.');
      try {
        const r = await fetch('/api/tasks/uncomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: target.id })
        });
        const d = await r.json();
        if (d && d.snapshot && Array.isArray(d.snapshot.tasks)) {
          state.tasks = d.snapshot.tasks.map(normalizeClientTask);
          renderAll();
        }
      } catch (_) {}
      return;
    }

    // Complete task with signature soft refractive light pulse
    const isCurrent = getCurrentTask() && getCurrentTask().id === target.id;
    const elapsedSec = isCurrent ? state.timerSeconds : 0;
    const startedAt = isCurrent && state.timerStartedAt ? state.timerStartedAt : new Date().toISOString();

    if (isCurrent) {
      resetTimer();
    }

    triggerLightPulse();
    playGlassHarmonic('complete');

    const card = document.getElementById('focusTaskCard');
    const heroBtn = document.getElementById('heroCheckBtn');
    if (isCurrent && heroBtn) heroBtn.classList.add('checked');
    if (isCurrent && card) card.classList.add('completing-anim');

    setTimeout(async () => {
      target.checked = true;
      if (card) card.classList.remove('completing-anim');
      ensureValidCurrentTask();
      renderAll();

      try {
        const r = await fetch('/api/tasks/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: target.id,
            content: target.content,
            estimatedMinutes: target.estimatedMinutes || 15,
            durationSeconds: elapsedSec,
            startedAt,
            endedAt: new Date().toISOString(),
            completedWithoutTimer: elapsedSec === 0
          })
        });
        const d = await r.json();
        if (d && d.user) {
          state.user = d.user;
          renderUserHeaderAndXP();
        }
        if (d && d.times) {
          state.timesData = d.times;
        }
        if (d && d.snapshot && Array.isArray(d.snapshot.tasks)) {
          state.tasks = d.snapshot.tasks.map(normalizeClientTask);
        }
        renderAll();
        showToast(`Tarefa concluida · +${d.xpGained || 50} XP`);
      } catch (_) {
        showToast('Tarefa concluida.');
      }
    }, 260);
  }

  async function saveTaskEstimate(minutes) {
    const task = getCurrentTask();
    if (!task) return;
    const mins = Math.min(480, Math.max(1, Math.round(Number(minutes || 15))));
    task.estimatedMinutes = mins;
    const bar = document.getElementById('inlineEstimateBar');
    if (bar) bar.classList.add('hidden');
    renderAll();
    showToast(`Estimativa ajustada para ${mins} min.`);

    try {
      const r = await fetch('/api/tasks/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, estimatedMinutes: mins })
      });
      const d = await r.json();
      if (d && d.times) state.timesData = d.times;
    } catch (_) {}
  }

  function stepTask(delta) {
    const list = getFilteredTasks();
    if (list.length === 0) return;
    const cur = getCurrentTask();
    const curIdx = cur ? list.findIndex((t) => t.id === cur.id) : 0;
    const nextIdx = (curIdx + delta + list.length) % list.length;
    state.currentTaskId = list[nextIdx].id;
    state.descExpanded = false;
    resetTimer();
    renderAll();
  }

  // ==========================================================================
  // SHORTCUT 'Q': QUICK-ADD MODAL WITH LIVE NLP PREVIEW
  // ==========================================================================
  function openQuickAddModal(prefillText) {
    closeAllModals();
    const modal = document.getElementById('quickAddModal');
    const input = document.getElementById('quickAddInput');
    const desc = document.getElementById('quickAddDesc');
    if (!modal) return;
    modal.classList.remove('hidden');
    if (input) {
      input.value = prefillText || '';
      setTimeout(() => input.focus(), 30);
    }
    if (desc) desc.value = '';
    updateQuickAddNlpPreview();
  }

  function updateQuickAddNlpPreview() {
    const input = document.getElementById('quickAddInput');
    const tokensList = document.getElementById('nlpTokensList');
    if (!tokensList) return;
    const raw = input ? input.value : '';
    const parsed = parseNaturalLanguageTask(raw, state.qaPicker);

    const chips = [];
    chips.push(
      `<span class="nlp-chip">Data: ${escapeHtml(parsed.dueDateLabel || 'Hoje')}${parsed.dueTime ? ' ' + escapeHtml(parsed.dueTime) : ''}</span>`
    );
    chips.push(`<span class="nlp-chip">Tempo: ${parsed.estimatedMinutes}m</span>`);
    chips.push(`<span class="nlp-chip">Prioridade: ${parsed.priority.toUpperCase()}</span>`);
    if (parsed.recurring) {
      chips.push(`<span class="nlp-chip">Recorrencia: ${escapeHtml(parsed.recurring)}</span>`);
    }
    parsed.labels.forEach((lbl) => {
      chips.push(`<span class="nlp-chip">#${escapeHtml(lbl)}</span>`);
    });
    tokensList.innerHTML = chips.join('');
  }

  async function handleQuickAddSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('quickAddInput');
    const desc = document.getElementById('quickAddDesc');
    const raw = input ? input.value.trim() : '';
    if (!raw) {
      showToast('Digite o nome da tarefa.');
      return;
    }

    const parsed = parseNaturalLanguageTask(raw, state.qaPicker);
    const description = desc ? desc.value.trim() : '';

    closeAllModals();
    showToast('Criando tarefa na agenda...');

    try {
      const r = await fetch('/api/tasks/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: parsed.cleanTitle,
          description,
          dueDate: parsed.dueDate,
          dueTime: parsed.dueTime,
          recurring: parsed.recurring,
          estimatedMinutes: parsed.estimatedMinutes,
          priority: parsed.priority,
          labels: parsed.labels
        })
      });
      const d = await r.json();
      if (d && d.ok) {
        if (d.user) {
          state.user = d.user;
          renderUserHeaderAndXP();
        }
        if (d.snapshot && Array.isArray(d.snapshot.tasks)) {
          state.tasks = d.snapshot.tasks.map(normalizeClientTask);
        }
        if (d.task && d.task.id) {
          state.filter = 'pending';
          state.currentTaskId = String(d.task.id);
        }
        renderAll();
        triggerLightPulse();
        showToast('Nova tarefa adicionada · +10 XP');
      } else {
        showToast((d && d.error) || 'Erro ao criar tarefa.');
      }
    } catch (_) {
      showToast('Erro de conexao ao criar tarefa.');
    }
  }

  // ==========================================================================
  // SHORTCUT 'CMD+K / CTRL+K': SPOTLIGHT SEARCH & COMMAND BAR
  // ==========================================================================
  function openSpotlightModal() {
    closeAllModals();
    const modal = document.getElementById('spotlightModal');
    const input = document.getElementById('spotlightInput');
    if (!modal) return;
    modal.classList.remove('hidden');
    state.spotlightIndex = 0;
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 30);
    }
    renderSpotlightResults('');
  }

  function renderSpotlightResults(query) {
    const q = String(query || '').trim().toLowerCase();
    const container = document.getElementById('spotlightResultsList');
    if (!container) return;

    const commands = [
      {
        type: 'cmd',
        id: 'cmd_new_task',
        title: 'Criar Nova Tarefa com Atalhos de Agenda',
        right: 'Tecla Q',
        run: () => openQuickAddModal(q)
      },
      {
        type: 'cmd',
        id: 'cmd_toggle_timer',
        title: state.timerRunning ? 'Pausar Cronometro de Foco' : 'Iniciar Cronometro de Foco',
        right: 'Espaco',
        run: () => toggleTimerPlayPause()
      },
      {
        type: 'cmd',
        id: 'cmd_complete_current',
        title: 'Concluir Tarefa em Foco Agora',
        right: '+50 XP',
        run: () => {
          const cur = getCurrentTask();
          if (cur) toggleTaskChecked(cur.id);
        }
      },
      {
        type: 'cmd',
        id: 'cmd_open_reports',
        title: 'Abrir Relatorios de Foco & Nivel de XP',
        right: 'Relatorios',
        run: () => openReportsModal()
      },
      {
        type: 'cmd',
        id: 'cmd_sync_todoist',
        title: 'Sincronizar com Todoist Agora',
        right: 'Sync',
        run: () => loadWorkspaceData(true)
      },
      {
        type: 'cmd',
        id: 'cmd_toggle_theme',
        title: state.theme === 'dark' ? 'Mudar para Modo Claro (Pearl Light)' : 'Mudar para Modo Escuro (Obsidian Dark)',
        right: 'Tema',
        run: () => applyTheme(state.theme === 'dark' ? 'light' : 'dark')
      }
    ];

    const matchingTasks = state.tasks
      .filter((t) => {
        if (!q) return !t.checked;
        return (
          t.content.toLowerCase().includes(q) ||
          (t.projectName && t.projectName.toLowerCase().includes(q)) ||
          (t.labels || []).some((l) => l.toLowerCase().includes(q))
        );
      })
      .slice(0, 8)
      .map((t) => ({
        type: 'task',
        id: t.id,
        title: t.content,
        right: `${t.checked ? 'Concluida · ' : ''}${t.estimatedMinutes || 15}m`,
        run: () => {
          state.filter = t.checked ? 'all' : 'pending';
          state.currentTaskId = t.id;
          renderAll();
          showToast('Tarefa colocada em foco.');
        }
      }));

    const matchingCmds = commands.filter((c) => !q || c.title.toLowerCase().includes(q));
    state.spotlightItems = [...matchingTasks, ...matchingCmds];
    if (state.spotlightIndex >= state.spotlightItems.length) {
      state.spotlightIndex = 0;
    }

    if (state.spotlightItems.length === 0) {
      container.innerHTML = `<div class="spotlight-item" data-spot-idx="0"><div class="spotlight-item-left"><span class="spotlight-item-title">Criar tarefa "${escapeHtml(query)}"</span></div><span class="spotlight-item-right">Enter</span></div>`;
      state.spotlightItems = [
        {
          type: 'cmd',
          id: 'cmd_quick_create',
          title: query,
          right: 'Enter',
          run: () => openQuickAddModal(query)
        }
      ];
      return;
    }

    let html = '';
    if (matchingTasks.length > 0) {
      html += `<div class="spotlight-section-label">Tarefas da Agenda</div>`;
      matchingTasks.forEach((item, idx) => {
        const sel = idx === state.spotlightIndex ? 'selected' : '';
        html += `
          <div class="spotlight-item ${sel}" data-spot-idx="${idx}" role="option">
            <div class="spotlight-item-left">
              <svg class="spotlight-item-icon" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.75"/>
              </svg>
              <span class="spotlight-item-title">${escapeHtml(item.title)}</span>
            </div>
            <span class="spotlight-item-right">${escapeHtml(item.right)}</span>
          </div>
        `;
      });
    }

    if (matchingCmds.length > 0) {
      html += `<div class="spotlight-section-label">Acoes e Comandos</div>`;
      matchingCmds.forEach((item, cIdx) => {
        const idx = matchingTasks.length + cIdx;
        const sel = idx === state.spotlightIndex ? 'selected' : '';
        html += `
          <div class="spotlight-item ${sel}" data-spot-idx="${idx}" role="option">
            <div class="spotlight-item-left">
              <svg class="spotlight-item-icon" viewBox="0 0 24 24" fill="none">
                <path d="M13 3L4 14H12L11 21L20 10H12L13 3Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
              </svg>
              <span class="spotlight-item-title">${escapeHtml(item.title)}</span>
            </div>
            <span class="spotlight-item-right">${escapeHtml(item.right)}</span>
          </div>
        `;
      });
    }

    container.innerHTML = html;
  }

  function executeSpotlightSelected() {
    const item = state.spotlightItems[state.spotlightIndex];
    if (!item) return;
    closeAllModals();
    item.run();
  }

  // ==========================================================================
  // REPORTS & XP MODAL + SETTINGS MODAL
  // ==========================================================================
  function openReportsModal() {
    closeAllModals();
    const modal = document.getElementById('reportsModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    renderUserHeaderAndXP();

    const todayStr = getTodayDateStr();
    const sessions = (state.timesData && Array.isArray(state.timesData.sessions)) ? state.timesData.sessions : [];
    const todaySessions = sessions.filter((s) => s.date === todayStr);
    const totalSec = todaySessions.reduce((acc, s) => acc + Number(s.durationSeconds || 0), 0);
    const timedCount = todaySessions.filter((s) => !s.completedWithoutTimer && Number(s.durationSeconds || 0) > 0).length;
    const quickCount = todaySessions.filter((s) => s.completedWithoutTimer || Number(s.durationSeconds || 0) === 0).length;

    const kpiMins = document.getElementById('kpiFocusedMinutes');
    const kpiTimed = document.getElementById('kpiTimedTasks');
    const kpiQuick = document.getElementById('kpiQuickTasks');
    const kpiAcc = document.getElementById('kpiAccuracyPct');

    if (kpiMins) kpiMins.textContent = `${Math.round(totalSec / 60)} min`;
    if (kpiTimed) kpiTimed.textContent = String(timedCount);
    if (kpiQuick) kpiQuick.textContent = String(quickCount);
    if (kpiAcc) kpiAcc.textContent = '100%';

    const histList = document.getElementById('reportsTaskHistoryList');
    if (histList) {
      const avgs = Object.values((state.timesData && state.timesData.taskAverages) || {});
      if (avgs.length === 0) {
        histList.innerHTML = `<div class="history-row"><span class="history-row-meta">Nenhuma sessao cronometrada registrada ainda.</span></div>`;
      } else {
        histList.innerHTML = avgs
          .slice(0, 15)
          .map(
            (a) => `
            <div class="history-row">
              <span class="history-row-title">${escapeHtml(a.content)}</span>
              <span class="history-row-meta">${a.runs}x · Media ${a.avgMinutes}m · Total ${Math.round((a.totalSeconds || 0) / 60)}m</span>
            </div>
          `
          )
          .join('');
      }
    }
  }

  function openSettingsModal() {
    closeAllModals();
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    renderUserHeaderAndXP();
    const note = document.getElementById('todoistStatusNote');
    if (note) {
      note.textContent = state.hasTodoistToken
        ? 'Token do Todoist ativo e sincronizado no servidor.'
        : 'Nenhum token do Todoist configurado nesta conta.';
    }
  }

  function closeAllModals() {
    ['quickAddModal', 'spotlightModal', 'reportsModal', 'settingsModal'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
  }

  // ==========================================================================
  // EVENT BINDINGS & GLOBAL KEYBOARD SHORTCUTS ('Q', 'CMD+K', 'SPACE', 'ESC')
  // ==========================================================================
  function bindEvents() {
    // Auth Tabs
    const tabLogin = document.getElementById('authTabLogin');
    const tabReg = document.getElementById('authTabRegister');
    if (tabLogin) tabLogin.addEventListener('click', () => setAuthMode('login'));
    if (tabReg) tabReg.addEventListener('click', () => setAuthMode('register'));

    // Auth Form Submit
    const authForm = document.getElementById('authForm');
    if (authForm) {
      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('authNameInput');
        const emailInput = document.getElementById('authEmailInput');
        const passInput = document.getElementById('authPasswordInput');
        const errMsg = document.getElementById('authErrorMsg');

        const name = nameInput ? nameInput.value.trim() : '';
        const email = emailInput ? emailInput.value.trim() : '';
        const password = passInput ? passInput.value.trim() : '';

        if (errMsg) errMsg.classList.add('hidden');

        const endpoint = state.authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
        try {
          const r = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
          });
          const d = await r.json();
          if (r.ok && d && d.authenticated) {
            state.authenticated = true;
            state.user = d.user || null;
            state.hasTodoistToken = Boolean(d.hasServerTodoistToken);
            if (passInput) passInput.value = '';
            updateAuthUI();
            triggerLightPulse();
            await loadWorkspaceData();
            showToast(`Bem-vindo, ${(state.user && state.user.name) || 'Walace'}`);
          } else {
            if (errMsg) {
              errMsg.textContent = (d && d.error) || 'Credenciais invalidas.';
              errMsg.classList.remove('hidden');
            }
          }
        } catch (_) {
          if (errMsg) {
            errMsg.textContent = 'Erro de comunicacao com o servidor.';
            errMsg.classList.remove('hidden');
          }
        }
      });
    }

    // Filter pills
    document.querySelectorAll('.filter-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.filter = btn.getAttribute('data-filter') || 'pending';
        ensureValidCurrentTask();
        renderAll();
      });
    });

    // Top bar actions
    const openSpotlightBtn = document.getElementById('openSpotlightBtn');
    const openQuickAddBtn = document.getElementById('openQuickAddBtn');
    const queueQuickAddBtn = document.getElementById('queueQuickAddBtn');
    const openReportsBtn = document.getElementById('openReportsBtn');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const pulseToggleBtn = document.getElementById('pulseToggleBtn');
    const syncNowBtn = document.getElementById('syncNowBtn');
    const themeToggleBtn = document.getElementById('themeToggleBtn');

    if (openSpotlightBtn) openSpotlightBtn.addEventListener('click', openSpotlightModal);
    if (openQuickAddBtn) openQuickAddBtn.addEventListener('click', () => openQuickAddModal(''));
    if (queueQuickAddBtn) queueQuickAddBtn.addEventListener('click', () => openQuickAddModal(''));
    if (openReportsBtn) openReportsBtn.addEventListener('click', openReportsModal);
    if (openSettingsBtn) openSettingsBtn.addEventListener('click', openSettingsModal);

    if (pulseToggleBtn) {
      pulseToggleBtn.classList.toggle('active', state.pulse5mEnabled);
      pulseToggleBtn.addEventListener('click', () => {
        state.pulse5mEnabled = !state.pulse5mEnabled;
        localStorage.setItem(STORAGE_KEYS.PULSE_5M, state.pulse5mEnabled ? '1' : '0');
        pulseToggleBtn.classList.toggle('active', state.pulse5mEnabled);
        if (state.pulse5mEnabled) triggerLightPulse();
        showToast(state.pulse5mEnabled ? 'Pulso luminoso de 5m ativado.' : 'Pulso luminoso de 5m silenciado.');
      });
    }

    if (syncNowBtn) {
      syncNowBtn.addEventListener('click', async () => {
        await loadWorkspaceData(true);
        showToast('Agenda sincronizada.');
      });
    }

    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        applyTheme(state.theme === 'dark' ? 'light' : 'dark');
      });
    }

    // Focus card controls
    const heroCheckBtn = document.getElementById('heroCheckBtn');
    const timerPlayPauseBtn = document.getElementById('timerPlayPauseBtn');
    const timerCompleteBtn = document.getElementById('timerCompleteBtn');
    const timerResetBtn = document.getElementById('timerResetBtn');
    const prevTaskBtn = document.getElementById('prevTaskBtn');
    const nextTaskBtn = document.getElementById('nextTaskBtn');
    const toggleDescBtn = document.getElementById('toggleDescExpandBtn');

    if (heroCheckBtn) {
      heroCheckBtn.addEventListener('click', () => {
        const cur = getCurrentTask();
        if (cur) toggleTaskChecked(cur.id);
      });
    }
    if (timerPlayPauseBtn) timerPlayPauseBtn.addEventListener('click', toggleTimerPlayPause);
    if (timerCompleteBtn) {
      timerCompleteBtn.addEventListener('click', () => {
        const cur = getCurrentTask();
        if (cur) toggleTaskChecked(cur.id);
      });
    }
    if (timerResetBtn) timerResetBtn.addEventListener('click', resetTimer);
    if (prevTaskBtn) prevTaskBtn.addEventListener('click', () => stepTask(-1));
    if (nextTaskBtn) nextTaskBtn.addEventListener('click', () => stepTask(1));
    if (toggleDescBtn) {
      toggleDescBtn.addEventListener('click', () => {
        state.descExpanded = !state.descExpanded;
        renderFocusCard();
      });
    }

    // Inline estimate bar
    const taskEstBtn = document.getElementById('taskEstimateBtn');
    const inlineEstBar = document.getElementById('inlineEstimateBar');
    const saveCustomEstBtn = document.getElementById('saveCustomEstimateBtn');
    const customEstInput = document.getElementById('customEstimateInput');

    if (taskEstBtn && inlineEstBar) {
      taskEstBtn.addEventListener('click', () => {
        inlineEstBar.classList.toggle('hidden');
      });
    }
    document.querySelectorAll('.est-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        saveTaskEstimate(Number(chip.getAttribute('data-min') || 15));
      });
    });
    if (saveCustomEstBtn && customEstInput) {
      saveCustomEstBtn.addEventListener('click', () => {
        if (customEstInput.value) saveTaskEstimate(Number(customEstInput.value));
      });
    }

    // Subtasks click delegation
    const subtasksList = document.getElementById('focusSubtasksList');
    if (subtasksList) {
      subtasksList.addEventListener('click', (e) => {
        const row = e.target.closest('.subtask-row');
        if (!row) return;
        const sid = row.getAttribute('data-subtask-id');
        if (!sid) return;
        state.subtasksDone[sid] = !state.subtasksDone[sid];
        saveJsonStorage(STORAGE_KEYS.SUBTASKS, state.subtasksDone);
        if (state.subtasksDone[sid]) triggerLightPulse();
        renderFocusCard();
      });
    }

    // Queue list click delegation
    const queueList = document.getElementById('agendaQueueList');
    if (queueList) {
      queueList.addEventListener('click', (e) => {
        const checkBtn = e.target.closest('[data-check-task-id]');
        if (checkBtn) {
          e.stopPropagation();
          toggleTaskChecked(checkBtn.getAttribute('data-check-task-id'));
          return;
        }
        const row = e.target.closest('[data-task-id]');
        if (row) {
          state.currentTaskId = row.getAttribute('data-task-id');
          state.descExpanded = false;
          resetTimer();
          renderAll();
        }
      });
    }

    // Quick-Add Modal events
    const quickAddInput = document.getElementById('quickAddInput');
    const quickAddForm = document.getElementById('quickAddForm');
    if (quickAddInput) {
      quickAddInput.addEventListener('input', updateQuickAddNlpPreview);
    }
    if (quickAddForm) {
      quickAddForm.addEventListener('submit', handleQuickAddSubmit);
    }

    document.querySelectorAll('[data-qa-date]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-qa-date]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.qaPicker.date = btn.getAttribute('data-qa-date');
        updateQuickAddNlpPreview();
      });
    });
    document.querySelectorAll('[data-qa-est]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-qa-est]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.qaPicker.est = Number(btn.getAttribute('data-qa-est') || 15);
        updateQuickAddNlpPreview();
      });
    });
    document.querySelectorAll('[data-qa-prio]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-qa-prio]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.qaPicker.prio = btn.getAttribute('data-qa-prio') || 'p4';
        updateQuickAddNlpPreview();
      });
    });

    // Spotlight Modal events
    const spotlightInput = document.getElementById('spotlightInput');
    const spotlightList = document.getElementById('spotlightResultsList');
    if (spotlightInput) {
      spotlightInput.addEventListener('input', () => {
        state.spotlightIndex = 0;
        renderSpotlightResults(spotlightInput.value);
      });
      spotlightInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (state.spotlightItems.length > 0) {
            state.spotlightIndex = (state.spotlightIndex + 1) % state.spotlightItems.length;
            renderSpotlightResults(spotlightInput.value);
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (state.spotlightItems.length > 0) {
            state.spotlightIndex =
              (state.spotlightIndex - 1 + state.spotlightItems.length) % state.spotlightItems.length;
            renderSpotlightResults(spotlightInput.value);
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          executeSpotlightSelected();
        }
      });
    }
    if (spotlightList) {
      spotlightList.addEventListener('click', (e) => {
        const item = e.target.closest('[data-spot-idx]');
        if (!item) return;
        state.spotlightIndex = Number(item.getAttribute('data-spot-idx') || 0);
        executeSpotlightSelected();
      });
    }

    // Export JSON in Reports Modal
    const exportBtn = document.getElementById('exportTimesJsonBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(state.timesData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lightfocus-relatorio-${getTodayDateStr()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // Settings Modal: Logout & Todoist Token Save
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        closeAllModals();
        resetTimer();
        state.authenticated = false;
        state.user = null;
        updateAuthUI();
        showToast('Sessao encerrada.');
      });
    }

    const todoistForm = document.getElementById('todoistConfigForm');
    if (todoistForm) {
      todoistForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('todoistTokenInput');
        const note = document.getElementById('todoistStatusNote');
        const token = input ? input.value.trim() : '';
        if (note) note.textContent = 'Validando e sincronizando com Todoist...';
        try {
          const r = await fetch('/api/config/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          });
          const d = await r.json();
          if (r.ok && d && d.ok) {
            state.hasTodoistToken = Boolean(d.hasServerTodoistToken);
            if (d.snapshot && Array.isArray(d.snapshot.tasks)) {
              state.tasks = d.snapshot.tasks.map(normalizeClientTask);
              renderAll();
            }
            if (note) note.textContent = 'Sincronizado com sucesso com sua conta Todoist.';
            showToast('Todoist sincronizado.');
          } else {
            if (note) note.textContent = (d && d.error) || 'Nao foi possivel sincronizar este token.';
          }
        } catch (_) {
          if (note) note.textContent = 'Erro ao salvar token.';
        }
      });
    }

    // Close modal buttons & backdrop click
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', closeAllModals);
    });
    document.querySelectorAll('.glass-modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeAllModals();
      });
    });

    // Global Keyboard Shortcuts: Q, Cmd/Ctrl+K, Space, Arrows, Escape
    document.addEventListener('keydown', (e) => {
      if (!state.authenticated) return;

      // Cmd+K or Ctrl+K -> Spotlight
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const spot = document.getElementById('spotlightModal');
        if (spot && !spot.classList.contains('hidden')) {
          closeAllModals();
        } else {
          openSpotlightModal();
        }
        return;
      }

      if (e.key === 'Escape') {
        closeAllModals();
        const estBar = document.getElementById('inlineEstimateBar');
        if (estBar) estBar.classList.add('hidden');
        return;
      }

      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isTyping = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';
      if (isTyping) return;

      if (e.key.toLowerCase() === 'q' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openQuickAddModal('');
      } else if (e.code === 'Space') {
        e.preventDefault();
        toggleTimerPlayPause();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepTask(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepTask(-1);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(state.theme);
    bindEvents();
    checkSessionAndBoot();
  });
})();
