#!/usr/bin/env node
/**
 * LightFocus v2 — estrelando Miss Minutos
 * Servidor Node.js (zero dependências externas)
 * - Proteção por senha (compatível com a senha Admin do Vault do Walace via SHA-256 + sessão de 30 dias)
 * - Sincronização bidirecional real com Todoist (Sync API v9 + REST API v2 + Fila de Sincronização)
 *   - Concluir tarefa (item_close preservando recorrência)
 *   - Reabrir tarefa (item_uncomplete / reopen)
 *   - Definir/atualizar estimativa de tempo por tarefa (duration + descrição [min])
 *   - Reordenar e sincronizar ordem exata do Hoje (day_orders / child_order)
 * - Grava logs de tempo reais e gamificação para a Miss Minutos ler antes das 5h30:
 *   1) /cursor/stores/store-5b2033df-0366-49bc-b749-db89d38460ab/lightfocus-times.json
 *   2) /workspace/lightfocus/data/lightfocus-times.json
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3847);
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'todoist-snapshot.json');
const LOCAL_TIMES_FILE = path.join(DATA_DIR, 'lightfocus-times.json');
const TOKEN_FILE = path.join(DATA_DIR, '.todoist-token');
const AUTH_HASH_FILE = path.join(DATA_DIR, '.auth-sha256');
const SYNC_QUEUE_FILE = path.join(DATA_DIR, 'todoist-sync-queue.json');

const MISS_MINUTOS_STORE_DIR = '/cursor/stores/store-5b2033df-0366-49bc-b749-db89d38460ab';
const MISS_MINUTOS_TIMES_FILE = path.join(MISS_MINUTOS_STORE_DIR, 'lightfocus-times.json');
const MISS_MINUTOS_TOKEN_FILE = path.join(MISS_MINUTOS_STORE_DIR, 'todoist-token.txt');

// Hash SHA-256 com salt da senha Admin padrão do Walace (Vault: Afilify Admin / PalcoGestão)
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

// ============================================================================
// Autenticação e Controle de Acesso (Sessão de 30 dias)
// ============================================================================
function computePasswordHash(plainPassword) {
  return crypto
    .createHash('sha256')
    .update(AUTH_SALT + String(plainPassword || '').trim())
    .digest('hex');
}

function getAllowedPasswordHashes() {
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
  // Senhas rápidas alternativas para o Walace caso esteja no celular sem o Vault aberto
  hashes.add(computePasswordHash('walace2026'));
  hashes.add(computePasswordHash('tubalabs'));
  return hashes;
}

function getSigningSecret() {
  const allowed = Array.from(getAllowedPasswordHashes())[0] || DEFAULT_ADMIN_SHA256;
  return crypto.createHash('sha256').update('lf_hmac_secret:' + allowed).digest('hex');
}

function createAuthToken() {
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 dias
  const payload = `walace.${exp}`;
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return false;
  const [user, expStr, sig] = parts;
  if (user !== 'walace') return false;
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return false;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${user}.${expStr}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  } catch (e) {
    return false;
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

function isRequestAuthorized(req) {
  const headerToken = (req.headers['x-lightfocus-auth'] || '').toString().trim();
  if (headerToken && verifyAuthToken(headerToken)) return true;

  const authHeader = (req.headers.authorization || '').toString().trim();
  if (authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (verifyAuthToken(bearer)) return true;
  }

  const cookies = parseCookies(req);
  if (cookies.lf_auth && verifyAuthToken(cookies.lf_auth)) return true;

  return false;
}

// ============================================================================
// Gerenciamento de Token Todoist e Fila de Sincronização
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
    console.error('Erro ao salvar token:', err.message);
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
// Persistência de Tempos, Estimativas e Gamificação (Miss Minutos 5h30)
// ============================================================================
function defaultTimesPayload() {
  const { isoStr } = getSaoPauloNow();
  return {
    app: 'LightFocus',
    owner: 'Walace Messias',
    agent: 'Miss Minutos · Adm do Tempo',
    agentId: '48d857a0-88cd-4c58-887e-43fd9aa850bb',
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
        content: s.content || 'Tarefa',
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
    entry.content = s.content || entry.content;
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
      content: s.content,
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
  } catch (err) {
    console.error('Erro ao gravar LOCAL_TIMES_FILE:', err.message);
  }

  try {
    if (fs.existsSync(MISS_MINUTOS_STORE_DIR)) {
      fs.writeFileSync(MISS_MINUTOS_TIMES_FILE, jsonStr, 'utf8');
      writtenPaths.push(MISS_MINUTOS_TIMES_FILE);
    }
  } catch (err) {
    console.error('Erro ao gravar MISS_MINUTOS_TIMES_FILE:', err.message);
  }

  return { data: enriched, writtenPaths };
}

writeTimesData(readTimesData());

// ============================================================================
// Leitura e Gravação do Snapshot de Tarefas do Hoje
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
          if (customEst !== undefined && customEst !== null) {
            return { ...t, estimatedMinutes: Number(customEst) || null };
          }
          return t;
        });
      }
      return snap;
    }
  } catch (err) {
    console.error('Erro ao ler snapshot:', err.message);
  }
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
  } catch (err) {
    console.error('Erro ao salvar snapshot:', err.message);
  }
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
// Integração Direta Todoist Sync API v9 / REST API v2
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
      }
    } catch (e) {
      remaining.push(op);
    }
  }
  writeSyncQueue(remaining);
}

async function syncFromTodoistApi(token) {
  const { dateStr, isoStr } = getSaoPauloNow();

  await flushQueueToTodoist(token);

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
    projectNames[String(p.id)] = p.name;
  }

  const prevSnapshot = readSnapshot();
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
        content: item.content,
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

  // Tarefas ativas vencendo hoje ou atrasadas
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

  // Constrói lista combinada preservando as tarefas concluídas hoje no Todoist + a nova ordem das pendentes
  const formattedActive = todayTopItems.map((item) => {
    const id = String(item.id);
    const desc = item.description || '';
    const due = item.due || {};
    const prev = prevTasksById.get(id);
    const est =
      customEstimates[id] !== undefined
        ? Number(customEstimates[id])
        : extractEstimatedMinutes(desc, item.duration) || (prev ? prev.estimatedMinutes : null);
    return {
      id,
      content: item.content,
      description: desc,
      dueDate: due.date ? String(due.date).slice(0, 10) : dateStr,
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

  // Preserva tarefas do snapshot de hoje que já foram concluídas no Todoist (ou avançaram a data recorrente)
  const completedTodayTasks = [];
  if (prevSnapshot.date === dateStr && Array.isArray(prevSnapshot.tasks)) {
    for (const oldTask of prevSnapshot.tasks) {
      const id = String(oldTask.id);
      if (!activeTodayIds.has(id)) {
        const remoteItem = itemsById.get(id);
        const remoteDue = remoteItem && remoteItem.due && remoteItem.due.date ? String(remoteItem.due.date).slice(0, 10) : null;
        const wasCompletedInTodoist =
          !remoteItem ||
          remoteItem.checked ||
          remoteItem.in_history ||
          (remoteDue && remoteDue > dateStr) ||
          oldTask.checked;
        if (wasCompletedInTodoist) {
          completedTodayTasks.push({
            ...oldTask,
            checked: true,
            completedAt: oldTask.completedAt || isoStr,
            estimatedMinutes:
              customEstimates[id] !== undefined ? Number(customEstimates[id]) : oldTask.estimatedMinutes || null
          });
        }
      }
    }
  }

  // Intercala ou mantém as pendentes na ordem exata do Todoist e as concluídas marcadas
  const combined = [...completedTodayTasks, ...formattedActive].map((t, idx) => ({
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

  writeSnapshot(snapshot);
  return snapshot;
}

async function closeTaskOnTodoist(token, taskId) {
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
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (restResp.ok || restResp.status === 204) {
    return { ok: true, method: 'rest_v2_close' };
  }
  const errText = await restResp.text();
  throw new Error(`Falha ao concluir no Todoist (${restResp.status}): ${errText}`);
}

async function reopenTaskOnTodoist(token, taskId) {
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
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (restResp.ok || restResp.status === 204) {
    return { ok: true, method: 'rest_v2_reopen' };
  }
  const errText = await restResp.text();
  throw new Error(`Falha ao reabrir no Todoist (${restResp.status}): ${errText}`);
}

async function updateTaskEstimateOnTodoist(token, taskId, estimatedMinutes, currentDescription) {
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
    idsToOrder[String(id)] = idx + 1;
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

// ============================================================================
// Utilitários HTTP
// ============================================================================
function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Todoist-Token, X-LightFocus-Auth, Authorization',
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

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// ============================================================================
// Servidor Principal
// ============================================================================
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // 1. Healthcheck público (sem expor tarefas)
    if (pathname === '/api/health' && req.method === 'GET') {
      const hasToken = Boolean(getStoredTodoistToken());
      const { dateStr, isoStr } = getSaoPauloNow();
      return sendJson(res, 200, {
        ok: true,
        app: 'LightFocus v2 — estrelando Miss Minutos',
        version: '2.0.0',
        date: dateStr,
        now: isoStr,
        timezone: 'America/Sao_Paulo',
        authRequired: true,
        hasServerTodoistToken: hasToken,
        pendingQueueCount: readSyncQueue().length
      });
    }

    // 2. Rotas de Autenticação (Login / Verify / Logout)
    if ((pathname === '/api/auth/verify' || pathname === '/api/auth/status') && req.method === 'GET') {
      const authed = isRequestAuthorized(req);
      return sendJson(res, 200, {
        ok: true,
        authenticated: authed,
        hasServerTodoistToken: authed ? Boolean(getStoredTodoistToken()) : false
      });
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const password = String(body.password || '').trim();
      if (!password) {
        return sendJson(res, 400, { ok: false, error: 'Digite sua senha de acesso.' });
      }
      const candidateHash = computePasswordHash(password);
      const allowedHashes = getAllowedPasswordHashes();

      if (!allowedHashes.has(candidateHash)) {
        return sendJson(res, 401, {
          ok: false,
          error: 'Senha incorreta. Use a sua senha Admin padrão (Vault: Afilify / PalcoGestão).'
        });
      }

      const token = createAuthToken();
      const cookieHeader = `lf_auth=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`;
      return sendJson(
        res,
        200,
        {
          ok: true,
          authenticated: true,
          token,
          hasServerTodoistToken: Boolean(getStoredTodoistToken())
        },
        { 'Set-Cookie': cookieHeader }
      );
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const cookieHeader = 'lf_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
      return sendJson(res, 200, { ok: true, authenticated: false }, { 'Set-Cookie': cookieHeader });
    }

    // 3. Proteção das rotas da API (/api/*)
    if (pathname.startsWith('/api/')) {
      if (!isRequestAuthorized(req)) {
        return sendJson(res, 401, {
          ok: false,
          authRequired: true,
          error: 'Sessão bloqueada. Faça login com sua senha para acessar suas tarefas.'
        });
      }
    }

    // 4. GET /api/tasks
    if (pathname === '/api/tasks' && req.method === 'GET') {
      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = headerToken || getStoredTodoistToken();
      const forceLive = parsedUrl.searchParams.get('live') === '1';

      if (token && forceLive) {
        try {
          const liveSnapshot = await syncFromTodoistApi(token);
          return sendJson(res, 200, {
            ok: true,
            mode: 'live_todoist',
            hasServerTodoistToken: true,
            snapshot: liveSnapshot
          });
        } catch (syncErr) {
          const fallback = readSnapshot();
          return sendJson(res, 200, {
            ok: true,
            mode: 'snapshot_fallback',
            syncError: syncErr.message,
            hasServerTodoistToken: Boolean(getStoredTodoistToken()),
            snapshot: fallback
          });
        }
      }

      const snapshot = readSnapshot();
      return sendJson(res, 200, {
        ok: true,
        mode: token ? 'token_ready' : 'snapshot_mcp',
        hasServerTodoistToken: Boolean(getStoredTodoistToken()),
        pendingQueueCount: readSyncQueue().length,
        snapshot
      });
    }

    // 5. POST /api/sync
    if ((pathname === '/api/sync' || pathname === '/api/todoist/sync') && req.method === 'POST') {
      const body = await parseBody(req);
      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = (body.token || headerToken || getStoredTodoistToken()).trim();

      if (body.token && body.saveToken !== false) {
        saveTodoistToken(body.token);
      }

      if (token) {
        const liveSnapshot = await syncFromTodoistApi(token);
        return sendJson(res, 200, {
          ok: true,
          mode: 'live_todoist',
          hasServerTodoistToken: true,
          snapshot: liveSnapshot
        });
      }

      const snapshot = readSnapshot();
      return sendJson(res, 200, {
        ok: true,
        mode: 'snapshot_mcp',
        hasServerTodoistToken: false,
        message: 'Estado sincronizado carregado.',
        snapshot
      });
    }

    // 6. POST /api/config/token
    if ((pathname === '/api/config/token' || pathname === '/api/todoist/token') && req.method === 'POST') {
      const body = await parseBody(req);
      const token = String(body.token || '').trim();
      if (!token) {
        saveTodoistToken('');
        return sendJson(res, 200, { ok: true, hasServerTodoistToken: false });
      }
      const saved = saveTodoistToken(token);
      let syncResult = null;
      try {
        syncResult = await syncFromTodoistApi(token);
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
      return sendJson(res, 200, {
        ok: saved,
        hasServerTodoistToken: true,
        snapshot: syncResult
      });
    }

    // 7. POST /api/tasks/complete (Concluir tarefa no LightFocus + Todoist)
    if ((pathname === '/api/tasks/complete' || pathname === '/api/todoist/complete') && req.method === 'POST') {
      const body = await parseBody(req);
      const taskId = String(body.taskId || '').trim();
      if (!taskId) {
        return sendJson(res, 400, { ok: false, error: 'taskId é obrigatório' });
      }

      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = (body.token || headerToken || getStoredTodoistToken()).trim();
      let todoistRemoteResult = { synced: false, reason: 'queued_for_sync' };

      if (token) {
        try {
          const r = await closeTaskOnTodoist(token, taskId);
          todoistRemoteResult = { synced: true, ...r };
        } catch (err) {
          enqueueTodoistOperation({ action: 'complete', taskId });
          todoistRemoteResult = { synced: false, queued: true, error: err.message };
        }
      } else {
        enqueueTodoistOperation({ action: 'complete', taskId });
        todoistRemoteResult = { synced: false, queued: true };
      }

      const { dateStr, isoStr } = getSaoPauloNow();
      const snapshot = readSnapshot();
      if (Array.isArray(snapshot.tasks)) {
        snapshot.tasks = snapshot.tasks.map((t) =>
          String(t.id) === taskId ? { ...t, checked: true, completedAt: isoStr } : t
        );
        snapshot.syncedAt = isoStr;
        writeSnapshot(snapshot);
      }

      const durationSeconds = Math.max(0, Math.round(Number(body.durationSeconds || 0)));
      const completedWithoutTimer = Boolean(body.completedWithoutTimer || durationSeconds === 0);

      const timesData = readTimesData();
      const sessionEntry = {
        sessionId: body.sessionId || crypto.randomUUID(),
        taskId,
        content: body.content || 'Tarefa concluída',
        projectId: body.projectId || '6CrgFRpqRPQVfgjG',
        date: body.date || dateStr,
        startedAt: body.startedAt || isoStr,
        endedAt: body.endedAt || isoStr,
        durationSeconds,
        durationMinutes: Number((durationSeconds / 60).toFixed(2)),
        estimatedMinutes: body.estimatedMinutes || (timesData.taskEstimates && timesData.taskEstimates[taskId]) || null,
        completed: true,
        completedWithoutTimer,
        todoistSynced: Boolean(todoistRemoteResult.synced)
      };
      timesData.sessions.push(sessionEntry);
      const savedTimes = writeTimesData(timesData);

      return sendJson(res, 200, {
        ok: true,
        todoist: todoistRemoteResult,
        session: sessionEntry,
        writtenPaths: savedTimes.writtenPaths,
        times: savedTimes.data,
        snapshot
      });
    }

    // 8. POST /api/tasks/uncomplete (Desmarcar / Reabrir tarefa no LightFocus + Todoist)
    if ((pathname === '/api/tasks/uncomplete' || pathname === '/api/todoist/uncomplete') && req.method === 'POST') {
      const body = await parseBody(req);
      const taskId = String(body.taskId || '').trim();
      if (!taskId) {
        return sendJson(res, 400, { ok: false, error: 'taskId é obrigatório' });
      }

      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = (body.token || headerToken || getStoredTodoistToken()).trim();
      let todoistRemoteResult = { synced: false, reason: 'queued_for_sync' };

      if (token) {
        try {
          const r = await reopenTaskOnTodoist(token, taskId);
          todoistRemoteResult = { synced: true, ...r };
        } catch (err) {
          enqueueTodoistOperation({ action: 'uncomplete', taskId });
          todoistRemoteResult = { synced: false, queued: true, error: err.message };
        }
      } else {
        enqueueTodoistOperation({ action: 'uncomplete', taskId });
        todoistRemoteResult = { synced: false, queued: true };
      }

      const { isoStr } = getSaoPauloNow();
      const snapshot = readSnapshot();
      if (Array.isArray(snapshot.tasks)) {
        snapshot.tasks = snapshot.tasks.map((t) =>
          String(t.id) === taskId ? { ...t, checked: false, completedAt: null } : t
        );
        snapshot.syncedAt = isoStr;
        writeSnapshot(snapshot);
      }

      return sendJson(res, 200, {
        ok: true,
        todoist: todoistRemoteResult,
        snapshot
      });
    }

    // 9. POST /api/tasks/estimate (Definir Média / Estimativa de Tempo por Tarefa no Planejamento)
    if ((pathname === '/api/tasks/estimate' || pathname === '/api/todoist/estimate') && req.method === 'POST') {
      const body = await parseBody(req);
      const taskId = String(body.taskId || '').trim();
      if (!taskId) {
        return sendJson(res, 400, { ok: false, error: 'taskId é obrigatório' });
      }
      const rawMin = body.estimatedMinutes;
      const estimatedMinutes =
        rawMin !== null && rawMin !== undefined && Number(rawMin) > 0
          ? Math.min(480, Math.max(1, Math.round(Number(rawMin))))
          : null;

      const snapshot = readSnapshot();
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
        writeSnapshot(snapshot);
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
      const token = (body.token || headerToken || getStoredTodoistToken()).trim();
      let todoistRemoteResult = { synced: false };

      if (token) {
        try {
          const r = await updateTaskEstimateOnTodoist(token, taskId, estimatedMinutes, taskDesc);
          todoistRemoteResult = { synced: true, ...r };
        } catch (err) {
          enqueueTodoistOperation({
            action: 'estimate',
            taskId,
            estimatedMinutes,
            description: taskDesc
          });
          todoistRemoteResult = { synced: false, queued: true, error: err.message };
        }
      } else {
        enqueueTodoistOperation({
          action: 'estimate',
          taskId,
          estimatedMinutes,
          description: taskDesc
        });
        todoistRemoteResult = { synced: false, queued: true };
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

    // 10. POST /api/tasks/reorder
    if ((pathname === '/api/tasks/reorder' || pathname === '/api/todoist/reorder') && req.method === 'POST') {
      const body = await parseBody(req);
      const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [];
      const snapshot = readSnapshot();
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
        writeSnapshot(snapshot);

        const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
        const token = (body.token || headerToken || getStoredTodoistToken()).trim();
        if (token) {
          reorderTasksOnTodoist(token, orderedIds).catch(() => {});
        } else {
          enqueueTodoistOperation({ action: 'reorder', orderedIds });
        }
      }
      return sendJson(res, 200, { ok: true, snapshot });
    }

    // 11. Bridge Endpoints (para sincronização externa / Miss Minutos)
    if (pathname === '/api/bridge/queue' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        queue: readSyncQueue(),
        snapshot: readSnapshot()
      });
    }

    if (pathname === '/api/bridge/sync' && req.method === 'POST') {
      const body = await parseBody(req);
      if (body.clearQueue) {
        writeSyncQueue([]);
      }
      if (body.snapshot && Array.isArray(body.snapshot.tasks)) {
        writeSnapshot(body.snapshot);
      }
      return sendJson(res, 200, {
        ok: true,
        snapshot: readSnapshot(),
        queue: readSyncQueue()
      });
    }

    // 12. GET & POST /api/times
    if (pathname === '/api/times' && req.method === 'GET') {
      const data = readTimesData();
      return sendJson(res, 200, {
        ok: true,
        missMinutosStorePath: MISS_MINUTOS_TIMES_FILE,
        localTimesPath: LOCAL_TIMES_FILE,
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
          taskId: String(s.taskId || ''),
          content: s.content || 'Tarefa',
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
      } else if (Array.isArray(body.sessions)) {
        const existingIds = new Set(current.sessions.map((x) => x.sessionId).filter(Boolean));
        for (const s of body.sessions) {
          if (s.sessionId && existingIds.has(s.sessionId)) continue;
          current.sessions.push(s);
        }
      }

      const saved = writeTimesData(current);
      return sendJson(res, 200, {
        ok: true,
        writtenPaths: saved.writtenPaths,
        data: saved.data
      });
    }

    // 13. Protege /tasks-seed.js se o visitante não estiver autenticado
    if (pathname === '/tasks-seed.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      if (!isRequestAuthorized(req)) {
        return res.end('window.LIGHTFOCUS_INITIAL_SNAPSHOT = null;\n');
      }
      const snap = readSnapshot();
      return res.end('window.LIGHTFOCUS_INITIAL_SNAPSHOT = ' + JSON.stringify(snap) + ';\n');
    }

    // 14. Servir arquivos estáticos (bloqueando acesso direto a dados sensíveis)
    let relPath = pathname === '/' ? '/index.html' : pathname;
    relPath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
    if (
      relPath.includes('.todoist-token') ||
      relPath.includes('.auth-sha256') ||
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
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  } catch (err) {
    console.error('Erro na requisição:', err);
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[LightFocus v2] Rodando em http://0.0.0.0:${PORT}`);
  console.log(`[LightFocus v2] Logs sincronizados em: ${MISS_MINUTOS_TIMES_FILE}`);
});
