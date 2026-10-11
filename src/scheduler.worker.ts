import { generateSchedule } from './scheduler';
import type { CollegeData, Session } from './types';

self.onmessage = (event: MessageEvent<{ data: CollegeData; lockedSessions?: Session[] }>) => {
  try {
    const result = generateSchedule(event.data.data, progress => self.postMessage({ type: 'progress', progress }), Date.now(), 20, event.data.lockedSessions ?? []);
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Scheduling failed.' });
  }
};
