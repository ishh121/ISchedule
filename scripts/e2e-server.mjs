import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const serverBundle = join(repositoryRoot, 'dist-server', 'index.mjs');
const frontend = join(repositoryRoot, 'dist', 'index.html');

if (process.argv[2] === '--server-child') {
  // server/index.mjs normally loads .env. E2E must not inherit developer mail,
  // model, or database settings, so the parent supplies the complete test env.
  try { process.loadEnvFile = undefined; } catch { /* Node exposes this as a read-only property on some versions. */ }
  await import(pathToFileURL(serverBundle).href);
} else {
  if (!existsSync(serverBundle) || !existsSync(frontend)) {
    console.error('E2E server cannot start because the production bundle is missing. Run "npm run build" first.');
    process.exitCode = 1;
  } else {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'ischedule-e2e-'));
    const port = process.env.E2E_PORT || '4180';
    const safeEnvironment = { ...process.env };
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']) delete safeEnvironment[key];
    Object.assign(safeEnvironment, {
      PORT: port,
      HOST: '127.0.0.1',
      PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      ISCHEDULE_DATA_DIR: dataDirectory,
      NODE_ENV: 'test',
      // Keep dotenv-style loaders from filling test processes with developer credentials.
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      MAIL_FROM: '',
      OPENAI_API_KEY: '',
      OPENAI_BASE_URL: '',
      OPENAI_MODEL: '',
    });

    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--server-child'], {
      cwd: repositoryRoot,
      env: safeEnvironment,
      stdio: 'inherit',
    });
    let finalized = false;
    const finalize = async (code) => {
      if (finalized) return;
      finalized = true;
      await rm(dataDirectory, { recursive: true, force: true });
      process.exitCode = code;
    };

    child.once('error', error => {
      console.error(`E2E server process failed: ${error.message}`);
      void finalize(1);
    });
    child.once('close', (code, signal) => {
      void finalize(code ?? (signal ? 1 : 0));
    });

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        if (!finalized && child.exitCode === null) child.kill(signal);
      });
    }
  }
}
