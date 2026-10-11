import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDirectory = resolve(process.env.ISCHEDULE_DATA_DIR || process.env.CAMPUSLY_DATA_DIR || 'server/data');
const backupDirectory = resolve(process.env.ISCHEDULE_BACKUP_DIR || process.env.CAMPUSLY_BACKUP_DIR || join(dataDirectory, 'backups'));
const currentSource = join(dataDirectory, 'ischedule.sqlite');
const legacySource = join(dataDirectory, 'campusly.sqlite');
const source = existsSync(currentSource) ? currentSource : legacySource;
if (!existsSync(source)) throw new Error(`Database not found at ${source}`);
mkdirSync(backupDirectory, { recursive: true });
const name = `ischedule-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.sqlite`;
const target = join(backupDirectory, name).replaceAll('\\', '/').replaceAll("'", "''");
const database = new DatabaseSync(source);
database.exec(`VACUUM INTO '${target}'`);
database.close();
console.log(`Backup written to ${join(backupDirectory, name)}`);
