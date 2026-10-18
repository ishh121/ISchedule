import { DAYS, PERIODS, type CollegeData, type Session } from './types';
import { placementIssues } from './scheduler';

export interface MoveTarget { day: number; period: number; roomId?: string }

export interface PlanningChange {
  ok: boolean;
  sessions: Session[];
  issues: string[];
  message: string;
  session?: Session;
}

function unchanged(sessions: Session[], issues: string[], message: string): PlanningChange {
  return { ok: false, sessions, issues: [...new Set(issues)], message };
}

export function validateSessionMove(data: CollegeData, sessions: Session[], sessionId: string, target: MoveTarget) {
  const current = sessions.find(session => session.id === sessionId);
  if (!current) return ['This session is no longer in the timetable.'];
  if (current.locked) return ['This session is locked. Unlock it before moving it.'];
  const candidate: Session = { ...current, day: target.day, period: target.period, roomId: target.roomId ?? current.roomId };
  return placementIssues(data, sessions.filter(session => session.id !== sessionId), candidate);
}

/** Validate and apply a drag/drop move. A successful manual move becomes locked. */
export function moveSession(data: CollegeData, sessions: Session[], sessionId: string, target: MoveTarget): PlanningChange {
  const current = sessions.find(session => session.id === sessionId);
  const issues = validateSessionMove(data, sessions, sessionId, target);
  if (!current) return unchanged(sessions, issues, issues[0]);
  if (issues.length) return unchanged(sessions, issues, `Session was not moved: ${issues.join(' ')}`);
  const moved: Session = { ...current, day: target.day, period: target.period, roomId: target.roomId ?? current.roomId, locked: true };
  return { ok: true, sessions: sessions.map(session => session.id === sessionId ? moved : session), issues: [], message: 'Session moved and locked for future generations.', session: moved };
}

export const applySessionMove = moveSession;
export const validateMove = validateSessionMove;

export interface GroupCopyMapping {
  sourceCourseId: string;
  sourceCode: string;
  targetCourseId?: string;
  targetCode?: string;
  status: 'mapped' | 'missing' | 'ambiguous' | 'invalid';
  message?: string;
}

export interface GroupCopyPreview {
  sourceGroupId: string;
  targetGroupId: string;
  mappings: GroupCopyMapping[];
  proposedSessions: Session[];
  issues: string[];
  valid: boolean;
}

function compatibleRooms(data: CollegeData, courseId: string) {
  const course = data.courses.find(item => item.id === courseId);
  const group = course && data.groups.find(item => item.id === course.groupId);
  if (!course || !group) return [];
  return data.rooms.filter(room => room.type === course.roomType && room.capacity >= group.size && !(course.requiredFeatures?.some(feature => !room.features?.includes(feature))));
}

function nextCopyId(sourceId: string, targetGroupId: string, sessions: Session[]) {
  const base = `${sourceId}-copy-${targetGroupId}`;
  let id = base;
  let index = 2;
  while (sessions.some(session => session.id === id)) id = `${base}-${index++}`;
  return id;
}

/** Build a non-destructive, explicit course-code mapping before copying a group timetable. */
export function previewGroupCopy(data: CollegeData, sessions: Session[], sourceGroupId: string, targetGroupId: string): GroupCopyPreview {
  const issues: string[] = [];
  const sourceCourses = data.courses.filter(course => course.groupId === sourceGroupId && sessions.some(session => session.courseId === course.id));
  const mappings: GroupCopyMapping[] = sourceCourses.map(sourceCourse => {
    const matches = data.courses.filter(course => course.groupId === targetGroupId && course.code === sourceCourse.code);
    if (!matches.length) return { sourceCourseId: sourceCourse.id, sourceCode: sourceCourse.code, status: 'missing', message: `No target course matches code ${sourceCourse.code}.` };
    if (matches.length > 1) return { sourceCourseId: sourceCourse.id, sourceCode: sourceCourse.code, status: 'ambiguous', message: `Target group has more than one course with code ${sourceCourse.code}.` };
    return { sourceCourseId: sourceCourse.id, sourceCode: sourceCourse.code, targetCourseId: matches[0].id, targetCode: matches[0].code, status: 'mapped' };
  });
  if (!sourceCourses.length) issues.push('The source group has no scheduled sessions to copy.');
  for (const mapping of mappings) if (mapping.message) issues.push(mapping.message);
  if (sourceGroupId === targetGroupId) issues.push('Choose a different target group; copying onto the source group is unsafe.');
  const targetGroup = data.groups.find(group => group.id === targetGroupId);
  if (!targetGroup) issues.push('The target student group no longer exists.');
  const proposed: Session[] = [];
  for (const mapping of mappings) {
    if (mapping.status !== 'mapped' || !mapping.targetCourseId) continue;
    const sourceCourse = data.courses.find(course => course.id === mapping.sourceCourseId);
    const targetCourse = data.courses.find(course => course.id === mapping.targetCourseId);
    if (!sourceCourse || !targetCourse) continue;
    const sourceSessions = sessions.filter(session => session.courseId === sourceCourse.id);
    const existingTargetCount = sessions.filter(session => session.courseId === targetCourse.id).length;
    if (existingTargetCount + sourceSessions.length > targetCourse.weeklySessions) {
      const message = `${targetCourse.code} would exceed its ${targetCourse.weeklySessions}-session weekly plan.`;
      mappings.find(item => item.sourceCourseId === sourceCourse.id)!.status = 'invalid';
      mappings.find(item => item.sourceCourseId === sourceCourse.id)!.message = message;
      issues.push(message);
      continue;
    }
    for (const sourceSession of sourceSessions) {
      const rooms = compatibleRooms(data, targetCourse.id).sort((a, b) => Number(a.id !== sourceSession.roomId) - Number(b.id !== sourceSession.roomId));
      let placed: Session | undefined;
      let lastIssues: string[] = [];
      for (const room of rooms) {
        const candidate: Session = { id: nextCopyId(sourceSession.id, targetGroupId, [...sessions, ...proposed]), courseId: targetCourse.id, day: sourceSession.day, period: sourceSession.period, roomId: room.id };
        const candidateIssues = placementIssues(data, [...sessions, ...proposed], candidate);
        if (!candidateIssues.length) { placed = candidate; break; }
        lastIssues = candidateIssues;
      }
      if (!placed) {
        const message = `Could not copy ${sourceCourse.code} on ${DAYS[sourceSession.day]} period ${sourceSession.period + 1}: ${lastIssues.join(' ') || 'no compatible room is available.'}`;
        issues.push(message);
      } else proposed.push(placed);
    }
  }
  const valid = issues.length === 0 && proposed.length === sourceCourses.reduce((total, course) => total + sessions.filter(session => session.courseId === course.id).length, 0);
  return { sourceGroupId, targetGroupId, mappings, proposedSessions: proposed, issues: [...new Set(issues)], valid };
}

export function copyGroupSchedule(data: CollegeData, sessions: Session[], sourceGroupId: string, targetGroupId: string, confirmed = false): PlanningChange & { preview: GroupCopyPreview } {
  const preview = previewGroupCopy(data, sessions, sourceGroupId, targetGroupId);
  if (!confirmed) return { ...unchanged(sessions, preview.issues, 'Review the copy preview and confirm before applying it.'), preview };
  if (!preview.valid) return { ...unchanged(sessions, preview.issues, 'The group timetable was not copied because the preview has validation errors.'), preview };
  return { ok: true, sessions: [...sessions, ...preview.proposedSessions], issues: [], message: `Copied ${preview.proposedSessions.length} session${preview.proposedSessions.length === 1 ? '' : 's'} after confirming the course-code mapping.`, preview };
}

export interface FacultyWorkload {
  facultyId: string;
  facultyName: string;
  periods: number;
  hours: number;
  capacityPeriods: number;
  capacityHours: number;
  utilization: number;
}

export interface RoomUtilization {
  roomId: string;
  roomName: string;
  occupiedPeriods: number;
  occupiedHours: number;
  capacityPeriods: number;
  capacityHours: number;
  utilization: number;
}

function minutes(time: string) {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

function courseMinutes(courseDuration: number, startPeriod: number) {
  return Array.from({ length: courseDuration }, (_, offset) => {
    const period = PERIODS[startPeriod + offset];
    return period ? minutes(period.end) - minutes(period.start) : 0;
  }).reduce((total, value) => total + value, 0);
}

function availableFacultyCapacity(data: CollegeData, facultyId: string) {
  const faculty = data.faculty.find(item => item.id === facultyId);
  if (!faculty) return { periods: 0, minutes: 0 };
  return data.preferences.days.reduce((capacity, day) => {
    const available = PERIODS.map((period, periodIndex) => ({ period, periodIndex })).filter(item => !faculty.unavailable.includes(`${day}-${item.periodIndex}`)).slice(0, faculty.maxDailyPeriods);
    return { periods: capacity.periods + available.length, minutes: capacity.minutes + available.reduce((total, item) => total + minutes(item.period.end) - minutes(item.period.start), 0) };
  }, { periods: 0, minutes: 0 });
}

export function facultyWorkloads(data: CollegeData, sessions: Session[]): FacultyWorkload[] {
  return data.faculty.map(faculty => {
    const facultySessions = sessions.filter(session => data.courses.find(course => course.id === session.courseId)?.facultyId === faculty.id);
    const periods = facultySessions.reduce((total, session) => total + (data.courses.find(course => course.id === session.courseId)?.duration ?? 0), 0);
    const hours = facultySessions.reduce((total, session) => total + courseMinutes(data.courses.find(course => course.id === session.courseId)?.duration ?? 0, session.period), 0) / 60;
    const capacity = availableFacultyCapacity(data, faculty.id);
    return { facultyId: faculty.id, facultyName: faculty.name, periods, hours, capacityPeriods: capacity.periods, capacityHours: capacity.minutes / 60, utilization: capacity.minutes ? (hours * 60) / capacity.minutes : 0 };
  });
}

export function roomUtilization(data: CollegeData, sessions: Session[]): RoomUtilization[] {
  const capacityPeriods = data.preferences.days.length * PERIODS.length;
  const capacityMinutes = data.preferences.days.reduce((total) => total + PERIODS.reduce((dayTotal, period) => dayTotal + minutes(period.end) - minutes(period.start), 0), 0);
  return data.rooms.map(room => {
    const roomSessions = sessions.filter(session => session.roomId === room.id);
    const occupiedPeriods = roomSessions.reduce((total, session) => total + (data.courses.find(course => course.id === session.courseId)?.duration ?? 0), 0);
    const occupiedHours = roomSessions.reduce((total, session) => total + courseMinutes(data.courses.find(course => course.id === session.courseId)?.duration ?? 0, session.period), 0) / 60;
    return { roomId: room.id, roomName: room.name, occupiedPeriods, occupiedHours, capacityPeriods, capacityHours: capacityMinutes / 60, utilization: capacityMinutes ? (occupiedHours * 60) / capacityMinutes : 0 };
  });
}
