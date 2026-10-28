#!/usr/bin/env node
/**
 * LightFocus — estrelando Miss Minutos
 * Servidor leve em Node.js (zero dependências externas)
 * - Sincroniza tarefas do Hoje no Todoist (Sync API v9 + REST API v2 + Snapshot MCP)
 * - Preserva a ordem exata do Hoje (day_order / child_order do projeto 6CrgFRpqRPQVfgjG)
 * - Conclui tarefas preservando recorrências (item_close)
 * - Grava logs de tempo reais para a Miss Minutos ler antes das 5h30:
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
const MISS_MINUTOS_STORE_DIR = '/cursor/stores/store-5b2033df-0366-49bc-b749-db89d38460ab';
const MISS_MINUTOS_TIMES_FILE = path.join(MISS_MINUTOS_STORE_DIR, 'lightfocus-times.json');

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

function getStoredTodoistToken() {
  if (process.env.TODOIST_API_TOKEN && process.env.TODOIST_API_TOKEN.trim()) {
    return process.env.TODOIST_API_TOKEN.trim();
  }
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (t) return t;
    }
  } catch (err) {
    // ignore
  }
  return '';
}

function saveTodoistToken(token) {
  try {
    fs.writeFileSync(TOKEN_FILE, String(token || '').trim(), { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (err) {
    console.error('Erro ao salvar token:', err.message);
    return false;
  }
}

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
    taskAverages: {},
    dailySummary: {}
  };
}

function readTimesData() {
  const candidates = [MISS_MINUTOS_TIMES_FILE, LOCAL_TIMES_FILE];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          parsed.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
          parsed.taskAverages = parsed.taskAverages || {};
          parsed.dailySummary = parsed.dailySummary || {};
          return parsed;
        }
      }
    } catch (err) {
      // try next
    }
  }
  return defaultTimesPayload();
}

function recomputeAggregates(data) {
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
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
        estimatedMinutes: s.estimatedMinutes || null,
        lastDurationSeconds: 0,
        lastCompletedAt: null
      };
    }
    const entry = taskMap[key];
    entry.content = s.content || entry.content;
    if (s.estimatedMinutes) entry.estimatedMinutes = s.estimatedMinutes;
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

// Garante que os dois arquivos de tempos já existam desde a subida do servidor
writeTimesData(readTimesData());

function readSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
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

function extractEstimatedMinutes(desc) {
  if (!desc) return null;
  const m1 = String(desc).match(/\[(\d+)\]/);
  if (m1) return parseInt(m1[1], 10);
  const m2 = String(desc).match(/(\d+)\s*min/i);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

async function syncFromTodoistApi(token) {
  const { dateStr, isoStr } = getSaoPauloNow();
  // Tenta Sync API v9 primeiro para obter day_orders e child_order exatos
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
  const items = Array.isArray(syncData.items) ? syncData.items : [];
  const dayOrders = syncData.day_orders || {};
  const projects = Array.isArray(syncData.projects) ? syncData.projects : [];
  const projectNames = {};
  for (const p of projects) {
    projectNames[String(p.id)] = p.name;
  }

  const activeItems = items.filter((item) => !item.checked && !item.is_deleted && !item.in_history);
  const childrenByParent = {};
  for (const item of activeItems) {
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

  const todayTopItems = activeItems.filter((item) => {
    if (item.parent_id) return false;
    const dueDate = item.due && item.due.date ? String(item.due.date).slice(0, 10) : null;
    return dueDate && dueDate <= dateStr;
  });

  // Verifica se day_orders possui ordem customizada definida no Hoje
  const hasExplicitDayOrders = todayTopItems.some((item) => {
    const id = String(item.id);
    return dayOrders[id] !== undefined || (item.day_order !== undefined && item.day_order >= 0);
  });

  todayTopItems.sort((a, b) => {
    const idA = String(a.id);
    const idB = String(b.id);
    if (hasExplicitDayOrders) {
      const doA = dayOrders[idA] !== undefined ? Number(dayOrders[idA]) : (a.day_order !== undefined && a.day_order >= 0 ? Number(a.day_order) : 999999);
      const doB = dayOrders[idB] !== undefined ? Number(dayOrders[idB]) : (b.day_order !== undefined && b.day_order >= 0 ? Number(b.day_order) : 999999);
      if (doA !== doB) return doA - doB;
    }
    const coA = Number(a.child_order ?? 999999);
    const coB = Number(b.child_order ?? 999999);
    if (coA !== coB) return coA - coB;
    return String(a.added_at || '').localeCompare(String(b.added_at || ''));
  });

  const formattedTasks = todayTopItems.map((item, idx) => {
    const id = String(item.id);
    const desc = item.description || '';
    const due = item.due || {};
    return {
      id,
      content: item.content,
      description: desc,
      dueDate: due.date ? String(due.date).slice(0, 10) : dateStr,
      recurring: due.is_recurring ? (due.string || 'recorrente') : false,
      priority: `p${5 - Number(item.priority || 1)}`,
      projectId: String(item.project_id || '6CrgFRpqRPQVfgjG'),
      projectName: projectNames[String(item.project_id)] || 'Hoje · Principal',
      labels: Array.isArray(item.labels) ? item.labels : [],
      checked: false,
      dayOrder: idx + 1,
      estimatedMinutes: extractEstimatedMinutes(desc),
      subtasks: childrenByParent[id] || [],
      addedAt: item.added_at || ''
    };
  });

  const snapshot = {
    syncedAt: isoStr,
    date: dateStr,
    timezone: 'America/Sao_Paulo',
    source: 'todoist_sync_v9',
    totalToday: formattedTasks.length,
    tasks: formattedTasks
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

  // Fallback REST v2 close
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

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Todoist-Token'
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      const hasToken = Boolean(getStoredTodoistToken());
      const { dateStr, isoStr } = getSaoPauloNow();
      return sendJson(res, 200, {
        ok: true,
        app: 'LightFocus — estrelando Miss Minutos',
        date: dateStr,
        now: isoStr,
        timezone: 'America/Sao_Paulo',
        hasServerTodoistToken: hasToken,
        missMinutosStorePath: MISS_MINUTOS_TIMES_FILE,
        localTimesPath: LOCAL_TIMES_FILE
      });
    }

    if (pathname === '/api/tasks' && req.method === 'GET') {
      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = headerToken || getStoredTodoistToken();
      const forceLive = parsedUrl.searchParams.get('live') === '1';

      if (token && forceLive) {
        try {
          const liveSnapshot = await syncFromTodoistApi(token);
          return sendJson(res, 200, { ok: true, mode: 'live_todoist', snapshot: liveSnapshot });
        } catch (syncErr) {
          const fallback = readSnapshot();
          return sendJson(res, 200, {
            ok: true,
            mode: 'snapshot_fallback',
            syncError: syncErr.message,
            snapshot: fallback
          });
        }
      }

      const snapshot = readSnapshot();
      return sendJson(res, 200, {
        ok: true,
        mode: token ? 'token_ready' : 'snapshot_mcp',
        hasServerTodoistToken: Boolean(getStoredTodoistToken()),
        snapshot
      });
    }

    if (pathname === '/api/sync' && req.method === 'POST') {
      const body = await parseBody(req);
      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = (body.token || headerToken || getStoredTodoistToken()).trim();

      if (body.token && body.saveToken !== false) {
        saveTodoistToken(body.token);
      }

      if (token) {
        const liveSnapshot = await syncFromTodoistApi(token);
        return sendJson(res, 200, { ok: true, mode: 'live_todoist', snapshot: liveSnapshot });
      }

      const snapshot = readSnapshot();
      return sendJson(res, 200, {
        ok: true,
        mode: 'snapshot_mcp',
        message: 'Snapshot sincronizado do conector Todoist carregado.',
        snapshot
      });
    }

    if (pathname === '/api/config/token' && req.method === 'POST') {
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

    if (pathname === '/api/tasks/complete' && req.method === 'POST') {
      const body = await parseBody(req);
      const taskId = String(body.taskId || '').trim();
      if (!taskId) {
        return sendJson(res, 400, { ok: false, error: 'taskId é obrigatório' });
      }

      const headerToken = (req.headers['x-todoist-token'] || '').toString().trim();
      const token = (body.token || headerToken || getStoredTodoistToken()).trim();
      let todoistRemoteResult = { synced: false, reason: 'no_token' };

      if (token) {
        try {
          const r = await closeTaskOnTodoist(token, taskId);
          todoistRemoteResult = { synced: true, ...r };
        } catch (err) {
          todoistRemoteResult = { synced: false, error: err.message };
        }
      }

      // Atualiza snapshot local marcando a tarefa como concluída hoje
      const snapshot = readSnapshot();
      if (Array.isArray(snapshot.tasks)) {
        snapshot.tasks = snapshot.tasks.map((t) =>
          String(t.id) === taskId ? { ...t, checked: true, completedAt: getSaoPauloNow().isoStr } : t
        );
        writeSnapshot(snapshot);
      }

      // Grava sessão de tempo no store da Miss Minutos + data/lightfocus-times.json
      const { dateStr, isoStr } = getSaoPauloNow();
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
        estimatedMinutes: body.estimatedMinutes || null,
        completed: true,
        completedWithoutTimer,
        todoistSynced: todoistRemoteResult.synced
      };
      timesData.sessions.push(sessionEntry);
      const savedTimes = writeTimesData(timesData);

      return sendJson(res, 200, {
        ok: true,
        todoist: todoistRemoteResult,
        session: sessionEntry,
        writtenPaths: savedTimes.writtenPaths,
        times: savedTimes.data
      });
    }

    if (pathname === '/api/tasks/reorder' && req.method === 'POST') {
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
        writeSnapshot(snapshot);
      }
      return sendJson(res, 200, { ok: true, snapshot });
    }

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
        // Merge sessions by sessionId
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

    // Servir arquivos estáticos da raiz (bloqueando acesso direto a server.js, data/.todoist-token, .env)
    let relPath = pathname === '/' ? '/index.html' : pathname;
    relPath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
    if (
      relPath.includes('.todoist-token') ||
      relPath.includes('.env') ||
      relPath === '/server.js' ||
      relPath === '\\server.js'
    ) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    let filePath = path.join(ROOT_DIR, relPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // Tenta dentro de public/
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
  console.log(`✨ LightFocus (estrelando Miss Minutos) rodando em http://0.0.0.0:${PORT}`);
  console.log(`⏰ Logs de tempo sincronizados em: ${MISS_MINUTOS_TIMES_FILE}`);
});
