export type RoomType = 'lecture' | 'lab';
export type Color = 'sage' | 'lavender' | 'peach' | 'blue' | 'rose' | 'sand';
export interface Faculty {
  id: string;
  name: string;
  email: string;
  department: string;
  maxDailyPeriods: number;
  unavailable: string[];
  preferred?: string[];
}
export interface Room { id: string; name: string; building: string; capacity: number; type: RoomType; features?: string[] }
export interface StudentGroup { id: string; name: string; department: string; size: number; semester: number }
export interface Course {
  id: string;
  name: string;
  code: string;
  facultyId: string;
  groupId: string;
  weeklySessions: number;
  duration: number;
  roomType: RoomType;
  color: Color;
  requiredFeatures?: string[];
}
export interface Preferences { days: number[]; preferMorning: boolean; balancedDays: boolean; avoidLastPeriod: boolean; avoidGaps?: boolean; avoidFirstPeriod?: boolean; balanceFacultyLoad?: boolean }
export interface CollegeData { courses: Course[]; faculty: Faculty[]; rooms: Room[]; groups: StudentGroup[]; preferences: Preferences }
export interface Session { id: string; courseId: string; day: number; period: number; roomId: string; locked?: boolean }
export interface ScheduleResult { sessions: Session[]; unscheduled: { courseId: string; count: number; reason: string }[]; quality: number; generatedAt: string }
export interface AcademicTerm { academicYear: string; semester: string; department: string; startDate: string; endDate: string; timeZone: string }
export interface SavedWorkspace { version: 1; data: CollegeData; schedule: ScheduleResult | null; term?: AcademicTerm }
export interface WorkspaceSummary { id: number; name: string; term?: AcademicTerm }
export type Page = 'overview' | 'timetable' | 'courses' | 'faculty' | 'rooms' | 'groups' | 'settings' | 'availability' | 'audit' | 'workspaces' | 'reports';
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const PERIODS = [
  { start: '09:00', end: '10:00', label: '09:00 AM' },
  { start: '10:00', end: '11:00', label: '10:00 AM' },
  { start: '11:15', end: '12:15', label: '11:15 AM' },
  { start: '12:15', end: '13:15', label: '12:15 PM' },
  { start: '14:00', end: '15:00', label: '02:00 PM' },
  { start: '15:00', end: '16:00', label: '03:00 PM' },
  { start: '16:00', end: '17:00', label: '04:00 PM' },
];
export const COLORS: Color[] = ['sage', 'lavender', 'peach', 'blue', 'rose', 'sand'];
export const newId = () => crypto.randomUUID();
export const initials = (name: string) => name.replace(/^(Dr\.?|Prof\.?)\s+/i, '').split(' ').map(s => s[0]).slice(0, 2).join('');
