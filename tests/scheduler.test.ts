import { describe, expect, it } from 'vitest';
import { createDemoData } from '../src/seed';
import { contiguous, exportCsv, exportIcs, generateSchedule, placementIssues, validateSchedule } from '../src/scheduler';
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
});
