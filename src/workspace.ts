import { COLORS, DAYS, PERIODS, type CollegeData, type SavedWorkspace, type Session } from './types';
import { summarizeSchedule, validateSchedule } from './scheduler';
import { createDemoData } from './seed';

export const STORAGE_KEY = 'ischedule.workspace.v1';
const LEGACY_STORAGE_KEY = 'campusly.workspace.v1';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const integer = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const roomType = (value: unknown) => value === 'lecture' || value === 'lab';

/** Validate imported and edited data before it reaches the constraint solver. */
export function dataIssues(value: unknown): string[] {
  if (!object(value)) return ['Workspace data must be an object.'];
  const issues: string[] = [];
  for (const key of ['courses', 'faculty', 'rooms', 'groups'] as const) {
    const rows = value[key];
    if (!Array.isArray(rows) || rows.length > 500 || rows.some(row => !object(row))) return [`Invalid ${key} collection (maximum 500 records).`];
    if (rows.some(row => !text(row.id) || !text(row.name))) issues.push(`Every ${key} record needs an ID and a name (up to 200 characters).`);
    if (new Set(rows.map(row => row.id)).size !== rows.length) issues.push(`Duplicate IDs in ${key}.`);
  }
  const data = value as unknown as CollegeData;
  for (const faculty of data.faculty) {
    if (typeof faculty.email !== 'string' || !text(faculty.department) || !integer(faculty.maxDailyPeriods, 1, PERIODS.length)) issues.push('Faculty need a department and a daily limit of 1–7 periods.');
    if (!Array.isArray(faculty.unavailable) || faculty.unavailable.some(slot => typeof slot !== 'string' || !/^[0-4]-[0-6]$/.test(slot))) issues.push('Invalid faculty availability.');
    if (faculty.preferred !== undefined && (!Array.isArray(faculty.preferred) || faculty.preferred.some(slot => typeof slot !== 'string' || !/^[0-4]-[0-6]$/.test(slot)))) issues.push('Invalid faculty preferred periods.');
  }
  for (const room of data.rooms) {
    if (!text(room.building) || !integer(room.capacity, 1, 1000) || !roomType(room.type)) issues.push('Rooms need a building, 1–1,000 seats, and a valid room type.');
    if (room.features !== undefined && (!Array.isArray(room.features) || room.features.some(feature => !text(feature, 60)))) issues.push('Room features must be short text labels.');
  }
  for (const group of data.groups) {
    if (!text(group.department) || !integer(group.size, 1, 1000) || !integer(group.semester, 1, 12)) issues.push('Groups need a department, 1–1,000 students, and a semester from 1–12.');
  }
  for (const course of data.courses) {
    if (!text(course.code) || !integer(course.weeklySessions, 1, 5) || !integer(course.duration, 1, 3) || !roomType(course.roomType) || !COLORS.includes(course.color)) issues.push('Courses need a code, 1–5 weekly sessions, a duration of 1–3 periods, and valid room type and color.');
    if (!data.faculty.some(f => f.id === course.facultyId) || !data.groups.some(g => g.id === course.groupId)) issues.push(`Assign an existing faculty member and student group to ${course.name || 'each course'}.`);
    if (course.requiredFeatures !== undefined && (!Array.isArray(course.requiredFeatures) || course.requiredFeatures.some(feature => !text(feature, 60)))) issues.push('Course room requirements must be short text labels.');
  }
  const prefs = value.preferences;
  if (!object(prefs) || !Array.isArray(prefs.days) || !prefs.days.length || prefs.days.some(day => !integer(day, 0, DAYS.length - 1)) || new Set(prefs.days).size !== prefs.days.length || ['preferMorning', 'balancedDays', 'avoidLastPeriod'].some(key => typeof prefs[key] !== 'boolean') || (prefs.avoidGaps !== undefined && typeof prefs.avoidGaps !== 'boolean')) issues.push('Choose at least one valid teaching day and valid scheduling preferences.');
  return [...new Set(issues)];
}

export function parseWorkspace(raw: string): SavedWorkspace {
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.version !== 1) throw new Error('This is not a supported ISchedule backup.');
  const issues = dataIssues(value.data);
  if (issues.length) throw new Error(issues[0]);
  const data = value.data as CollegeData;
  let schedule = null;
  if (value.schedule !== null) {
    const result = value.schedule;
    if (!object(result) || !Array.isArray(result.sessions) || result.sessions.length > 2500 || typeof result.generatedAt !== 'string' || !Number.isFinite(Date.parse(result.generatedAt))) throw new Error('Invalid saved timetable.');
    for (const s of result.sessions) {
       if (!object(s) || !text(s.id) || !text(s.courseId) || !text(s.roomId) || !integer(s.day, 0, 4) || !integer(s.period, 0, 6) || (s.locked !== undefined && typeof s.locked !== 'boolean')) throw new Error('Invalid timetable session.');
    }
    const sessions = result.sessions as Session[];
    const conflicts = validateSchedule(data, sessions);
    if (conflicts.length) throw new Error(`Saved timetable has a conflict: ${conflicts[0].message}`);
    schedule = summarizeSchedule(data, sessions, result.generatedAt);
  }
  return { version: 1, data, schedule };
}

export function loadWorkspace(): { workspace: SavedWorkspace; warning: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) return { workspace: parseWorkspace(raw), warning: '' };
  } catch {
    return { workspace: { version: 1, data: createDemoData(), schedule: null }, warning: 'Your saved workspace could not be read. Sample data is loaded; use a JSON backup to restore your work.' };
  }
  return { workspace: { version: 1, data: createDemoData(), schedule: null }, warning: '' };
}

export function downloadFile(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
