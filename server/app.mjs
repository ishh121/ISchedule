import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';
import { parseWorkspace } from '../src/workspace.ts';
import { createDemoData } from '../src/seed.ts';
import { summarizeSchedule, validateSchedule } from '../src/scheduler.ts';

const scrypt = promisify(scryptCallback);
const roles = ['admin', 'planner', 'faculty', 'student', 'viewer'];
const cookieName = 'ischedule_session';
const lifetime = 7 * 24 * 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const text = (value, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const emailValid = value => text(value, 160) && /^\S+@\S+\.\S+$/.test(value);
const passwordValid = value => typeof value === 'string' && value.length >= 8 && value.length <= 200;
const publicUser = user => ({ id: user.id, name: user.name, email: user.email, role: user.role, facultyId: user.facultyId, groupId: user.groupId, active: Boolean(user.active ?? 1), emailVerified: Boolean(user.emailVerified ?? 0) });
const httpError = (status, message) => Object.assign(new Error(message), { status });

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
  try { db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1'); } catch { /* Existing databases already have the column. */ }
  try { db.exec('ALTER TABLE users ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 0'); } catch { /* Existing databases already have the column. */ }
  if (!db.prepare('SELECT id FROM workspace WHERE id=1').get()) {
    let workspace = { version: 1, data: createDemoData(), schedule: null };
    // Preserve accounts/data created by the earlier JSON-storage version.
    const legacyFile = dataDirectory && join(dataDirectory, 'store.json');
    const legacy = legacyFile && existsSync(legacyFile) ? JSON.parse(readFileSync(legacyFile, 'utf8')) : null;
    if (legacy?.workspace) workspace = parseWorkspace(JSON.stringify(legacy.workspace));
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const user of legacy?.users || []) {
        db.prepare('INSERT INTO users(id,name,email,role,passwordHash,active) VALUES(?,?,?,?,?,1)').run(user.id, user.name, user.email, roles.includes(user.role) ? user.role : 'student', user.passwordHash);
      }
      db.prepare('INSERT INTO workspace VALUES(1,0,?)').run(JSON.stringify(workspace));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const loginAttempts = new Map();
  const audit = (user, action, details = {}) => db.prepare('INSERT INTO audit(actor,action,details,createdAt) VALUES(?,?,?,?)').run(user?.email || 'system', action, JSON.stringify(details), new Date().toISOString());
  const mailTransport = process.env.SMTP_HOST ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT || 587) === 465, auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined }) : null;
  const openAiKey = process.env.OPENAI_API_KEY;
  const openAiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const openAiBaseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const sendMail = async (to, subject, textBody) => {
    if (!mailTransport || !process.env.MAIL_FROM) { console.log(`Mail (${subject}) for ${to}: ${textBody}`); return; }
    await mailTransport.sendMail({ from: process.env.MAIL_FROM, to, subject, text: textBody });
  };
  const load = () => {
    const row = db.prepare('SELECT revision,payload FROM workspace WHERE id=1').get();
    return { revision: row.revision, workspace: JSON.parse(row.payload) };
  };
  function save(workspace, revision, user) {
    if (!Number.isInteger(revision)) throw httpError(400, 'Workspace revision is required.');
    let parsed;
    try { parsed = parseWorkspace(JSON.stringify(workspace)); }
    catch (error) { throw httpError(400, error.message); }
    const payload = JSON.stringify(parsed);
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare('UPDATE workspace SET payload=?,revision=revision+1 WHERE id=1 AND revision=?').run(payload, revision);
      if (!result.changes) throw httpError(409, 'Another planner changed this workspace. Download your draft, then reload the latest version.');
      db.prepare('INSERT INTO history VALUES(?,?,?,?)').run(revision + 1, payload, user.name, new Date().toISOString());
      db.prepare('DELETE FROM history WHERE revision <= ?').run(revision - 49);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    audit(user, 'workspace.saved', { revision: revision + 1 });
    return { workspace: parsed, revision: revision + 1 };
  }
  async function createAiSchedule(workspace, user) {
    if (!openAiKey) throw httpError(503, 'AI planning is not configured. Add OPENAI_API_KEY to the server environment.');
    let parsed;
    try { parsed = parseWorkspace(JSON.stringify(workspace)); }
    catch (error) { throw httpError(400, error.message); }
    const { data, schedule } = parsed;
    const lockedSessions = schedule?.sessions.filter(session => session.locked) || [];
    const prompt = {
      data,
      lockedSessions,
      instructions: [
        'Create a complete weekly timetable for every requested course session.',
        'Return only JSON with a sessions array. Do not include markdown or explanations.',
        'Each session must contain id, courseId, day, period, roomId, and optional locked boolean.',
        'Use only IDs from the supplied data. Days and periods are zero-based.',
        'Each course can meet at most once per day. Multi-period courses must use contiguous periods and cannot cross breaks.',
        'Preserve every locked session exactly, including its id, day, period, roomId, and locked=true.',
      ],
    };
    let response;
    try {
      response = await fetch(`${openAiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: openAiModel,
          temperature: 0.15,
          response_format: { type: 'json_object' },
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
    if (!response.ok) throw httpError(502, `The AI service rejected the timetable request (${response.status}).`);
    let body;
    try { body = await response.json(); }
    catch { throw httpError(502, 'The AI service returned an unreadable response.'); }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw httpError(502, 'The AI service returned no timetable.');
    let result;
    try { result = JSON.parse(content); }
    catch { throw httpError(502, 'The AI service returned invalid timetable JSON.'); }
    if (!Array.isArray(result?.sessions) || result.sessions.length > 2500) throw httpError(502, 'The AI service returned an invalid session list.');
    const sessions = result.sessions.map(session => ({
      id: session?.id,
      courseId: session?.courseId,
      day: session?.day,
      period: session?.period,
      roomId: session?.roomId,
      ...(session?.locked === true ? { locked: true } : {}),
    }));
    if (sessions.some(session => !text(session.id) || !text(session.courseId) || !text(session.roomId) || !Number.isInteger(session.day) || !Number.isInteger(session.period) || (session.locked !== undefined && session.locked !== true))) throw httpError(502, 'The AI service returned malformed timetable sessions.');
    const issues = validateSchedule(data, sessions);
    if (issues.length) throw httpError(502, `The AI proposed an invalid timetable: ${issues[0].message}`);
    for (const locked of lockedSessions) {
      const candidate = sessions.find(session => session.id === locked.id);
      if (!candidate || candidate.courseId !== locked.courseId || candidate.day !== locked.day || candidate.period !== locked.period || candidate.roomId !== locked.roomId || candidate.locked !== true) throw httpError(502, 'The AI changed a locked session. Try again or use the deterministic planner.');
    }
    const planned = summarizeSchedule(data, sessions);
    audit(user, 'workspace.ai_plan_generated', { model: openAiModel, placed: sessions.length, unscheduled: planned.unscheduled.reduce((total, item) => total + item.count, 0) });
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
  async function route(request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' http://127.0.0.1:4174 http://127.0.0.1:5173 http://localhost:4174 http://localhost:5173; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'");
    if (publicOrigin?.startsWith('https://')) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const origin = request.headers.origin;
    const allowedOrigin = publicOrigin || (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : `http://${request.headers.host}`);
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
        const invitation = text(value.invite, 100) ? db.prepare('SELECT * FROM invitations WHERE token=? AND expires>? AND usedBy IS NULL').get(hash(value.invite), Date.now()) : null;
        if (value.invite && (!invitation || invitation.email !== email)) throw httpError(400, 'This invitation is invalid, expired, or addressed to another email.');
        const role = invitation?.role || (db.prepare('SELECT count(*) AS n FROM users').get().n === 0 ? 'admin' : value.role === 'viewer' ? 'viewer' : 'planner');
        user = { id: randomBytes(16).toString('hex'), name: value.name.trim(), email, role, passwordHash: encoded, facultyId: invitation?.facultyId || null, groupId: invitation?.groupId || null, emailVerified: 0 };
        try { db.prepare('INSERT INTO users(id,name,email,role,passwordHash,facultyId,groupId,emailVerified) VALUES(?,?,?,?,?,?,?,0)').run(user.id, user.name, email, role, encoded, user.facultyId, user.groupId); }
        catch { throw httpError(409, 'This email is already registered.'); }
        if (invitation) db.prepare('UPDATE invitations SET usedBy=? WHERE token=?').run(user.id, hash(value.invite));
        const verificationToken = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO email_tokens VALUES(?,?,?)').run(hash(verificationToken), user.id, Date.now() + 24 * 60 * 60 * 1000);
        await sendMail(email, 'Verify your ISchedule account', `${publicOrigin || 'http://localhost:4174'}/verify-email?token=${verificationToken}`);
        user.emailVerified = 0;
      } else if (!user || !(await checkPassword(value.password, user.passwordHash))) throw httpError(401, 'Email or password is incorrect.');
      setSession(response, user, request);
      audit(user, path.endsWith('/register') ? 'account.registered' : 'account.login');
      return send(response, path.endsWith('/register') ? 201 : 200, { user: publicUser(user) });
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
      db.prepare('UPDATE users SET passwordHash=?,active=1 WHERE id=?').run(await encodePassword(value.password), row.userId);
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
    if (path === '/api/auth/me' && request.method === 'GET') return send(response, 200, { user: publicUser(user) });
    if (path === '/api/auth/password' && request.method === 'POST') {
      const value = await readBody(request);
      if (!passwordValid(value.password) || typeof value.currentPassword !== 'string' || value.currentPassword.length > 200 || !(await checkPassword(value.currentPassword, user.passwordHash))) throw httpError(400, 'Check your current password and use an 8–200 character new password.');
      const encoded = await encodePassword(value.password);
      db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(encoded, user.id);
      db.prepare('DELETE FROM sessions WHERE userId=?').run(user.id);
      setSession(response, user, request);
      audit(user, 'account.password_changed');
      return send(response, 200, { ok: true });
    }
    if (path === '/api/workspace' && request.method === 'GET') return send(response, 200, load());
    if (path === '/api/workspace' && request.method === 'PUT') {
      requireRole(user, ['admin', 'planner']);
      const value = await readBody(request);
      return send(response, 200, save(value.workspace, value.revision, user));
    }
    if (path === '/api/ai/plan' && request.method === 'POST') {
      requireRole(user, ['admin', 'planner']);
      const value = await readBody(request);
      return send(response, 200, { schedule: await createAiSchedule(value.workspace, user) });
    }
    if (path === '/api/availability' && request.method === 'PUT') {
      requireRole(user, ['faculty']);
      if (!user.facultyId) throw httpError(400, 'Ask your administrator to link your faculty record.');
      const value = await readBody(request);
      const current = load();
      const faculty = current.workspace.data.faculty.find(item => item.id === user.facultyId);
      if (!faculty) throw httpError(400, 'Linked faculty record no longer exists.');
      faculty.unavailable = value.unavailable;
      // Availability changes must remain compatible with the current timetable.
      return send(response, 200, save(current.workspace, value.revision, user));
    }
    if (path === '/api/users' && request.method === 'GET') {
      requireRole(user, ['admin']);
      return send(response, 200, { users: db.prepare('SELECT * FROM users ORDER BY name').all().map(publicUser) });
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
      const { workspace } = load();
      const facultyId = value.role === 'faculty' ? value.facultyId || null : null;
      const groupId = value.role === 'student' ? value.groupId || null : null;
      if (facultyId && !workspace.data.faculty.some(item => item.id === facultyId)) throw httpError(400, 'Choose an existing faculty member.');
      if (groupId && !workspace.data.groups.some(item => item.id === groupId)) throw httpError(400, 'Choose an existing student group.');
      db.prepare('UPDATE users SET role=?,facultyId=?,groupId=?,active=? WHERE id=?').run(value.role, facultyId, groupId, value.active === false ? 0 : 1, id);
      audit(user, 'account.updated', { target: id, role: value.role, active: value.active !== false });
      return send(response, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
    }
    if (path.startsWith('/api/users/') && request.method === 'POST' && path.endsWith('/reset-password')) {
      requireRole(user, ['admin']);
      const id = path.split('/')[3];
      if (!db.prepare('SELECT id FROM users WHERE id=?').get(id)) throw httpError(404, 'User not found.');
      const value = await readBody(request);
      if (!passwordValid(value.password)) throw httpError(400, 'Use an 8–200 character temporary password.');
      db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(await encodePassword(value.password), id);
      db.prepare('DELETE FROM sessions WHERE userId=?').run(id);
      audit(user, 'account.password_reset_by_admin', { target: id });
      return send(response, 200, { ok: true });
    }
    if (path === '/api/invitations' && request.method === 'POST') {
      requireRole(user, ['admin']);
      const value = await readBody(request);
      if (!emailValid(value.email) || !roles.includes(value.role) || value.role === 'admin') throw httpError(400, 'Choose a valid email and non-administrator role.');
      const invite = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO invitations VALUES(?,?,?,?,?,?,NULL)').run(hash(invite), value.email.trim().toLowerCase(), value.role, value.facultyId || null, value.groupId || null, Date.now() + 7 * 24 * 60 * 60 * 1000);
      const link = `/register?invite=${invite}`;
      await sendMail(value.email, 'You are invited to ISchedule', `${publicOrigin || 'http://localhost:4174'}${link}`);
      audit(user, 'account.invitation_created', { email: value.email, role: value.role });
      return send(response, 201, { link, ...(process.env.NODE_ENV !== 'production' ? { token: invite } : {}) });
    }
    if (path === '/api/audit' && request.method === 'GET') {
      requireRole(user, ['admin']);
      return send(response, 200, { audit: db.prepare('SELECT actor,action,details,createdAt FROM audit ORDER BY id DESC LIMIT 200').all() });
    }
    if (path === '/api/versions' && request.method === 'GET') {
      requireRole(user, ['admin', 'planner']);
      return send(response, 200, { versions: db.prepare('SELECT id,name,revision,published,createdBy,createdAt FROM workspace_versions ORDER BY id DESC LIMIT 100').all() });
    }
    if (path === '/api/versions' && request.method === 'POST') {
      requireRole(user, ['admin', 'planner']);
      const value = await readBody(request);
      if (!text(value.name, 120)) throw httpError(400, 'Version name is required.');
      const current = load();
      const result = db.prepare('INSERT INTO workspace_versions(name,revision,payload,published,createdBy,createdAt) VALUES(?,?,?,?,?,?)').run(value.name.trim(), current.revision, JSON.stringify(current.workspace), 0, user.email, new Date().toISOString());
      audit(user, 'workspace.version_created', { id: result.lastInsertRowid, name: value.name });
      return send(response, 201, { id: result.lastInsertRowid });
    }
    if (path.startsWith('/api/versions/') && path.endsWith('/publish') && request.method === 'POST') {
      requireRole(user, ['admin', 'planner']);
      const versionId = Number(path.split('/')[3]);
      if (!db.prepare('SELECT id FROM workspace_versions WHERE id=?').get(versionId)) throw httpError(404, 'Version not found.');
      db.exec('BEGIN IMMEDIATE');
      try { db.prepare('UPDATE workspace_versions SET published=0').run(); db.prepare('UPDATE workspace_versions SET published=1 WHERE id=?').run(versionId); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
      audit(user, 'workspace.version_published', { id: versionId });
      return send(response, 200, { ok: true });
    }
    if (path === '/api/published' && request.method === 'GET') {
      const version = db.prepare('SELECT id,name,revision,payload,createdAt FROM workspace_versions WHERE published=1 ORDER BY id DESC LIMIT 1').get();
      return send(response, 200, { version: version ? { ...version, payload: JSON.parse(version.payload) } : null });
    }
    if (path === '/api/history' && request.method === 'GET') {
      requireRole(user, ['admin', 'planner']);
      return send(response, 200, { history: db.prepare('SELECT revision,actor,savedAt FROM history ORDER BY revision DESC LIMIT 50').all() });
    }
    if (path === '/api/history/restore' && request.method === 'POST') {
      requireRole(user, ['admin']);
      const value = await readBody(request);
      const entry = db.prepare('SELECT payload FROM history WHERE revision=?').get(value.targetRevision ?? -1);
      if (!entry) throw httpError(404, 'Saved version not found.');
      return send(response, 200, save(JSON.parse(entry.payload), value.revision, user));
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
