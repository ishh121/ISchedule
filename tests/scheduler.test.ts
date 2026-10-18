import { describe, expect, it } from 'vitest';
import { createDemoData } from './fixtures/demo';
import { contiguous, exportCsv, exportIcs, facultyDailyLoads, facultyLoadPenalty, generateSchedule, placementIssues, scorePlacement, validateSchedule } from '../src/scheduler';
import type { Session } from '../src/types';

describe('timetable scheduler', () => {
  it('understands breaks when checking consecutive periods', () => {
    expect(contiguous(0, 2)).toBe(true);
    expect(contiguous(1, 2)).toBe(false);
    expect(contiguous(5, 3)).toBe(false);
  });

  it('generates a schedule without hard conflicts for the demo workspace', () => {
    const data = createDemoData();
    const result = generateSchedule(data, undefined, 42, 8);

    expect(result.sessions.length).toBeGreaterThan(0);
    expect(validateSchedule(data, result.sessions)).toEqual([]);
    expect(result.sessions.every(session => data.preferences.days.includes(session.day))).toBe(true);
  });

  it('preserves valid locked sessions during regeneration', () => {
    const data = createDemoData();
    const locked: Session = { id: 'c1-1', courseId: 'c1', day: 1, period: 0, roomId: 'r1', locked: true };
    const result = generateSchedule(data, undefined, 7, 8, [locked]);
    const preserved = result.sessions.find(session => session.id === locked.id);

    expect(preserved).toEqual(locked);
    expect(validateSchedule(data, result.sessions)).toEqual([]);
  });

  it('rejects a locked placement that conflicts with a faculty member', () => {
    const data = createDemoData();
    const locked: Session = { id: 'blocked-c1', courseId: 'c1', day: 0, period: 6, roomId: 'r1', locked: true };

    expect(() => generateSchedule(data, undefined, 8, 2, [locked])).toThrow('A locked session is invalid');
    expect(placementIssues(data, [], locked)).toContain('Dr. Olivia Bennett is unavailable at this time.');
  });

  it('exports human-readable CSV with the expected columns', () => {
    const data = createDemoData();
    const session: Session = { id: 'csv-c1', courseId: 'c1', day: 1, period: 0, roomId: 'r1' };
    const csv = exportCsv(data, [session]);

    expect(csv.split('\r\n')[0]).toBe('"Day","Start","End","Course code","Course","Student group","Faculty","Room"');
    expect(csv).toContain('"Tuesday","09:00","10:00","CS201"');
  });

  it('exports a calendar event with course, room, and group details', () => {
    const data = createDemoData();
    const ics = exportIcs(data, [{ id: 'ics-c1', courseId: 'c1', day: 1, period: 0, roomId: 'r1' }], new Date(2027, 0, 4));

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:CS201 · Data Structures');
    expect(ics).toContain('LOCATION:Room 101');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('scores first-period avoidance without turning it into a hard constraint', () => {
    const data = createDemoData();
    data.preferences = { ...data.preferences, avoidFirstPeriod: true };
    const later = { id: 'later', courseId: 'c1', day: 1, period: 1, roomId: 'r1' };
    const first = { ...later, id: 'first', period: 0 };

    expect(scorePlacement(data, [], first)).toBeGreaterThan(scorePlacement(data, [], later));
    expect(placementIssues(data, [], first)).toEqual([]);
  });

  it('balances faculty daily workload when the preference is enabled', () => {
    const data = createDemoData();
    data.preferences = { ...data.preferences, balanceFacultyLoad: true };
    const concentrated: Session[] = [
      { id: 'one', courseId: 'c1', day: 0, period: 0, roomId: 'r1' },
      { id: 'two', courseId: 'c1', day: 0, period: 1, roomId: 'r1' },
    ];
    const distributed: Session[] = [
      { id: 'one', courseId: 'c1', day: 0, period: 0, roomId: 'r1' },
      { id: 'two', courseId: 'c1', day: 1, period: 0, roomId: 'r1' },
    ];

    expect(facultyDailyLoads(data, concentrated, 'f1')).toEqual([2, 0, 0, 0, 0]);
    expect(facultyLoadPenalty(data, distributed, 'f1')).toBeLessThan(facultyLoadPenalty(data, concentrated, 'f1'));
    const candidate = { id: 'candidate', courseId: 'c1', day: 2, period: 0, roomId: 'r1' };
    expect(scorePlacement(data, distributed, candidate)).toBeLessThan(scorePlacement(data, concentrated, candidate));
  });

  it('counts real gaps when avoidGaps is enabled', () => {
    const data = createDemoData();
    const sessions: Session[] = [
      { id: 'morning', courseId: 'c1', day: 1, period: 0, roomId: 'r1' },
      { id: 'late', courseId: 'c2', day: 1, period: 2, roomId: 'r2' },
    ];
    const compact = { ...data, preferences: { ...data.preferences, avoidGaps: true } };
    const withoutGapPreference = { ...data, preferences: { ...data.preferences, avoidGaps: false } };
    const candidate = { id: 'candidate', courseId: 'c3', day: 1, period: 4, roomId: 'r1' };

    expect(scorePlacement(compact, sessions, candidate)).toBeGreaterThan(scorePlacement(withoutGapPreference, sessions, candidate));
  });
});
