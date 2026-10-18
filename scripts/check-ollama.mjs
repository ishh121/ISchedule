import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const model = process.env.OLLAMA_MODEL || process.env.OPENAI_MODEL || 'llama3.2:3b';
const timeout = 20_000;
// Loading a local model on CPU can exceed the ordinary service startup timeout.
const modelTimeout = 90_000;
const appTimeout = 75_000;

function localBase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('OLLAMA_BASE_URL must be a valid http:// or https:// URL.'); }
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (!['http:', 'https:'].includes(url.protocol) || !localHosts.has(url.hostname) || url.username || url.password) {
    throw new Error('Only a localhost Ollama endpoint is allowed (for example http://127.0.0.1:11434).');
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  return url.toString().replace(/\/$/, '');
}

async function jsonRequest(url, options, label, requestTimeout = timeout) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(requestTimeout) });
  } catch (error) {
    const timedOut = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    if (timedOut) throw new Error(`${label} timed out after ${requestTimeout / 1000} seconds. The local model may still be loading or processing the request.`);
    throw new Error(`${label} could not be reached. Is Ollama running locally? (${error instanceof Error ? error.message : 'network error'})`);
  }
  const body = await response.text();
  if (!response.ok) {
    if (label === 'ISchedule AI flow') {
      let detail = '';
      try { const parsed = JSON.parse(body); if (typeof parsed?.error === 'string') detail = `: ${parsed.error}`; } catch { /* A failed app response may not be JSON. */ }
      throw new Error(`${label} returned HTTP ${response.status}${detail}`);
    }
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }
  try { return JSON.parse(body); } catch { throw new Error(`${label} returned non-JSON data.`); }
}

function appWorkspace() {
  return {
    version: 1,
    data: {
      courses: [{ id: 'e2e-course', name: 'Local AI flow', code: 'AI101', facultyId: 'e2e-faculty', groupId: 'e2e-group', weeklySessions: 1, duration: 1, roomType: 'lecture', color: 'sage' }],
      faculty: [{ id: 'e2e-faculty', name: 'Local Faculty', email: 'faculty@example.invalid', department: 'Computer Science', maxDailyPeriods: 5, unavailable: [] }],
      rooms: [{ id: 'e2e-room', name: 'Local Room', building: 'Test Building', capacity: 30, type: 'lecture' }],
      groups: [{ id: 'e2e-group', name: 'Local Group', department: 'Computer Science', size: 20, semester: 1 }],
      preferences: { days: [0], preferMorning: true, balancedDays: true, avoidLastPeriod: true },
    },
    schedule: null,
  };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePort());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function waitForHealth(base, child) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (child.exitCode !== null) throw new Error('The isolated ISchedule server exited before it became ready.');
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* The server may still be binding its local port. */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
  }
  throw new Error('The isolated ISchedule server did not become ready in time.');
}

async function runAppFlow(ollamaRoot) {
  const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const serverBundle = join(repositoryRoot, 'dist-server', 'index.mjs');
  const dataDirectory = await mkdtemp(join(tmpdir(), 'ischedule-ollama-check-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const environment = { ...process.env, PORT: String(port), HOST: '127.0.0.1', PUBLIC_ORIGIN: base, ISCHEDULE_DATA_DIR: dataDirectory, NODE_ENV: 'test', OPENAI_API_KEY: 'ollama', OPENAI_BASE_URL: `${ollamaRoot}/v1`, OPENAI_MODEL: model, SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASSWORD: '', MAIL_FROM: '' };
  const child = spawn(process.execPath, ['--input-type=module', '-e', `process.loadEnvFile = undefined; await import(${JSON.stringify(pathToFileURL(serverBundle).href)});`], { cwd: repositoryRoot, env: environment, stdio: 'ignore' });
  try {
    await waitForHealth(base, child);
    const registration = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Isolated Ollama Check', email: 'ollama-check@example.invalid', password: 'isolated-test-password', role: 'planner' }), signal: AbortSignal.timeout(timeout) });
    if (!registration.ok) throw new Error(`The isolated app registration returned HTTP ${registration.status}.`);
    const cookie = registration.headers.get('set-cookie')?.split(';', 1)[0];
    if (!cookie) throw new Error('The isolated app did not return a session cookie.');
    const result = await jsonRequest(`${base}/api/ai/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ workspace: appWorkspace() }) }, 'ISchedule AI flow', appTimeout);
    if (!Array.isArray(result?.schedule?.sessions) || typeof result.schedule.generatedAt !== 'string') throw new Error('ISchedule AI flow returned no validated schedule.');
    if (result.schedule.sessions.length !== 1 || result.schedule.sessions[0].courseId !== 'e2e-course' || result.schedule.unscheduled?.length !== 0) throw new Error('ISchedule AI flow did not place the requested course using its exact ID.');
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    if (child.exitCode === null) await new Promise(resolveClose => child.once('close', resolveClose));
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const root = localBase(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
  const version = await jsonRequest(`${root}/api/version`, {}, 'Ollama /api/version');
  if (typeof version?.version !== 'string' || !version.version.trim()) throw new Error('Ollama /api/version did not include a version string.');
  console.log(`Ollama ${version.version} is reachable at ${root}.`);

  const completion = await jsonRequest(`${root}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ollama' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with exactly OK.' }], temperature: 0, max_tokens: 8 }),
  }, 'Ollama OpenAI-compatible chat', modelTimeout);
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Ollama OpenAI-compatible chat returned no assistant content.');
  console.log(`OpenAI-compatible chat responded using model ${model}.`);

  if (process.argv.includes('--app-flow')) {
    if (!existsSync(join(resolve(fileURLToPath(new URL('..', import.meta.url))), 'dist-server', 'index.mjs'))) throw new Error('The optional app flow needs a production server bundle. Run "npm run build" first.');
    await runAppFlow(root);
    console.log('Isolated ISchedule AI flow returned a validated schedule.');
  }
}

try {
  await main();
} catch (error) {
  console.error(`Ollama check failed: ${error instanceof Error ? error.message : 'unexpected error'}`);
  if (process.argv.includes('--app-flow')) console.error('If the two base checks passed, Ollama is reachable; use the app error above to diagnose the planning failure.');
  else console.error(`Try "ollama serve" and "ollama pull ${model}", then rerun npm run test:ollama.`);
  process.exitCode = 1;
}
