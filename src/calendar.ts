import { DAYS, PERIODS, type AcademicTerm, type CollegeData, type Session } from './types';

export type CalendarScope =
  | { facultyId?: string; groupId?: string; roomId?: string }
  | { type: 'faculty' | 'group' | 'room'; id: string }
  | { kind: 'faculty' | 'group' | 'room'; id: string };

type CalendarDate = [year: number, month: number, day: number];

const pad = (value: number) => String(value).padStart(2, '0');

function dateParts(value: string, label: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) throw new Error(`${label} must use the YYYY-MM-DD format.`);
  const result: CalendarDate = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(result[0], result[1] - 1, result[2]));
  if (check.getUTCFullYear() !== result[0] || check.getUTCMonth() !== result[1] - 1 || check.getUTCDate() !== result[2]) throw new Error(`${label} is not a valid calendar date.`);
  return result;
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const value = new Date(Date.UTC(date[0], date[1] - 1, date[2] + days));
  return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()];
}

function dateNumber(date: CalendarDate) {
  return Date.UTC(date[0], date[1] - 1, date[2]);
}

function localDateTime(date: CalendarDate, time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  return `${date[0]}${pad(date[1])}${pad(date[2])}T${pad(hours)}${pad(minutes)}00`;
}

function timeZoneParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

function timeZoneOffset(value: Date, timeZone: string) {
  const parts = timeZoneParts(value, timeZone);
  return (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - value.getTime()) / 60000;
}

/** Convert a local wall-clock date/time in an IANA zone to an instant without a date library. */
function zonedTimeToUtc(date: CalendarDate, hours: number, minutes: number, seconds: number, timeZone: string) {
  const wallClock = Date.UTC(date[0], date[1] - 1, date[2], hours, minutes, seconds);
  let instant = new Date(wallClock);
  for (let attempt = 0; attempt < 3; attempt++) {
    const corrected = wallClock - timeZoneOffset(instant, timeZone) * 60000;
    if (corrected === instant.getTime()) break;
    instant = new Date(corrected);
  }
  return instant;
}

function utcStamp(value: Date) {
  return `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}Z`;
}

function escapeText(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replaceAll('\r\n', '\\n').replaceAll('\n', '\\n').replaceAll('\r', '\\n');
}

function foldLine(line: string) {
  const folded: string[] = [];
  let remaining = line;
  let first = true;
  while (remaining.length) {
    const limit = first ? 75 : 74;
    let chunk = '';
    for (const character of remaining) {
      if (new TextEncoder().encode(chunk + character).length > limit) break;
      chunk += character;
    }
    if (!chunk) throw new Error('Unable to fold an ICS line.');
    folded.push(`${first ? '' : ' '}${chunk}`);
    remaining = remaining.slice(chunk.length);
    first = false;
  }
  return folded.join('\r\n');
}

function scopeValues(scope?: CalendarScope) {
  if (!scope) return {};
  if ('type' in scope) return scope.type === 'faculty' ? { facultyId: scope.id } : scope.type === 'group' ? { groupId: scope.id } : { roomId: scope.id };
  if ('kind' in scope) return scope.kind === 'faculty' ? { facultyId: scope.id } : scope.kind === 'group' ? { groupId: scope.id } : { roomId: scope.id };
  return scope;
}

export function filterCalendarSessions(data: CollegeData, sessions: Session[], scope?: CalendarScope) {
  const values = scopeValues(scope);
  return sessions.filter(session => {
    const course = data.courses.find(item => item.id === session.courseId);
    if (!course) return false;
    return (!values.facultyId || course.facultyId === values.facultyId) && (!values.groupId || course.groupId === values.groupId) && (!values.roomId || session.roomId === values.roomId);
  });
}

/** Export the weekly timetable as bounded recurring events for an academic term. */
export function exportSemesterIcs(data: CollegeData, sessions: Session[], term: AcademicTerm, scope?: CalendarScope) {
  const start = dateParts(term.startDate, 'Term start date');
  const end = dateParts(term.endDate, 'Term end date');
  if (dateNumber(start) > dateNumber(end)) throw new Error('The term end date must be on or after the start date.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: term.timeZone }).format(new Date());
  } catch {
    throw new Error(`Unknown time zone: ${term.timeZone}`);
  }
  const endUtc = zonedTimeToUtc(end, 23, 59, 59, term.timeZone);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ISchedule//College Timetable//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-TIMEZONE:${escapeText(term.timeZone)}`,
    `X-WR-CALNAME:${escapeText(`ISchedule ${term.department} ${term.academicYear} ${term.semester}`)}`,
  ];
  const stamp = utcStamp(new Date());
  for (const session of [...filterCalendarSessions(data, sessions, scope)].sort((a, b) => a.day - b.day || a.period - b.period || a.id.localeCompare(b.id))) {
    const course = data.courses.find(item => item.id === session.courseId);
    const period = PERIODS[session.period];
    const endingPeriod = course && PERIODS[session.period + course.duration - 1];
    if (!course || !period || !endingPeriod || session.day < 0 || session.day >= DAYS.length) continue;
    const startWeekday = (new Date(Date.UTC(start[0], start[1] - 1, start[2])).getUTCDay() + 6) % 7;
    const firstOffset = (session.day - startWeekday + 7) % 7;
    const occurrence = addDays(start, firstOffset);
    if (dateNumber(occurrence) > dateNumber(end)) continue;
    const room = data.rooms.find(item => item.id === session.roomId)?.name ?? 'Room unavailable';
    const group = data.groups.find(item => item.id === course.groupId)?.name ?? 'Student group';
    const faculty = data.faculty.find(item => item.id === course.facultyId)?.name ?? 'Faculty';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(session.id)}@ischedule`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${escapeText(term.timeZone)}:${localDateTime(occurrence, period.start)}`,
      `DTEND;TZID=${escapeText(term.timeZone)}:${localDateTime(occurrence, endingPeriod.end)}`,
      `RRULE:FREQ=WEEKLY;UNTIL=${utcStamp(endUtc)}`,
      `SUMMARY:${escapeText(`${course.code} · ${course.name}`)}`,
      `LOCATION:${escapeText(room)}`,
      `DESCRIPTION:${escapeText(`${group} · ${faculty}`)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export const exportScopedSemesterIcs = exportSemesterIcs;
