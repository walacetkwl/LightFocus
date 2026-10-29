/* ============================================================================
   Lightfocus v3.5 — Apple Liquid Glass Commercial SaaS Edition (app.js)
   - Clean Sans-Serif Tabular Numerals (zero monospace fonts)
   - Live Inline Highlighted Function Tags in Quick-Add ('Q') + Clear Explanation
   - Custom Time Estimates Everywhere (Quick-Add & Focus Card)
   - Agenda Geral (Full Interactive Monthly Calendar with Recurrence Projection)
   - Modo Ultra Foco (Task + Timer + Luminoso/Sonoro/Ambos + Custom Interval)
   - Google Agenda Sync with Toggle to Include/Exclude from Today's Focus Queue
   - Motivational Quotes Footer
   ============================================================================ */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    THEME: 'lf_v35_theme',
    ATT_MODE: 'lf_v35_att_mode', // 'light' | 'sound' | 'both' | 'off'
    ATT_MIN: 'lf_v35_att_min',
    INCLUDE_GCAL: 'lf_v35_include_gcal',
    SUBTASKS: 'lf_v35_subtasks_done',
    GCAL_DONE: 'lf_v35_gcal_done'
  };

  const MOTIVATIONAL_QUOTES = [
    '"Clareza precede velocidade: faça uma única tarefa com presença absoluta até terminá-la."',
    '"Não é sobre ter mais tempo no dia, é sobre eliminar o ruído ao redor do que importa agora."',
    '"Disciplina é transformar intenção em execução silenciosa, bloco por bloco."',
    '"Quem domina a própria atenção constrói em uma manhã o que o distraído adia por semanas."',
    '"Comece pelo essencial. O movimento gera a energia que a dúvida tenta roubar."',
    '"Foco profundo é o superpoder mais raro e valioso da era digital."',
    '"Uma tarefa concluída com excelência vale mais que cinquenta abertas na cabeça."',
    '"Subtraia o excesso, ative o cronômetro e deixe o resultado falar por você."'
  ];

  const WEEKDAY_NAMES_PT = [
    'domingo',
    'segunda-feira',
    'terça-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado'
  ];

  const MONTH_NAMES_PT = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro'
  ];

  const state = {
    authenticated: false,
    authMode: 'login',
    user: null,
    hasTodoistToken: false,
    tasks: [],
    gcalEvents: [],
    gcalConnected: false,
    gcalCalendarName: '',
    includeGcalInToday: localStorage.getItem(STORAGE_KEYS.INCLUDE_GCAL) !== '0',
    calShowGcal: true,
    gcalDoneIds: loadJsonStorage(STORAGE_KEYS.GCAL_DONE, {}),
    filter: 'pending', // 'pending' | 'all' | 'calendar' | 'completed'
    ultraFocus: false,
    currentTaskId: null,
    descExpanded: false,
    subtasksDone: loadJsonStorage(STORAGE_KEYS.SUBTASKS, {}),
    timerRunning: false,
    timerSeconds: 0,
    timerStartedAt: null,
    timerInterval: null,
    attentionMode: localStorage.getItem(STORAGE_KEYS.ATT_MODE) || 'both',
    attentionIntervalMin: Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.ATT_MIN) || 5)),
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
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    calSelectedDate: null,
    quoteIndex: 0,
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

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function addDaysDateStr(days, baseDateStr) {
    const base = baseDateStr ? new Date(baseDateStr + 'T12:00:00') : new Date();
    const d = new Date(base.getTime() + days * 86400000);
    const fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return fmt.format(d);
  }

  function formatDateBR(dateStr) {
    if (!dateStr || dateStr.length < 10) return 'Hoje';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  function formatDateShortBR(dateStr) {
    if (!dateStr || dateStr.length < 10) return 'Hoje';
    const [y, m, d] = dateStr.split('-');
    const dt = new Date(`${y}-${m}-${d}T12:00:00`);
    const shortDow = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][dt.getDay()];
    return `${shortDow}, ${d}/${m}`;
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
  // ATTENTION CALL (LUMINOSO, SONORO, AMBOS) & TOAST
  // ==========================================================================
  function triggerLightPulse() {
    try { if (typeof renderBotanicalEverywhere === 'function') renderBotanicalEverywhere(true); } catch (_) {}
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
      const notes =
        kind === 'complete'
          ? [523.25, 659.25, 783.99, 1046.5]
          : [587.33, 880, 1174.66];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.07);
        gain.gain.setValueAtTime(0.0001, now + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.055, now + idx * 0.07 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.07 + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.48);
      });
    } catch (_) {}
  }

  function triggerConfiguredAttentionCall(isTest) {
    const mode = state.attentionMode;
    if (mode === 'off' && !isTest) return;
    if (mode === 'light' || mode === 'both' || isTest) {
      triggerLightPulse();
    }
    if (mode === 'sound' || mode === 'both' || (isTest && mode === 'sound')) {
      playGlassHarmonic('pulse');
    }
    if (isTest) {
      showToast(`Teste de chamada de atencao (${mode === 'light' ? 'Luminoso' : mode === 'sound' ? 'Sonoro' : 'Luminoso + Sonoro'})`);
    } else {
      showToast(`Chamada de Atencao · ${state.attentionIntervalMin} min de foco!`);
    }
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
    }, 3200);
  }

  // ==========================================================================
  // THEME ENGINE & MOTIVATIONAL QUOTES
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

  function cycleMotivationalQuote() {
    state.quoteIndex = (state.quoteIndex + 1) % MOTIVATIONAL_QUOTES.length;
    const el = document.getElementById('motivationalQuoteText');
    if (el) {
      el.textContent = MOTIVATIONAL_QUOTES[state.quoteIndex];
    }
  }

  function setUltraFocusMode(enabled) {
    state.ultraFocus = Boolean(enabled);
    document.body.classList.toggle('ultra-focus-mode', state.ultraFocus);
    const exitPill = document.getElementById('exitUltraFocusBtn');
    const cardLbl = document.getElementById('cardUltraFocusLabel');
    if (exitPill) exitPill.classList.toggle('hidden', !state.ultraFocus);
    if (cardLbl) cardLbl.textContent = state.ultraFocus ? 'Sair Ultra Foco' : 'Ultra Foco';
    if (state.ultraFocus && state.filter === 'calendar') {
      setFilterView('pending');
    }
    if (state.ultraFocus) {
      showToast('Modo Ultra Foco ativado · Pressione Esc para sair');
    }
  }

  // ==========================================================================
  // NATURAL LANGUAGE PARSER + LIVE INLINE HIGHLIGHTING (FOR SHORTCUT 'Q')
  // ==========================================================================
  const DOW_MAP = {
    dom: 0,
    domingo: 0,
    seg: 1,
    segunda: 1,
    'segunda-feira': 1,
    ter: 2,
    terca: 2,
    'terca-feira': 2,
    qua: 3,
    quarta: 3,
    'quarta-feira': 3,
    qui: 4,
    quinta: 4,
    'quinta-feira': 4,
    sex: 5,
    sexta: 5,
    'sexta-feira': 5,
    sab: 6,
    sabado: 6
  };

  function normWord(w) {
    return String(w || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function nextWeekdayDateStr(targetDow, includeToday) {
    const todayStr = getTodayDateStr();
    const nowDt = new Date(todayStr + 'T12:00:00');
    const curDow = nowDt.getDay();
    let diff = (targetDow - curDow + 7) % 7;
    if (diff === 0 && !includeToday) diff = 7;
    return addDaysDateStr(diff, todayStr);
  }

  function parseNaturalLanguageTask(rawInput, fallbackPicker) {
    const original = String(rawInput || '');
    let text = original;
    const detected = {
      dueDate: null,
      dueDateLabel: null,
      dueTime: null,
      estimatedMinutes: null,
      priority: null,
      recurring: null,
      recurrenceRule: null,
      humanScheduleSummary: null,
      labels: [],
      matchedSpans: []
    };

    function markAndRemove(regex, kind, handler) {
      text = text.replace(regex, (...args) => {
        const fullMatch = args[0];
        const res = handler(...args);
        if (res === false) return fullMatch;
        return ' '.repeat(fullMatch.length);
      });
    }

    // 1. Extract #tags
    markAndRemove(/(?:^|\s)(#[a-zA-Z0-9_-]+)/g, 'tag', (full, tag) => {
      detected.labels.push(tag.slice(1).toLowerCase());
      return true;
    });

    // 2. Extract priority: p1..p4
    markAndRemove(/(?:^|\s)(p[1-4])(?=\s|$)/gi, 'prio', (full, p) => {
      detected.priority = p.toLowerCase();
      return true;
    });

    // 3. Extract duration/estimate: 1h30, 1h, 35m, 45min, 90 minutos
    markAndRemove(/(?:^|\s)(\d{1,2})\s*h(?:\s*(\d{1,2})\s*m(?:in)?)?(?=\s|$)/gi, 'est', (full, h, m) => {
      const mins = Number(h) * 60 + (m ? Number(m) : 0);
      if (mins > 0 && mins <= 480) {
        detected.estimatedMinutes = mins;
        return true;
      }
      return false;
    });
    markAndRemove(/(?:^|\s)(\d{1,3})\s*(?:m|min|minutos)(?=\s|$)/gi, 'est', (full, m) => {
      const mins = Number(m);
      if (mins > 0 && mins <= 480) {
        detected.estimatedMinutes = mins;
        return true;
      }
      return false;
    });

    // 4. Extract recurring weekdays: "toda segunda e terça", "toda segunda", "todo sabado"
    markAndRemove(
      /(?:^|\s)(?:toda|todo|todas\s+as|todos\s+os)\s+(segunda(?:-feira)?|seg|terca(?:-feira)?|terça(?:-feira)?|ter|quarta(?:-feira)?|qua|quinta(?:-feira)?|qui|sexta(?:-feira)?|sex|sabado|sábado|sab|domingo|dom)(?:\s*(?:,|e)\s*(?:toda\s+|todo\s+)?(segunda(?:-feira)?|seg|terca(?:-feira)?|terça(?:-feira)?|ter|quarta(?:-feira)?|qua|quinta(?:-feira)?|qui|sexta(?:-feira)?|sex|sabado|sábado|sab|domingo|dom))?(?=\s|$)/gi,
      'rec',
      (full, d1, d2) => {
        const dow1 = DOW_MAP[normWord(d1)];
        const dows = [dow1];
        if (d2 && DOW_MAP[normWord(d2)] !== undefined) {
          dows.push(DOW_MAP[normWord(d2)]);
        }
        const dayNames = dows.map((d) => WEEKDAY_NAMES_PT[d]);
        const nextDate = nextWeekdayDateStr(dows[0], true);
        detected.dueDate = nextDate;
        detected.recurring = `toda ${dayNames.join(' e ')}`;
        detected.recurrenceRule = {
          type: 'weekly',
          daysOfWeek: dows,
          label: `Toda ${dayNames.join(' e ')}`
        };
        detected.dueDateLabel = `Toda ${dayNames.join(' e ')}`;
        detected.humanScheduleSummary = `Vai aparecer toda ${dayNames.join(' e ')} na sua Agenda do Dia (próxima: ${formatDateShortBR(nextDate)})`;
        return true;
      }
    );

    // 5. Extract general recurrence: todo dia, diariamente, semanal, mensal
    if (!detected.recurrenceRule) {
      markAndRemove(
        /(?:^|\s)(todo\s+dia|todos\s+os\s+dias|diario|diariamente|semanal|semanalmente|mensal|mensalmente)(?=\s|$)/gi,
        'rec',
        (full, rec) => {
          const w = normWord(rec);
          const todayStr = getTodayDateStr();
          detected.dueDate = todayStr;
          if (w.includes('mensal')) {
            const dom = Number(todayStr.slice(8, 10));
            detected.recurring = 'mensal';
            detected.recurrenceRule = { type: 'monthly', dayOfMonth: dom, label: `Todo dia ${dom} do mês` };
            detected.dueDateLabel = `Mensal (dia ${dom})`;
            detected.humanScheduleSummary = `Vai aparecer todo mês no dia ${dom} na sua Agenda`;
          } else if (w.includes('semanal')) {
            const dow = new Date(todayStr + 'T12:00:00').getDay();
            detected.recurring = 'semanal';
            detected.recurrenceRule = { type: 'weekly', daysOfWeek: [dow], label: `Toda ${WEEKDAY_NAMES_PT[dow]}` };
            detected.dueDateLabel = `Semanal (${WEEKDAY_NAMES_PT[dow]})`;
            detected.humanScheduleSummary = `Vai aparecer toda ${WEEKDAY_NAMES_PT[dow]} na sua Agenda`;
          } else {
            detected.recurring = 'todo dia';
            detected.recurrenceRule = { type: 'daily', label: 'Todos os dias' };
            detected.dueDateLabel = 'Todo dia';
            detected.humanScheduleSummary = 'Vai aparecer todos os dias na sua Agenda do Dia';
          }
          return true;
        }
      );
    }

    // 6. Extract "daqui N dias" / "daqui N semanas"
    markAndRemove(
      /(?:^|\s)(?:daqui\s+(?:a\s+)?|em\s+)(\d{1,3})\s*(dias?|semanas?)(?=\s|$)/gi,
      'date',
      (full, num, unit) => {
        const n = Number(num);
        const mult = normWord(unit).startsWith('semana') ? 7 : 1;
        const totalDays = n * mult;
        const targetDate = addDaysDateStr(totalDays);
        detected.dueDate = targetDate;
        detected.dueDateLabel = `Daqui a ${totalDays} dias (${formatDateShortBR(targetDate)})`;
        detected.humanScheduleSummary = `Vai aparecer daqui a ${totalDays} dias (${formatDateBR(targetDate)} — ${formatDateShortBR(targetDate)})`;
        return true;
      }
    );

    // 7. Extract explicit date: "dia 20/11", "20/11", "20/11/2026"
    markAndRemove(
      /(?:^|\s)(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|$)/gi,
      'date',
      (full, dd, mm, yyyy) => {
        const d = Number(dd);
        const m = Number(mm);
        if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
          let year = yyyy ? Number(yyyy) : new Date().getFullYear();
          if (year < 100) year += 2000;
          const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          detected.dueDate = dateStr;
          detected.dueDateLabel = `Dia ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
          detected.humanScheduleSummary = `Vai aparecer no dia ${formatDateBR(dateStr)} (${formatDateShortBR(dateStr)}) na sua Agenda`;
          return true;
        }
        return false;
      }
    );

    // 8. Extract single weekday or relative day: hoje, amanha, segunda, terca...
    if (!detected.dueDate) {
      markAndRemove(
        /(?:^|\s)(hoje|amanha|amanhã|segunda(?:-feira)?|seg|terca(?:-feira)?|terça(?:-feira)?|ter|quarta(?:-feira)?|qua|quinta(?:-feira)?|qui|sexta(?:-feira)?|sex|sabado|sábado|sab|domingo|dom)(?=\s|$)/gi,
        'date',
        (full, word) => {
          const w = normWord(word);
          if (w === 'hoje') {
            const dStr = getTodayDateStr();
            detected.dueDate = dStr;
            detected.dueDateLabel = 'Hoje';
            detected.humanScheduleSummary = `Vai aparecer Hoje (${formatDateShortBR(dStr)}) na sua Agenda do Dia`;
          } else if (w === 'amanha') {
            const dStr = addDaysDateStr(1);
            detected.dueDate = dStr;
            detected.dueDateLabel = `Amanhã (${formatDateShortBR(dStr)})`;
            detected.humanScheduleSummary = `Vai aparecer Amanhã (${formatDateBR(dStr)} — ${formatDateShortBR(dStr)}) na sua Agenda`;
          } else if (DOW_MAP[w] !== undefined) {
            const dow = DOW_MAP[w];
            const dStr = nextWeekdayDateStr(dow, false);
            const dayName = WEEKDAY_NAMES_PT[dow];
            detected.dueDate = dStr;
            detected.dueDateLabel = `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} (${formatDateShortBR(dStr)})`;
            detected.humanScheduleSummary = `Vai aparecer na próxima ${dayName} (${formatDateBR(dStr)}) — ou digite "toda ${w}" para repetir toda semana`;
          }
          return true;
        }
      );
    }

    // 9. Extract time: às 14:30, 14:30, às 15h, 15h30
    markAndRemove(/(?:^|\s)(?:as|às)?\s*(\d{1,2}):(\d{2})(?=\s|$)/gi, 'time', (full, hh, mm) => {
      const h = Number(hh);
      const m = Number(mm);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        detected.dueTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        return true;
      }
      return false;
    });
    if (!detected.dueTime) {
      markAndRemove(/(?:^|\s)(?:as|às)?\s*(\d{1,2})h(\d{2})?(?=\s|$)/gi, 'time', (full, hh, mm) => {
        const h = Number(hh);
        const m = mm ? Number(mm) : 0;
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
          detected.dueTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          return true;
        }
        return false;
      });
    }

    const cleanTitle = stripEmojis(text.replace(/\s{2,}/g, ' ').trim());

    // Fallback picker values when not overridden by NLP text
    const picker = fallbackPicker || state.qaPicker;
    let finalDueDate = detected.dueDate;
    let finalDateLabel = detected.dueDateLabel;
    let finalHumanSummary = detected.humanScheduleSummary;

    if (!finalDueDate) {
      if (picker.date === 'tomorrow') {
        finalDueDate = addDaysDateStr(1);
        finalDateLabel = `Amanhã (${formatDateShortBR(finalDueDate)})`;
        finalHumanSummary = `Vai aparecer Amanhã (${formatDateBR(finalDueDate)}) na sua Agenda`;
      } else {
        finalDueDate = getTodayDateStr();
        finalDateLabel = 'Hoje';
        finalHumanSummary = `Vai aparecer Hoje (${formatDateShortBR(finalDueDate)}) na sua Agenda do Dia`;
      }
    }

    const finalEst = detected.estimatedMinutes || Number(picker.est || 15);
    const finalPrio = detected.priority || picker.prio || 'p4';

    return {
      cleanTitle: cleanTitle || stripEmojis(original).trim(),
      dueDate: finalDueDate,
      dueDateLabel: finalDateLabel,
      dueTime: detected.dueTime,
      estimatedMinutes: finalEst,
      priority: finalPrio,
      recurring: detected.recurring,
      recurrenceRule: detected.recurrenceRule,
      humanScheduleSummary: finalHumanSummary,
      labels: detected.labels
    };
  }

  function renderInlineHighlightedBackdrop(rawText) {
    if (!rawText) return '';
    let safe = escapeHtml(rawText);
    const rules = [
      {
        re: /\b((?:toda|todo|todas\s+as|todos\s+os)\s+(?:segunda(?:-feira)?|seg|terca(?:-feira)?|terça(?:-feira)?|ter|quarta(?:-feira)?|qua|quinta(?:-feira)?|qui|sexta(?:-feira)?|sex|sabado|sábado|sab|domingo|dom)(?:\s*(?:,|e)\s*(?:toda\s+|todo\s+)?(?:segunda(?:-feira)?|seg|terca(?:-feira)?|terça(?:-feira)?|ter|quarta(?:-feira)?|qua|quinta(?:-feira)?|qui|sexta(?:-feira)?|sex|sabado|sábado|sab|domingo|dom))?)\b/gi,
        cls: 'hl-token hl-rec'
      },
      {
        re: /\b(todo\s+dia|todos\s+os\s+dias|diario|diariamente|semanal|semanalmente|mensal|mensalmente)\b/gi,
        cls: 'hl-token hl-rec'
      },
      {
        re: /\b((?:daqui\s+(?:a\s+)?|em\s+)\d{1,3}\s*(?:dias?|semanas?))\b/gi,
        cls: 'hl-token'
      },
      {
        re: /\b((?:dia\s+)?\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/gi,
        cls: 'hl-token'
      },
      {
        re: /\b(hoje|amanha|amanhã|segunda(?:-feira)?|seg|terca(?:-feira)?|terça(?:-feira)?|ter|quarta(?:-feira)?|qua|quinta(?:-feira)?|qui|sexta(?:-feira)?|sex|sabado|sábado|sab|domingo|dom)\b/gi,
        cls: 'hl-token'
      },
      {
        re: /\b((?:as|às)?\s*\d{1,2}:\d{2}|(?:as|às)?\s*\d{1,2}h(?:\d{2})?)\b/gi,
        cls: 'hl-token'
      },
      {
        re: /\b(\d{1,2}\s*h(?:\s*\d{1,2}\s*m(?:in)?)?|\d{1,3}\s*(?:m|min|minutos))\b/gi,
        cls: 'hl-token hl-est'
      },
      {
        re: /\b(p[1-4])\b/gi,
        cls: 'hl-token hl-prio'
      },
      {
        re: /(#[a-zA-Z0-9_-]+)/g,
        cls: 'hl-token'
      }
    ];

    rules.forEach((r) => {
      safe = safe.replace(r.re, `<mark class="${r.cls}">$1</mark>`);
    });
    return safe;
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
    if (nameGroup) nameGroup.classList.toggle('hidden', state.authMode !== 'register');
    if (emailHint) emailHint.classList.toggle('hidden', state.authMode === 'register');
    if (submitLabel) {
      submitLabel.textContent = state.authMode === 'register' ? 'Criar Conta & Entrar' : 'Entrar no Workspace';
    }
  }

  function updateAuthUI() {
    const gate = document.getElementById('authGateOverlay');
    const shell = document.getElementById('appShell');
    const lp = document.getElementById('landingPageSection');
    const wantsLanding = !!(window.LF_LANDING && window.LF_LANDING.shouldShow && window.LF_LANDING.shouldShow(state.authenticated));
    if (lp) lp.classList.toggle('hidden', !wantsLanding);
    document.body.classList.toggle('lp-mode', wantsLanding);
    if (wantsLanding) {
      if (gate) gate.classList.add('hidden');
      if (shell) shell.classList.add('hidden');
      return;
    }
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
    try { if (typeof renderBotanicalEverywhere === 'function') renderBotanicalEverywhere(false); } catch (_) {}
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
      const [tasksRes, timesRes, gcalRes] = await Promise.all([
        fetch(forceLive ? '/api/tasks?live=1' : '/api/tasks'),
        fetch('/api/times'),
        fetch('/api/gcal/events')
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

      if (gcalRes.ok) {
        const gcalJson = await gcalRes.json();
        if (gcalJson && gcalJson.ok) {
          state.gcalConnected = Boolean(gcalJson.connected);
          state.gcalCalendarName = gcalJson.calendarName || '';
          state.gcalEvents = Array.isArray(gcalJson.events) ? gcalJson.events : [];
          if (gcalJson.includeInToday !== undefined && localStorage.getItem(STORAGE_KEYS.INCLUDE_GCAL) === null) {
            state.includeGcalInToday = Boolean(gcalJson.includeInToday);
          }
        }
      }
    } catch (_) {
      if (window.LIGHTFOCUS_INITIAL_SNAPSHOT && Array.isArray(window.LIGHTFOCUS_INITIAL_SNAPSHOT.tasks)) {
        state.tasks = window.LIGHTFOCUS_INITIAL_SNAPSHOT.tasks.map(normalizeClientTask);
      }
    } finally {
      if (syncLbl) {
        syncLbl.textContent = state.gcalConnected ? 'Google Agenda + Todoist' : 'Sincronizado';
      }
      if (syncIcon) syncIcon.style.transform = '';
    }

    syncGcalUIElements();
    ensureValidCurrentTask();
    renderUserHeaderAndXP();
    renderAll();
  }

  function syncGcalUIElements() {
    const incToggle = document.getElementById('includeGcalToggle');
    const settingsToggle = document.getElementById('settingsIncludeGcalToggle');
    const badge = document.getElementById('gcalCountBadge');
    const modalBadge = document.getElementById('gcalModalStatusBadge');
    const note = document.getElementById('gcalStatusNote');

    if (incToggle) incToggle.checked = state.includeGcalInToday;
    if (settingsToggle) settingsToggle.checked = state.includeGcalInToday;

    const todayStr = getTodayDateStr();
    const todayGcalCount = state.gcalEvents.filter((ev) => ev.dueDate === todayStr).length;
    if (badge) {
      badge.textContent = state.gcalConnected
        ? `${todayGcalCount} hoje · ${state.gcalEvents.length} no mes`
        : 'Conectar';
    }
    if (modalBadge) {
      modalBadge.textContent = state.gcalConnected
        ? `Conectado (${state.gcalCalendarName || 'Google Agenda'})`
        : 'Pronto p/ conectar';
    }
    if (note) {
      note.textContent = state.gcalConnected
        ? `${state.gcalEvents.length} eventos sincronizados de ${state.gcalCalendarName}.`
        : 'Cole uma URL iCal (.ics) do Google Agenda para sincronizar compromissos.';
    }
  }

  function normalizeClientTask(t, idx) {
    const id = String(t.id);
    const estFromTimes = state.timesData && state.timesData.taskEstimates && state.timesData.taskEstimates[id];
    let recRule = t.recurrenceRule || null;
    const recStr = String(t.recurring || '').toLowerCase();
    if (!recRule && recStr) {
      const parsed = parseNaturalLanguageTask(recStr, state.qaPicker);
      if (parsed.recurrenceRule) recRule = parsed.recurrenceRule;
    }

    return {
      id,
      content: stripEmojis(t.content || 'Tarefa sem titulo'),
      description: String(t.description || '').replace(/\[LF_EST:\d+m\]/gi, '').trim(),
      dueDate: t.dueDate || getTodayDateStr(),
      dueTime: t.dueTime || null,
      recurring: t.recurring || false,
      recurrenceRule: recRule,
      priority: ['p1', 'p2', 'p3', 'p4'].includes(String(t.priority || '').toLowerCase())
        ? String(t.priority).toLowerCase()
        : 'p4',
      projectName: stripEmojis(t.projectName || 'Hoje · Principal'),
      source: t.source || 'todoist',
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

  function doesTaskOccurOnDate(task, dateStr) {
    if (task.dueDate === dateStr) return true;
    const rule = task.recurrenceRule;
    if (!rule) return false;
    const dt = new Date(dateStr + 'T12:00:00');
    const todayStr = getTodayDateStr();
    if (dateStr < todayStr && task.dueDate !== dateStr) return false;

    if (rule.type === 'daily') return true;
    if (rule.type === 'weekly' && Array.isArray(rule.daysOfWeek)) {
      return rule.daysOfWeek.includes(dt.getDay());
    }
    if (rule.type === 'monthly' && rule.dayOfMonth) {
      return dt.getDate() === Number(rule.dayOfMonth);
    }
    return false;
  }

  function getCombinedTodayTasks() {
    const todayStr = getTodayDateStr();
    // Include tasks scheduled for today (or without future date) + recurring tasks matching today
    const baseTasks = state.tasks.filter((t) => {
      if (!t.dueDate || t.dueDate <= todayStr) return true;
      return doesTaskOccurOnDate(t, todayStr);
    });

    if (!state.includeGcalInToday) {
      return baseTasks;
    }

    // Merge today's Google Calendar events when toggle is enabled
    const todayGcal = state.gcalEvents
      .filter((ev) => ev.dueDate === todayStr)
      .map((ev, i) => ({
        id: String(ev.id),
        content: stripEmojis(ev.content),
        description: stripEmojis(ev.description || ''),
        dueDate: ev.dueDate,
        dueTime: ev.dueTime || null,
        recurring: false,
        recurrenceRule: null,
        priority: 'p2',
        projectName: 'Google Agenda',
        source: 'gcal',
        labels: ['google-agenda'],
        checked: Boolean(state.gcalDoneIds[ev.id]),
        estimatedMinutes: Number(ev.estimatedMinutes || 45),
        subtasks: [],
        dayOrder: 500 + i
      }));

    return [...baseTasks, ...todayGcal];
  }

  function getFilteredTasks() {
    const combined = getCombinedTodayTasks();
    if (state.filter === 'pending') {
      return combined.filter((t) => !t.checked);
    }
    if (state.filter === 'completed') {
      return combined.filter((t) => t.checked);
    }
    return combined;
  }

  function ensureValidCurrentTask() {
    let list = getFilteredTasks();
    if (list.length === 0 && state.filter === "pending") {
      const allToday = getCombinedTodayTasks();
      if (allToday.length > 0 && allToday.every((t) => t.checked)) {
        // Keep pending view showing 00/00 until user clicks arrows or switches to Agenda do Dia
        state.currentTaskId = null;
        return;
      }
    }
    if (list.length === 0) {
      state.currentTaskId = null;
      return;
    }
    const exists = list.some((t) => String(t.id) === String(state.currentTaskId));
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
  // RENDERING: FOCUS CARD, BENTO RING, QUEUE & AGENDA GERAL CALENDAR
  // ==========================================================================
  function setFilterView(filterName) {
    state.filter = filterName || 'pending';
    document.querySelectorAll('.filter-pill').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-filter') === state.filter);
    });

    const calSec = document.getElementById('generalCalendarSection');
    const stageSec = document.getElementById('spatialStage');

    if (state.filter === 'calendar') {
      if (calSec) calSec.classList.remove('hidden');
      if (stageSec) stageSec.classList.add('hidden');
      if (!state.calSelectedDate) state.calSelectedDate = getTodayDateStr();
      renderGeneralCalendar();
    } else {
      if (calSec) calSec.classList.add('hidden');
      if (stageSec) stageSec.classList.remove('hidden');
      ensureValidCurrentTask();
      renderAll();
    }
  }

  function renderAll() {
    ensureValidCurrentTask();
    renderFocusCard();
    renderDayOverviewAndQueue();
    if (state.filter === 'calendar') {
      renderGeneralCalendar();
    }
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
            : 'Tudo concluido por agora. Pressione Q para agendar uma nova tarefa.';
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
    const datePart = task.dueDate === todayStr ? 'Hoje' : formatDateShortBR(task.dueDate);
    const timePart = task.dueTime ? ` · ${task.dueTime}` : '';
    const recLabel =
      (task.recurrenceRule && task.recurrenceRule.label) ||
      (task.recurring ? String(task.recurring) : '');
    const recPart = recLabel ? ` · ${recLabel}` : '';
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
      if (recLabel) {
        chips.push(`<span class="task-tag-chip">${escapeHtml(recLabel)}</span>`);
      }
      (task.labels || []).forEach((lbl) => {
        chips.push(`<span class="task-tag-chip">#${escapeHtml(lbl)}</span>`);
      });
      tagsRow.innerHTML = chips.join('');
    }

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
    const allToday = getCombinedTodayTasks();
    const total = allToday.length;
    const completed = allToday.filter((t) => t.checked).length;
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

    const todayStr = getTodayDateStr();
    const sessions = (state.timesData && Array.isArray(state.timesData.sessions)) ? state.timesData.sessions : [];
    const todaySec = sessions
      .filter((s) => s.date === todayStr)
      .reduce((acc, s) => acc + Number(s.durationSeconds || 0), 0);
    const totalMins = Math.round((todaySec + state.timerSeconds) / 60);
    if (focusedStat) focusedStat.textContent = `${totalMins}m`;

    const remMins = allToday
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

    const list = getFilteredTasks();
    const queueBadge = document.getElementById('queueTotalBadge');
    const queueContainer = document.getElementById('agendaQueueList');
    if (queueBadge) queueBadge.textContent = String(list.length);
    if (!queueContainer) return;

    if (list.length === 0) {
      queueContainer.innerHTML = `<div class="history-row"><span class="history-row-meta">Nenhuma atividade neste filtro.</span></div>`;
      return;
    }

    const current = getCurrentTask();
    queueContainer.innerHTML = list
      .map((t) => {
        const isActive = current && current.id === t.id;
        const timeTag = t.dueTime ? `${t.dueTime} · ` : '';
        const sourceTag = t.source === 'gcal' ? 'GCal · ' : '';
        return `
          <div class="queue-item-row ${isActive ? 'active-focus' : ''} ${t.checked ? 'completed' : ''}" data-task-id="${escapeHtml(t.id)}" role="listitem">
            <button type="button" class="queue-mini-check" data-check-task-id="${escapeHtml(t.id)}" aria-label="Concluir atividade">
              <svg class="icon-13" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5L9.5 17L19 7.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <span class="queue-item-text">${escapeHtml(t.content)}</span>
            <span class="queue-item-est">${escapeHtml(sourceTag + timeTag)}${t.estimatedMinutes || 15}m</span>
          </div>
        `;
      })
      .join('');
  }

  // ==========================================================================
  // AGENDA GERAL (FULL INTERACTIVE MONTHLY CALENDAR + DAY INSPECTOR)
  // ==========================================================================
  function getItemsForCalendarDate(dateStr) {
    const items = [];
    state.tasks.forEach((t) => {
      if (doesTaskOccurOnDate(t, dateStr)) {
        items.push({
          ...t,
          isRecurringProjection: t.dueDate !== dateStr && Boolean(t.recurrenceRule)
        });
      }
    });

    if (state.calShowGcal) {
      state.gcalEvents.forEach((ev) => {
        if (ev.dueDate === dateStr) {
          items.push({
            id: String(ev.id),
            content: stripEmojis(ev.content),
            description: stripEmojis(ev.description || ''),
            dueDate: ev.dueDate,
            dueTime: ev.dueTime || null,
            estimatedMinutes: Number(ev.estimatedMinutes || 45),
            priority: 'p2',
            projectName: 'Google Agenda',
            source: 'gcal',
            checked: Boolean(state.gcalDoneIds[ev.id])
          });
        }
      });
    }
    return items;
  }

  function renderGeneralCalendar() {
    const year = state.calYear;
    const month = state.calMonth;
    const titleEl = document.getElementById('calendarMonthTitle');
    const gridEl = document.getElementById('calendarDaysGrid');
    if (titleEl) {
      titleEl.textContent = `${MONTH_NAMES_PT[month]} ${year}`;
    }
    if (!gridEl) return;

    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = getTodayDateStr();
    if (!state.calSelectedDate) state.calSelectedDate = todayStr;

    let cellsHtml = '';
    for (let i = 0; i < startOffset; i++) {
      cellsHtml += `<div class="cal-day-cell other-month"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayItems = getItemsForCalendarDate(dateStr);
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === state.calSelectedDate;

      const pillsHtml = dayItems
        .slice(0, 3)
        .map((it) => {
          const cls =
            it.source === 'gcal'
              ? 'gcal-pill'
              : it.recurrenceRule || it.recurring
              ? 'rec-pill'
              : '';
          const tPrefix = it.dueTime ? `${it.dueTime} ` : '';
          return `<div class="cal-mini-pill ${cls}">${escapeHtml(tPrefix + it.content)}</div>`;
        })
        .join('');

      const moreHtml =
        dayItems.length > 3
          ? `<div class="cal-mini-pill">+${dayItems.length - 3} mais</div>`
          : '';

      cellsHtml += `
        <div class="cal-day-cell ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}" data-cal-date="${dateStr}">
          <div class="cal-day-num">
            <span>${day}</span>
            ${dayItems.length > 0 ? `<span class="cal-day-count">${dayItems.length}</span>` : ''}
          </div>
          <div class="cal-mini-items">
            ${pillsHtml}
            ${moreHtml}
          </div>
        </div>
      `;
    }

    gridEl.innerHTML = cellsHtml;
    renderCalendarDayInspector(state.calSelectedDate);
  }

  function renderCalendarDayInspector(dateStr) {
    const titleEl = document.getElementById('inspectorDateTitle');
    const listEl = document.getElementById('inspectorTasksList');
    if (titleEl) {
      const todayStr = getTodayDateStr();
      const prefix = dateStr === todayStr ? 'Hoje · ' : '';
      titleEl.textContent = `${prefix}${formatDateBR(dateStr)} (${formatDateShortBR(dateStr)})`;
    }
    if (!listEl) return;

    const items = getItemsForCalendarDate(dateStr);
    if (items.length === 0) {
      listEl.innerHTML = `<div class="history-row"><span class="history-row-meta">Nenhuma atividade agendada para este dia. Clique em "Agendar neste dia" para criar.</span></div>`;
      return;
    }

    listEl.innerHTML = items
      .map((it) => {
        const badge =
          it.source === 'gcal'
            ? 'Google Agenda'
            : (it.recurrenceRule && it.recurrenceRule.label) || (it.recurring ? String(it.recurring) : 'Tarefa');
        const timePart = it.dueTime ? `${it.dueTime} · ` : '';
        return `
          <div class="queue-item-row ${it.checked ? 'completed' : ''}" data-cal-task-id="${escapeHtml(it.id)}">
            <span class="queue-item-text">${escapeHtml(it.content)}</span>
            <span class="queue-item-est">${escapeHtml(timePart + badge)} · ${it.estimatedMinutes || 15}m</span>
          </div>
        `;
      })
      .join('');
  }

  // ==========================================================================
  // TIMER CONSOLE & CONFIGURABLE ATTENTION CALL
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
      const intervalSec = Math.max(60, Math.round(Number(state.attentionIntervalMin || 5) * 60));
      if (state.timerSeconds > 0 && state.timerSeconds % intervalSec === 0) {
        triggerConfiguredAttentionCall(false);
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
      const attName =
        state.attentionMode === 'light'
          ? 'Luminoso'
          : state.attentionMode === 'sound'
          ? 'Sonoro'
          : state.attentionMode === 'both'
          ? 'Luminoso + Sonoro'
          : 'Sem alerta';
      if (state.timerRunning) {
        subStatus.textContent = `Focando · Meta ${Math.round(estSec / 60)}m · Alerta ${attName} (${state.attentionIntervalMin}m)`;
      } else if (state.timerSeconds > 0) {
        subStatus.textContent = 'Pausado · Pronto para retomar';
      } else {
        subStatus.textContent = `Pronto · Alerta ${attName} a cada ${state.attentionIntervalMin}m`;
      }
    }

    if (playLabel) {
      playLabel.textContent = state.timerRunning ? 'Pausar' : state.timerSeconds > 0 ? 'Retomar' : 'Ativar Tempo';
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

  function syncAttentionUI() {
    document.querySelectorAll('.att-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-att-mode') === state.attentionMode);
    });
    const presetMins = [5, 10, 15];
    document.querySelectorAll('.att-int-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.getAttribute('data-att-min')) === state.attentionIntervalMin);
    });
    const customInput = document.getElementById('customAttentionMinInput');
    if (customInput && !presetMins.includes(state.attentionIntervalMin)) {
      customInput.value = String(state.attentionIntervalMin);
    }
    updateTimerProgressUI();
  }

  // ==========================================================================
  // TASK COMPLETION / UNCOMPLETION / ESTIMATE / NAVIGATION
  // ==========================================================================
  async function toggleTaskChecked(taskId) {
    const idStr = String(taskId);

    // Handle Google Calendar event completion locally + XP
    if (idStr.startsWith('gcal_')) {
      const wasDone = Boolean(state.gcalDoneIds[idStr]);
      state.gcalDoneIds[idStr] = !wasDone;
      saveJsonStorage(STORAGE_KEYS.GCAL_DONE, state.gcalDoneIds);
      if (!wasDone) {
        triggerLightPulse();
        playGlassHarmonic('complete');
        cycleMotivationalQuote();
        showToast('Compromisso do Google Agenda concluido!');
      }
      ensureValidCurrentTask();
      renderAll();
      return;
    }

    const target = state.tasks.find((t) => t.id === idStr);
    if (!target) return;

    if (target.checked) {
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

    const isCurrent = getCurrentTask() && getCurrentTask().id === target.id;
    const elapsedSec = isCurrent ? state.timerSeconds : 0;
    const startedAt = isCurrent && state.timerStartedAt ? state.timerStartedAt : new Date().toISOString();

    if (isCurrent) {
      resetTimer();
    }

    triggerLightPulse();
    playGlassHarmonic('complete');
    cycleMotivationalQuote();

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
    const tObj = state.tasks.find((t) => t.id === task.id);
    if (tObj) tObj.estimatedMinutes = mins;

    const bar = document.getElementById('inlineEstimateBar');
    if (bar) bar.classList.add('hidden');
    renderAll();
    showToast(`Tempo da tarefa definido para ${mins} min.`);

    if (!String(task.id).startsWith('gcal_')) {
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
  }

  function stepTask(delta) {
    if (state.filter === "calendar") {
      const curDate = state.calSelectedDate || getTodayDateStr();
      const nextDate = addDaysDateStr(delta, curDate);
      state.calSelectedDate = nextDate;
      const parts = nextDate.split("-").map(Number);
      if (parts.length === 3) {
        state.calYear = parts[0];
        state.calMonth = parts[1] - 1;
      }
      renderGeneralCalendar();
      return;
    }

    let list = getFilteredTasks();
    if (list.length <= 1) {
      const allToday = getCombinedTodayTasks();
      if (allToday.length > 1) {
        state.filter = "all";
        document.querySelectorAll(".filter-pill").forEach((b) => {
          b.classList.toggle("active", b.getAttribute("data-filter") === "all");
        });
        list = allToday;
      } else if (state.tasks.length > 1) {
        state.filter = "all";
        document.querySelectorAll(".filter-pill").forEach((b) => {
          b.classList.toggle("active", b.getAttribute("data-filter") === "all");
        });
        list = state.tasks;
      }
    }

    if (list.length === 0) {
      showToast("Nenhuma atividade na fila — pressione Q para criar uma nova tarefa.");
      return;
    }

    const curId = state.currentTaskId || (getCurrentTask() && getCurrentTask().id);
    let curIdx = curId ? list.findIndex((t) => String(t.id) === String(curId)) : 0;
    if (curIdx < 0) curIdx = 0;
    const nextIdx = (curIdx + delta + list.length) % list.length;
    state.currentTaskId = list[nextIdx].id;
    state.descExpanded = false;
    resetTimer();
    renderAll();

    const card = document.getElementById("focusTaskCard");
    if (card) {
      card.classList.remove("task-step-anim");
      void card.offsetWidth;
      card.classList.add("task-step-anim");
    }
    const activeRow = document.querySelector("#agendaQueueList .queue-item-row.active-focus");
    if (activeRow && activeRow.scrollIntoView) {
      activeRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // ==========================================================================
  // SHORTCUT 'Q': QUICK-ADD WITH LIVE INLINE HIGHLIGHTED TAGS & EXPLANATION
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
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }, 30);
    }
    if (desc) desc.value = '';
    updateQuickAddNlpPreview();
  }

  function updateQuickAddNlpPreview() {
    const input = document.getElementById('quickAddInput');
    const backdrop = document.getElementById('nlpHighlightBackdrop');
    const tokensList = document.getElementById('nlpTokensList');
    const humanTitle = document.getElementById('nlpHumanTitle');
    const humanSub = document.getElementById('nlpHumanSub');

    const raw = input ? input.value : '';
    if (backdrop) {
      backdrop.innerHTML = renderInlineHighlightedBackdrop(raw);
    }

    const parsed = parseNaturalLanguageTask(raw, state.qaPicker);

    if (humanTitle) {
      humanTitle.textContent =
        parsed.humanScheduleSummary ||
        `Agendada para ${parsed.dueDateLabel || 'Hoje'} na sua Agenda do Dia`;
    }
    if (humanSub) {
      const timeInfo = parsed.dueTime ? ` às ${parsed.dueTime}` : '';
      const recInfo = parsed.recurrenceRule ? ` · Repetição: ${parsed.recurrenceRule.label}` : '';
      humanSub.textContent = `Tempo estimado: ${parsed.estimatedMinutes} min${timeInfo}${recInfo} · Prioridade ${parsed.priority.toUpperCase()}`;
    }

    if (!tokensList) return;
    const chips = [];
    chips.push(
      `<span class="nlp-chip">Quando: ${escapeHtml(parsed.dueDateLabel || 'Hoje')}${parsed.dueTime ? ' às ' + escapeHtml(parsed.dueTime) : ''}</span>`
    );
    if (parsed.recurrenceRule) {
      chips.push(`<span class="nlp-chip">Recorrencia: ${escapeHtml(parsed.recurrenceRule.label)}</span>`);
    }
    chips.push(`<span class="nlp-chip">Tempo: ${parsed.estimatedMinutes} min</span>`);
    chips.push(`<span class="nlp-chip">Prioridade: ${parsed.priority.toUpperCase()}</span>`);
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
          recurrenceRule: parsed.recurrenceRule,
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
        if (d.task && d.task.id && state.filter !== 'calendar') {
          state.currentTaskId = String(d.task.id);
        }
        renderAll();
        triggerLightPulse();
        showToast(`Criada: ${parsed.dueDateLabel || 'Hoje'} (${parsed.estimatedMinutes}m) · +10 XP`);
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
        title: 'Criar Nova Tarefa com Tags de Agenda',
        right: 'Tecla Q',
        run: () => openQuickAddModal(q)
      },
      {
        type: 'cmd',
        id: 'cmd_ultra_focus',
        title: state.ultraFocus ? 'Sair do Modo Ultra Foco' : 'Ativar Modo Ultra Foco (So Tarefa + Cronometro)',
        right: 'Tecla U',
        run: () => setUltraFocusMode(!state.ultraFocus)
      },
      {
        type: 'cmd',
        id: 'cmd_general_calendar',
        title: 'Abrir Agenda Geral (Calendario Mensal Completo)',
        right: 'Calendario',
        run: () => setFilterView('calendar')
      },
      {
        type: 'cmd',
        id: 'cmd_toggle_timer',
        title: state.timerRunning ? 'Pausar Cronometro de Foco' : 'Ativar Tempo (Iniciar Cronometro)',
        right: 'Espaco',
        run: () => toggleTimerPlayPause()
      },
      {
        type: 'cmd',
        id: 'cmd_toggle_gcal',
        title: state.includeGcalInToday
          ? 'Ocultar Eventos do Google Agenda da Fila do Dia'
          : 'Incluir Eventos do Google Agenda na Fila do Dia',
        right: 'Google Agenda',
        run: () => toggleIncludeGcalInToday(!state.includeGcalInToday)
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
        id: 'cmd_toggle_theme',
        title: state.theme === 'dark' ? 'Mudar para Modo Claro (Pearl Light)' : 'Mudar para Modo Escuro (Obsidian Dark)',
        right: 'Tema',
        run: () => applyTheme(state.theme === 'dark' ? 'light' : 'dark')
      }
    ];

    const allTasks = getCombinedTodayTasks();
    const matchingTasks = allTasks
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
        right: `${t.source === 'gcal' ? 'Google Agenda · ' : ''}${t.estimatedMinutes || 15}m`,
        run: () => {
          setFilterView(t.checked ? 'all' : 'pending');
          state.currentTaskId = t.id;
          renderAll();
          showToast('Atividade colocada em foco.');
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
      html += `<div class="spotlight-section-label">Atividades da Agenda</div>`;
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

  async function toggleIncludeGcalInToday(enabled) {
    state.includeGcalInToday = Boolean(enabled);
    localStorage.setItem(STORAGE_KEYS.INCLUDE_GCAL, state.includeGcalInToday ? '1' : '0');
    syncGcalUIElements();
    ensureValidCurrentTask();
    renderAll();
    showToast(
      state.includeGcalInToday
        ? 'Eventos do Google Agenda incluidos na fila do dia.'
        : 'Eventos do Google Agenda ocultados da fila do dia.'
    );
    try {
      await fetch('/api/gcal/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeInToday: state.includeGcalInToday })
      });
    } catch (_) {}
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
    syncGcalUIElements();
    const note = document.getElementById('todoistStatusNote');
    if (note) {
      note.textContent = state.hasTodoistToken
        ? 'Token do Todoist ativo e sincronizado no servidor.'
        : 'Tarefas do Todoist sincronizadas no seu workspace.';
    }
  }

  function closeAllModals() {
    ['quickAddModal', 'spotlightModal', 'reportsModal', 'settingsModal', 'tutorialModal', 'lofiStudioPopover'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
  }

  // ==========================================================================
  // EVENT BINDINGS & GLOBAL KEYBOARD SHORTCUTS ('Q', 'CMD+K', 'U', 'SPACE', 'ESC')
  // ==========================================================================
  function bindEvents() {
    // Auth Tabs & Form
    const tabLogin = document.getElementById('authTabLogin');
    const tabReg = document.getElementById('authTabRegister');
    if (tabLogin) tabLogin.addEventListener('click', () => setAuthMode('login'));
    if (tabReg) tabReg.addEventListener('click', () => setAuthMode('register'));

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
          } else if (errMsg) {
            errMsg.textContent = (d && d.error) || 'Credenciais invalidas.';
            errMsg.classList.remove('hidden');
          }
        } catch (_) {
          if (errMsg) {
            errMsg.textContent = 'Erro de comunicacao com o servidor.';
            errMsg.classList.remove('hidden');
          }
        }
      });
    }

    // Filter pills (Foco | Agenda do Dia | Agenda Geral | Concluidas)
    document.querySelectorAll('.filter-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        setFilterView(btn.getAttribute('data-filter') || 'pending');
      });
    });

    // Top bar & Ultra Focus buttons
    const openSpotlightBtn = document.getElementById('openSpotlightBtn');
    const openQuickAddBtn = document.getElementById('openQuickAddBtn');
    const queueQuickAddBtn = document.getElementById('queueQuickAddBtn');
    const openCalendarFromQueueBtn = document.getElementById('openCalendarFromQueueBtn');
    const openReportsBtn = document.getElementById('openReportsBtn');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const ultraFocusToggleBtn = document.getElementById('ultraFocusToggleBtn');
    const cardUltraFocusBtn = document.getElementById('cardUltraFocusBtn');
    const exitUltraFocusBtn = document.getElementById('exitUltraFocusBtn');
    const syncNowBtn = document.getElementById('syncNowBtn');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const nextQuoteBtn = document.getElementById('nextQuoteBtn');

    if (openSpotlightBtn) openSpotlightBtn.addEventListener('click', openSpotlightModal);
    if (openQuickAddBtn) openQuickAddBtn.addEventListener('click', () => openQuickAddModal(''));
    if (queueQuickAddBtn) queueQuickAddBtn.addEventListener('click', () => openQuickAddModal(''));
    if (openCalendarFromQueueBtn) {
      openCalendarFromQueueBtn.addEventListener('click', () => setFilterView('calendar'));
    }
    if (openReportsBtn) openReportsBtn.addEventListener('click', openReportsModal);
    if (openSettingsBtn) openSettingsBtn.addEventListener('click', openSettingsModal);
    if (ultraFocusToggleBtn) {
      ultraFocusToggleBtn.addEventListener('click', () => setUltraFocusMode(!state.ultraFocus));
    }
    if (cardUltraFocusBtn) {
      cardUltraFocusBtn.addEventListener('click', () => setUltraFocusMode(!state.ultraFocus));
    }
    if (exitUltraFocusBtn) {
      exitUltraFocusBtn.addEventListener('click', () => setUltraFocusMode(false));
    }
    if (syncNowBtn) {
      syncNowBtn.addEventListener('click', async () => {
        await loadWorkspaceData(true);
        showToast('Google Agenda e Todoist sincronizados.');
      });
    }
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        applyTheme(state.theme === 'dark' ? 'light' : 'dark');
      });
    }
    if (nextQuoteBtn) {
      nextQuoteBtn.addEventListener('click', cycleMotivationalQuote);
    }

    // Google Agenda inclusion toggles
    const includeGcalToggle = document.getElementById('includeGcalToggle');
    const settingsIncludeGcalToggle = document.getElementById('settingsIncludeGcalToggle');
    const calViewGcalToggle = document.getElementById('calViewGcalToggle');

    if (includeGcalToggle) {
      includeGcalToggle.addEventListener('change', () => {
        toggleIncludeGcalInToday(includeGcalToggle.checked);
      });
    }
    if (settingsIncludeGcalToggle) {
      settingsIncludeGcalToggle.addEventListener('change', () => {
        toggleIncludeGcalInToday(settingsIncludeGcalToggle.checked);
      });
    }
    if (calViewGcalToggle) {
      calViewGcalToggle.addEventListener('change', () => {
        state.calShowGcal = calViewGcalToggle.checked;
        renderGeneralCalendar();
      });
    }

    // Agenda Geral Calendar navigation
    const calPrevBtn = document.getElementById('calPrevMonthBtn');
    const calNextBtn = document.getElementById('calNextMonthBtn');
    const calTodayBtn = document.getElementById('calTodayBtn');
    const calNewTaskDateBtn = document.getElementById('calNewTaskDateBtn');
    const calGrid = document.getElementById('calendarDaysGrid');
    const inspectorList = document.getElementById('inspectorTasksList');

    if (calPrevBtn) {
      calPrevBtn.addEventListener('click', () => {
        state.calMonth -= 1;
        if (state.calMonth < 0) {
          state.calMonth = 11;
          state.calYear -= 1;
        }
        renderGeneralCalendar();
      });
    }
    if (calNextBtn) {
      calNextBtn.addEventListener('click', () => {
        state.calMonth += 1;
        if (state.calMonth > 11) {
          state.calMonth = 0;
          state.calYear += 1;
        }
        renderGeneralCalendar();
      });
    }
    if (calTodayBtn) {
      calTodayBtn.addEventListener('click', () => {
        const now = new Date();
        state.calYear = now.getFullYear();
        state.calMonth = now.getMonth();
        state.calSelectedDate = getTodayDateStr();
        renderGeneralCalendar();
      });
    }
    if (calNewTaskDateBtn) {
      calNewTaskDateBtn.addEventListener('click', () => {
        const sel = state.calSelectedDate || getTodayDateStr();
        const [, m, d] = sel.split('-');
        openQuickAddModal(`dia ${d}/${m} `);
      });
    }
    if (calGrid) {
      calGrid.addEventListener('click', (e) => {
        const cell = e.target.closest('[data-cal-date]');
        if (!cell) return;
        state.calSelectedDate = cell.getAttribute('data-cal-date');
        renderGeneralCalendar();
      });
    }
    if (inspectorList) {
      inspectorList.addEventListener('click', (e) => {
        const row = e.target.closest('[data-cal-task-id]');
        if (!row) return;
        const tid = row.getAttribute('data-cal-task-id');
        state.currentTaskId = tid;
        setFilterView('all');
        showToast('Atividade aberta no painel de foco.');
      });
    }

    // Focus card & Timer controls
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

    // Configurable Attention Call (Luminoso / Sonoro / Ambos + Custom Minutes)
    document.querySelectorAll('.att-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.attentionMode = btn.getAttribute('data-att-mode') || 'both';
        localStorage.setItem(STORAGE_KEYS.ATT_MODE, state.attentionMode);
        syncAttentionUI();
        triggerConfiguredAttentionCall(true);
      });
    });

    document.querySelectorAll('.att-int-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.attentionIntervalMin = Math.max(1, Number(btn.getAttribute('data-att-min') || 5));
        localStorage.setItem(STORAGE_KEYS.ATT_MIN, String(state.attentionIntervalMin));
        const customIn = document.getElementById('customAttentionMinInput');
        if (customIn) customIn.value = '';
        syncAttentionUI();
        showToast(`Chamada de atencao ajustada para cada ${state.attentionIntervalMin} min.`);
      });
    });

    const customAttInput = document.getElementById('customAttentionMinInput');
    if (customAttInput) {
      customAttInput.addEventListener('change', () => {
        const val = Math.min(180, Math.max(1, Math.round(Number(customAttInput.value || 5))));
        state.attentionIntervalMin = val;
        localStorage.setItem(STORAGE_KEYS.ATT_MIN, String(val));
        syncAttentionUI();
        showToast(`Chamada de atencao personalizada: a cada ${val} min.`);
      });
    }

    const testAttBtn = document.getElementById('testAttentionNowBtn');
    if (testAttBtn) {
      testAttBtn.addEventListener('click', () => triggerConfiguredAttentionCall(true));
    }

    // Inline Estimate Bar on Focus Card (Presets + Custom Time Input)
    const taskEstBtn = document.getElementById('taskEstimateBtn');
    const inlineEstBar = document.getElementById('inlineEstimateBar');
    const saveCustomEstBtn = document.getElementById('saveCustomEstimateBtn');
    const customEstInput = document.getElementById('customEstimateInput');

    if (taskEstBtn && inlineEstBar) {
      taskEstBtn.addEventListener('click', () => {
        inlineEstBar.classList.toggle('hidden');
        if (!inlineEstBar.classList.contains('hidden') && customEstInput) {
          const cur = getCurrentTask();
          customEstInput.value = cur ? String(cur.estimatedMinutes || 15) : '15';
          setTimeout(() => customEstInput.focus(), 20);
        }
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
      customEstInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (customEstInput.value) saveTaskEstimate(Number(customEstInput.value));
        }
      });
    }

    // Subtasks & Queue clicks
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

    // Quick-Add ('Q') Modal Events + Token Insertion Chips + Custom Time Input
    const quickAddInput = document.getElementById('quickAddInput');
    const quickAddForm = document.getElementById('quickAddForm');
    const qaCustomEstInput = document.getElementById('qaCustomEstInput');

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

    // Quick token insertion chips (e.g. "toda segunda", "toda terca", "daqui 15 dias")
    document.querySelectorAll('[data-qa-token]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!quickAddInput) return;
        const token = btn.getAttribute('data-qa-token') || '';
        const curVal = quickAddInput.value.trim();
        quickAddInput.value = curVal ? `${curVal} ${token} ` : `${token} `;
        quickAddInput.focus();
        updateQuickAddNlpPreview();
      });
    });

    document.querySelectorAll('[data-qa-est]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-qa-est]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.qaPicker.est = Number(btn.getAttribute('data-qa-est') || 15);
        if (qaCustomEstInput) qaCustomEstInput.value = '';
        updateQuickAddNlpPreview();
      });
    });

    if (qaCustomEstInput) {
      qaCustomEstInput.addEventListener('input', () => {
        const v = Number(qaCustomEstInput.value);
        if (v > 0 && v <= 480) {
          document.querySelectorAll('[data-qa-est]').forEach((b) => b.classList.remove('active'));
          state.qaPicker.est = Math.round(v);
          updateQuickAddNlpPreview();
        }
      });
    }

    document.querySelectorAll('[data-qa-prio]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-qa-prio]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.qaPicker.prio = btn.getAttribute('data-qa-prio') || 'p4';
        updateQuickAddNlpPreview();
      });
    });

    // Spotlight Modal Events
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

    // Settings Modal: Logout, Google Agenda Config & Todoist Config
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

    const gcalForm = document.getElementById('gcalConfigForm');
    if (gcalForm) {
      gcalForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const urlInput = document.getElementById('gcalIcsUrlInput');
        const incCheck = document.getElementById('settingsIncludeGcalToggle');
        const note = document.getElementById('gcalStatusNote');
        const icsUrl = urlInput ? urlInput.value.trim() : '';
        const inc = incCheck ? incCheck.checked : state.includeGcalInToday;

        if (note) note.textContent = 'Sincronizando configurações do Google Agenda...';
        try {
          const r = await fetch('/api/gcal/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              includeInToday: inc,
              icsUrl: icsUrl || undefined
            })
          });
          const d = await r.json();
          if (r.ok && d && d.ok) {
            state.includeGcalInToday = Boolean(d.includeInToday);
            localStorage.setItem(STORAGE_KEYS.INCLUDE_GCAL, state.includeGcalInToday ? '1' : '0');
            if (Array.isArray(d.events)) state.gcalEvents = d.events;
            state.gcalConnected = Boolean(d.connected);
            state.gcalCalendarName = d.calendarName || '';
            syncGcalUIElements();
            renderAll();
            showToast('Google Agenda atualizado com sucesso.');
          }
        } catch (_) {
          if (note) note.textContent = 'Erro ao salvar Google Agenda.';
        }
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
          } else if (note) {
            note.textContent = (d && d.error) || 'Nao foi possivel sincronizar este token.';
          }
        } catch (_) {
          if (note) note.textContent = 'Erro ao salvar token.';
        }
      });
    }

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', closeAllModals);
    });
    document.querySelectorAll('.glass-modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeAllModals();
      });
    });

    // Global Keyboard Shortcuts: Q, Cmd/Ctrl+K, U (Ultra Foco), Space, Arrows, Escape
    document.addEventListener('keydown', (e) => {
      if (!state.authenticated) return;

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
        if (state.ultraFocus) setUltraFocusMode(false);
        return;
      }

      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isTyping = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';
      if (isTyping) return;

      if (e.key.toLowerCase() === 'q' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openQuickAddModal('');
      } else if (e.key.toLowerCase() === 'u' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setUltraFocusMode(!state.ultraFocus);
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

  // ==========================================================================
  // 8-STAGE SLOW-GROWING BOTANICAL TREE (6 MONTHS / 180 DAYS OF CONSISTENCY)
  // ==========================================================================
  const BOTANICAL_STAGES = [
    { level: 1, title: 'Semente Despertando', short: 'Semente', period: 'Dias 1–7', minXp: 0, nextXp: 450, desc: 'A semente germina na terra fertil com os primeiros minutos de foco.' },
    { level: 2, title: 'Broto Inicial', short: 'Broto', period: 'Semanas 2–3', minXp: 450, nextXp: 1500, desc: 'As duas primeiras folhinhas se abrem buscando luz.' },
    { level: 3, title: 'Muda Jovem', short: 'Muda', period: 'Mes 1', minXp: 1500, nextXp: 3500, desc: 'Caule firme e quatro folhas vibrantes apos o primeiro mes.' },
    { level: 4, title: 'Arbusto Ramificado', short: 'Arbusto', period: 'Mes 2', minXp: 3500, nextXp: 6500, desc: 'Primeiros galhos laterais e raizes profundas no segundo mes.' },
    { level: 5, title: 'Arvore Jovem', short: 'Arvore Jovem', period: 'Mes 3', minXp: 6500, nextXp: 10000, desc: 'Tronco de madeira estruturado e copa ganhando volume.' },
    { level: 6, title: 'Arvore Frondosa', short: 'Frondosa', period: 'Mes 4', minXp: 10000, nextXp: 14000, desc: 'Copa densa em multiplas camadas oferecendo sombra e clareza.' },
    { level: 7, title: 'Arvore em Flor', short: 'Em Flor', period: 'Mes 5', minXp: 14000, nextXp: 18000, desc: 'Flores delicadas desabrocham celebrando 5 meses de disciplina.' },
    { level: 8, title: 'Super Arvore Ancestral', short: 'Super Arvore', period: '6 Meses+', minXp: 18000, nextXp: 18000, desc: 'O apice de 6 meses seguidos: arvore majestosa com frutos dourados e luz.' }
  ];

  function computeBotanicalStage(xpInput) {
    const xp = Math.max(0, Math.round(Number(xpInput || 0)));
    let cur = BOTANICAL_STAGES[0];
    let next = BOTANICAL_STAGES[1];
    for (let i = 0; i < BOTANICAL_STAGES.length; i++) {
      if (xp >= BOTANICAL_STAGES[i].minXp) {
        cur = BOTANICAL_STAGES[i];
        next = BOTANICAL_STAGES[i + 1] || BOTANICAL_STAGES[BOTANICAL_STAGES.length - 1];
      }
    }
    const span = Math.max(1, next.minXp - cur.minXp);
    const stagePct = cur.level === 8 ? 100 : Math.min(100, Math.max(4, Math.round(((xp - cur.minXp) / span) * 100)));
    const sixMonthPct = Math.min(100, Number(((xp / 18000) * 100).toFixed(1)));
    return { xp, stage: cur, nextStage: next, stagePct, sixMonthPct };
  }

  function getBotanicalStageSvg(stageNum) {
    const s = Math.min(8, Math.max(1, Number(stageNum || 1)));
    const soil = `<ellipse cx="40" cy="70" rx="24" ry="5.5" fill="rgba(120, 82, 48, 0.32)"/><path d="M20 70 Q40 65 60 70" stroke="#8B5E34" stroke-width="2.2" stroke-linecap="round" fill="none"/>`;

    if (s === 1) {
      // Stage 1: Seed cracking open with tiny green tip
      return `<svg viewBox="0 0 80 80" fill="none">
        ${soil}
        <g class="tree-sway-group">
          <ellipse cx="40" cy="65" rx="7" ry="5" fill="#A47148" stroke="#6F4518" stroke-width="1.5"/>
          <path d="M40 62 C40 56 42 53 45 51" stroke="#22C55E" stroke-width="2.4" stroke-linecap="round"/>
          <circle cx="45.5" cy="50.5" r="2.5" fill="#4ADE80" class="tree-canopy-breath"/>
        </g>
      </svg>`;
    }
    if (s === 2) {
      // Stage 2: Tender sprout with 2 cotyledon leaves
      return `<svg viewBox="0 0 80 80" fill="none">
        ${soil}
        <g class="tree-sway-group">
          <path d="M40 69 Q39 55 40 44" stroke="#16A34A" stroke-width="2.8" stroke-linecap="round"/>
          <g class="tree-canopy-breath">
            <path d="M40 47 C31 45 27 38 34 36 C38 35 40 41 40 47 Z" fill="#22C55E"/>
            <path d="M40 45 C49 43 53 36 46 34 C42 33 40 39 40 45 Z" fill="#4ADE80"/>
          </g>
        </g>
      </svg>`;
    }
    if (s === 3) {
      // Stage 3: Young sapling with 4 vibrant leaves (Month 1)
      return `<svg viewBox="0 0 80 80" fill="none">
        ${soil}
        <g class="tree-sway-group">
          <path d="M40 69 Q41 50 40 34" stroke="#15803D" stroke-width="3.2" stroke-linecap="round"/>
          <g class="tree-canopy-breath">
            <path d="M40 53 C28 51 25 43 32 41 C37 40 39 47 40 53 Z" fill="#16A34A"/>
            <path d="M40 50 C52 48 55 40 48 38 C43 37 41 44 40 50 Z" fill="#22C55E"/>
            <path d="M40 38 C30 34 29 25 36 25 C40 25 40 33 40 38 Z" fill="#22C55E"/>
            <path d="M40 36 C50 32 51 23 44 23 C40 23 40 31 40 36 Z" fill="#4ADE80"/>
          </g>
        </g>
      </svg>`;
    }
    if (s === 4) {
      // Stage 4: Branched shrub (Month 2)
      return `<svg viewBox="0 0 80 80" fill="none">
        ${soil}
        <g class="tree-sway-group">
          <path d="M40 70 L40 34 M40 52 L29 42 M40 48 L51 38" stroke="#784B2A" stroke-width="3.6" stroke-linecap="round"/>
          <g class="tree-canopy-breath">
            <circle cx="28" cy="39" r="9" fill="#16A34A"/>
            <circle cx="52" cy="36" r="9.5" fill="#15803D"/>
            <circle cx="40" cy="28" r="12" fill="#22C55E"/>
            <circle cx="37" cy="25" r="7" fill="#4ADE80" fill-opacity="0.7"/>
          </g>
        </g>
      </svg>`;
    }
    if (s === 5) {
      // Stage 5: Young Structured Tree (Month 3)
      return `<svg viewBox="0 0 80 80" fill="none">
        ${soil}
        <g class="tree-sway-group">
          <path d="M36 70 Q39 52 38 35 L42 35 Q41 52 44 70 Z" fill="#7C4D2B"/>
          <path d="M39 48 L26 36 M41 45 L54 34" stroke="#7C4D2B" stroke-width="3.2" stroke-linecap="round"/>
          <g class="tree-canopy-breath">
            <circle cx="26" cy="34" r="11" fill="#15803D"/>
            <circle cx="54" cy="33" r="11" fill="#16A34A"/>
            <circle cx="40" cy="24" r="15" fill="#22C55E"/>
            <circle cx="36" cy="20" r="9" fill="#4ADE80" fill-opacity="0.65"/>
          </g>
        </g>
      </svg>`;
    }
    if (s === 6) {
      // Stage 6: Lush Layered Canopy Tree (Month 4)
      return `<svg viewBox="0 0 80 80" fill="none">
        ${soil}
        <g class="tree-sway-group">
          <path d="M33 70 Q38 50 37 32 L43 32 Q42 50 47 70 Z" fill="#6F4518"/>
          <path d="M38 46 L22 33 M42 44 L58 31 M40 36 L30 22 M40 36 L50 22" stroke="#6F4518" stroke-width="3.4" stroke-linecap="round"/>
          <g class="tree-canopy-breath">
            <circle cx="22" cy="34" r="12.5" fill="#14532D"/>
            <circle cx="58" cy="33" r="12.5" fill="#15803D"/>
            <circle cx="31" cy="22" r="14" fill="#16A34A"/>
            <circle cx="49" cy="22" r="14" fill="#22C55E"/>
            <circle cx="40" cy="17" r="13" fill="#4ADE80"/>
          </g>
        </g>
      </svg>`;
    }
    if (s === 7) {
      // Stage 7: Flowering Tree (Month 5)
      return `<svg viewBox="0 0 80 80" fill="none">
        ${soil}
        <g class="tree-sway-group">
          <path d="M32 70 Q37 49 36 30 L44 30 Q43 49 48 70 Z" fill="#6F4518"/>
          <g class="tree-canopy-breath">
            <circle cx="21" cy="34" r="13" fill="#15803D"/>
            <circle cx="59" cy="33" r="13" fill="#16A34A"/>
            <circle cx="30" cy="21" r="14.5" fill="#16A34A"/>
            <circle cx="50" cy="21" r="14.5" fill="#22C55E"/>
            <circle cx="40" cy="16" r="14" fill="#4ADE80"/>
            <!-- Blossoms -->
            <circle cx="24" cy="29" r="3" fill="#F472B6"/>
            <circle cx="36" cy="14" r="3.2" fill="#FB7185"/>
            <circle cx="48" cy="19" r="3" fill="#F472B6"/>
            <circle cx="56" cy="31" r="2.8" fill="#FBBF24"/>
            <circle cx="31" cy="36" r="2.8" fill="#F472B6"/>
          </g>
        </g>
      </svg>`;
    }
    // Stage 8: 6-Month Super Ancestral Tree (Majestic canopy, roots, golden fruits & floating spores)
    return `<svg viewBox="0 0 80 80" fill="none">
      <ellipse cx="40" cy="71" rx="29" ry="6" fill="rgba(52, 199, 89, 0.22)"/>
      <g class="tree-sway-group">
        <!-- Deep Roots & Majestic Trunk -->
        <path d="M26 72 Q35 66 35 45 L36 28 L44 28 L45 45 Q45 66 54 72 Z" fill="#583101"/>
        <path d="M37 44 L19 29 M43 42 L61 28 M39 34 L27 18 M41 34 L53 18" stroke="#583101" stroke-width="3.8" stroke-linecap="round"/>
        <g class="tree-canopy-breath">
          <circle cx="19" cy="33" r="14" fill="#14532D"/>
          <circle cx="61" cy="32" r="14" fill="#15803D"/>
          <circle cx="29" cy="19" r="15.5" fill="#16A34A"/>
          <circle cx="51" cy="19" r="15.5" fill="#22C55E"/>
          <circle cx="40" cy="14" r="15" fill="#4ADE80"/>
          <circle cx="40" cy="28" r="13" fill="#22C55E"/>
          <!-- Golden Wisdom Fruits & Light Spores -->
          <circle cx="23" cy="27" r="3.3" fill="#FBBF24" class="tree-spore-dot"/>
          <circle cx="38" cy="12" r="3.5" fill="#F59E0B" class="tree-spore-dot"/>
          <circle cx="53" cy="21" r="3.3" fill="#FBBF24" class="tree-spore-dot"/>
          <circle cx="32" cy="31" r="3.1" fill="#FDE047" class="tree-spore-dot"/>
          <circle cx="58" cy="34" r="3.1" fill="#F59E0B" class="tree-spore-dot"/>
        </g>
      </g>
    </svg>`;
  }

  let previewedStageLevel = null;

  function renderBotanicalEverywhere(triggerBurst) {
    const xp = (state.user && Number(state.user.xp)) || 0;
    const info = computeBotanicalStage(xp);
    const activeStageNum = previewedStageLevel || info.stage.level;
    const svgMarkup = getBotanicalStageSvg( info.stage.level );

    // 1. Top Bar Capsule
    const topHost = document.getElementById('topPlantSvgHost');
    const topLbl = document.getElementById('topLevelLabel');
    const topXp = document.getElementById('topXpValue');
    if (topHost) topHost.innerHTML = svgMarkup;
    if (topLbl) topLbl.textContent = `Est. ${info.stage.level} · ${info.stage.short}`;
    if (topXp) topXp.textContent = `${info.xp} XP`;

    // 2. Sidebar Botanical Card
    const sideSvg = document.getElementById('sidebarTreeStageSvg');
    const sidePeriod = document.getElementById('sidebarTreePeriodBadge');
    const sideTitle = document.getElementById('sidebarTreeStageTitle');
    const sideSub = document.getElementById('sidebarTreeSubText');
    const sideFill = document.getElementById('sidebarTreeProgressFill');
    const sideXpLbl = document.getElementById('sidebarTreeXpLabel');
    const sideSixPct = document.getElementById('sidebarSixMonthPctLabel');
    const sideCard = document.getElementById('botanicalSidebarCard');

    if (sideSvg) sideSvg.innerHTML = svgMarkup;
    if (sidePeriod) sidePeriod.textContent = info.stage.period;
    if (sideTitle) sideTitle.textContent = info.stage.title;
    if (sideSub) sideSub.textContent = info.stage.desc;
    if (sideFill) sideFill.style.width = `${info.stagePct}%`;
    if (sideXpLbl) {
      sideXpLbl.textContent =
        info.stage.level === 8
          ? `${info.xp} XP (Estagio Maximo)`
          : `${info.xp} / ${info.nextStage.minXp} XP p/ ${info.nextStage.short}`;
    }
    if (sideSixPct) sideSixPct.textContent = `${info.sixMonthPct}% de 6 meses`;

    if (triggerBurst && sideCard) {
      sideCard.classList.add('nutrir-burst');
      setTimeout(() => sideCard.classList.remove('nutrir-burst'), 1100);
    }

    // 3. Reports Modal Showcase & 8-Stage Interactive Timeline
    const modalSvg = document.getElementById('modalTreeStageSvg');
    const repTitle = document.getElementById('reportLevelTitle');
    const repSub = document.getElementById('reportXpSubtitle');
    const repFill = document.getElementById('reportXpBarFill');
    const timeline = document.getElementById('treeStagesTimeline');
    const previewHint = document.getElementById('treePreviewHint');

    const shownStage = BOTANICAL_STAGES.find((s) => s.level === activeStageNum) || info.stage;
    if (modalSvg) modalSvg.innerHTML = getBotanicalStageSvg(shownStage.level);
    if (repTitle) repTitle.textContent = `Estagio ${shownStage.level} · ${shownStage.title} (${shownStage.period})`;
    if (repSub) {
      repSub.textContent = `${shownStage.desc} — Voce acumula XP diariamente ate atingir a Super Arvore Ancestral em 6 meses (18.000 XP).`;
    }
    if (repFill) repFill.style.width = `${info.stagePct}%`;
    if (previewHint) {
      previewHint.textContent =
        shownStage.level === info.stage.level
          ? `Seu estagio atual (${info.sixMonthPct}% da jornada de 6 meses)`
          : `Pre-visualizando Estagio ${shownStage.level} (${shownStage.period})`;
    }

    if (timeline) {
      timeline.innerHTML = BOTANICAL_STAGES.map((st) => {
        const isUnlocked = info.xp >= st.minXp;
        const isActive = st.level === shownStage.level;
        return `
          <button type="button" class="tree-stage-node ${isUnlocked ? 'unlocked' : ''} ${isActive ? 'active-preview' : ''}" data-preview-stage="${st.level}">
            <div class="stage-node-svg">${getBotanicalStageSvg(st.level)}</div>
            <span class="stage-node-title">${st.short}</span>
            <span class="stage-node-period">${st.period}</span>
          </button>
        `;
      }).join('');
    }
  }

  // ==========================================================================
  // OPTIONAL LO-FI & AMBIENT SOUNDSCAPE SYNTHESIZER (WebAudio Realtime)
  // ==========================================================================
  const lofiEngine = {
    playing: false,
    station: localStorage.getItem('lf_v36_lofi_station') || 'lofi_chill',
    volume: Number(localStorage.getItem('lf_v36_lofi_vol') || 40),
    ctx: null,
    masterGain: null,
    nodes: [],
    chordTimer: null
  };

  function stopLofiNodes() {
    if (lofiEngine.chordTimer) {
      clearInterval(lofiEngine.chordTimer);
      lofiEngine.chordTimer = null;
    }
    lofiEngine.nodes.forEach((n) => {
      try {
        if (n.stop) n.stop();
        if (n.disconnect) n.disconnect();
      } catch (_) {}
    });
    lofiEngine.nodes = [];
  }

  function startLofiSynth() {
    const ctx = getAudioContext();
    if (!ctx) return;
    stopLofiNodes();

    const master = ctx.createGain();
    master.gain.setValueAtTime((lofiEngine.volume / 100) * 0.28, ctx.currentTime);
    master.connect(ctx.destination);
    lofiEngine.masterGain = master;

    // Subtle warm vinyl/rain noise bed
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      output[i] = (b0 + b1 + b2) * 0.35;
    }
    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lofiEngine.station === 'rain_glass' ? 950 : 420;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = lofiEngine.station === 'rain_glass' ? 0.55 : 0.14;
    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(master);
    whiteNoise.start();
    lofiEngine.nodes.push(whiteNoise, filter, noiseGain);

    if (lofiEngine.station === 'lofi_chill') {
      // Warm Rhodes Jazzy Lo-Fi chord progression
      const chords = [
        [261.63, 329.63, 392.00, 493.88], // Cmaj7
        [220.00, 261.63, 329.63, 392.00], // Am7
        [293.66, 349.23, 440.00, 523.25], // Dm7
        [196.00, 246.94, 293.66, 349.23]  // G7
      ];
      let cIdx = 0;
      const playChord = () => {
        if (!lofiEngine.playing) return;
        const notes = chords[cIdx % chords.length];
        cIdx += 1;
        const now = ctx.currentTime;
        notes.forEach((freq) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);
          g.gain.setValueAtTime(0.0001, now);
          g.gain.linearRampToValueAtTime(0.08, now + 0.45);
          g.gain.exponentialRampToValueAtTime(0.001, now + 3.4);
          osc.connect(g);
          g.connect(master);
          osc.start(now);
          osc.stop(now + 3.5);
        });
      };
      playChord();
      lofiEngine.chordTimer = setInterval(playChord, 3500);
    } else if (lofiEngine.station === 'binaural_alpha') {
      // 432Hz + 442Hz (10Hz Alpha Focus Wave)
      [216, 226].forEach((freq) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.value = 0.16;
        osc.connect(g);
        g.connect(master);
        osc.start();
        lofiEngine.nodes.push(osc, g);
      });
    } else if (lofiEngine.station === 'night_cafe') {
      // Warm harmonic pad drone
      [146.83, 220.0, 277.18].forEach((freq) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = 340;
        g.gain.value = 0.12;
        osc.connect(lpf);
        lpf.connect(g);
        g.connect(master);
        osc.start();
        lofiEngine.nodes.push(osc, lpf, g);
      });
    }
  }

  function syncLofiUI() {
    const pillBtn = document.getElementById('lofiTogglePillBtn');
    const eq = document.getElementById('lofiLiveizer');
    const playMasterBtn = document.getElementById('lofiPlayMasterBtn');
    const playMasterLbl = document.getElementById('lofiPlayMasterLabel');
    const volSlider = document.getElementById('lofiVolumeSlider');
    const volVal = document.getElementById('lofiVolumeVal');

    if (pillBtn) pillBtn.classList.toggle('playing', lofiEngine.playing);
    if (eq) eq.classList.toggle('hidden', !lofiEngine.playing);
    if (playMasterBtn) playMasterBtn.classList.toggle('active', lofiEngine.playing);
    if (playMasterLbl) playMasterLbl.textContent = lofiEngine.playing ? 'Pausar' : 'Tocar';
    if (volSlider) volSlider.value = String(lofiEngine.volume);
    if (volVal) volVal.textContent = `${lofiEngine.volume}%`;

    document.querySelectorAll('.lofi-station-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-lofi-station') === lofiEngine.station);
    });
  }

  function toggleLofiPlay() {
    lofiEngine.playing = !lofiEngine.playing;
    if (lofiEngine.playing) {
      startLofiSynth();
      showToast('Lo-Fi ambiente ativado.');
    } else {
      stopLofiNodes();
      showToast('Lo-Fi pausado.');
    }
    syncLofiUI();
  }

  // ==========================================================================
  // LIGHT FIRST-ACCESS TUTORIAL CONTROLLER
  // ==========================================================================
  function openTutorialModal() {
    closeAllModals();
    const modal = document.getElementById('tutorialModal');
    if (modal) modal.classList.remove('hidden');
  }

  function checkFirstAccessTutorial() {
    const seen = localStorage.getItem('lf_v36_tutorial_seen');
    if (!seen && state.authenticated) {
      localStorage.setItem('lf_v36_tutorial_seen', '1');
      setTimeout(() => {
        openTutorialModal();
      }, 450);
    }
  }

  function bindV36Enhancements() {
    // Botanical Sidebar Card click opens Reports & Tree Timeline Modal
    const botCard = document.getElementById('botanicalSidebarCard');
    if (botCard) {
      botCard.addEventListener('click', () => {
        previewedStageLevel = null;
        openReportsModal();
        renderBotanicalEverywhere(false);
      });
    }

    // Interactive 8-Stage Timeline clicks inside Reports Modal
    const timeline = document.getElementById('treeStagesTimeline');
    if (timeline) {
      timeline.addEventListener('click', (e) => {
        const node = e.target.closest('[data-preview-stage]');
        if (!node) return;
        previewedStageLevel = Number(node.getAttribute('data-preview-stage') || 1);
        renderBotanicalEverywhere(false);
      });
    }

    // Lo-Fi Popover & Controls
    const lofiPill = document.getElementById('lofiTogglePillBtn');
    const lofiPop = document.getElementById('lofiStudioPopover');
    const lofiMasterBtn = document.getElementById('lofiPlayMasterBtn');
    const lofiSlider = document.getElementById('lofiVolumeSlider');

    if (lofiPill && lofiPop) {
      if (lofiPop.parentElement !== document.body) {
        document.body.appendChild(lofiPop);
      }
      const positionLofiPopover = () => {
        const rect = lofiPill.getBoundingClientRect();
        const popW = 310;
        const topPx = Math.max(64, Math.round(rect.bottom + 10));
        const leftPx = Math.max(12, Math.min(window.innerWidth - popW - 16, Math.round(rect.right - popW)));
        lofiPop.style.position = "fixed";
        lofiPop.style.top = topPx + "px";
        lofiPop.style.left = leftPx + "px";
        lofiPop.style.right = "auto";
        lofiPop.style.zIndex = "9950";
      };
      lofiPill.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = lofiPop.classList.contains("hidden");
        if (willOpen) {
          positionLofiPopover();
          lofiPop.classList.remove("hidden");
        } else {
          lofiPop.classList.add("hidden");
        }
      });
      window.addEventListener("resize", () => {
        if (!lofiPop.classList.contains("hidden")) positionLofiPopover();
      });
      const lofiCloseBtn = document.getElementById("lofiClosePopoverBtn");
      if (lofiCloseBtn) {
        lofiCloseBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          lofiPop.classList.add("hidden");
        });
      }
      document.addEventListener("click", (e) => {
        if (!lofiPop.classList.contains("hidden") && !lofiPop.contains(e.target) && !lofiPill.contains(e.target)) {
          lofiPop.classList.add("hidden");
        }
      });
    }

    if (lofiMasterBtn) {
      lofiMasterBtn.addEventListener('click', toggleLofiPlay);
    }

    document.querySelectorAll('.lofi-station-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        lofiEngine.station = btn.getAttribute('data-lofi-station') || 'lofi_chill';
        localStorage.setItem('lf_v36_lofi_station', lofiEngine.station);
        if (!lofiEngine.playing) {
          lofiEngine.playing = true;
        }
        startLofiSynth();
        syncLofiUI();
      });
    });

    if (lofiSlider) {
      lofiSlider.addEventListener('input', () => {
        lofiEngine.volume = Number(lofiSlider.value || 40);
        localStorage.setItem('lf_v36_lofi_vol', String(lofiEngine.volume));
        if (lofiEngine.masterGain && lofiEngine.ctx) {
          lofiEngine.masterGain.gain.setValueAtTime((lofiEngine.volume / 100) * 0.28, lofiEngine.ctx.currentTime);
        }
        syncLofiUI();
      });
    }

    // Tutorial Modal buttons
    const openTutBtn = document.getElementById('openTutorialBtn');
    const tutDoneBtn = document.getElementById('tutorialDoneBtn');
    const tutQuickBtn = document.getElementById('tutorialOpenQuickAddBtn');

    if (openTutBtn) openTutBtn.addEventListener('click', openTutorialModal);
    if (tutDoneBtn) {
      tutDoneBtn.addEventListener('click', () => {
        localStorage.setItem('lf_v36_tutorial_seen', '1');
        closeAllModals();
      });
    }
    if (tutQuickBtn) {
      tutQuickBtn.addEventListener('click', () => {
        localStorage.setItem('lf_v36_tutorial_seen', '1');
        openQuickAddModal('Planejar metas toda segunda 14:30 35m p1 ');
      });
    }

    syncLofiUI();
  }

  window.LF = { state, getCurrentTask: () => { try { return getCurrentTask(); } catch (_) { return null; } }, updateAuthUI, showToast, closeAllModals };
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(state.theme);
    syncAttentionUI();
    bindEvents();
    bindV36Enhancements();
    checkSessionAndBoot().then(() => {
      renderBotanicalEverywhere(false);
      checkFirstAccessTutorial();
    });
  });
})();
