import { DAYS, PERIODS, type CollegeData, type Course, type ScheduleResult, type Session } from './types';

export function contiguous(period: number, duration: number) {
  if (!Number.isInteger(period) || !Number.isInteger(duration) || duration < 1 || period < 0 || period + duration > PERIODS.length) return false;
  for (let p = period; p < period + duration - 1; p++) {
    if (PERIODS[p].end !== PERIODS[p + 1].start) return false;
  }
  return true;
}

export function placementIssues(data: CollegeData, sessions: Session[], candidate: Session): string[] {
  const course = data.courses.find(c => c.id === candidate.courseId);
  if (!course) return ['Course no longer exists.'];
  const faculty = data.faculty.find(f => f.id === course.facultyId);
  const group = data.groups.find(g => g.id === course.groupId);
  const room = data.rooms.find(r => r.id === candidate.roomId);
  if (!faculty || !group || !room) return ['A required faculty member, student group, or room is missing.'];
  const issues: string[] = [];
  if (!Number.isInteger(candidate.day) || candidate.day < 0 || candidate.day >= DAYS.length || !data.preferences.days.includes(candidate.day)) issues.push('This teaching day is disabled.');
  if (!Number.isInteger(candidate.period) || !contiguous(candidate.period, course.duration)) issues.push('This session would cross a break or the end of the day.');
  if (room.type !== course.roomType) issues.push(`This course requires a ${course.roomType === 'lab' ? 'laboratory' : 'lecture room'}.`);
  if (room.capacity < group.size) issues.push(`The room needs at least ${group.size} seats.`);
  if (course.requiredFeatures?.some(feature => !room.features?.includes(feature))) issues.push(`The room needs: ${course.requiredFeatures.filter(feature => !room.features?.includes(feature)).join(', ')}.`);
  for (let p = candidate.period; p < candidate.period + course.duration; p++) {
    if (faculty.unavailable.includes(`${candidate.day}-${p}`)) { issues.push(`${faculty.name} is unavailable at this time.`); break; }
  }
  let dailyLoad = course.duration;
  for (const other of sessions) {
    if (other.id === candidate.id || other.day !== candidate.day) continue;
    const otherCourse = data.courses.find(c => c.id === other.courseId);
    if (!otherCourse) continue;
    if (otherCourse.facultyId === course.facultyId) dailyLoad += otherCourse.duration;
    if (other.courseId === course.id) issues.push('This course already has a session on this day.');
    const overlaps = candidate.period < other.period + otherCourse.duration && other.period < candidate.period + course.duration;
    if (!overlaps) continue;
    if (other.roomId === candidate.roomId) issues.push(`${room.name} is already booked.`);
    if (otherCourse.facultyId === course.facultyId) issues.push(`${faculty.name} is teaching another class.`);
    if (otherCourse.groupId === course.groupId) issues.push(`${group.name} has another class at this time.`);
  }
  if (dailyLoad > faculty.maxDailyPeriods) issues.push(`${faculty.name}'s daily teaching limit would be exceeded.`);
  return [...new Set(issues)];
}

export function validateSchedule(data: CollegeData, sessions: Session[]) {
  const errors = sessions.flatMap(session => placementIssues(data, sessions, session).map(message => ({ sessionId: session.id, message })));
  const ids = new Set<string>();
  for (const session of sessions) {
    if (ids.has(session.id)) errors.push({ sessionId: session.id, message: 'Duplicate session ID.' });
    ids.add(session.id);
  }
  for (const course of data.courses) {
    if (sessions.filter(s => s.courseId === course.id).length > course.weeklySessions) errors.push({ sessionId: course.id, message: 'Too many weekly sessions.' });
  }
  return errors;
}

function placements(data: CollegeData, course: Course, sessions: Session[], id: string) {
  const group = data.groups.find(g => g.id === course.groupId);
  const rooms = data.rooms.filter(r => r.type === course.roomType && r.capacity >= (group?.size ?? Infinity) && !(course.requiredFeatures?.some(feature => !r.features?.includes(feature))));
  const options: Session[] = [];
  for (const day of data.preferences.days) for (let period = 0; period < PERIODS.length; period++) {
    if (!contiguous(period, course.duration)) continue;
    for (const room of rooms) {
      const candidate = { id, courseId: course.id, day, period, roomId: room.id };
      if (placementIssues(data, sessions, candidate).length === 0) options.push(candidate);
    }
  }
  return options;
}

function dailyFacultyLoad(data: CollegeData, sessions: Session[], facultyId: string, day: number) {
  return sessions.reduce((total, session) => {
    if (session.day !== day) return total;
    const course = data.courses.find(item => item.id === session.courseId);
    return course?.facultyId === facultyId ? total + course.duration : total;
  }, 0);
}

export function facultyDailyLoads(data: CollegeData, sessions: Session[], facultyId: string) {
  return data.preferences.days.map(day => dailyFacultyLoad(data, sessions, facultyId, day));
}

function standardDeviation(values: number[]) {
  if (!values.length) return 0;
  const average = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length);
}

export function facultyLoadPenalty(data: CollegeData, sessions: Session[], facultyId: string) {
  return standardDeviation(facultyDailyLoads(data, sessions, facultyId));
}

export function scorePlacement(data: CollegeData, sessions: Session[], candidate: Session, random: () => number = () => 0) {
  const course = data.courses.find(c => c.id === candidate.courseId)!;
  const groupSessions = sessions.filter(s => data.courses.find(c => c.id === s.courseId)?.groupId === course.groupId && s.day === candidate.day);
  let score = random() * 2.2;
  if (data.preferences.balancedDays) score += groupSessions.reduce((n, s) => n + data.courses.find(c => c.id === s.courseId)!.duration, 0) * 2;
  if (data.preferences.preferMorning) score += candidate.period * 0.28;
  if (data.preferences.avoidFirstPeriod && candidate.period === 0) score += 3;
  if (data.preferences.avoidLastPeriod && candidate.period + course.duration === PERIODS.length) score += 3;
  const faculty = data.faculty.find(item => item.id === course.facultyId);
  if (faculty?.preferred?.length && !faculty.preferred.includes(`${candidate.day}-${candidate.period}`)) score += 0.35;
  // Prefer adjacent classes to isolated periods, keeping student days compact.
  if (data.preferences.avoidGaps) {
    const withCandidate = [...groupSessions, candidate].sort((a, b) => a.period - b.period);
    for (let index = 1; index < withCandidate.length; index++) {
      const previous = withCandidate[index - 1];
      const previousCourse = data.courses.find(item => item.id === previous.courseId);
      const gap = withCandidate[index].period - (previous.period + (previousCourse?.duration ?? 1));
      score += Math.max(0, gap) * 0.55;
    }
  } else if (groupSessions.some(s => s.period + data.courses.find(c => c.id === s.courseId)!.duration === candidate.period || candidate.period + course.duration === s.period)) score -= 1.4;
  if (data.preferences.balanceFacultyLoad) {
    const withCandidate = [...sessions, candidate];
    score += facultyLoadPenalty(data, withCandidate, course.facultyId) * 0.8;
  }
  return score;
}

function nextSessionId(course: Course, sessions: Session[]) {
  let index = sessions.filter(session => session.courseId === course.id).length;
  let id = `${course.id}-${index}`;
  while (sessions.some(session => session.id === id)) id = `${course.id}-${++index}`;
  return id;
}

export function scheduleQuality(data: CollegeData, sessions: Session[]) {
  const requested = data.courses.reduce((n, c) => n + c.weeklySessions, 0);
  if (!requested || !sessions.length) return 0;
  let penalty = 0;
  for (const group of data.groups) {
    const loads = data.preferences.days.map(day => sessions.filter(s => s.day === day && data.courses.find(c => c.id === s.courseId)?.groupId === group.id).reduce((n, s) => n + data.courses.find(c => c.id === s.courseId)!.duration, 0));
    if (data.preferences.balancedDays && loads.length) penalty += (Math.max(...loads) - Math.min(...loads)) * 0.7;
  }
  if (data.preferences.avoidLastPeriod) penalty += sessions.filter(s => s.period + data.courses.find(c => c.id === s.courseId)!.duration === PERIODS.length).length * 0.6;
  if (data.preferences.avoidFirstPeriod) penalty += sessions.filter(s => s.period === 0).length * 0.6;
  if (data.preferences.preferMorning) penalty += sessions.filter(s => s.period >= 4).length * 0.12;
  if (data.preferences.avoidGaps) for (const group of data.groups) for (const day of data.preferences.days) {
    const groupSessions = sessions.filter(s => s.day === day && data.courses.find(c => c.id === s.courseId)?.groupId === group.id).sort((a, b) => a.period - b.period);
    for (let index = 1; index < groupSessions.length; index++) penalty += Math.max(0, groupSessions[index].period - (groupSessions[index - 1].period + (data.courses.find(c => c.id === groupSessions[index - 1].courseId)?.duration ?? 1))) * 0.4;
  }
  if (data.preferences.balanceFacultyLoad) for (const faculty of data.faculty) penalty += facultyLoadPenalty(data, sessions, faculty.id) * 0.55;
  return Math.max(0, Math.round((sessions.length / requested) * Math.max(0, 100 - penalty)));
}

function unscheduledReason(data: CollegeData, course: Course) {
  const group = data.groups.find(g => g.id === course.groupId);
  if (!group || !data.faculty.some(f => f.id === course.facultyId)) return 'Assign an existing faculty member and student group.';
  if (!data.rooms.some(r => r.type === course.roomType && r.capacity >= group.size && !(course.requiredFeatures?.some(feature => !r.features?.includes(feature))))) return `No compatible ${course.roomType === 'lab' ? 'lab' : 'lecture room'} has the required capacity and features.`;
  if (course.weeklySessions > data.preferences.days.length) return 'More sessions requested than teaching days. Reduce sessions or enable more days.';
  if (!placements(data, course, [], 'check').length) return 'No available slot meets faculty availability, daily limits, and session duration.';
  return 'No compatible free slot was found. Try another run, add resources, or relax faculty availability.';
}

/** Minimum-remaining-values constraint search with randomized restarts and soft-constraint scoring. */
export function generateSchedule(data: CollegeData, onProgress?: (percent: number) => void, seed = Date.now(), attempts = 20, initialSessions: Session[] = []): ScheduleResult {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const requested = data.courses.reduce((n, c) => n + c.weeklySessions, 0);
  const lockedSessions = initialSessions.map(session => ({ ...session, locked: true }));
  const lockedIssues = validateSchedule(data, lockedSessions);
  if (lockedIssues.length) throw new Error(`A locked session is invalid: ${lockedIssues[0].message}`);
  const lockedCounts = new Map<string, number>();
  for (const session of lockedSessions) lockedCounts.set(session.courseId, (lockedCounts.get(session.courseId) ?? 0) + 1);
  for (const [courseId, count] of lockedCounts) {
    const course = data.courses.find(item => item.id === courseId);
    if (course && count > course.weeklySessions) throw new Error(`${course.name} has more locked sessions than its weekly plan.`);
  }
  let best: Session[] = [];
  let bestQuality = -1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const sessions: Session[] = lockedSessions.map(session => ({ ...session }));
    const remaining = new Map(data.courses.map(c => [c.id, Math.max(0, c.weeklySessions - (lockedCounts.get(c.id) ?? 0))]));
    while ([...remaining.values()].some(n => n > 0)) {
      let chosen: { course: Course; options: Session[] } | undefined;
      for (const course of data.courses) {
        const left = remaining.get(course.id)!;
        if (left <= 0) continue;
         const options = placements(data, course, sessions, nextSessionId(course, sessions));
        if (!options.length) { remaining.set(course.id, 0); continue; }
        if (!chosen || options.length < chosen.options.length || (options.length === chosen.options.length && random() < 0.35)) chosen = { course, options };
      }
      if (!chosen) break;
      const ranked = chosen.options.map(option => ({ option, score: scorePlacement(data, sessions, option, random) })).sort((a, b) => a.score - b.score);
      sessions.push(ranked[0].option);
      remaining.set(chosen.course.id, remaining.get(chosen.course.id)! - 1);
    }
    const quality = scheduleQuality(data, sessions);
    if (sessions.length > best.length || (sessions.length === best.length && quality > bestQuality)) { best = sessions; bestQuality = quality; }
    onProgress?.(Math.round(((attempt + 1) / attempts) * 100));
    if (best.length === requested && quality >= 97) break;
  }
  onProgress?.(100);
  return summarizeSchedule(data, best);
}

export function summarizeSchedule(data: CollegeData, sessions: Session[], generatedAt = new Date().toISOString()): ScheduleResult {
  const unscheduled = data.courses.flatMap(course => {
    const count = course.weeklySessions - sessions.filter(s => s.courseId === course.id).length;
    return count > 0 ? [{ courseId: course.id, count, reason: unscheduledReason(data, course) }] : [];
  });
  return { sessions, unscheduled, quality: scheduleQuality(data, sessions), generatedAt };
}

export function exportCsv(data: CollegeData, sessions: Session[]) {
  const cell = (value: string | number) => {
    const text = String(value);
    return `"${(/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
  };
  const rows: (string | number)[][] = [['Day', 'Start', 'End', 'Course code', 'Course', 'Student group', 'Faculty', 'Room']];
  for (const s of [...sessions].sort((a, b) => a.day - b.day || a.period - b.period)) {
    const c = data.courses.find(c => c.id === s.courseId)!;
    rows.push([DAYS[s.day], PERIODS[s.period].start, PERIODS[s.period + c.duration - 1].end, c.code, c.name, data.groups.find(g => g.id === c.groupId)?.name ?? '', data.faculty.find(f => f.id === c.facultyId)?.name ?? '', data.rooms.find(r => r.id === s.roomId)?.name ?? '']);
  }
  return rows.map(row => row.map(cell).join(',')).join('\r\n');
}

export function exportIcs(data: CollegeData, sessions: Session[], week = new Date()) {
  const monday = new Date(week.getFullYear(), week.getMonth(), week.getDate());
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? 1 : 8 - day));
  const stamp = (date: Date, time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const value = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
    const pad = (number: number) => String(number).padStart(2, '0');
    return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}T${pad(value.getHours())}${pad(value.getMinutes())}00`;
  };
  const escape = (value: string) => value.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replaceAll('\n', '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ISchedule//College Timetable//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:ISchedule timetable'];
  for (const session of [...sessions].sort((a, b) => a.day - b.day || a.period - b.period)) {
    const course = data.courses.find(item => item.id === session.courseId);
    if (!course) continue;
    const end = session.period + course.duration - 1;
    const startDate = new Date(monday);
    startDate.setDate(monday.getDate() + session.day);
    const room = data.rooms.find(item => item.id === session.roomId)?.name ?? 'Room unavailable';
    const group = data.groups.find(item => item.id === course.groupId)?.name ?? 'Student group';
    const faculty = data.faculty.find(item => item.id === course.facultyId)?.name ?? 'Faculty';
    lines.push('BEGIN:VEVENT', `UID:${escape(session.id)}@ischedule`, `DTSTAMP:${stamp(new Date(), '00:00')}`, `DTSTART:${stamp(startDate, PERIODS[session.period].start)}`, `DTEND:${stamp(startDate, PERIODS[end].end)}`, `SUMMARY:${escape(`${course.code} · ${course.name}`)}`, `LOCATION:${escape(room)}`, `DESCRIPTION:${escape(`${group} · ${faculty}`)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
