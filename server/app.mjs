import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';
import { createEmptyWorkspace, parseWorkspace } from '../src/workspace.ts';
import { generateSchedule, summarizeSchedule } from '../src/scheduler.ts';

const scrypt = promisify(scryptCallback);
const roles = ['admin', 'planner', 'faculty', 'student', 'viewer'];
const cookieName = 'ischedule_session';
const lifetime = 7 * 24 * 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const text = (value, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const emailValid = value => text(value, 160) && /^\S+@\S+\.\S+$/.test(value);
const passwordValid = value => typeof value === 'string' && value.length >= 8 && value.length <= 200;
const publicUser = (user, link = {}) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  facultyId: link.facultyId ?? null,
  groupId: link.groupId ?? null,
  active: Boolean(user.active ?? 1),
  emailVerified: Boolean(user.emailVerified ?? 0),
});
const httpError = (status, message) => Object.assign(new Error(message), { status });
const slotPattern = /^[0-4]-[0-6]$/;

async function encodePassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
async function checkPassword(password, encoded) {
  const [salt, expected] = encoded.split(':');
  const result = await scrypt(password, salt, 64);
  const buffer = Buffer.from(expected, 'hex');
  return result.length === buffer.length && timingSafeEqual(result, buffer);
}
async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw httpError(413, 'Request exceeds the 2 MB limit.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw httpError(400, 'Invalid JSON body.'); }
}

export function createApplication({ dataDirectory, publicDirectory, publicOrigin } = {}) {
  if (dataDirectory) mkdirSync(dataDirectory, { recursive: true });
  const databasePath = dataDirectory
    ? existsSync(join(dataDirectory, 'ischedule.sqlite')) || !existsSync(join(dataDirectory, 'campusly.sqlite'))
      ? join(dataDirectory, 'ischedule.sqlite')
      : join(dataDirectory, 'campusly.sqlite')
    : ':memory:';
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL, passwordHash TEXT NOT NULL, facultyId TEXT, groupId TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history (revision INTEGER PRIMARY KEY, payload TEXT NOT NULL, actor TEXT NOT NULL, savedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reset_tokens (token TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS email_tokens (token TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invitations (token TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, facultyId TEXT, groupId TEXT, expires INTEGER NOT NULL, usedBy TEXT);
    CREATE TABLE IF NOT EXISTS workspace_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL);
  `);
  const columns = table => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  const addColumn = (table, column, definition) => { if (!columns(table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); };
  addColumn('users', 'active', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('users', 'emailVerified', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('workspace_versions', 'workspaceId', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('audit', 'workspaceId', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('invitations', 'workspaceId', 'INTEGER NOT NULL DEFAULT 1');
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, term TEXT,
      revision INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_workspace_links (
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspaceId INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      facultyId TEXT, groupId TEXT, PRIMARY KEY(userId, workspaceId)
    );
    CREATE TABLE IF NOT EXISTS workspace_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspaceId INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, payload TEXT NOT NULL, actor TEXT NOT NULL, savedAt TEXT NOT NULL,
      UNIQUE(workspaceId, revision)
    );
    CREATE INDEX IF NOT EXISTS workspace_versions_scope ON workspace_versions(workspaceId, id);
    CREATE INDEX IF NOT EXISTS audit_scope ON audit(workspaceId, id);
  `);
  // Preserve accounts/data created by the earlier JSON-storage and single-row SQLite versions.
  let legacy = null;
  const legacyFile = dataDirectory && join(dataDirectory, 'store.json');
  if (legacyFile && existsSync(legacyFile)) {
    try { legacy = JSON.parse(readFileSync(legacyFile, 'utf8')); } catch { legacy = null; }
  }
  if (!db.prepare('SELECT id FROM workspaces WHERE id=1').get()) {
    let workspace = createEmptyWorkspace();
    const old = db.prepare('SELECT revision,payload FROM workspace WHERE id=1').get();
    if (old?.payload) {
      try { workspace = parseWorkspace(old.payload); } catch { /* Preserve the legacy row and start the new store empty. */ }
    } else if (legacy?.workspace) {
      try { workspace = parseWorkspace(JSON.stringify(legacy.workspace)); } catch { /* Preserve the legacy file and start the new store empty. */ }
    }
    const now = new Date().toISOString();
    const payload = JSON.stringify(workspace);
    db.prepare('INSERT INTO workspaces(id,name,term,revision,payload,createdAt,updatedAt) VALUES(1,?,?,?,?,?,?)').run('Workspace 1', workspace.term ? JSON.stringify(workspace.term) : null, old?.revision ?? 0, payload, now, now);
    if (!old) db.prepare('INSERT OR IGNORE INTO workspace(id,revision,payload) VALUES(1,?,?)').run(old?.revision ?? 0, payload);
  }
  for (const account of legacy?.users || []) {
    if (!account?.id || !account?.passwordHash || !emailValid(account.email)) continue;
    db.prepare('INSERT OR IGNORE INTO users(id,name,email,role,passwordHash,active) VALUES(?,?,?,?,?,?)').run(account.id, account.name || account.email, account.email.trim().toLowerCase(), roles.includes(account.role) ? account.role : 'student', account.passwordHash, account.active === false ? 0 : 1);
  }
  db.prepare(`INSERT OR IGNORE INTO workspace_history(workspaceId,revision,payload,actor,savedAt)
    SELECT 1,revision,payload,actor,savedAt FROM history`).run();
  db.prepare(`INSERT OR IGNORE INTO user_workspace_links(userId,workspaceId,facultyId,groupId)
    SELECT id,1,facultyId,groupId FROM users WHERE facultyId IS NOT NULL OR groupId IS NOT NULL`).run();
  // Existing invitations and versions belong to the migrated workspace 1 through their default column.
  db.prepare('UPDATE workspace_versions SET workspaceId=1 WHERE workspaceId IS NULL').run();
  db.prepare('UPDATE audit SET workspaceId=1 WHERE workspaceId IS NULL').run();
  db.prepare('UPDATE invitations SET workspaceId=1 WHERE workspaceId IS NULL').run();
  const loginAttempts = new Map();
  const audit = (user, action, details = {}, workspaceId = 1) => db.prepare('INSERT INTO audit(actor,action,details,createdAt,workspaceId) VALUES(?,?,?,?,?)').run(user?.email || 'system', action, JSON.stringify(details), new Date().toISOString(), workspaceId);
  const mailTransport = process.env.SMTP_HOST ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT || 587) === 465, auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined }) : null;
  const openAiKey = process.env.OPENAI_API_KEY;
  const openAiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const openAiBaseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const sendMail = async (to, subject, textBody) => {
    if (!mailTransport || !process.env.MAIL_FROM) { if (process.env.NODE_ENV !== 'test') console.log(`Mail (${subject}) for ${to}: ${textBody}`); return; }
    await mailTransport.sendMail({ from: process.env.MAIL_FROM, to, subject, text: textBody });
  };
  const workspaceRow = workspaceId => {
    const row = db.prepare('SELECT id,name,term,revision,payload,createdAt,updatedAt FROM workspaces WHERE id=?').get(workspaceId);
    if (!row) throw httpError(404, 'Workspace not found.');
    return row;
  };
  const load = workspaceId => {
    const row = workspaceRow(workspaceId);
    return { revision: row.revision, workspace: JSON.parse(row.payload) };
  };
  const workspaceSummary = row => ({ id: row.id, name: row.name, ...(row.term ? { term: JSON.parse(row.term) } : {}) });
  const linkFor = (user, workspaceId) => db.prepare('SELECT facultyId,groupId FROM user_workspace_links WHERE userId=? AND workspaceId=?').get(user.id, workspaceId) || { facultyId: null, groupId: null };
  const publicFor = (user, workspaceId) => publicUser(user, linkFor(user, workspaceId));
  function workspaceIdFrom(url) {
    const raw = url.searchParams.get('workspaceId');
    if (raw === null) return 1;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw))) throw httpError(400, 'workspaceId must be a positive integer.');
    const id = Number(raw);
    workspaceRow(id);
    return id;
  };
  function save(workspaceId, workspace, revision, user) {
    if (!Number.isInteger(revision)) throw httpError(400, 'Workspace revision is required.');
    let parsed;
    try { parsed = parseWorkspace(JSON.stringify(workspace)); }
    catch (error) { throw httpError(400, error.message); }
    const payload = JSON.stringify(parsed);
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare('UPDATE workspaces SET payload=?,term=?,revision=revision+1,updatedAt=? WHERE id=? AND revision=?').run(payload, parsed.term ? JSON.stringify(parsed.term) : null, now, workspaceId, revision);
      if (!result.changes) throw httpError(409, 'Another planner changed this workspace. Download your draft, then reload the latest version.');
      db.prepare('INSERT INTO workspace_history(workspaceId,revision,payload,actor,savedAt) VALUES(?,?,?,?,?)').run(workspaceId, revision + 1, payload, user.name, now);
      db.prepare('DELETE FROM workspace_history WHERE workspaceId=? AND revision <= ?').run(workspaceId, revision - 49);
      if (workspaceId === 1) {
        db.prepare('UPDATE workspace SET payload=?,revision=? WHERE id=1').run(payload, revision + 1);
        db.prepare('INSERT OR IGNORE INTO history(revision,payload,actor,savedAt) VALUES(?,?,?,?)').run(revision + 1, payload, user.name, now);
        db.prepare('DELETE FROM history WHERE revision <= ?').run(revision - 49);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    audit(user, 'workspace.saved', { revision: revision + 1 }, workspaceId);
    return { workspace: parsed, revision: revision + 1 };
  }
  async function createAiSchedule(workspace, user, workspaceId) {
    if (!openAiKey) throw httpError(503, 'AI planning is not configured. Configure the AI provider on the server.');
    let parsed;
    try { parsed = parseWorkspace(JSON.stringify(workspace)); }
    catch (error) { throw httpError(400, error.message); }
    const { data, schedule } = parsed;
    if (!data.courses.length) throw httpError(400, 'Add at least one course before using AI planning.');
    const courseIds = data.courses.map(course => course.id);
    const responseSchema = {
      type: 'object',
      properties: {
        courseOrder: {
          type: 'array',
          items: { type: 'string', enum: courseIds },
          minItems: courseIds.length,
          maxItems: courseIds.length,
        },
      },
      required: ['courseOrder'],
      additionalProperties: false,
    };
    const lockedSessions = schedule?.sessions.filter(session => session.locked) || [];
    const prompt = {
      allowedCourseIds: courseIds,
      data: {
        courses: data.courses,
        faculty: data.faculty.map(member => ({ id: member.id, maxDailyPeriods: member.maxDailyPeriods, unavailable: member.unavailable })),
        rooms: data.rooms,
        groups: data.groups,
        preferences: data.preferences,
      },
      lockedSessions,
      instructions: [
        'Rank the courses in the order they should be planned, placing the most constrained courses first.',
        'Return only JSON with a courseOrder array. Do not include markdown, explanations, sessions, or time placements.',
        'courseOrder must contain every course ID exactly once and must use only IDs from the supplied data.',
        'Copy the exact courses[].id values from allowedCourseIds, not course codes (courses[].code), names, or invented identifiers.',
        'Consider weekly sessions, duration, room type and features, group size, faculty availability, daily limits, teaching days, and locked sessions.',
      ],
    };
    let response;
    try {
      response = await fetch(`${openAiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: openAiModel,
          temperature: 0,
          max_tokens: 1000,
          response_format: { type: 'json_schema', json_schema: { name: 'course_priority', strict: true, schema: responseSchema } },
          messages: [
            { role: 'system', content: 'You are the ISchedule timetable planning engine. Produce valid structured timetable data and follow the supplied constraints exactly.' },
            { role: 'user', content: JSON.stringify(prompt) },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw httpError(502, error instanceof Error ? `The AI service could not be reached: ${error.message}` : 'The AI service could not be reached.');
    }
    if (!response.ok) {
      let detail = '';
      try {
        const errorBody = await response.json();
        detail = typeof errorBody?.error?.message === 'string' ? errorBody.error.message : '';
      } catch { /* The provider may return a non-JSON error response. */ }
      if (response.status === 429) throw httpError(429, detail ? `The AI provider rate limit or quota was reached: ${detail}` : 'The AI provider rate limit or quota was reached. Check usage limits and rate limits.');
      throw httpError(502, detail ? `The AI provider rejected the timetable request: ${detail}` : `The AI provider rejected the timetable request (${response.status}).`);
    }
    let body;
    try { body = await response.json(); }
    catch { throw httpError(502, 'The AI service returned an unreadable response.'); }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw httpError(502, 'The AI service returned no timetable.');
    let result;
    try { result = JSON.parse(content); }
    catch { throw httpError(502, 'The AI service returned invalid timetable JSON.'); }
    if (!Array.isArray(result?.courseOrder) || result.courseOrder.length !== data.courses.length || result.courseOrder.some(courseId => typeof courseId !== 'string')) throw httpError(502, 'The AI service returned an invalid course priority list.');
    const knownCourseIds = new Set(data.courses.map(course => course.id));
    if (new Set(result.courseOrder).size !== result.courseOrder.length || result.courseOrder.some(courseId => !knownCourseIds.has(courseId))) throw httpError(502, 'The AI service returned unknown or duplicate course IDs.');
    const courseById = new Map(data.courses.map(course => [course.id, course]));
    const aiData = { ...data, courses: result.courseOrder.map(courseId => courseById.get(courseId)) };
    const planned = generateSchedule(aiData, undefined, Date.now(), 20, lockedSessions);
    audit(user, 'workspace.ai_plan_generated', { model: openAiModel, placed: planned.sessions.length, unscheduled: planned.unscheduled.reduce((total, item) => total + item.count, 0) }, workspaceId);
    return planned;
  }
  function token(request) {
    const entry = (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`));
    return entry?.slice(cookieName.length + 1) || '';
  }
  function authenticate(request) {
    const user = db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.userId WHERE token=? AND expires>? AND users.active=1').get(hash(token(request)), Date.now());
    if (!user) throw httpError(401, 'Please sign in to continue.');
    return user;
  }
  function requireRole(user, allowed) {
    if (!allowed.includes(user.role)) throw httpError(403, 'Your account does not have permission for this action.');
  }
  function setSession(response, user, request) {
    const value = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(value), user.id, Date.now() + lifetime);
    const secure = publicOrigin?.startsWith('https://') || request.socket.encrypted;
    response.setHeader('Set-Cookie', `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${lifetime / 1000}${secure ? '; Secure' : ''}`);
  }
  const send = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  function publishedFor(user, workspaceId, workspace) {
    if (user.role === 'admin' || user.role === 'planner') return workspace;
    const link = linkFor(user, workspaceId);
    if (user.role === 'faculty' && !link.facultyId) return null;
    if (user.role === 'student' && !link.groupId) return null;
    if (!['faculty', 'student'].includes(user.role)) return null;
    const courseMatches = user.role === 'faculty'
      ? workspace.data.courses.filter(course => course.facultyId === link.facultyId)
      : workspace.data.courses.filter(course => course.groupId === link.groupId);
    const courseIds = new Set(courseMatches.map(course => course.id));
    const roomIds = new Set((workspace.schedule?.sessions || []).filter(session => courseIds.has(session.courseId)).map(session => session.roomId));
    const groupIds = new Set(courseMatches.map(course => course.groupId));
    const facultyIds = new Set(courseMatches.map(course => course.facultyId));
    return {
      ...workspace,
      data: {
        ...workspace.data,
        courses: courseMatches,
        faculty: workspace.data.faculty.filter(member => facultyIds.has(member.id)),
        groups: workspace.data.groups.filter(group => groupIds.has(group.id)),
        rooms: workspace.data.rooms.filter(room => roomIds.has(room.id)),
      },
      schedule: workspace.schedule ? {
        ...workspace.schedule,
        sessions: workspace.schedule.sessions.filter(session => courseIds.has(session.courseId)),
        unscheduled: workspace.schedule.unscheduled.filter(item => courseIds.has(item.courseId)),
      } : null,
    };
  }
  function availabilitySlots(value, field) {
    if (!Array.isArray(value) || value.length > 35 || value.some(slot => typeof slot !== 'string' || !slotPattern.test(slot)) || new Set(value).size !== value.length) throw httpError(400, `${field} must contain unique weekly slots such as 2-4.`);
    return value;
  }
  function scheduleConflicts(data, schedule, facultyId, unavailable) {
    return (schedule?.sessions || []).filter(session => {
      const course = data.courses.find(item => item.id === session.courseId);
      return course?.facultyId === facultyId && unavailable.some(slot => {
        const [day, period] = slot.split('-').map(Number);
        return day === session.day && period >= session.period && period < session.period + course.duration;
      });
    });
  }
  async function route(request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' http://127.0.0.1:4174 http://127.0.0.1:5173 http://localhost:4174 http://localhost:5173; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'");
    if (publicOrigin?.startsWith('https://')) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const origin = request.headers.origin;
    const localOrigin = value => {
      try { return ['localhost', '127.0.0.1'].includes(new URL(value).hostname); }
      catch { return false; }
    };
    // Vite runs on 5173 while the development API runs on 4174. Allow both
    // local origins during development, while keeping production strict.
    const isLocalDevelopmentOrigin = process.env.NODE_ENV !== 'production' && origin && publicOrigin && localOrigin(origin) && localOrigin(publicOrigin);
    const allowedOrigin = publicOrigin && !isLocalDevelopmentOrigin ? publicOrigin : (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : `http://${request.headers.host}`);
    if (origin && origin !== allowedOrigin) throw httpError(403, 'Request origin is not allowed.');
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
      response.setHeader('Vary', 'Origin');
    }
    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname;
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (!path.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(request.method)) throw httpError(405, 'Method not allowed.');
      if (!publicDirectory) throw httpError(404, 'Frontend is not built.');
      const root = resolve(publicDirectory);
      let file = resolve(root, `.${decodeURIComponent(path)}`);
      if (!file.startsWith(root + sep) && file !== root) throw httpError(404, 'Not found.');
      if (!existsSync(file) || !statSync(file).isFile()) {
        if (extname(path)) throw httpError(404, 'Asset not found.');
        file = join(root, 'index.html');
      }
      if (!existsSync(file)) throw httpError(404, 'Run npm run build to build the frontend.');
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : readFileSync(file));
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (!request.headers['content-type']?.startsWith('application/json')) throw httpError(415, 'JSON content type is required.');
    }
    if (path === '/api/health' && request.method === 'GET') return send(response, 200, { ok: true });
    if (['/api/auth/login', '/api/auth/register'].includes(path) && request.method === 'POST') {
      const workspaceId = workspaceIdFrom(url);
      const key = request.socket.remoteAddress;
      const attempt = loginAttempts.get(key);
      const current = attempt && attempt.until > Date.now() ? attempt : { count: 0, until: Date.now() + 60_000 };
      if (++current.count > 30) throw httpError(429, 'Too many sign-in attempts. Try again in a minute.');
      loginAttempts.set(key, current);
      const value = await readBody(request);
      if (!emailValid(value.email) || !passwordValid(value.password)) throw httpError(400, 'Use a valid email and an 8–200 character password.');
      const email = value.email.trim().toLowerCase();
      let user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (path.endsWith('/register')) {
        if (!text(value.name, 100)) throw httpError(400, 'Name is required (up to 100 characters).');
        if (user) throw httpError(409, 'This email is already registered.');
        const encoded = await encodePassword(value.password);
        // Choose the bootstrap role AFTER hashing so simultaneous signups cannot create two bootstrap admins.
        const invitation = text(value.invite, 100) ? db.prepare('SELECT * FROM invitations WHERE token=? AND workspaceId=? AND expires>? AND usedBy IS NULL').get(hash(value.invite), workspaceId, Date.now()) : null;
        if (value.invite && (!invitation || invitation.email !== email)) throw httpError(400, 'This invitation is invalid, expired, or addressed to another email.');
        // After bootstrap, self-selected roles are never trusted. Invitations are the only way to obtain a non-viewer role.
        const role = invitation?.role || (db.prepare('SELECT count(*) AS n FROM users').get().n === 0 ? 'admin' : 'viewer');
        user = { id: randomBytes(16).toString('hex'), name: value.name.trim(), email, role, passwordHash: encoded, facultyId: null, groupId: null, emailVerified: 0 };
        try { db.prepare('INSERT INTO users(id,name,email,role,passwordHash,facultyId,groupId,emailVerified) VALUES(?,?,?,?,?,?,?,0)').run(user.id, user.name, email, role, encoded, null, null); }
        catch { throw httpError(409, 'This email is already registered.'); }
        db.prepare('INSERT INTO user_workspace_links(userId,workspaceId,facultyId,groupId) VALUES(?,?,?,?)').run(user.id, workspaceId, invitation?.facultyId || null, invitation?.groupId || null);
        if (invitation) db.prepare('UPDATE invitations SET usedBy=? WHERE token=?').run(user.id, hash(value.invite));
        const verificationToken = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO email_tokens VALUES(?,?,?)').run(hash(verificationToken), user.id, Date.now() + 24 * 60 * 60 * 1000);
        await sendMail(email, 'Verify your ISchedule account', `${publicOrigin || 'http://localhost:4174'}/verify-email?token=${verificationToken}`);
        user.emailVerified = 0;
      } else if (!user || !user.active || !(await checkPassword(value.password, user.passwordHash))) throw httpError(401, 'Email or password is incorrect.');
      setSession(response, user, request);
      audit(user, path.endsWith('/register') ? 'account.registered' : 'account.login', {}, workspaceId);
      return send(response, path.endsWith('/register') ? 201 : 200, { user: publicFor(user, workspaceId) });
    }
    if (path === '/api/auth/forgot-password' && request.method === 'POST') {
      const value = await readBody(request);
      const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(String(value.email || '').trim().toLowerCase());
      let developmentToken;
      if (user) {
        developmentToken = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO reset_tokens VALUES(?,?,?)').run(hash(developmentToken), user.id, Date.now() + 30 * 60 * 1000);
        await sendMail(user.email, 'Reset your ISchedule password', `${publicOrigin || 'http://localhost:4174'}/reset-password?token=${developmentToken}`);
      }
      return send(response, 200, { ok: true, ...(process.env.NODE_ENV !== 'production' && developmentToken ? { developmentToken } : {}) });
    }
    if (path === '/api/auth/reset-password' && request.method === 'POST') {
      const value = await readBody(request);
      if (!passwordValid(value.password) || !text(value.token, 100)) throw httpError(400, 'A valid reset token and new password are required.');
      const row = db.prepare('SELECT * FROM reset_tokens WHERE token=? AND expires>?').get(hash(value.token), Date.now());
      if (!row) throw httpError(400, 'This password reset link is invalid or expired.');
      db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(await encodePassword(value.password), row.userId);
      db.prepare('DELETE FROM reset_tokens WHERE userId=?').run(row.userId);
      db.prepare('DELETE FROM sessions WHERE userId=?').run(row.userId);
      audit({ email: row.userId }, 'account.password_reset');
      return send(response, 200, { ok: true });
    }
    if (path === '/api/auth/verify-email' && request.method === 'POST') {
      const value = await readBody(request);
      const row = db.prepare('SELECT * FROM email_tokens WHERE token=? AND expires>?').get(hash(value.token || ''), Date.now());
      if (!row) throw httpError(400, 'This verification link is invalid or expired.');
      db.prepare('UPDATE users SET emailVerified=1 WHERE id=?').run(row.userId);
      db.prepare('DELETE FROM email_tokens WHERE userId=?').run(row.userId);
      audit({ email: row.userId }, 'account.email_verified');
      return send(response, 200, { ok: true });
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token(request)));
      response.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
      return send(response, 200, { ok: true });
    }
    const user = authenticate(request);
    const workspaceId = workspaceIdFrom(url);
    if (path === '/api/auth/me' && request.method === 'GET') return send(response, 200, { user: publicFor(user, workspaceId) });
    if (path === '/api/auth/password' && request.method === 'POST') {
      const value = await readBody(request);
      if (!passwordValid(value.password) || typeof value.currentPassword !== 'string' || value.currentPassword.length > 200 || !(await checkPassword(value.currentPassword, user.passwordHash))) throw httpError(400, 'Check your current password and use an 8–200 character new password.');
      const encoded = await encodePassword(value.password);
      db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(encoded, user.id);
      db.prepare('DELETE FROM sessions WHERE userId=?').run(user.id);
      setSession(response, user, request);
      audit(user, 'account.password_changed', {}, workspaceId);
      return send(response, 200, { ok: true });
    }
    if (path === '/api/workspaces' && request.method === 'GET') {
      return send(response, 200, { workspaces: db.prepare('SELECT id,name,term FROM workspaces ORDER BY id').all().map(workspaceSummary) });
    }
    if (path === '/api/workspaces' && request.method === 'POST') {
      requireRole(user, ['admin', 'planner']);
      const value = await readBody(request);
      if (!text(value.name, 120)) throw httpError(400, 'Workspace name is required.');
      const sourceId = value.sourceWorkspaceId === undefined || value.sourceWorkspaceId === null ? null : Number(value.sourceWorkspaceId);
      if (sourceId !== null && (!Number.isSafeInteger(sourceId) || sourceId < 1)) throw httpError(400, 'sourceWorkspaceId must be a positive integer.');
      const source = sourceId === null ? null : load(sourceId).workspace;
      let workspace = source ? { ...source, data: source.data, schedule: value.copySchedule === true ? source.schedule : null } : createEmptyWorkspace();
      if (value.term !== undefined) workspace = { ...workspace, term: value.term };
      let parsed;
      try { parsed = parseWorkspace(JSON.stringify(workspace)); } catch (error) { throw httpError(400, error.message); }
      const now = new Date().toISOString();
      const result = db.prepare('INSERT INTO workspaces(name,term,revision,payload,createdAt,updatedAt) VALUES(?,?,0,?,?,?)').run(value.name.trim(), parsed.term ? JSON.stringify(parsed.term) : null, JSON.stringify(parsed), now, now);
      const id = Number(result.lastInsertRowid);
      audit(user, 'workspace.created', { id, sourceWorkspaceId: sourceId, copySchedule: value.copySchedule === true }, id);
      return send(response, 201, { id });
    }
    if (path === '/api/workspace' && request.method === 'GET') {
      requireRole(user, ['admin', 'planner']);
      return send(response, 200, load(workspaceId));
    }
    if (path === '/api/workspace' && request.method === 'PUT') {
      requireRole(user, ['admin', 'planner']);
      const value = await readBody(request);
      return send(response, 200, save(workspaceId, value.workspace, value.revision, user));
    }
    if (path === '/api/ai/plan' && request.method === 'POST') {
      requireRole(user, ['admin', 'planner']);
      const value = await readBody(request);
      return send(response, 200, { schedule: await createAiSchedule(value.workspace, user, workspaceId) });
    }
    if (path === '/api/availability' && request.method === 'GET') {
      requireRole(user, ['faculty']);
      const link = linkFor(user, workspaceId);
      if (!link.facultyId) throw httpError(400, 'Ask your administrator to link your faculty record in this workspace.');
      const current = load(workspaceId);
      const faculty = current.workspace.data.faculty.find(item => item.id === link.facultyId);
      if (!faculty) throw httpError(400, 'Linked faculty record no longer exists in this workspace.');
      return send(response, 200, { faculty, revision: current.revision });
    }
    if (path === '/api/availability' && request.method === 'PUT') {
      requireRole(user, ['faculty']);
      const link = linkFor(user, workspaceId);
      if (!link.facultyId) throw httpError(400, 'Ask your administrator to link your faculty record in this workspace.');
      const value = await readBody(request);
      const unavailable = availabilitySlots(value.unavailable, 'unavailable');
      const preferred = availabilitySlots(value.preferred === undefined ? [] : value.preferred, 'preferred');
      if (preferred.some(slot => unavailable.includes(slot))) throw httpError(400, 'Preferred and unavailable slots must be disjoint.');
      const current = load(workspaceId);
      if (!Number.isInteger(value.revision)) throw httpError(400, 'Availability revision is required.');
      if (value.revision !== current.revision) throw httpError(409, 'Availability is out of date. Reload the current faculty record before saving.');
      const faculty = current.workspace.data.faculty.find(item => item.id === link.facultyId);
      if (!faculty) throw httpError(400, 'Linked faculty record no longer exists in this workspace.');
      const draftConflicts = scheduleConflicts(current.workspace.data, current.workspace.schedule, link.facultyId, unavailable);
      const publishedRow = db.prepare('SELECT payload FROM workspace_versions WHERE workspaceId=? AND published=1 ORDER BY id DESC LIMIT 1').get(workspaceId);
      const published = publishedRow ? JSON.parse(publishedRow.payload) : null;
      const publishedConflicts = published ? scheduleConflicts(published.data, published.schedule, link.facultyId, unavailable) : [];
      if (draftConflicts.length || publishedConflicts.length) throw httpError(400, `Availability conflicts with ${draftConflicts.length ? 'the draft timetable' : 'the published timetable'}; adjust the timetable before saving.`);
      const next = JSON.parse(JSON.stringify(current.workspace));
      const nextFaculty = next.data.faculty.find(item => item.id === link.facultyId);
      nextFaculty.unavailable = unavailable;
      nextFaculty.preferred = preferred;
      const saved = save(workspaceId, next, value.revision, user);
      return send(response, 200, { faculty: saved.workspace.data.faculty.find(item => item.id === link.facultyId), revision: saved.revision });
    }
    if (path === '/api/users' && request.method === 'GET') {
      requireRole(user, ['admin']);
      return send(response, 200, { users: db.prepare('SELECT * FROM users ORDER BY name').all().map(target => publicFor(target, workspaceId)) });
    }
    if (path.startsWith('/api/users/') && request.method === 'PUT') {
      requireRole(user, ['admin']);
      const id = path.slice('/api/users/'.length);
      const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!target) throw httpError(404, 'User not found.');
      const value = await readBody(request);
      if (!roles.includes(value.role)) throw httpError(400, 'Invalid role.');
      if (id === user.id && value.role !== 'admin') throw httpError(400, 'You cannot remove your own administrator role.');
      if (id === user.id && value.active === false) throw httpError(400, 'You cannot deactivate your own account.');
      const { workspace } = load(workspaceId);
      const facultyId = value.role === 'faculty' ? value.facultyId || null : null;
      const groupId = value.role === 'student' ? value.groupId || null : null;
      if (facultyId && !workspace.data.faculty.some(item => item.id === facultyId)) throw httpError(400, 'Choose an existing faculty member.');
      if (groupId && !workspace.data.groups.some(item => item.id === groupId)) throw httpError(400, 'Choose an existing student group.');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE users SET role=?,active=? WHERE id=?').run(value.role, value.active === false ? 0 : 1, id);
        db.prepare('INSERT INTO user_workspace_links(userId,workspaceId,facultyId,groupId) VALUES(?,?,?,?) ON CONFLICT(userId,workspaceId) DO UPDATE SET facultyId=excluded.facultyId,groupId=excluded.groupId').run(id, workspaceId, facultyId, groupId);
        if (workspaceId === 1) db.prepare('UPDATE users SET facultyId=?,groupId=? WHERE id=?').run(facultyId, groupId, id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      audit(user, 'account.updated', { target: id, role: value.role, active: value.active !== false }, workspaceId);
      return send(response, 200, { user: publicFor(db.prepare('SELECT * FROM users WHERE id=?').get(id), workspaceId) });
    }
    if (path.startsWith('/api/users/') && request.method === 'POST' && path.endsWith('/reset-password')) {
      requireRole(user, ['admin']);
      const id = path.split('/')[3];
      if (!db.prepare('SELECT id FROM users WHERE id=?').get(id)) throw httpError(404, 'User not found.');
      const value = await readBody(request);
      if (!passwordValid(value.password)) throw httpError(400, 'Use an 8–200 character temporary password.');
      db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(await encodePassword(value.password), id);
      db.prepare('DELETE FROM sessions WHERE userId=?').run(id);
      audit(user, 'account.password_reset_by_admin', { target: id }, workspaceId);
      return send(response, 200, { ok: true });
    }
    if (path === '/api/invitations' && request.method === 'POST') {
      requireRole(user, ['admin']);
      const value = await readBody(request);
      if (!emailValid(value.email) || !roles.includes(value.role) || value.role === 'admin') throw httpError(400, 'Choose a valid email and non-administrator role.');
      const invite = randomBytes(32).toString('hex');
      const { workspace } = load(workspaceId);
      const facultyId = value.role === 'faculty' ? value.facultyId || null : null;
      const groupId = value.role === 'student' ? value.groupId || null : null;
      if (facultyId && !workspace.data.faculty.some(item => item.id === facultyId)) throw httpError(400, 'Choose an existing faculty member.');
      if (groupId && !workspace.data.groups.some(item => item.id === groupId)) throw httpError(400, 'Choose an existing student group.');
      db.prepare('INSERT INTO invitations(token,email,role,facultyId,groupId,expires,usedBy,workspaceId) VALUES(?,?,?,?,?,?,NULL,?)').run(hash(invite), value.email.trim().toLowerCase(), value.role, facultyId, groupId, Date.now() + 7 * 24 * 60 * 60 * 1000, workspaceId);
      const link = `/register?invite=${invite}`;
      await sendMail(value.email, 'You are invited to ISchedule', `${publicOrigin || 'http://localhost:4174'}${link}`);
      audit(user, 'account.invitation_created', { email: value.email, role: value.role }, workspaceId);
      return send(response, 201, { link, ...(process.env.NODE_ENV !== 'production' ? { token: invite } : {}) });
    }
    if (path === '/api/audit' && request.method === 'GET') {
      requireRole(user, ['admin']);
      return send(response, 200, { audit: db.prepare('SELECT actor,action,details,createdAt FROM audit WHERE workspaceId=? ORDER BY id DESC LIMIT 200').all(workspaceId) });
    }
    if (path === '/api/versions' && request.method === 'GET') {
      requireRole(user, ['admin', 'planner']);
      return send(response, 200, { versions: db.prepare('SELECT id,name,revision,published,createdBy,createdAt FROM workspace_versions WHERE workspaceId=? ORDER BY id DESC LIMIT 100').all(workspaceId) });
    }
    if (path === '/api/versions' && request.method === 'POST') {
      requireRole(user, ['admin', 'planner']);
      const value = await readBody(request);
      if (!text(value.name, 120)) throw httpError(400, 'Version name is required.');
      const current = load(workspaceId);
      const result = db.prepare('INSERT INTO workspace_versions(workspaceId,name,revision,payload,published,createdBy,createdAt) VALUES(?,?,?,?,?,?,?)').run(workspaceId, value.name.trim(), current.revision, JSON.stringify(current.workspace), 0, user.email, new Date().toISOString());
      audit(user, 'workspace.version_created', { id: result.lastInsertRowid, name: value.name }, workspaceId);
      return send(response, 201, { id: result.lastInsertRowid });
    }
    if (path.startsWith('/api/versions/') && path.endsWith('/publish') && request.method === 'POST') {
      requireRole(user, ['admin', 'planner']);
      const versionId = Number(path.split('/')[3]);
      if (!Number.isSafeInteger(versionId) || !db.prepare('SELECT id FROM workspace_versions WHERE id=? AND workspaceId=?').get(versionId, workspaceId)) throw httpError(404, 'Version not found in this workspace.');
      db.exec('BEGIN IMMEDIATE');
      try { db.prepare('UPDATE workspace_versions SET published=0 WHERE workspaceId=?').run(workspaceId); db.prepare('UPDATE workspace_versions SET published=1 WHERE id=? AND workspaceId=?').run(versionId, workspaceId); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
      audit(user, 'workspace.version_published', { id: versionId }, workspaceId);
      return send(response, 200, { ok: true });
    }
    if (path === '/api/published' && request.method === 'GET') {
      const version = db.prepare('SELECT id,name,revision,payload,createdAt FROM workspace_versions WHERE workspaceId=? AND published=1 ORDER BY id DESC LIMIT 1').get(workspaceId);
      const payload = version ? publishedFor(user, workspaceId, JSON.parse(version.payload)) : null;
      return send(response, 200, { version: version && payload ? { ...version, payload } : null });
    }
    if (path === '/api/history' && request.method === 'GET') {
      requireRole(user, ['admin', 'planner']);
      return send(response, 200, { history: db.prepare('SELECT revision,actor,savedAt FROM workspace_history WHERE workspaceId=? ORDER BY revision DESC LIMIT 50').all(workspaceId) });
    }
    if (path === '/api/history/restore' && request.method === 'POST') {
      requireRole(user, ['admin']);
      const value = await readBody(request);
      const entry = db.prepare('SELECT payload FROM workspace_history WHERE workspaceId=? AND revision=?').get(workspaceId, value.targetRevision ?? -1);
      if (!entry) throw httpError(404, 'Saved version not found.');
      return send(response, 200, save(workspaceId, JSON.parse(entry.payload), value.revision, user));
    }
    throw httpError(404, 'API route not found.');
  }
  const server = createServer((request, response) => {
    route(request, response).catch(error => {
      if (response.headersSent) { response.end(); return; }
      if (!error.status) console.error(error);
      send(response, error.status || 500, { error: error.status ? error.message : 'The server could not complete this request.' });
    });
  });
  server.requestTimeout = 30_000;
  return { server, close: () => new Promise(resolveClose => { server.close(() => { db.close(); resolveClose(); }); server.closeIdleConnections(); }) };
}
