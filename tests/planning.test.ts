import { describe, expect, it } from 'vitest';
import { copyGroupSchedule, facultyWorkloads, moveSession, previewGroupCopy, roomUtilization } from '../src/planning';
import type { CollegeData, Session } from '../src/types';

function planningData(): CollegeData {
  return {
    courses: [
      { id: 'source-course', name: 'Source course', code: 'CS101', facultyId: 'f1', groupId: 'g1', weeklySessions: 1, duration: 1, roomType: 'lecture', color: 'sage' },
      { id: 'target-course', name: 'Target course', code: 'CS101', facultyId: 'f2', groupId: 'g2', weeklySessions: 1, duration: 1, roomType: 'lecture', color: 'blue' },
      { id: 'other-course', name: 'Other course', code: 'CS102', facultyId: 'f2', groupId: 'g1', weeklySessions: 1, duration: 1, roomType: 'lecture', color: 'peach' },
    ],
    faculty: [
      { id: 'f1', name: 'Faculty One', email: 'one@example.edu', department: 'CS', maxDailyPeriods: 5, unavailable: [] },
      { id: 'f2', name: 'Faculty Two', email: 'two@example.edu', department: 'CS', maxDailyPeriods: 5, unavailable: [] },
    ],
    rooms: [
      { id: 'r1', name: 'Room 1', building: 'A', capacity: 40, type: 'lecture' },
      { id: 'r2', name: 'Room 2', building: 'A', capacity: 40, type: 'lecture' },
    ],
    groups: [
      { id: 'g1', name: 'Group 1', department: 'CS', size: 30, semester: 1 },
      { id: 'g2', name: 'Group 2', department: 'CS', size: 30, semester: 1 },
    ],
    preferences: { days: [0, 1], preferMorning: false, balancedDays: false, avoidLastPeriod: false },
  };
}

describe('planning controls', () => {
  it('validates a move, locks it, and explains hard conflicts', () => {
    const data = planningData();
    const source: Session = { id: 'move-me', courseId: 'source-course', day: 0, period: 0, roomId: 'r1' };
    const other: Session = { id: 'already-there', courseId: 'other-course', day: 1, period: 1, roomId: 'r2' };
    const moved = moveSession(data, [source], source.id, { day: 1, period: 1 });
    const blocked = moveSession(data, [source, other], source.id, { day: 1, period: 1 });

    expect(moved.ok).toBe(true);
    expect(moved.session?.locked).toBe(true);
    expect(moved.session?.day).toBe(1);
    expect(blocked.ok).toBe(false);
    expect(blocked.issues).toContain('Group 1 has another class at this time.');
    expect(moveSession(data, [{ ...source, locked: true }], source.id, { day: 1, period: 1 }).issues[0]).toContain('locked');
  });

  it('previews explicit course-code mappings and uses a free room alternative', () => {
    const data = planningData();
    const source: Session = { id: 'source-session', courseId: 'source-course', day: 0, period: 0, roomId: 'r1' };
    const preview = previewGroupCopy(data, [source], 'g1', 'g2');

    expect(preview.valid).toBe(true);
    expect(preview.mappings).toEqual([expect.objectContaining({ sourceCode: 'CS101', targetCourseId: 'target-course', status: 'mapped' })]);
    expect(preview.proposedSessions[0].roomId).toBe('r2');
    expect(copyGroupSchedule(data, [source], 'g1', 'g2').ok).toBe(false);
    const copied = copyGroupSchedule(data, [source], 'g1', 'g2', true);
    expect(copied.ok).toBe(true);
    expect(copied.sessions).toHaveLength(2);
    expect(copied.sessions[0]).toEqual(source);
  });

  it('returns validation errors instead of overwriting a target timetable', () => {
    const data = planningData();
    const noAlternative = { ...data, rooms: [data.rooms[0]] };
    const source: Session = { id: 'source-session', courseId: 'source-course', day: 0, period: 0, roomId: 'r1' };
    const preview = previewGroupCopy(noAlternative, [source], 'g1', 'g2');
    const result = copyGroupSchedule(noAlternative, [source], 'g1', 'g2', true);

    expect(preview.valid).toBe(false);
    expect(preview.issues.join(' ')).toContain('already booked');
    expect(result.ok).toBe(false);
    expect(result.sessions).toEqual([source]);
  });

  it('reports workload and room utilization against enabled capacity', () => {
    const data = planningData();
    const sessions: Session[] = [{ id: 'source-session', courseId: 'source-course', day: 0, period: 0, roomId: 'r1' }];
    const faculty = facultyWorkloads(data, sessions)[0];
    const room = roomUtilization(data, sessions)[0];

    expect(faculty.periods).toBe(1);
    expect(faculty.capacityPeriods).toBe(10);
    expect(faculty.hours).toBe(1);
    expect(faculty.capacityHours).toBe(10);
    expect(room.occupiedPeriods).toBe(1);
    expect(room.capacityPeriods).toBe(14);
    expect(room.utilization).toBeCloseTo(1 / 14);
  });
});
