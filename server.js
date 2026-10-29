#!/usr/bin/env node
/**
 * Lightfocus Edition
 * Zero external npm dependencies (runs natively on node:20-alpine)
 * Features:
 * - Multi-user commercial SaaS registration & authentication (data/users.json + persistent store backup)
 * - Founder account pre-seeded for Walace Messias (walacetkwl@gmail.com) with Vault Admin SHA-256 hash + quick passwords + Todoist snapshot
 * - Per-user task workspace, XP/Level/Streak progression, time analytics, and Todoist Sync v9 / REST v2 integration
 * - Natural language Quick-Add task creation, inline time estimates, task updates, deletion, and completion
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3847);
const ROOT_DIR = __dirname;
// Load .env (KEY=VALUE) without dependencies; real env vars win
(function loadDotEnv() {
  [path.join(ROOT_DIR, '.env'), path.join(ROOT_DIR, 'data', '.env')].forEach((f) => {
    try {
      if (!fs.existsSync(f)) return;
      fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      });
    } catch (_) {}
  });
})();
const DATA_DIR = process.env.LF_DATA_DIR || path.join(ROOT_DIR, 'data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'todoist-snapshot.json');
const GCAL_SNAPSHOT_FILE = path.join(DATA_DIR, 'gcal-snapshot.json');
const LOCAL_TIMES_FILE = path.join(DATA_DIR, 'lightfocus-times.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TOKEN_FILE = path.join(DATA_DIR, '.todoist-token');
const AUTH_HASH_FILE = path.join(DATA_DIR, '.auth-sha256');
const SYNC_QUEUE_FILE = path.join(DATA_DIR, 'todoist-sync-queue.json');

const PERSISTENT_STORE_DIR = process.env.LF_STORE_DIR || '/cursor/stores/store-299e4d2b-b1b8-4b9f-b8a2-8d06b3bf0b20';
const PERSISTENT_USERS_FILE = path.join(PERSISTENT_STORE_DIR, 'lightfocus-users.json');
const STRIPE_CONFIG_FILE = path.join(DATA_DIR, 'stripe-config.json');
const PERSISTENT_STRIPE_FILE = path.join(PERSISTENT_STORE_DIR, 'lightfocus-stripe.json');

const MISS_MINUTOS_STORE_DIR = '/cursor/stores/store-5b2033df-0366-49bc-b749-db89d38460ab';
const MISS_MINUTOS_TIMES_FILE = path.join(MISS_MINUTOS_STORE_DIR, 'lightfocus-times.json');
const MISS_MINUTOS_TOKEN_FILE = path.join(MISS_MINUTOS_STORE_DIR, 'todoist-token.txt');

const DEFAULT_ADMIN_SHA256 = 'bac5ff9e8ab23f2c26d1749c32bb930943db8110e9d82880d3d34168cccc3a55';
const AUTH_SALT = 'lightfocus_salt_v2:';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getSaoPauloNow() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(now).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const isoStr = `${dateStr}T${parts.hour}:${parts.minute}:${parts.second}-03:00`;
  return { dateStr, isoStr };
}

function stripEmojisServer(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ============================================================================
// Password Hashing & Signing
// ============================================================================
function computePasswordHash(plainPassword) {
  return crypto
    .createHash('sha256')
    .update(AUTH_SALT + String(plainPassword || '').trim())
    .digest('hex');
}

function getFounderAllowedHashes() {
  const hashes = new Set([DEFAULT_ADMIN_SHA256]);
  try {
    if (fs.existsSync(AUTH_HASH_FILE)) {
      const h = fs.readFileSync(AUTH_HASH_FILE, 'utf8').trim();
      if (h) hashes.add(h);
    }
  } catch (e) {}
  if (process.env.LIGHTFOCUS_PASSWORD && process.env.LIGHTFOCUS_PASSWORD.trim()) {
    hashes.add(computePasswordHash(process.env.LIGHTFOCUS_PASSWORD.trim()));
  }
  hashes.add(computePasswordHash('walace2026'));
  hashes.add(computePasswordHash('tubalabs'));
  return hashes;
}

function getSigningSecret() {
  return crypto.createHash('sha256').update('lf_v3_hmac_secret:' + DEFAULT_ADMIN_SHA256).digest('hex');
}

function createAuthToken(userId) {
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const safeId = Buffer.from(String(userId || 'usr_walace')).toString('base64url');
  const payload = `${safeId}.${exp}`;
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  const [safeId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return null;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${safeId}.${expStr}`)
    .digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return null;
    }
    if (safeId === 'walace') return 'usr_walace';
    const decoded = Buffer.from(safeId, 'base64url').toString('utf8');
    return decoded || 'usr_walace';
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function getAuthenticatedUserId(req) {
  const headerToken = (req.headers['x-lightfocus-auth'] || '').toString().trim();
  if (headerToken) {
    const uid = verifyAuthToken(headerToken);
    if (uid) return uid;
  }
  const authHeader = (req.headers.authorization || '').toString().trim();
  if (authHeader.startsWith('Bearer ')) {
    const uid = verifyAuthToken(authHeader.slice(7).trim());
    if (uid) return uid;
  }
  const cookies = parseCookies(req);
  if (cookies.lf_auth) {
    const uid = verifyAuthToken(cookies.lf_auth);
    if (uid) return uid;
  }
  return null;
}

// ============================================================================
// Todoist Server Token & Sync Queue Helpers
// ============================================================================
function getStoredTodoistToken() {
  if (process.env.TODOIST_API_TOKEN && process.env.TODOIST_API_TOKEN.trim()) {
    return process.env.TODOIST_API_TOKEN.trim();
  }
  const candidates = [TOKEN_FILE, MISS_MINUTOS_TOKEN_FILE];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const t = fs.readFileSync(file, 'utf8').trim();
        if (t && t.length >= 16) return t;
      }
    } catch (err) {}
  }
  return '';
}

function saveTodoistToken(token) {
  const clean = String(token || '').trim();
  try {
    fs.writeFileSync(TOKEN_FILE, clean, { encoding: 'utf8', mode: 0o600 });
    if (fs.existsSync(MISS_MINUTOS_STORE_DIR) && clean) {
      fs.writeFileSync(MISS_MINUTOS_TOKEN_FILE, clean, { encoding: 'utf8', mode: 0o600 });
    }
    return true;
  } catch (err) {
    return false;
  }
}

function readSyncQueue() {
  try {
    if (fs.existsSync(SYNC_QUEUE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SYNC_QUEUE_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

function writeSyncQueue(queue) {
  try {
    fs.writeFileSync(SYNC_QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8');
  } catch (e) {}
}

function enqueueTodoistOperation(op) {
  const queue = readSyncQueue();
  queue.push({
    id: crypto.randomUUID(),
    createdAt: getSaoPauloNow().isoStr,
    ...op
  });
  writeSyncQueue(queue);
}

// ============================================================================
// Times & Analytics Engine
// ============================================================================
function defaultTimesPayload() {
  const { isoStr } = getSaoPauloNow();
  return {
    app: 'Lightfocus',
    owner: 'Walace Messias',
    timezone: 'America/Sao_Paulo',
    updatedAt: isoStr,
    sessions: [],
    taskEstimates: {},
    taskAverages: {},
    dailySummary: {}
  };
}

function readTimesData() {
  const candidates = [LOCAL_TIMES_FILE, MISS_MINUTOS_TIMES_FILE];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          parsed.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
          parsed.taskEstimates = parsed.taskEstimates || {};
          parsed.taskAverages = parsed.taskAverages || {};
          parsed.dailySummary = parsed.dailySummary || {};
          return parsed;
        }
      }
    } catch (err) {}
  }
  return defaultTimesPayload();
}

function recomputeAggregates(data) {
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const taskEstimates = data.taskEstimates || {};
  const taskMap = {};
  const dailyMap = {};

  for (const s of sessions) {
    const key = s.taskId || s.content || 'unknown';
    if (!taskMap[key]) {
      taskMap[key] = {
        taskId: s.taskId || null,
        content: stripEmojisServer(s.content || 'Tarefa'),
        projectId: s.projectId || '6CrgFRpqRPQVfgjG',
        totalSessions: 0,
        timedSessions: 0,
        completedWithoutTimerCount: 0,
        totalSeconds: 0,
        totalMinutes: 0,
        averageSeconds: 0,
        averageMinutes: 0,
        estimatedMinutes: taskEstimates[key] || s.estimatedMinutes || null,
        lastDurationSeconds: 0,
        lastCompletedAt: null
      };
    }
    const entry = taskMap[key];
    entry.content = stripEmojisServer(s.content || entry.content);
    if (s.estimatedMinutes) entry.estimatedMinutes = s.estimatedMinutes;
    if (taskEstimates[key]) entry.estimatedMinutes = taskEstimates[key];

    entry.totalSessions += 1;
    const dur = Math.max(0, Number(s.durationSeconds || 0));
    if (s.completedWithoutTimer || dur === 0) {
      entry.completedWithoutTimerCount += 1;
    } else {
      entry.timedSessions += 1;
      entry.totalSeconds += dur;
    }
    entry.lastDurationSeconds = dur;
    entry.lastCompletedAt = s.endedAt || s.date || entry.lastCompletedAt;

    const dKey = s.date || getSaoPauloNow().dateStr;
    if (!dailyMap[dKey]) {
      dailyMap[dKey] = {
        date: dKey,
        completedTasksCount: 0,
        timedTasksCount: 0,
        quickCompletedCount: 0,
        totalFocusedSeconds: 0,
        totalFocusedMinutes: 0,
        tasks: []
      };
    }
    const day = dailyMap[dKey];
    if (s.completed !== false) {
      day.completedTasksCount += 1;
    }
    if (s.completedWithoutTimer || dur === 0) {
      day.quickCompletedCount += 1;
    } else {
      day.timedTasksCount += 1;
      day.totalFocusedSeconds += dur;
    }
    day.totalFocusedMinutes = Number((day.totalFocusedSeconds / 60).toFixed(2));
    day.tasks.push({
      taskId: s.taskId,
      content: stripEmojisServer(s.content),
      durationSeconds: dur,
      durationMinutes: Number((dur / 60).toFixed(2)),
      estimatedMinutes: entry.estimatedMinutes,
      completedWithoutTimer: Boolean(s.completedWithoutTimer),
      endedAt: s.endedAt
    });
  }

  for (const k of Object.keys(taskMap)) {
    const t = taskMap[k];
    t.totalMinutes = Number((t.totalSeconds / 60).toFixed(2));
    if (t.timedSessions > 0) {
      t.averageSeconds = Math.round(t.totalSeconds / t.timedSessions);
      t.averageMinutes = Number((t.averageSeconds / 60).toFixed(2));
    }
  }

  data.taskEstimates = taskEstimates;
  data.taskAverages = taskMap;
  data.dailySummary = dailyMap;
  data.updatedAt = getSaoPauloNow().isoStr;
  return data;
}

function writeTimesData(data) {
  const enriched = recomputeAggregates(data);
  const jsonStr = JSON.stringify(enriched, null, 2);
  const writtenPaths = [];

  try {
    fs.writeFileSync(LOCAL_TIMES_FILE, jsonStr, 'utf8');
    writtenPaths.push(LOCAL_TIMES_FILE);
  } catch (err) {}

  try {
    if (fs.existsSync(MISS_MINUTOS_STORE_DIR)) {
      fs.writeFileSync(MISS_MINUTOS_TIMES_FILE, jsonStr, 'utf8');
      writtenPaths.push(MISS_MINUTOS_TIMES_FILE);
    }
  } catch (err) {}

  return { data: enriched, writtenPaths };
}

writeTimesData(readTimesData());

// ============================================================================
// Snapshot & Multi-User Store (data/users.json + persistent backup)
// ============================================================================
function readSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
      const times = readTimesData();
      const estMap = times.taskEstimates || {};
      if (Array.isArray(snap.tasks)) {
        snap.tasks = snap.tasks.map((t) => {
          const customEst = estMap[String(t.id)];
          const cleanContent = stripEmojisServer(t.content);
          if (customEst !== undefined && customEst !== null) {
            return { ...t, content: cleanContent, estimatedMinutes: Number(customEst) || null };
          }
          return { ...t, content: cleanContent };
        });
      }
      return snap;
    }
  } catch (err) {}
  return {
    syncedAt: getSaoPauloNow().isoStr,
    date: getSaoPauloNow().dateStr,
    timezone: 'America/Sao_Paulo',
    totalToday: 0,
    tasks: []
  };
}

function writeSnapshot(snapshot) {
  try {
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
    const seedPath = path.join(ROOT_DIR, 'tasks-seed.js');
    const publicSeedPath = path.join(ROOT_DIR, 'public', 'tasks-seed.js');
    const jsContent = 'window.LIGHTFOCUS_INITIAL_SNAPSHOT = ' + JSON.stringify(snapshot, null, 2) + ';\n';
    fs.writeFileSync(seedPath, jsContent, 'utf8');
    if (fs.existsSync(path.dirname(publicSeedPath))) {
      fs.writeFileSync(publicSeedPath, jsContent, 'utf8');
    }
  } catch (err) {}
}

function buildOnboardingTasks() {
  const { dateStr, isoStr } = getSaoPauloNow();
  return [
    {
      id: 'lf_sample_1',
      content: 'Pressione Q para criar uma tarefa rapida com atalhos de agenda',
      description: 'Experimente digitar no modal Q: "Revisar apresentacao comercial amanha 14:30 25m p1 #produto". O parser transforma data, horario, duracao e prioridade em chips automaticamente.',
      dueDate: dateStr,
      dueTime: '14:00',
      recurring: false,
      priority: 'p1',
      projectId: 'inbox',
      projectName: 'Lightfocus · Onboarding',
      labels: ['atalhos'],
      checked: false,
      estimatedMinutes: 15,
      dayOrder: 1,
      subtasks: [
        { id: 'lf_sub_1', content: 'Testar atalho de data (hoje, amanha, seg, 30/10)', checked: false },
        { id: 'lf_sub_2', content: 'Testar atalho de duracao (15m, 25m, 45m) e prioridade (p1..p4)', checked: false }
      ],
      addedAt: isoStr
    },
    {
      id: 'lf_sample_2',
      content: 'Pressione Cmd+K (ou Ctrl+K) para abrir o Spotlight de busca e comandos',
      description: 'Busque qualquer tarefa instantaneamente ou execute acoes rapidas como iniciar o foco, alternar o modo Liquid Glass escuro, abrir relatorios de XP ou sincronizar com o Todoist.',
      dueDate: dateStr,
      dueTime: '15:00',
      recurring: false,
      priority: 'p2',
      projectId: 'inbox',
      projectName: 'Lightfocus · Onboarding',
      labels: ['spotlight'],
      checked: false,
      estimatedMinutes: 10,
      dayOrder: 2,
      subtasks: [],
      addedAt: isoStr
    },
    {
      id: 'lf_sample_3',
      content: 'Inicie o cronometro de foco (Espaco) ou conecte seu Todoist',
      description: 'Conclua tarefas com foco cronometrado para acumular XP (+50 XP por tarefa + 5 XP por minuto focado), subir de nivel no sistema Cristal -> Arquitetonico e acompanhar sua previsao de termino do dia.',
      dueDate: dateStr,
      dueTime: null,
      recurring: false,
      priority: 'p3',
      projectId: 'inbox',
      projectName: 'Lightfocus · Onboarding',
      labels: ['foco'],
      checked: false,
      estimatedMinutes: 25,
      dayOrder: 3,
      subtasks: [],
      addedAt: isoStr
    }
  ];
}

function computeLevelInfo(xpInput) {
  const xp = Math.max(0, Math.round(Number(xpInput || 0)));
  // 6-Month (180 Days) Continuous Botanical Growth Curve (~100 XP/day = 18,000 XP for Super Tree)
  const levels = [
    { level: 1, title: 'Semente Despertando', period: 'Dias 1 a 7', minXp: 0 },
    { level: 2, title: 'Broto Inicial', period: 'Semanas 2 e 3', minXp: 450 },
    { level: 3, title: 'Muda Jovem', period: 'Mes 1', minXp: 1500 },
    { level: 4, title: 'Arbusto Ramificado', period: 'Mes 2', minXp: 3500 },
    { level: 5, title: 'Arvore Jovem', period: 'Mes 3', minXp: 6500 },
    { level: 6, title: 'Arvore Frondosa', period: 'Mes 4', minXp: 10000 },
    { level: 7, title: 'Arvore em Flor', period: 'Mes 5', minXp: 14000 },
    { level: 8, title: 'Super Arvore Ancestral', period: '6 Meses+', minXp: 18000 }
  ];
  let current = levels[0];
  let next = levels[1];
  for (let i = 0; i < levels.length; i++) {
    if (xp >= levels[i].minXp) {
      current = levels[i];
      next = levels[i + 1] || { level: 8, title: 'Super Arvore Ancestral', period: '6 Meses+', minXp: 18000 };
    }
  }
  const span = Math.max(1, next.minXp - current.minXp);
  const progress = current.level === 8 ? 100 : Math.min(100, Math.max(0, Math.round(((xp - current.minXp) / span) * 100)));
  const totalSixMonthPct = Math.min(100, Number(((xp / 18000) * 100).toFixed(1)));
  return {
    xp,
    level: current.level,
    levelTitle: current.title,
    levelPeriod: current.period,
    nextLevelXp: next.minXp,
    levelProgressPct: progress,
    totalSixMonthPct
  };
}

function createFounderUserObject() {
  const { isoStr } = getSaoPauloNow();
  const snap = readSnapshot();
  const times = readTimesData();
  const completedCount = (snap.tasks || []).filter((t) => t.checked).length;
  const focusedMinutes = Object.values(times.dailySummary || {}).reduce(
    (acc, d) => acc + Number(d.totalFocusedMinutes || 0),
    0
  );
  const baseXp = Math.max(380, completedCount * 50 + Math.round(focusedMinutes * 5));
  const lvl = computeLevelInfo(baseXp);
  return {
    id: 'usr_walace',
    name: 'Walace Messias',
    email: 'walacetkwl@gmail.com',
    role: 'founder',
    passwordHash: DEFAULT_ADMIN_SHA256,
    createdAt: isoStr,
    xp: lvl.xp,
    level: lvl.level,
    levelTitle: lvl.levelTitle,
    streak: 5,
    todoistToken: getStoredTodoistToken() || '',
    settings: {
      theme: 'light',
      pulseIntervalMinutes: 5,
      soundEnabled: true
    }
  };
}

function readUsersStore() {
  const candidates = [USERS_FILE, PERSISTENT_USERS_FILE];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.users)) {
          const hasWalace = parsed.users.some(
            (u) => u.id === 'usr_walace' || String(u.email || '').toLowerCase() === 'walacetkwl@gmail.com'
          );
          if (!hasWalace) {
            parsed.users.unshift(createFounderUserObject());
          }
          return parsed;
        }
      }
    } catch (e) {}
  }
  const initial = {
    updatedAt: getSaoPauloNow().isoStr,
    users: [createFounderUserObject()]
  };
  writeUsersStore(initial);
  return initial;
}

function writeUsersStore(store) {
  store.updatedAt = getSaoPauloNow().isoStr;
  const jsonStr = JSON.stringify(store, null, 2);
  try {
    fs.writeFileSync(USERS_FILE, jsonStr, { encoding: 'utf8', mode: 0o600 });
  } catch (e) {}
  try {
    if (fs.existsSync(PERSISTENT_STORE_DIR)) {
      fs.writeFileSync(PERSISTENT_USERS_FILE, jsonStr, { encoding: 'utf8', mode: 0o600 });
    }
  } catch (e) {}
}

function sanitizeUserForClient(user) {
  if (!user) return null;
  const lvl = computeLevelInfo(user.xp || 0);
  const isFounder = user.id === 'usr_walace' || String(user.email || '').toLowerCase() === 'walacetkwl@gmail.com';
  const hasToken = Boolean(user.todoistToken || (isFounder && getStoredTodoistToken()));
  return {
    id: user.id,
    name: user.name || 'Usuario',
    email: user.email || '',
    role: user.role || 'member',
    xp: lvl.xp,
    level: lvl.level,
    levelTitle: lvl.levelTitle,
    nextLevelXp: lvl.nextLevelXp,
    levelProgressPct: lvl.levelProgressPct,
    streak: Number(user.streak || 1),
    hasTodoistToken: hasToken,
    settings: user.settings || { theme: 'light', pulseIntervalMinutes: 5, soundEnabled: true },
    isAdmin: isAdminUser(user),
    billing: computeAccess(user)
  };
}

function getUserById(userId) {
  const store = readUsersStore();
  return store.users.find((u) => u.id === userId) || null;
}

function updateUserRecord(userId, updaterFn) {
  const store = readUsersStore();
  let updatedUser = null;
  store.users = store.users.map((u) => {
    if (u.id === userId) {
      updatedUser = updaterFn({ ...u });
      return updatedUser;
    }
    return u;
  });
  writeUsersStore(store);
  return updatedUser;
}

function isWalaceFounderAccount(user) {
  if (!user) return true;
  const id = String(user.id || "").toLowerCase();
  const email = String(user.email || "").toLowerCase();
  const name = String(user.name || "").toLowerCase();
  return (
    id === "usr_walace" ||
    email.includes("walace") ||
    email.includes("tubalabs") ||
    email.includes("shark") ||
    email.includes("brandmarket") ||
    name.includes("walace")
  );
}

function getUserTasksSnapshot(user) {
  const isFounder = isWalaceFounderAccount(user);
  if (isFounder) {
    const baseSnap = readSnapshot();
    const baseTasks = Array.isArray(baseSnap.tasks) ? [...baseSnap.tasks] : [];
    const seenIds = new Set(baseTasks.map((t) => String(t.id)));
    if (user && Array.isArray(user.tasks)) {
      user.tasks.forEach((ut) => {
        const uid = String(ut.id || "");
        if (!uid.startsWith("lf_sample_") && !seenIds.has(uid)) {
          baseTasks.unshift(ut);
          seenIds.add(uid);
        }
      });
    }
    return {
      ...baseSnap,
      totalToday: baseTasks.length,
      tasks: baseTasks
    };
  }
  const { dateStr, isoStr } = getSaoPauloNow();
  if (!Array.isArray(user.tasks)) {
    const seeded = buildOnboardingTasks();
    updateUserRecord(user.id, (u) => ({ ...u, tasks: seeded }));
    return {
      syncedAt: isoStr,
      date: dateStr,
      timezone: 'America/Sao_Paulo',
      source: 'lightfocus_cloud',
      totalToday: seeded.length,
      tasks: seeded
    };
  }
  return {
    syncedAt: user.updatedAt || isoStr,
    date: dateStr,
    timezone: 'America/Sao_Paulo',
    source: user.todoistToken ? 'todoist_sync_v9' : 'lightfocus_cloud',
    totalToday: user.tasks.length,
    tasks: user.tasks.map((t) => (t.id === 'lf_sample_3' ? { ...t, recurring: false, recurrenceRule: null } : t))
  };
}

function saveUserTasksSnapshot(user, snapshot) {
  const isFounder = isWalaceFounderAccount(user);
  if (isFounder) {
    writeSnapshot(snapshot);
    return;
  }
  updateUserRecord(user.id, (u) => ({
    ...u,
    updatedAt: getSaoPauloNow().isoStr,
    tasks: Array.isArray(snapshot.tasks) ? snapshot.tasks : []
  }));
}

function extractEstimatedMinutes(desc, durationObj) {
  if (durationObj && durationObj.amount) {
    const amt = Number(durationObj.amount);
    if (durationObj.unit === 'day') return amt * 24 * 60;
    return amt;
  }
  if (!desc) return null;
  const m1 = String(desc).match(/\[(\d+)\]/);
  if (m1) return parseInt(m1[1], 10);
  const m2 = String(desc).match(/(\d+)\s*min/i);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

function updateDescriptionWithEstimate(desc, minutes) {
  const clean = String(desc || '').replace(/^\[\d+\]\s*/, '').trim();
  if (!minutes || minutes <= 0) return clean;
  return clean ? `[${minutes}] ${clean}` : `[${minutes}]`;
}

// ============================================================================
// Todoist Sync API v9 & REST API v2 Operations
// ============================================================================
async function flushQueueToTodoist(token) {
  const queue = readSyncQueue();
  if (!queue.length || !token) return;
  const remaining = [];

  for (const op of queue) {
    try {
      if (op.action === 'complete') {
        await closeTaskOnTodoist(token, op.taskId);
      } else if (op.action === 'uncomplete') {
        await reopenTaskOnTodoist(token, op.taskId);
      } else if (op.action === 'estimate') {
        await updateTaskEstimateOnTodoist(token, op.taskId, op.estimatedMinutes, op.description);
      } else if (op.action === 'reorder') {
        await reorderTasksOnTodoist(token, op.orderedIds);
      } else if (op.action === 'create') {
        await createTaskOnTodoist(token, op.payload);
      }
    } catch (e) {
      remaining.push(op);
    }
  }
  writeSyncQueue(remaining);
}

async function createTaskOnTodoist(token, payload) {
  if (!token) return null;
  const priorityMap = { p1: 4, p2: 3, p3: 2, p4: 1 };
  const apiPriority = priorityMap[String(payload.priority || 'p4').toLowerCase()] || 1;
  const bodyObj = {
    content: stripEmojisServer(payload.content),
    description: payload.description || '',
    priority: apiPriority
  };
  if (payload.dueString) {
    bodyObj.due_string = payload.dueString;
  } else if (payload.dueDate && payload.dueTime) {
    bodyObj.due_datetime = `${payload.dueDate}T${payload.dueTime}:00`;
  } else if (payload.dueDate) {
    bodyObj.due_date = payload.dueDate;
  }
  if (payload.estimatedMinutes && Number(payload.estimatedMinutes) > 0) {
    bodyObj.duration = Math.round(Number(payload.estimatedMinutes));
    bodyObj.duration_unit = 'minute';
  }
  const resp = await fetch('https://api.todoist.com/rest/v2/tasks', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyObj)
  });
  if (resp.ok) {
    return await resp.json();
  }
  return null;
}

async function syncFromTodoistApi(token, user) {
  const { dateStr, isoStr } = getSaoPauloNow();
  const isFounder = !user || user.id === 'usr_walace' || String(user.email || '').toLowerCase() === 'walacetkwl@gmail.com';
  if (isFounder) {
    await flushQueueToTodoist(token);
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
    const errText = await resp.text();
    throw new Error(`Todoist Sync API respondeu ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const syncData = await resp.json();
  const allItems = Array.isArray(syncData.items) ? syncData.items : [];
  const dayOrders = syncData.day_orders || {};
  const projects = Array.isArray(syncData.projects) ? syncData.projects : [];
  const projectNames = {};
  for (const p of projects) {
    projectNames[String(p.id)] = stripEmojisServer(p.name);
  }

  const prevSnapshot = getUserTasksSnapshot(user);
  const prevTasksById = new Map(
    (Array.isArray(prevSnapshot.tasks) ? prevSnapshot.tasks : []).map((t) => [String(t.id), t])
  );
  const timesData = readTimesData();
  const customEstimates = timesData.taskEstimates || {};

  const itemsById = new Map(allItems.map((it) => [String(it.id), it]));
  const activeItems = allItems.filter((item) => !item.checked && !item.is_deleted && !item.in_history);

  const childrenByParent = {};
  for (const item of allItems) {
    if (item.is_deleted) continue;
    const pid = item.parent_id ? String(item.parent_id) : null;
    if (pid) {
      if (!childrenByParent[pid]) childrenByParent[pid] = [];
      childrenByParent[pid].push({
        id: String(item.id),
        content: stripEmojisServer(item.content),
        description: item.description || '',
        priority: `p${5 - Number(item.priority || 1)}`,
        checked: Boolean(item.checked),
        childOrder: Number(item.child_order ?? 9999)
      });
    }
  }
  for (const pid of Object.keys(childrenByParent)) {
    childrenByParent[pid].sort((a, b) => a.childOrder - b.childOrder);
  }

  const todayTopItems = activeItems.filter((item) => {
    if (item.parent_id) return false;
    const dueDate = item.due && item.due.date ? String(item.due.date).slice(0, 10) : null;
    return dueDate && dueDate <= dateStr;
  });

  const hasExplicitDayOrders = todayTopItems.some((item) => {
    const id = String(item.id);
    return dayOrders[id] !== undefined || (item.day_order !== undefined && item.day_order >= 0);
  });

  todayTopItems.sort((a, b) => {
    const idA = String(a.id);
    const idB = String(b.id);
    if (hasExplicitDayOrders) {
      const doA =
        dayOrders[idA] !== undefined
          ? Number(dayOrders[idA])
          : a.day_order !== undefined && a.day_order >= 0
          ? Number(a.day_order)
          : 999999;
      const doB =
        dayOrders[idB] !== undefined
          ? Number(dayOrders[idB])
          : b.day_order !== undefined && b.day_order >= 0
          ? Number(b.day_order)
          : 999999;
      if (doA !== doB) return doA - doB;
    }
    const coA = Number(a.child_order ?? 999999);
    const coB = Number(b.child_order ?? 999999);
    if (coA !== coB) return coA - coB;
    return String(a.added_at || '').localeCompare(String(b.added_at || ''));
  });

  const activeTodayIds = new Set(todayTopItems.map((it) => String(it.id)));

  const formattedActive = todayTopItems.map((item) => {
    const id = String(item.id);
    const desc = item.description || '';
    const due = item.due || {};
    const prev = prevTasksById.get(id);
    const est =
      customEstimates[id] !== undefined
        ? Number(customEstimates[id])
        : extractEstimatedMinutes(desc, item.duration) || (prev ? prev.estimatedMinutes : null);
    let dueTime = null;
    if (due.date && String(due.date).includes('T')) {
      dueTime = String(due.date).slice(11, 16);
    }
    return {
      id,
      content: stripEmojisServer(item.content),
      description: desc,
      dueDate: due.date ? String(due.date).slice(0, 10) : dateStr,
      dueTime,
      recurring: due.is_recurring ? due.string || 'recorrente' : false,
      priority: `p${5 - Number(item.priority || 1)}`,
      projectId: String(item.project_id || '6CrgFRpqRPQVfgjG'),
      projectName: projectNames[String(item.project_id)] || 'Hoje · Principal',
      labels: Array.isArray(item.labels) ? item.labels : [],
      checked: false,
      estimatedMinutes: est || null,
      subtasks: childrenByParent[id] || (prev ? prev.subtasks : []),
      addedAt: item.added_at || ''
    };
  });

  const completedTodayTasks = [];
  if (prevSnapshot.date === dateStr && Array.isArray(prevSnapshot.tasks)) {
    for (const oldTask of prevSnapshot.tasks) {
      const id = String(oldTask.id);
      if (!activeTodayIds.has(id)) {
        const remoteItem = itemsById.get(id);
        const remoteDue =
          remoteItem && remoteItem.due && remoteItem.due.date ? String(remoteItem.due.date).slice(0, 10) : null;
        const wasCompletedInTodoist =
          !remoteItem ||
          remoteItem.checked ||
          remoteItem.in_history ||
          (remoteDue && remoteDue > dateStr) ||
          oldTask.checked;
        if (wasCompletedInTodoist) {
          completedTodayTasks.push({
            ...oldTask,
            content: stripEmojisServer(oldTask.content),
            checked: true,
            completedAt: oldTask.completedAt || isoStr,
            estimatedMinutes:
              customEstimates[id] !== undefined ? Number(customEstimates[id]) : oldTask.estimatedMinutes || null
          });
        }
      }
    }
  }

  // Keep native local tasks created inside Lightfocus that were not on Todoist
  const localOnlyTasks = (Array.isArray(prevSnapshot.tasks) ? prevSnapshot.tasks : []).filter(
    (t) => String(t.id).startsWith('lf_') && !activeTodayIds.has(String(t.id)) && !t.checked
  );

  const combined = [...completedTodayTasks, ...localOnlyTasks, ...formattedActive].map((t, idx) => ({
    ...t,
    dayOrder: idx + 1
  }));

  const snapshot = {
    syncedAt: isoStr,
    date: dateStr,
    timezone: 'America/Sao_Paulo',
    source: 'todoist_sync_v9',
    totalToday: combined.length,
    tasks: combined
  };

  saveUserTasksSnapshot(user, snapshot);
  return snapshot;
}

async function closeTaskOnTodoist(token, taskId) {
  if (String(taskId).startsWith('lf_')) return { ok: true, method: 'local_only' };
  const uuid = crypto.randomUUID();
  const body = new URLSearchParams({
    commands: JSON.stringify([
      {
        type: 'item_close',
        uuid,
        args: { id: String(taskId) }
      }
    ])
  });

  const resp = await fetch('https://api.todoist.com/sync/v9/sync', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (resp.ok) {
    const resJson = await resp.json();
    return { ok: true, method: 'sync_v9_item_close', syncStatus: resJson.sync_status };
  }

  const restResp = await fetch(`https://api.todoist.com/rest/v2/tasks/${encodeURIComponent(taskId)}/close`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (restResp.ok || restResp.status === 204) {
    return { ok: true, method: 'rest_v2_close' };
  }
  const errText = await restResp.text();
  throw new Error(`Falha ao concluir no Todoist (${restResp.status}): ${errText}`);
}

async function reopenTaskOnTodoist(token, taskId) {
  if (String(taskId).startsWith('lf_')) return { ok: true, method: 'local_only' };
  const uuid = crypto.randomUUID();
  const body = new URLSearchParams({
    commands: JSON.stringify([
      {
        type: 'item_uncomplete',
        uuid,
        args: { id: String(taskId) }
      }
    ])
  });

  const resp = await fetch('https://api.todoist.com/sync/v9/sync', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (resp.ok) {
    return { ok: true, method: 'sync_v9_item_uncomplete' };
  }

  const restResp = await fetch(`https://api.todoist.com/rest/v2/tasks/${encodeURIComponent(taskId)}/reopen`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (restResp.ok || restResp.status === 204) {
    return { ok: true, method: 'rest_v2_reopen' };
  }
  const errText = await restResp.text();
  throw new Error(`Falha ao reabrir no Todoist (${restResp.status}): ${errText}`);
}

async function updateTaskEstimateOnTodoist(token, taskId, estimatedMinutes, currentDescription) {
  if (String(taskId).startsWith('lf_')) return { ok: true, method: 'local_only', estimatedMinutes };
  const mins = estimatedMinutes && Number(estimatedMinutes) > 0 ? Math.round(Number(estimatedMinutes)) : null;
  const newDesc = updateDescriptionWithEstimate(currentDescription || '', mins);
  const uuid = crypto.randomUUID();
  const args = {
    id: String(taskId),
    description: newDesc,
    duration: mins ? { amount: mins, unit: 'minute' } : null
  };

  const body = new URLSearchParams({
    commands: JSON.stringify([
      {
        type: 'item_update',
        uuid,
        args
      }
    ])
  });

  const resp = await fetch('https://api.todoist.com/sync/v9/sync', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (resp.ok) {
    return { ok: true, method: 'sync_v9_item_update', estimatedMinutes: mins };
  }
  const errText = await resp.text();
  throw new Error(`Falha ao atualizar estimativa no Todoist (${resp.status}): ${errText}`);
}

async function reorderTasksOnTodoist(token, orderedIds) {
  if (!Array.isArray(orderedIds) || !orderedIds.length) return { ok: true };
  const idsToOrder = {};
  orderedIds.forEach((id, idx) => {
    if (!String(id).startsWith('lf_')) {
      idsToOrder[String(id)] = idx + 1;
    }
  });
  const uuid = crypto.randomUUID();
  const body = new URLSearchParams({
    commands: JSON.stringify([
      {
        type: 'day_orders_update',
        uuid,
        args: { ids_to_orders: idsToOrder }
      }
    ])
  });

  const resp = await fetch('https://api.todoist.com/sync/v9/sync', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (resp.ok) {
    return { ok: true, method: 'sync_v9_day_orders_update' };
  }
  return { ok: false };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Todoist-Token, X-Lightfocus-Auth, Authorization',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}


function readGcalSnapshot(user, isFounder) {
  if (user && Array.isArray(user.gcalEvents) && user.gcalEvents.length > 0) {
    return {
      connected: true,
      calendarName: user.gcalName || user.email || "Google Agenda",
      includeInToday: user.settings && user.settings.includeGcalInToday !== undefined ? Boolean(user.settings.includeGcalInToday) : true,
      icsUrl: user.gcalIcsUrl || "",
      events: user.gcalEvents
    };
  }
  if (isFounder && fs.existsSync(GCAL_SNAPSHOT_FILE)) {
    try {
      const snap = JSON.parse(fs.readFileSync(GCAL_SNAPSHOT_FILE, "utf8"));
      return {
        connected: true,
        calendarName: snap.calendarName || "walace@sharkcommerce.com.br",
        includeInToday: user && user.settings && user.settings.includeGcalInToday !== undefined ? Boolean(user.settings.includeGcalInToday) : true,
        icsUrl: (user && user.gcalIcsUrl) || "",
        events: Array.isArray(snap.events) ? snap.events : []
      };
    } catch (_) {}
  }
  return {
    connected: false,
    calendarName: "",
    includeInToday: false,
    icsUrl: "",
    events: []
  };
}

function parseIcsContent(icsText) {
  const events = [];
  const blocks = String(icsText || "").split("BEGIN:VEVENT").slice(1);
  for (const blk of blocks) {
    const endIdx = blk.indexOf("END:VEVENT");
    const body = endIdx >= 0 ? blk.slice(0, endIdx) : blk;
    const unfolded = body.replace(/\r?\n[ \t]/g, "");
    const lines = unfolded.split(/\r?\n/);
    let uid = "";
    let summary = "Evento Google Agenda";
    let description = "";
    let dtStart = "";
    let dtEnd = "";
    for (const line of lines) {
      if (line.startsWith("UID:")) uid = line.slice(4).trim();
      else if (line.startsWith("SUMMARY")) summary = line.replace(/^SUMMARY[^:]*:/, "").trim();
      else if (line.startsWith("DESCRIPTION")) description = line.replace(/^DESCRIPTION[^:]*:/, "").replace(/\\n/g, "\n").trim();
      else if (line.startsWith("DTSTART")) dtStart = line.replace(/^DTSTART[^:]*:/, "").trim();
      else if (line.startsWith("DTEND")) dtEnd = line.replace(/^DTEND[^:]*:/, "").trim();
    }
    if (dtStart.length >= 8) {
      const y = dtStart.slice(0, 4);
      const m = dtStart.slice(4, 6);
      const d = dtStart.slice(6, 8);
      const dueDate = `${y}-${m}-${d}`;
      let dueTime = null;
      if (dtStart.includes("T") && dtStart.length >= 13) {
        dueTime = `${dtStart.slice(9, 11)}:${dtStart.slice(11, 13)}`;
      }
      events.push({
        id: "gcal_" + (uid || Math.random().toString(36).slice(2, 10)).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24),
        content: stripEmojisServer(summary),
        description: stripEmojisServer(description),
        dueDate,
        dueTime,
        estimatedMinutes: 45,
        priority: "p2",
        projectName: "Google Agenda",
        source: "gcal",
        checked: false
      });
    }
  }
  return events;
}

function readStripeConfig() {
  const candidates = [STRIPE_CONFIG_FILE, PERSISTENT_STRIPE_FILE];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          return {
            secretKey: String(parsed.secretKey || process.env.STRIPE_SECRET_KEY || '').trim(),
            publishableKey: String(parsed.publishableKey || process.env.STRIPE_PUBLISHABLE_KEY || '').trim(),
            paymentLink: String(parsed.paymentLink || process.env.STRIPE_PAYMENT_LINK || '').trim(),
            pixKey: String(parsed.pixKey || process.env.LIGHTFOCUS_PIX_KEY || 'walacetkwl@gmail.com').trim(),
            priceCents: Number(parsed.priceCents || 9900),
            currency: 'brl'
          };
        }
      }
    } catch (_) {}
  }
  return {
    secretKey: String(process.env.STRIPE_SECRET_KEY || '').trim(),
    publishableKey: String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim(),
    paymentLink: String(process.env.STRIPE_PAYMENT_LINK || '').trim(),
    pixKey: String(process.env.LIGHTFOCUS_PIX_KEY || 'walacetkwl@gmail.com').trim(),
    priceCents: 9900,
    currency: 'brl'
  };
}

function writeStripeConfig(nextCfg) {
  const current = readStripeConfig();
  const merged = {
    secretKey: nextCfg.secretKey !== undefined ? String(nextCfg.secretKey).trim() : current.secretKey,
    publishableKey: nextCfg.publishableKey !== undefined ? String(nextCfg.publishableKey).trim() : current.publishableKey,
    paymentLink: nextCfg.paymentLink !== undefined ? String(nextCfg.paymentLink).trim() : current.paymentLink,
    pixKey: nextCfg.pixKey !== undefined ? String(nextCfg.pixKey).trim() : current.pixKey,
    priceCents: 9900,
    currency: 'brl',
    updatedAt: getSaoPauloNow().isoStr
  };
  const payload = JSON.stringify(merged, null, 2);
  try {
    fs.writeFileSync(STRIPE_CONFIG_FILE, payload, 'utf8');
  } catch (_) {}
  try {
    if (fs.existsSync(PERSISTENT_STORE_DIR)) {
      fs.writeFileSync(PERSISTENT_STRIPE_FILE, payload, 'utf8');
    }
  } catch (_) {}
  return merged;
}

function createStripeCheckoutSessionHttps(secretKey, opts = {}) {
  const origin = opts.origin || 'https://lightfocus.0loicj.easypanel.host';
  const methodPref = opts.paymentMethod === 'pix' ? 'pix' : 'card';
  const customerEmail = String(opts.email || '').trim();

  function postForm(paramsObj) {
    return new Promise((resolve, reject) => {
      const formBody = new URLSearchParams(paramsObj).toString();
      const req = https.request(
        {
          hostname: 'api.stripe.com',
          port: 443,
          path: '/v1/checkout/sessions',
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + secretKey,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(formBody)
          }
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(raw);
              resolve({ status: res.statusCode, data: parsed });
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(formBody);
      req.end();
    });
  }

  const baseParams = {
    mode: 'payment',
    success_url: origin + '/?app=1&checkout=success&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/?lp=1&checkout=canceled',
    'line_items[0][price_data][currency]': 'brl',
    'line_items[0][price_data][unit_amount]': '9900',
    'line_items[0][price_data][product_data][name]': 'Lightfocus: Acesso Vitalício',
    'line_items[0][price_data][product_data][description]': 'Licença vitalícia Lightfocus (pagamento único R$ 99 · PIX ou Cartão em até 12x)',
    'line_items[0][quantity]': '1',
    'allow_promotion_codes': 'true'
  };
  if (customerEmail && customerEmail.includes('@')) {
    baseParams.customer_email = customerEmail;
  }

  // First attempt: both card + pix + installments
  const attempt1 = {
    ...baseParams,
    'payment_method_types[0]': methodPref === 'pix' ? 'pix' : 'card',
    'payment_method_types[1]': methodPref === 'pix' ? 'card' : 'pix',
    'payment_method_options[card][installments][enabled]': 'true'
  };

  return postForm(attempt1).then((res1) => {
    if (res1.status >= 200 && res1.status < 300 && res1.data && res1.data.url) {
      return res1.data;
    }
    // Fallback if PIX or installments are not enabled on the Stripe account yet
    const attempt2 = {
      ...baseParams,
      'payment_method_types[0]': 'card'
    };
    return postForm(attempt2).then((res2) => {
      if (res2.status >= 200 && res2.status < 300 && res2.data && res2.data.url) {
        return res2.data;
      }
      const errMsg =
        (res1.data && res1.data.error && res1.data.error.message) ||
        (res2.data && res2.data.error && res2.data.error.message) ||
        'Não foi possível iniciar a sessão do Stripe.';
      throw new Error(errMsg);
    });
  });
}


// ============================================================================
// Billing: trial (48h), plans (monthly R$ 29, lifetime R$ 99), Stripe keyless
// ============================================================================
const TRIAL_MS = 48 * 60 * 60 * 1000;
const TRIAL_LAUNCH_ISO = '2026-10-29T16:00:00-03:00';
const STRIPE_EVENTS_FILE = path.join(DATA_DIR, 'stripe-events.json');
const PRICE_MONTHLY_BRL = 29;
const PRICE_LIFETIME_BRL = 99;

function isAdminUser(user) {
  if (!user) return false;
  return user.id === 'usr_walace' || String(user.email || '').toLowerCase() === 'walacetkwl@gmail.com' || user.role === 'admin';
}

function trialEndsAtOf(user) {
  if (user.trialEndsAt) return new Date(user.trialEndsAt).getTime();
  // Legacy accounts (created before trials existed) get 48h counted from launch
  const created = Date.parse(user.createdAt || '') || Date.now();
  return Math.max(created, Date.parse(TRIAL_LAUNCH_ISO)) + TRIAL_MS;
}

function computeAccess(user) {
  if (!user) return null;
  const now = Date.now();
  const trialEnds = trialEndsAtOf(user);
  const base = {
    plan: user.plan || 'trial',
    status: user.planStatus || null,
    trialEndsAt: new Date(trialEnds).toISOString(),
    trialMsLeft: Math.max(0, trialEnds - now),
    currentPeriodEnd: user.currentPeriodEnd || null,
    cancelAtPeriodEnd: Boolean(user.cancelAtPeriodEnd),
    hasStripeCustomer: Boolean(user.stripeCustomerId),
    disabled: Boolean(user.disabled)
  };
  if (user.disabled) return { ...base, entitled: false, reason: 'disabled' };
  if (isAdminUser(user)) return { ...base, plan: 'admin', entitled: true, reason: 'admin' };
  if (user.plan === 'lifetime') return { ...base, entitled: true, reason: 'lifetime' };
  if (user.plan === 'monthly') {
    const okStatus = ['active', 'trialing', 'past_due'].includes(user.planStatus || 'active');
    const periodOk = !user.currentPeriodEnd || Date.parse(user.currentPeriodEnd) + 3 * 86400000 > now;
    if (okStatus && periodOk) return { ...base, entitled: true, reason: 'monthly' };
  }
  if (trialEnds > now) return { ...base, plan: user.plan === 'monthly' ? 'monthly' : 'trial', entitled: true, reason: 'trial' };
  return { ...base, entitled: false, reason: 'expired' };
}

function billingConfig() {
  return {
    secretKey: String(process.env.STRIPE_SECRET_KEY || readStripeConfig().secretKey || '').trim(),
    webhookSecret: String(process.env.STRIPE_WEBHOOK_SECRET || '').trim(),
    priceMonthly: String(process.env.STRIPE_PRICE_MONTHLY || '').trim(),
    priceLifetime: String(process.env.STRIPE_PRICE_LIFETIME || '').trim(),
    linkMonthly: String(process.env.STRIPE_PAYMENT_LINK_MONTHLY || '').trim(),
    linkLifetime: String(process.env.STRIPE_PAYMENT_LINK_LIFETIME || readStripeConfig().paymentLink || '').trim(),
    portalLoginUrl: String(process.env.STRIPE_PORTAL_LOGIN_URL || '').trim()
  };
}

function publicBillingInfo() {
  const c = billingConfig();
  const sessionOk = c.secretKey.startsWith('sk_');
  return {
    monthly: { priceBrl: PRICE_MONTHLY_BRL, available: Boolean(c.linkMonthly || (sessionOk && c.priceMonthly)) },
    lifetime: { priceBrl: PRICE_LIFETIME_BRL, available: Boolean(c.linkLifetime || (sessionOk && c.priceLifetime)) },
    portalAvailable: Boolean(c.portalLoginUrl || sessionOk),
    methods: ['card', 'apple_pay', 'google_pay', 'pix']
  };
}

function stripeApi(secretKey, apiPath, params) {
  return new Promise((resolve, reject) => {
    const formBody = new URLSearchParams(params).toString();
    const r = https.request(
      {
        hostname: 'api.stripe.com', port: 443, path: apiPath, method: 'POST',
        headers: { Authorization: 'Bearer ' + secretKey, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(formBody) }
      },
      (resp) => {
        let raw = '';
        resp.on('data', (c) => (raw += c));
        resp.on('end', () => { try { resolve({ status: resp.statusCode, data: JSON.parse(raw) }); } catch (e) { reject(e); } });
      }
    );
    r.on('error', reject);
    r.write(formBody);
    r.end();
  });
}

async function createPlanCheckout(user, plan, origin) {
  const c = billingConfig();
  const isMonthly = plan === 'monthly';
  const price = isMonthly ? c.priceMonthly : c.priceLifetime;
  if (c.secretKey.startsWith('sk_') && price) {
    const params = {
      mode: isMonthly ? 'subscription' : 'payment',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      success_url: origin + '/?app=1&checkout=success&plan=' + plan,
      cancel_url: origin + '/?lp=1&checkout=canceled',
      client_reference_id: user.id,
      allow_promotion_codes: 'true',
      'metadata[app]': 'lightfocus',
      'metadata[plan]': plan,
      'payment_method_types[0]': 'card'
    };
    if (!isMonthly) params['payment_method_types[1]'] = 'pix';
    if (user.stripeCustomerId) params.customer = user.stripeCustomerId;
    else if (user.email) params.customer_email = user.email;
    let r = await stripeApi(c.secretKey, '/v1/checkout/sessions', params);
    if (!(r.status < 300 && r.data.url) && !isMonthly) {
      delete params['payment_method_types[1]'];
      r = await stripeApi(c.secretKey, '/v1/checkout/sessions', params);
    }
    if (r.status < 300 && r.data.url) return r.data.url;
  }
  const link = isMonthly ? c.linkMonthly : c.linkLifetime;
  if (!link) return null;
  const u = new URL(link);
  u.searchParams.set('client_reference_id', user.id);
  if (user.email) u.searchParams.set('prefilled_email', user.email);
  u.searchParams.set('locale', 'pt-BR');
  return u.toString();
}

async function createPortalUrl(user, origin) {
  const c = billingConfig();
  if (c.secretKey.startsWith('sk_') && user.stripeCustomerId) {
    try {
      const r = await stripeApi(c.secretKey, '/v1/billing_portal/sessions', { customer: user.stripeCustomerId, return_url: origin + '/?app=1' });
      if (r.status < 300 && r.data.url) return r.data.url;
    } catch (_) {}
  }
  if (!c.portalLoginUrl) return null;
  const u = new URL(c.portalLoginUrl);
  if (user.email) u.searchParams.set('prefilled_email', user.email);
  return u.toString();
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 1024 * 1024) reject(new Error('Payload too large')); else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifyStripeSignature(rawBuf, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = {};
  String(header).split(',').forEach((kv) => {
    const i = kv.indexOf('=');
    if (i > 0) {
      const k = kv.slice(0, i).trim();
      (parts[k] = parts[k] || []).push(kv.slice(i + 1).trim());
    }
  });
  const t = parts.t && parts.t[0];
  if (!t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(t + '.' + rawBuf.toString('utf8')).digest('hex');
  return parts.v1.some((sig) => {
    try { return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch (_) { return false; }
  });
}

function readStripeEvents() {
  try { const j = JSON.parse(fs.readFileSync(STRIPE_EVENTS_FILE, 'utf8')); if (Array.isArray(j.events)) return j; } catch (_) {}
  return { events: [], payments: [] };
}
function writeStripeEvents(j) {
  j.events = j.events.slice(-300);
  try { fs.writeFileSync(STRIPE_EVENTS_FILE, JSON.stringify(j, null, 2), { encoding: 'utf8', mode: 0o600 }); } catch (_) {}
}

function findUserForStripe(store, { userId, customerId, subscriptionId, email }) {
  return (
    (userId && store.users.find((u) => u.id === userId)) ||
    (subscriptionId && store.users.find((u) => u.stripeSubscriptionId === subscriptionId)) ||
    (customerId && store.users.find((u) => u.stripeCustomerId === customerId)) ||
    (email && store.users.find((u) => String(u.email || '').toLowerCase() === String(email).toLowerCase())) ||
    null
  );
}

function handleStripeEvent(evt) {
  const log = readStripeEvents();
  if (log.events.some((e) => e.id === evt.id)) return { duplicate: true };
  const obj = (evt.data && evt.data.object) || {};
  const store = readUsersStore();
  let user = null;
  let note = '';
  const toIso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);

  if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
    user = findUserForStripe(store, {
      userId: obj.client_reference_id,
      customerId: obj.customer,
      email: (obj.customer_details && obj.customer_details.email) || obj.customer_email
    });
    const paid = obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required';
    if (user && obj.mode === 'subscription') {
      user.plan = user.plan === 'lifetime' ? 'lifetime' : 'monthly';
      user.planStatus = 'active';
      user.stripeSubscriptionId = obj.subscription || user.stripeSubscriptionId;
      note = 'assinatura mensal ativada';
    } else if (user && obj.mode === 'payment' && paid) {
      user.plan = 'lifetime';
      user.planStatus = 'active';
      user.lifetimeSince = new Date().toISOString();
      note = 'vitalício liberado';
    } else if (user) {
      note = 'aguardando pagamento (' + obj.payment_status + ')';
    } else {
      note = 'usuário não encontrado';
    }
    if (user && obj.customer) user.stripeCustomerId = obj.customer;
    if (paid && obj.amount_total) {
      log.payments.push({ at: new Date(evt.created * 1000).toISOString(), userId: user ? user.id : null, amount: obj.amount_total / 100, currency: obj.currency, kind: obj.mode === 'subscription' ? 'monthly' : 'lifetime' });
    }
  } else if (evt.type === 'customer.subscription.updated' || evt.type === 'customer.subscription.deleted') {
    user = findUserForStripe(store, { subscriptionId: obj.id, customerId: obj.customer });
    if (user) {
      const item = obj.items && obj.items.data && obj.items.data[0];
      const periodEnd = obj.current_period_end || (item && item.current_period_end);
      user.stripeSubscriptionId = obj.id;
      user.planStatus = evt.type.endsWith('deleted') ? 'canceled' : obj.status;
      user.currentPeriodEnd = toIso(periodEnd);
      user.cancelAtPeriodEnd = Boolean(obj.cancel_at_period_end);
      if (user.plan !== 'lifetime') user.plan = evt.type.endsWith('deleted') ? 'expired' : 'monthly';
      note = 'assinatura ' + user.planStatus;
    } else note = 'usuário não encontrado';
  } else if (evt.type === 'invoice.payment_failed') {
    user = findUserForStripe(store, { customerId: obj.customer, email: obj.customer_email });
    if (user && user.plan === 'monthly') user.planStatus = 'past_due';
    note = 'falha no pagamento';
  } else if (evt.type === 'invoice.paid') {
    user = findUserForStripe(store, { customerId: obj.customer, email: obj.customer_email });
    if (obj.billing_reason === 'subscription_cycle' && obj.amount_paid) {
      log.payments.push({ at: new Date(evt.created * 1000).toISOString(), userId: user ? user.id : null, amount: obj.amount_paid / 100, currency: obj.currency, kind: 'monthly' });
    }
    note = 'fatura paga';
  } else {
    note = 'ignorado';
  }

  if (user) {
    store.users = store.users.map((u) => (u.id === user.id ? user : u));
    writeUsersStore(store);
  }
  log.events.push({ id: evt.id, type: evt.type, at: new Date((evt.created || Date.now() / 1000) * 1000).toISOString(), userId: user ? user.id : null, email: user ? user.email : null, note, livemode: Boolean(evt.livemode) });
  writeStripeEvents(log);
  return { ok: true, note };
}

function buildAdminOverview() {
  const store = readUsersStore();
  const log = readStripeEvents();
  const now = Date.now();
  const users = store.users.map((u) => {
    const acc = computeAccess(u);
    return {
      id: u.id, name: u.name || '', email: u.email || '', role: u.role || 'member',
      createdAt: u.createdAt || null, lastAccessAt: u.lastAccessAt || null,
      plan: acc.plan, reason: acc.reason, entitled: acc.entitled, status: u.planStatus || null,
      trialEndsAt: acc.trialEndsAt, currentPeriodEnd: u.currentPeriodEnd || null,
      disabled: Boolean(u.disabled), tasksCount: Array.isArray(u.tasks) ? u.tasks.length : 0,
      hasTodoist: Boolean(u.todoistToken), stripeCustomer: Boolean(u.stripeCustomerId)
    };
  });
  const count = (fn) => users.filter(fn).length;
  const monthly = count((u) => u.reason === 'monthly');
  const lifetime = count((u) => u.reason === 'lifetime');
  const totalRevenue = log.payments.reduce((a, p) => a + Number(p.amount || 0), 0);
  const days = {};
  for (let i = 29; i >= 0; i--) days[new Date(now - i * 86400000).toISOString().slice(0, 10)] = 0;
  users.forEach((u) => { const d = String(u.createdAt || '').slice(0, 10); if (d in days) days[d]++; });
  return {
    kpis: {
      totalUsers: users.length,
      activeTrials: count((u) => u.reason === 'trial'),
      expiredTrials: count((u) => u.reason === 'expired'),
      payingMonthly: monthly,
      lifetime,
      mrr: monthly * PRICE_MONTHLY_BRL,
      totalRevenue,
      disabled: count((u) => u.disabled)
    },
    signups: Object.entries(days).map(([date, n]) => ({ date, n })),
    users,
    events: log.events.slice(-50).reverse(),
    billing: publicBillingInfo()
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// ============================================================================
// HTTP Server & Commercial Multi-User SaaS API Routes
// ============================================================================
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // 1. Public Healthcheck
    if (pathname === '/api/health' && req.method === 'GET') {
      const hasToken = Boolean(getStoredTodoistToken());
      const { dateStr, isoStr } = getSaoPauloNow();
      const store = readUsersStore();
      return sendJson(res, 200, {
        ok: true,
        app: 'Lightfocus',
        version: '3.0.0',
        date: dateStr,
        now: isoStr,
        timezone: 'America/Sao_Paulo',
        authRequired: true,
        registeredUsersCount: store.users.length,
        hasServerTodoistToken: hasToken,
        pendingQueueCount: readSyncQueue().length
      });
    }

    // 2. Auth Verify / Session Status
    if ((pathname === '/api/auth/verify' || pathname === '/api/auth/status') && req.method === 'GET') {
      const uid = getAuthenticatedUserId(req);
      const user = uid ? getUserById(uid) : null;
      const authed = Boolean(user);
      return sendJson(res, 200, {
        ok: true,
        authenticated: authed,
        user: authed ? sanitizeUserForClient(user) : null,
        hasServerTodoistToken: authed ? sanitizeUserForClient(user).hasTodoistToken : false
      });
    }

    // 3. SaaS User Registration (POST /api/auth/register)
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await parseBody(req);
      const name = stripEmojisServer(String(body.name || '').trim()) || 'Novo Usuario';
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '').trim();

      if (!email || !email.includes('@')) {
        return sendJson(res, 400, { ok: false, error: 'Informe um e-mail valido para criar sua conta.' });
      }
      if (!password || password.length < 4) {
        return sendJson(res, 400, { ok: false, error: 'A senha precisa ter pelo menos 4 caracteres.' });
      }

      const store = readUsersStore();
      const existing = store.users.find((u) => String(u.email || '').toLowerCase() === email);
      if (existing) {
        return sendJson(res, 409, {
          ok: false,
          error: 'Ja existe uma conta com este e-mail. Use a aba Entrar.'
        });
      }

      const { isoStr } = getSaoPauloNow();
      const newUserId = 'usr_' + crypto.randomUUID().slice(0, 12);
      const onboardingTasks = buildOnboardingTasks();
      const newUser = {
        id: newUserId,
        name,
        email,
        role: 'member',
        passwordHash: computePasswordHash(password),
        createdAt: isoStr,
        updatedAt: isoStr,
        xp: 50,
        level: 1,
        levelTitle: 'Cristal',
        streak: 1,
        todoistToken: '',
        settings: {
          theme: 'light',
          pulseIntervalMinutes: 5,
          soundEnabled: true
        },
        tasks: onboardingTasks,
        plan: 'trial',
        trialEndsAt: new Date(Date.now() + TRIAL_MS).toISOString()
      };

      store.users.push(newUser);
      writeUsersStore(store);

      const token = createAuthToken(newUser.id);
      const cookieHeader = `lf_auth=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`;
      return sendJson(
        res,
        201,
        {
          ok: true,
          authenticated: true,
          token,
          user: sanitizeUserForClient(newUser),
          hasServerTodoistToken: false
        },
        { 'Set-Cookie': cookieHeader }
      );
    }

    // 4. SaaS Login (POST /api/auth/login) — supports email + password OR quick password for Walace
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '').trim();
      if (!password) {
        return sendJson(res, 400, { ok: false, error: 'Digite sua senha para acessar.' });
      }

      const candidateHash = computePasswordHash(password);
      const founderHashes = getFounderAllowedHashes();
      const store = readUsersStore();

      let matchedUser = null;

      if (email && email !== 'walacetkwl@gmail.com') {
        const userByEmail = store.users.find((u) => String(u.email || '').toLowerCase() === email);
        if (!userByEmail) {
          return sendJson(res, 401, { ok: false, error: 'Conta nao encontrada com este e-mail.' });
        }
        if (userByEmail.passwordHash === candidateHash) {
          matchedUser = userByEmail;
        } else {
          return sendJson(res, 401, { ok: false, error: 'Senha incorreta para esta conta.' });
        }
      } else {
        // Founder login or quick password-only login
        if (founderHashes.has(candidateHash)) {
          matchedUser = store.users.find((u) => u.id === 'usr_walace') || createFounderUserObject();
        } else {
          const anyUser = store.users.find((u) => u.passwordHash === candidateHash);
          if (anyUser) matchedUser = anyUser;
        }
      }

      if (!matchedUser) {
        return sendJson(res, 401, {
          ok: false,
          error: 'Credenciais invalidas. Verifique seu e-mail e senha.'
        });
      }

      const token = createAuthToken(matchedUser.id);
      const cookieHeader = `lf_auth=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`;
      const clientUser = sanitizeUserForClient(matchedUser);
      return sendJson(
        res,
        200,
        {
          ok: true,
          authenticated: true,
          token,
          user: clientUser,
          hasServerTodoistToken: clientUser.hasTodoistToken
        },
        { 'Set-Cookie': cookieHeader }
      );
    }

    // 5. Logout
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const cookieHeader = 'lf_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
      return sendJson(res, 200, { ok: true, authenticated: false }, { 'Set-Cookie': cookieHeader });
    }

// 5B. Public Stripe Config & Checkout Session (R$ 99 Vitalício — PIX ou Cartão Parcelado)
    if (pathname === '/api/config/stripe' && req.method === 'GET') {
      const cfg = readStripeConfig();
      return sendJson(res, 200, {
        ok: true,
        priceBrl: 99,
        priceCents: 9900,
        currency: 'BRL',
        hasSecretKey: Boolean(cfg.secretKey),
        hasPaymentLink: Boolean(cfg.paymentLink),
        paymentLink: cfg.paymentLink || null,
        publishableKey: cfg.publishableKey || null,
        pixKey: cfg.pixKey || 'walacetkwl@gmail.com',
        installmentsNote: 'Parcelamento em até 12x no cartão com acréscimo da operadora por conta do comprador, ou R$ 99 à vista no PIX.'
      });
    }

    if (pathname === '/api/checkout/stripe' && req.method === 'POST') {
      const body = await parseBody(req);
      const cfg = readStripeConfig();
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'lightfocus.0loicj.easypanel.host';
      const origin = `${proto}://${host}`;

      if (cfg.secretKey && cfg.secretKey.startsWith('sk_')) {
        try {
          const session = await createStripeCheckoutSessionHttps(cfg.secretKey, {
            origin,
            paymentMethod: body.paymentMethod || 'pix',
            email: body.email || ''
          });
          return sendJson(res, 200, {
            ok: true,
            mode: 'stripe_session',
            checkoutUrl: session.url,
            sessionId: session.id
          });
        } catch (stripeErr) {
          if (cfg.paymentLink) {
            return sendJson(res, 200, {
              ok: true,
              mode: 'payment_link_fallback',
              checkoutUrl: cfg.paymentLink,
              warning: stripeErr.message
            });
          }
          return sendJson(res, 200, {
            ok: true,
            mode: 'interactive_checkout',
            priceBrl: 99,
            pixKey: cfg.pixKey || 'walacetkwl@gmail.com',
            stripeError: stripeErr.message
          });
        }
      }

      if (cfg.paymentLink && cfg.paymentLink.startsWith('http')) {
        return sendJson(res, 200, {
          ok: true,
          mode: 'payment_link',
          checkoutUrl: cfg.paymentLink
        });
      }

      return sendJson(res, 200, {
        ok: true,
        mode: 'interactive_checkout',
        priceBrl: 99,
        pixKey: cfg.pixKey || 'walacetkwl@gmail.com',
        message: 'Checkout direto Lightfocus R$ 99 Vitalício (PIX ou Cartão Parcelado).'
      });
    }


    // 5C. Billing (public info + Stripe webhook)
    if (pathname === '/api/billing/info' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, ...publicBillingInfo() });
    }
    if (pathname === '/api/stripe/webhook' && req.method === 'POST') {
      const raw = await readRawBody(req);
      const secret = billingConfig().webhookSecret;
      if (!secret) return sendJson(res, 503, { ok: false, error: 'webhook not configured' });
      if (!verifyStripeSignature(raw, req.headers['stripe-signature'], secret)) {
        return sendJson(res, 400, { ok: false, error: 'invalid signature' });
      }
      let evt;
      try { evt = JSON.parse(raw.toString('utf8')); } catch (_) { return sendJson(res, 400, { ok: false }); }
      const r = handleStripeEvent(evt);
      return sendJson(res, 200, { received: true, ...r });
    }

    // 6. Auth Guard for all /api/* routes
    let currentUser = null;
    if (pathname.startsWith('/api/')) {
      const uid = getAuthenticatedUserId(req);
      currentUser = uid ? getUserById(uid) : null;
      if (!currentUser) {
        return sendJson(res, 401, {
          ok: false,
          authRequired: true,
          error: 'Sessao expirada ou nao autenticada. Entre na sua conta Lightfocus.'
        });
      }
      if (currentUser.disabled) {
        return sendJson(res, 403, { ok: false, disabled: true, error: 'Conta desativada. Fale com o suporte.' });
      }
      // last access (throttled to 5 min)
      if (!currentUser.lastAccessAt || Date.now() - Date.parse(currentUser.lastAccessAt) > 5 * 60 * 1000) {
        const nowIso = new Date().toISOString();
        updateUserRecord(currentUser.id, (u) => ({ ...u, lastAccessAt: nowIso }));
        currentUser.lastAccessAt = nowIso;
      }
    }

    // 6B. Billing routes for the signed-in user
    if (pathname === '/api/billing/status' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, billing: computeAccess(currentUser), info: publicBillingInfo(), email: currentUser.email || '' });
    }
    if (pathname === '/api/billing/checkout' && req.method === 'POST') {
      const body = await parseBody(req);
      const plan = body.plan === 'monthly' ? 'monthly' : 'lifetime';
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const origin = `${proto}://${req.headers.host || 'lightfocus.0loicj.easypanel.host'}`;
      let url = null;
      try { url = await createPlanCheckout(currentUser, plan, origin); } catch (_) { url = null; }
      if (!url) return sendJson(res, 200, { ok: false, unavailable: true, message: 'Pagamento em breve.' });
      return sendJson(res, 200, { ok: true, checkoutUrl: url });
    }
    if (pathname === '/api/billing/portal' && req.method === 'POST') {
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const origin = `${proto}://${req.headers.host || 'lightfocus.0loicj.easypanel.host'}`;
      const url = await createPortalUrl(currentUser, origin);
      if (!url) return sendJson(res, 200, { ok: false, unavailable: true, message: 'Portal em breve.' });
      return sendJson(res, 200, { ok: true, portalUrl: url });
    }

    // 6C. Admin (server-side authorization on every route)
    if (pathname.startsWith('/api/admin/')) {
      if (!isAdminUser(currentUser)) return sendJson(res, 403, { ok: false, error: 'Acesso restrito.' });
      if (pathname === '/api/admin/overview' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, ...buildAdminOverview() });
      }
      if (pathname === '/api/admin/user-action' && req.method === 'POST') {
        const body = await parseBody(req);
        const target = getUserById(String(body.userId || ''));
        if (!target) return sendJson(res, 404, { ok: false, error: 'Usuário não encontrado.' });
        if (isAdminUser(target) && body.action === 'deactivate') return sendJson(res, 400, { ok: false, error: 'Não é possível desativar o admin.' });
        const updated = updateUserRecord(target.id, (u) => {
          if (body.action === 'extend_trial') {
            const days = Math.min(365, Math.max(1, Number(body.days || 2)));
            const base = Math.max(Date.now(), trialEndsAtOf(u));
            u.trialEndsAt = new Date(base + days * 86400000).toISOString();
          } else if (body.action === 'grant_lifetime') {
            u.plan = 'lifetime'; u.planStatus = 'active'; u.lifetimeSince = new Date().toISOString(); u.grantedByAdmin = true;
          } else if (body.action === 'revoke_plan') {
            u.plan = 'expired'; u.planStatus = null;
          } else if (body.action === 'deactivate') {
            u.disabled = true;
          } else if (body.action === 'reactivate') {
            u.disabled = false;
          }
          return u;
        });
        const log = readStripeEvents();
        log.events.push({ id: 'adm_' + crypto.randomUUID().slice(0, 8), type: 'admin.' + body.action, at: new Date().toISOString(), userId: target.id, email: target.email, note: 'ação do admin', livemode: false });
        writeStripeEvents(log);
        return sendJson(res, 200, { ok: true, user: sanitizeUserForClient(updated) });
      }
      return sendJson(res, 404, { ok: false });
    }

    // 6D. Paywall: expired trial blocks the app data routes (data is kept)
    if (pathname.startsWith('/api/') && currentUser) {
      const acc = computeAccess(currentUser);
      const open = ['/api/settings', '/api/config/token', '/api/todoist/token'];
      if (!acc.entitled && !open.includes(pathname)) {
        return sendJson(res, 402, { ok: false, paywall: true, billing: acc, user: sanitizeUserForClient(currentUser), error: 'Seu teste grátis terminou. Escolha um plano para continuar.' });
      }
    }

    const isFounder =
      currentUser &&
      (currentUser.id === 'usr_walace' || String(currentUser.email || '').toLowerCase() === 'walacetkwl@gmail.com');

    function resolveEffectiveTodoistToken(reqHeaderToken, bodyToken) {
      if (bodyToken && String(bodyToken).trim()) return String(bodyToken).trim();
      if (reqHeaderToken && String(reqHeaderToken).trim()) return String(reqHeaderToken).trim();
      if (currentUser && currentUser.todoistToken) return String(currentUser.todoistToken).trim();
      if (isFounder) return getStoredTodoistToken();
      return '';
    }

    // 7. GET /api/tasks
    if (pathname === '/api/tasks' && req.method === 'GET') {
      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = resolveEffectiveTodoistToken(headerToken, '');
      const forceLive = parsedUrl.searchParams.get('live') === '1';

      if (token && forceLive) {
        try {
          const liveSnapshot = await syncFromTodoistApi(token, currentUser);
          return sendJson(res, 200, {
            ok: true,
            mode: 'live_todoist',
            user: sanitizeUserForClient(getUserById(currentUser.id)),
            hasServerTodoistToken: true,
            snapshot: liveSnapshot
          });
        } catch (syncErr) {
          const fallback = getUserTasksSnapshot(currentUser);
          return sendJson(res, 200, {
            ok: true,
            mode: 'snapshot_fallback',
            syncError: syncErr.message,
            user: sanitizeUserForClient(currentUser),
            hasServerTodoistToken: Boolean(token),
            snapshot: fallback
          });
        }
      }

      const snapshot = getUserTasksSnapshot(currentUser);
      return sendJson(res, 200, {
        ok: true,
        mode: token ? 'token_ready' : 'cloud_workspace',
        user: sanitizeUserForClient(currentUser),
        hasServerTodoistToken: Boolean(token),
        pendingQueueCount: isFounder ? readSyncQueue().length : 0,
        snapshot
      });
    }

    // 8. POST /api/tasks/create — Quick Add ('Q') with Natural Language Schedule Support
    if (pathname === '/api/tasks/create' && req.method === 'POST') {
      const body = await parseBody(req);
      const rawContent = stripEmojisServer(String(body.content || '').trim());
      if (!rawContent) {
        return sendJson(res, 400, { ok: false, error: 'O titulo da tarefa nao pode ficar vazio.' });
      }

      const { dateStr, isoStr } = getSaoPauloNow();
      const estimatedMinutes =
        body.estimatedMinutes && Number(body.estimatedMinutes) > 0
          ? Math.min(480, Math.round(Number(body.estimatedMinutes)))
          : null;
      const priority = ['p1', 'p2', 'p3', 'p4'].includes(String(body.priority || '').toLowerCase())
        ? String(body.priority).toLowerCase()
        : 'p4';
      const dueDate = body.dueDate ? String(body.dueDate).slice(0, 10) : dateStr;
      const dueTime = body.dueTime ? String(body.dueTime).slice(0, 5) : null;
      const recurring = body.recurring ? String(body.recurring) : false;
      const recurrenceRule = body.recurrenceRule && typeof body.recurrenceRule === 'object' ? body.recurrenceRule : null;
      const projectName = stripEmojisServer(body.projectName || 'Hoje · Principal');
      const labels = Array.isArray(body.labels) ? body.labels.map((l) => stripEmojisServer(l)) : [];
      const rawDesc = String(body.description || '').trim();
      const finalDesc = updateDescriptionWithEstimate(rawDesc, estimatedMinutes);

      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = resolveEffectiveTodoistToken(headerToken, body.token);

      let taskId = 'lf_' + crypto.randomUUID().slice(0, 10);
      let todoistSynced = false;

      if (token) {
        try {
          const remoteTask = await createTaskOnTodoist(token, {
            content: rawContent,
            description: finalDesc,
            priority,
            dueDate,
            dueTime,
            dueString: recurring || undefined,
            estimatedMinutes
          });
          if (remoteTask && remoteTask.id) {
            taskId = String(remoteTask.id);
            todoistSynced = true;
          }
        } catch (e) {
          if (isFounder) {
            enqueueTodoistOperation({
              action: 'create',
              payload: { content: rawContent, description: finalDesc, priority, dueDate, dueTime, estimatedMinutes }
            });
          }
        }
      }

      const snapshot = getUserTasksSnapshot(currentUser);
      const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
      const newTask = {
        id: taskId,
        content: rawContent,
        description: finalDesc,
        dueDate,
        dueTime,
        recurring,
        recurrenceRule,
        priority,
        projectId: 'inbox',
        projectName,
        labels,
        checked: false,
        estimatedMinutes,
        subtasks: [],
        addedAt: isoStr,
        dayOrder: 1
      };

      // Insert at top of active tasks
      const completed = tasks.filter((t) => t.checked);
      const pending = [newTask, ...tasks.filter((t) => !t.checked)];
      snapshot.tasks = [...completed, ...pending].map((t, idx) => ({ ...t, dayOrder: idx + 1 }));
      snapshot.totalToday = snapshot.tasks.length;
      snapshot.syncedAt = isoStr;
      saveUserTasksSnapshot(currentUser, snapshot);

      if (estimatedMinutes) {
        const timesData = readTimesData();
        timesData.taskEstimates = timesData.taskEstimates || {};
        timesData.taskEstimates[taskId] = estimatedMinutes;
        writeTimesData(timesData);
      }

      // Award +10 XP for planning a structured task
      const updatedUser = updateUserRecord(currentUser.id, (u) => {
        const nextXp = Number(u.xp || 0) + 10;
        const lvl = computeLevelInfo(nextXp);
        return { ...u, xp: lvl.xp, level: lvl.level, levelTitle: lvl.levelTitle };
      });

      return sendJson(res, 201, {
        ok: true,
        task: newTask,
        todoistSynced,
        user: sanitizeUserForClient(updatedUser || currentUser),
        snapshot
      });
    }

    // 9. POST /api/tasks/update — Edit task title, description, schedule, priority, or subtasks
    if (pathname === '/api/tasks/update' && req.method === 'POST') {
      const body = await parseBody(req);
      const taskId = String(body.taskId || '').trim();
      if (!taskId) {
        return sendJson(res, 400, { ok: false, error: 'taskId obrigatorio' });
      }
      const snapshot = getUserTasksSnapshot(currentUser);
      if (Array.isArray(snapshot.tasks)) {
        snapshot.tasks = snapshot.tasks.map((t) => {
          if (String(t.id) !== taskId) return t;
          return {
            ...t,
            content: body.content !== undefined ? stripEmojisServer(body.content) : t.content,
            description: body.description !== undefined ? String(body.description) : t.description,
            dueDate: body.dueDate !== undefined ? body.dueDate : t.dueDate,
            dueTime: body.dueTime !== undefined ? body.dueTime : t.dueTime,
            priority: body.priority !== undefined ? body.priority : t.priority,
            estimatedMinutes:
              body.estimatedMinutes !== undefined ? body.estimatedMinutes : t.estimatedMinutes,
            subtasks: Array.isArray(body.subtasks) ? body.subtasks : t.subtasks
          };
        });
        snapshot.syncedAt = getSaoPauloNow().isoStr;
        saveUserTasksSnapshot(currentUser, snapshot);
      }
      return sendJson(res, 200, { ok: true, snapshot });
    }

    // 10. POST /api/tasks/delete — Delete task
    if (pathname === '/api/tasks/delete' && req.method === 'POST') {
      const body = await parseBody(req);
      const taskId = String(body.taskId || '').trim();
      if (!taskId) {
        return sendJson(res, 400, { ok: false, error: 'taskId obrigatorio' });
      }
      const snapshot = getUserTasksSnapshot(currentUser);
      if (Array.isArray(snapshot.tasks)) {
        snapshot.tasks = snapshot.tasks
          .filter((t) => String(t.id) !== taskId)
          .map((t, i) => ({ ...t, dayOrder: i + 1 }));
        snapshot.totalToday = snapshot.tasks.length;
        snapshot.syncedAt = getSaoPauloNow().isoStr;
        saveUserTasksSnapshot(currentUser, snapshot);
      }
      return sendJson(res, 200, { ok: true, snapshot });
    }

    // 11. POST /api/sync
    if ((pathname === '/api/sync' || pathname === '/api/todoist/sync') && req.method === 'POST') {
      const body = await parseBody(req);
      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = resolveEffectiveTodoistToken(headerToken, body.token);

      if (body.token && body.saveToken !== false) {
        const cleanTok = String(body.token).trim();
        updateUserRecord(currentUser.id, (u) => ({ ...u, todoistToken: cleanTok }));
        if (isFounder) saveTodoistToken(cleanTok);
      }

      if (token) {
        const liveSnapshot = await syncFromTodoistApi(token, currentUser);
        return sendJson(res, 200, {
          ok: true,
          mode: 'live_todoist',
          user: sanitizeUserForClient(getUserById(currentUser.id)),
          hasServerTodoistToken: true,
          snapshot: liveSnapshot
        });
      }

      const snapshot = getUserTasksSnapshot(currentUser);
      return sendJson(res, 200, {
        ok: true,
        mode: 'cloud_workspace',
        user: sanitizeUserForClient(currentUser),
        hasServerTodoistToken: false,
        message: 'Workspace sincronizado.',
        snapshot
      });
    }

    // 12. POST /api/config/token
    if ((pathname === '/api/config/token' || pathname === '/api/todoist/token') && req.method === 'POST') {
      const body = await parseBody(req);
      const token = String(body.token || '').trim();
      updateUserRecord(currentUser.id, (u) => ({ ...u, todoistToken: token }));
      if (isFounder) saveTodoistToken(token);

      if (!token) {
        return sendJson(res, 200, {
          ok: true,
          hasServerTodoistToken: false,
          user: sanitizeUserForClient(getUserById(currentUser.id))
        });
      }

      let syncResult = null;
      try {
        syncResult = await syncFromTodoistApi(token, getUserById(currentUser.id));
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
      return sendJson(res, 200, {
        ok: true,
        hasServerTodoistToken: true,
        user: sanitizeUserForClient(getUserById(currentUser.id)),
        snapshot: syncResult
      });
    }

    // 13. POST /api/tasks/complete
    if ((pathname === '/api/tasks/complete' || pathname === '/api/todoist/complete') && req.method === 'POST') {
      const body = await parseBody(req);
      const taskId = String(body.taskId || '').trim();
      if (!taskId) {
        return sendJson(res, 400, { ok: false, error: 'taskId obrigatorio' });
      }

      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = resolveEffectiveTodoistToken(headerToken, body.token);
      let todoistRemoteResult = { synced: false, reason: 'local_or_queued' };

      if (token) {
        try {
          const r = await closeTaskOnTodoist(token, taskId);
          todoistRemoteResult = { synced: true, ...r };
        } catch (err) {
          if (isFounder) enqueueTodoistOperation({ action: 'complete', taskId });
          todoistRemoteResult = { synced: false, queued: true, error: err.message };
        }
      } else if (isFounder) {
        enqueueTodoistOperation({ action: 'complete', taskId });
        todoistRemoteResult = { synced: false, queued: true };
      }

      const { dateStr, isoStr } = getSaoPauloNow();
      const snapshot = getUserTasksSnapshot(currentUser);
      if (Array.isArray(snapshot.tasks)) {
        snapshot.tasks = snapshot.tasks.map((t) =>
          String(t.id) === taskId ? { ...t, checked: true, completedAt: isoStr } : t
        );
        snapshot.syncedAt = isoStr;
        saveUserTasksSnapshot(currentUser, snapshot);
      }

      const durationSeconds = Math.max(0, Math.round(Number(body.durationSeconds || 0)));
      const completedWithoutTimer = Boolean(body.completedWithoutTimer || durationSeconds === 0);

      const timesData = readTimesData();
      const sessionEntry = {
        sessionId: body.sessionId || crypto.randomUUID(),
        userId: currentUser.id,
        taskId,
        content: stripEmojisServer(body.content || 'Tarefa concluida'),
        projectId: body.projectId || '6CrgFRpqRPQVfgjG',
        date: body.date || dateStr,
        startedAt: body.startedAt || isoStr,
        endedAt: body.endedAt || isoStr,
        durationSeconds,
        durationMinutes: Number((durationSeconds / 60).toFixed(2)),
        estimatedMinutes:
          body.estimatedMinutes || (timesData.taskEstimates && timesData.taskEstimates[taskId]) || null,
        completed: true,
        completedWithoutTimer,
        todoistSynced: Boolean(todoistRemoteResult.synced)
      };
      timesData.sessions.push(sessionEntry);
      const savedTimes = writeTimesData(timesData);

      // Award XP: +50 XP per completed task + 5 XP per focused minute
      const focusedMins = Math.floor(durationSeconds / 60);
      const xpGain = 50 + focusedMins * 5;
      const updatedUser = updateUserRecord(currentUser.id, (u) => {
        const nextXp = Number(u.xp || 0) + xpGain;
        const lvl = computeLevelInfo(nextXp);
        return {
          ...u,
          xp: lvl.xp,
          level: lvl.level,
          levelTitle: lvl.levelTitle,
          streak: Math.max(1, Number(u.streak || 1))
        };
      });

      return sendJson(res, 200, {
        ok: true,
        xpGained: xpGain,
        user: sanitizeUserForClient(updatedUser || currentUser),
        todoist: todoistRemoteResult,
        session: sessionEntry,
        writtenPaths: savedTimes.writtenPaths,
        times: savedTimes.data,
        snapshot
      });
    }

    // 14. POST /api/tasks/uncomplete
    if ((pathname === '/api/tasks/uncomplete' || pathname === '/api/todoist/uncomplete') && req.method === 'POST') {
      const body = await parseBody(req);
      const taskId = String(body.taskId || '').trim();
      if (!taskId) {
        return sendJson(res, 400, { ok: false, error: 'taskId obrigatorio' });
      }

      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = resolveEffectiveTodoistToken(headerToken, body.token);
      let todoistRemoteResult = { synced: false };

      if (token) {
        try {
          const r = await reopenTaskOnTodoist(token, taskId);
          todoistRemoteResult = { synced: true, ...r };
        } catch (err) {
          if (isFounder) enqueueTodoistOperation({ action: 'uncomplete', taskId });
          todoistRemoteResult = { synced: false, queued: true, error: err.message };
        }
      } else if (isFounder) {
        enqueueTodoistOperation({ action: 'uncomplete', taskId });
      }

      const { isoStr } = getSaoPauloNow();
      const snapshot = getUserTasksSnapshot(currentUser);
      if (Array.isArray(snapshot.tasks)) {
        snapshot.tasks = snapshot.tasks.map((t) =>
          String(t.id) === taskId ? { ...t, checked: false, completedAt: null } : t
        );
        snapshot.syncedAt = isoStr;
        saveUserTasksSnapshot(currentUser, snapshot);
      }

      return sendJson(res, 200, {
        ok: true,
        user: sanitizeUserForClient(currentUser),
        todoist: todoistRemoteResult,
        snapshot
      });
    }

    // 15. POST /api/tasks/estimate
    if ((pathname === '/api/tasks/estimate' || pathname === '/api/todoist/estimate') && req.method === 'POST') {
      const body = await parseBody(req);
      const taskId = String(body.taskId || '').trim();
      if (!taskId) {
        return sendJson(res, 400, { ok: false, error: 'taskId obrigatorio' });
      }
      const rawMin = body.estimatedMinutes;
      const estimatedMinutes =
        rawMin !== null && rawMin !== undefined && Number(rawMin) > 0
          ? Math.min(480, Math.max(1, Math.round(Number(rawMin))))
          : null;

      const snapshot = getUserTasksSnapshot(currentUser);
      let taskDesc = '';
      if (Array.isArray(snapshot.tasks)) {
        snapshot.tasks = snapshot.tasks.map((t) => {
          if (String(t.id) === taskId) {
            taskDesc = t.description || '';
            const updatedDesc = updateDescriptionWithEstimate(taskDesc, estimatedMinutes);
            return {
              ...t,
              estimatedMinutes,
              description: updatedDesc
            };
          }
          return t;
        });
        snapshot.syncedAt = getSaoPauloNow().isoStr;
        saveUserTasksSnapshot(currentUser, snapshot);
      }

      const timesData = readTimesData();
      timesData.taskEstimates = timesData.taskEstimates || {};
      if (estimatedMinutes) {
        timesData.taskEstimates[taskId] = estimatedMinutes;
      } else {
        delete timesData.taskEstimates[taskId];
      }
      const savedTimes = writeTimesData(timesData);

      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = resolveEffectiveTodoistToken(headerToken, body.token);
      let todoistRemoteResult = { synced: false };

      if (token) {
        try {
          const r = await updateTaskEstimateOnTodoist(token, taskId, estimatedMinutes, taskDesc);
          todoistRemoteResult = { synced: true, ...r };
        } catch (err) {
          if (isFounder) {
            enqueueTodoistOperation({ action: 'estimate', taskId, estimatedMinutes, description: taskDesc });
          }
        }
      } else if (isFounder) {
        enqueueTodoistOperation({ action: 'estimate', taskId, estimatedMinutes, description: taskDesc });
      }

      return sendJson(res, 200, {
        ok: true,
        taskId,
        estimatedMinutes,
        todoist: todoistRemoteResult,
        snapshot,
        times: savedTimes.data
      });
    }

    // 16. POST /api/tasks/reorder
    if ((pathname === '/api/tasks/reorder' || pathname === '/api/todoist/reorder') && req.method === 'POST') {
      const body = await parseBody(req);
      const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [];
      const snapshot = getUserTasksSnapshot(currentUser);
      if (orderedIds.length > 0 && Array.isArray(snapshot.tasks)) {
        const mapById = new Map(snapshot.tasks.map((t) => [String(t.id), t]));
        const reordered = [];
        for (const id of orderedIds) {
          if (mapById.has(id)) {
            reordered.push(mapById.get(id));
            mapById.delete(id);
          }
        }
        for (const rest of mapById.values()) {
          reordered.push(rest);
        }
        snapshot.tasks = reordered.map((t, i) => ({ ...t, dayOrder: i + 1 }));
        snapshot.syncedAt = getSaoPauloNow().isoStr;
        saveUserTasksSnapshot(currentUser, snapshot);

        const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
        const token = resolveEffectiveTodoistToken(headerToken, body.token);
        if (token) {
          reorderTasksOnTodoist(token, orderedIds).catch(() => {});
        } else if (isFounder) {
          enqueueTodoistOperation({ action: 'reorder', orderedIds });
        }
      }
      return sendJson(res, 200, { ok: true, snapshot });
    }

    
    // 16b. Google Calendar Integration (GET /api/gcal/events & POST /api/gcal/settings)
    if (pathname === "/api/gcal/events" && req.method === "GET") {
      const gcal = readGcalSnapshot(currentUser, isFounder);
      return sendJson(res, 200, {
        ok: true,
        ...gcal
      });
    }

    if (pathname === "/api/gcal/settings" && req.method === "POST") {
      const body = await parseBody(req);
      let fetchedEvents = null;
      let icsUrl = body.icsUrl !== undefined ? String(body.icsUrl || "").trim() : undefined;

      if (icsUrl && (icsUrl.startsWith("http://") || icsUrl.startsWith("https://"))) {
        try {
          const resp = await fetch(icsUrl);
          if (resp.ok) {
            const icsText = await resp.text();
            fetchedEvents = parseIcsContent(icsText);
          }
        } catch (_) {}
      }

      const updatedUser = updateUserRecord(currentUser.id, (u) => {
        const nextSettings = { ...(u.settings || {}) };
        if (body.includeInToday !== undefined) {
          nextSettings.includeGcalInToday = Boolean(body.includeInToday);
        }
        if (body.attentionMode !== undefined) {
          nextSettings.attentionMode = String(body.attentionMode);
        }
        if (body.attentionIntervalMinutes !== undefined) {
          nextSettings.attentionIntervalMinutes = Math.max(1, Number(body.attentionIntervalMinutes || 5));
        }
        if (body.notifyTimeEnding !== undefined) {
          nextSettings.notifyTimeEnding = Boolean(body.notifyTimeEnding);
        }
        if (body.notifyThresholdMinutes !== undefined) {
          nextSettings.notifyThresholdMinutes = Math.max(1, Number(body.notifyThresholdMinutes || 1));
        }
        const next = { ...u, settings: nextSettings };
        if (icsUrl !== undefined) next.gcalIcsUrl = icsUrl;
        if (Array.isArray(fetchedEvents) && fetchedEvents.length > 0) {
          next.gcalEvents = fetchedEvents;
          next.gcalName = "Google Agenda (iCal)";
        }
        return next;
      });

      const gcal = readGcalSnapshot(updatedUser || currentUser, isFounder);
      return sendJson(res, 200, {
        ok: true,
        user: sanitizeUserForClient(updatedUser || currentUser),
        ...gcal
      });
    }

// 16B. POST /api/config/stripe — Save Stripe Secret Key, Payment Link, or PIX Key
    if (pathname === '/api/config/stripe' && req.method === 'POST') {
      if (!isAdminUser(currentUser)) return sendJson(res, 403, { ok: false, error: 'Acesso restrito.' });
      const body = await parseBody(req);
      const saved = writeStripeConfig({
        secretKey: body.secretKey,
        publishableKey: body.publishableKey,
        paymentLink: body.paymentLink,
        pixKey: body.pixKey
      });
      return sendJson(res, 200, {
        ok: true,
        hasSecretKey: Boolean(saved.secretKey),
        hasPaymentLink: Boolean(saved.paymentLink),
        paymentLink: saved.paymentLink || '',
        publishableKey: saved.publishableKey || '',
        pixKey: saved.pixKey || 'walacetkwl@gmail.com'
      });
    }

    // 17. GET & POST /api/times
    if (pathname === '/api/times' && req.method === 'GET') {
      const data = readTimesData();
      return sendJson(res, 200, {
        ok: true,
        localTimesPath: LOCAL_TIMES_FILE,
        user: sanitizeUserForClient(currentUser),
        data
      });
    }

    if (pathname === '/api/times' && req.method === 'POST') {
      const body = await parseBody(req);
      const current = readTimesData();

      if (body.session && typeof body.session === 'object') {
        const { dateStr, isoStr } = getSaoPauloNow();
        const s = body.session;
        const dur = Math.max(0, Math.round(Number(s.durationSeconds || 0)));
        current.sessions.push({
          sessionId: s.sessionId || crypto.randomUUID(),
          userId: currentUser.id,
          taskId: String(s.taskId || ''),
          content: stripEmojisServer(s.content || 'Tarefa'),
          projectId: s.projectId || '6CrgFRpqRPQVfgjG',
          date: s.date || dateStr,
          startedAt: s.startedAt || isoStr,
          endedAt: s.endedAt || isoStr,
          durationSeconds: dur,
          durationMinutes: Number((dur / 60).toFixed(2)),
          estimatedMinutes: s.estimatedMinutes || null,
          completed: s.completed !== false,
          completedWithoutTimer: Boolean(s.completedWithoutTimer || dur === 0)
        });
      }

      const saved = writeTimesData(current);
      return sendJson(res, 200, {
        ok: true,
        writtenPaths: saved.writtenPaths,
        data: saved.data
      });
    }

    // 18. Protected /tasks-seed.js
    if (pathname === '/tasks-seed.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      const uid = getAuthenticatedUserId(req);
      const u = uid ? getUserById(uid) : null;
      if (!u) {
        return res.end('window.LIGHTFOCUS_INITIAL_SNAPSHOT = null;\n');
      }
      const snap = getUserTasksSnapshot(u);
      return res.end('window.LIGHTFOCUS_INITIAL_SNAPSHOT = ' + JSON.stringify(snap) + ';\n');
    }

    // 19. Static Files
    let relPath = pathname === '/' ? '/index.html' : pathname;
    relPath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
    if (
      relPath.includes('.todoist-token') ||
      relPath.includes('.auth-sha256') ||
      relPath.includes('users.json') ||
      relPath.includes('stripe-config.json') ||
      relPath.includes('.env') ||
      relPath.startsWith('/data/') ||
      relPath.startsWith('\\data\\') ||
      relPath === '/server.js' ||
      relPath === '\\server.js'
    ) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    let filePath = path.join(ROOT_DIR, relPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      const pubCandidate = path.join(ROOT_DIR, 'public', relPath);
      if (fs.existsSync(pubCandidate) && !fs.statSync(pubCandidate).isDirectory()) {
        filePath = pubCandidate;
      } else {
        filePath = path.join(ROOT_DIR, 'index.html');
      }
    }

    if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      };
      if (relPath === '/sw.js' || relPath.endsWith('/sw.js')) {
        headers['Service-Worker-Allowed'] = '/';
      }
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  } catch (err) {
    console.error('Erro na requisicao:', err);
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Lightfocus] Rodando em http://0.0.0.0:${PORT}`);
});
