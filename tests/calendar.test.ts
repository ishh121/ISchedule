import { describe, expect, it } from 'vitest';
import { exportSemesterIcs } from '../src/calendar';
import { createDemoData } from '../src/seed';
import type { AcademicTerm, Session } from '../src/types';

const term: AcademicTerm = {
  academicYear: '2026–27',
  semester: 'Spring',
  department: 'Computer Science',
  startDate: '2027-03-01',
  endDate: '2027-03-31',
  timeZone: 'America/New_York',
};

describe('semester calendar export', () => {
  it('creates weekly events with local TZID start times and a UTC term boundary', () => {
    const data = createDemoData();
    const session: Session = { id: 'semester-c1', courseId: 'c1', day: 1, period: 0, roomId: 'r1' };
    const ics = exportSemesterIcs(data, [session], term);

    expect(ics).toContain('DTSTART;TZID=America/New_York:20270302T090000');
    expect(ics).toContain('DTEND;TZID=America/New_York:20270302T100000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;UNTIL=20270401T035959Z');
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    expect(ics).toContain('X-WR-TIMEZONE:America/New_York');
    expect(ics).toContain('DTSTART;TZID=');
    expect(ics).not.toContain('DTSTART:2027');
  });

  it('scopes events by faculty, student group, and room', () => {
    const data = createDemoData();
    const sessions: Session[] = [
      { id: 'group-a', courseId: 'c1', day: 0, period: 0, roomId: 'r1' },
      { id: 'group-b', courseId: 'c7', day: 0, period: 1, roomId: 'r2' },
    ];

    expect((exportSemesterIcs(data, sessions, term, { facultyId: 'f1' }).match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect((exportSemesterIcs(data, sessions, term, { groupId: 'g1' }).match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect((exportSemesterIcs(data, sessions, term, { type: 'room', id: 'r1' }).match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
  });

  it('escapes text and folds long UTF-8 lines at the ICS byte limit', () => {
    const data = createDemoData();
    const course = data.courses.find(item => item.id === 'c1')!;
    course.name = `Algorithms, planning; ${'é'.repeat(90)}\nnext line`;
    const ics = exportSemesterIcs(data, [{ id: 'folded', courseId: course.id, day: 0, period: 0, roomId: 'r1' }], term);

    expect(ics).toContain('SUMMARY:CS201 · Algorithms\\, planning\\;');
    for (const line of ics.split('\r\n').filter(Boolean)) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
