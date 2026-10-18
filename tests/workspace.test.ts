import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorkspace, STORAGE_KEY } from '../src/workspace';
import { createDemoData } from './fixtures/demo';

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null });
});

afterEach(() => vi.unstubAllGlobals());

describe('local workspace loading', () => {
  const emptyWorkspace = {
    version: 1,
    data: {
      courses: [], faculty: [], rooms: [], groups: [],
      preferences: { days: [0, 1, 2, 3, 4], preferMorning: true, balancedDays: true, avoidLastPeriod: true },
    },
    schedule: null,
  };

  it('starts fresh local storage with empty resources, default preferences, and no schedule', () => {
    const result = loadWorkspace();

    expect(result.workspace).toMatchObject(emptyWorkspace);
    expect(result.warning).toBe('');
  });

  it('falls back to an empty workspace when saved data cannot be read', () => {
    storage.set(STORAGE_KEY, '{invalid json');

    const result = loadWorkspace();

    expect(result.workspace).toMatchObject(emptyWorkspace);
    expect(result.warning).toBeTruthy();
    expect(result.warning).not.toMatch(/sample|demo/i);
  });

  it('preserves an existing saved workspace instead of replacing it with empty resources', () => {
    const saved = {
      version: 1,
      data: createDemoData(),
      schedule: {
        sessions: [{ id: 'saved-c1', courseId: 'c1', day: 1, period: 0, roomId: 'r1', locked: true }],
        unscheduled: [], quality: 100, generatedAt: '2027-01-04T09:00:00.000Z',
      },
    };
    storage.set(STORAGE_KEY, JSON.stringify(saved));

    const result = loadWorkspace();

    expect(result.workspace.data).toEqual(saved.data);
    expect(result.workspace.schedule?.sessions).toEqual(saved.schedule.sessions);
    expect(result.workspace.schedule?.generatedAt).toBe(saved.schedule.generatedAt);
    expect(result.warning).toBe('');
  });
});
