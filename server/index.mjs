import { resolve } from 'node:path';
import { createApplication } from './app.mjs';

const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || '127.0.0.1';
const { server, close } = createApplication({
    dataDirectory: resolve(process.env.ISCHEDULE_DATA_DIR || process.env.CAMPUSLY_DATA_DIR || 'server/data'),
  publicDirectory: resolve('dist'),
  publicOrigin: process.env.PUBLIC_ORIGIN,
});
server.listen(port, host, () => console.log(`ISchedule listening at http://${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { close(); });
