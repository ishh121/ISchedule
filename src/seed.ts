import type { CollegeData, Color, Course } from './types';

const subjects: { name: string; code: string; faculty: string; sessions: number; color: Color; lab?: boolean }[] = [
  { name: 'Data Structures', code: 'CS201', faculty: 'f1', sessions: 3, color: 'sage' },
  { name: 'Database Systems', code: 'CS202', faculty: 'f2', sessions: 3, color: 'lavender' },
  { name: 'Computer Networks', code: 'CS203', faculty: 'f3', sessions: 3, color: 'blue' },
  { name: 'Discrete Mathematics', code: 'MA201', faculty: 'f4', sessions: 3, color: 'peach' },
  { name: 'Software Engineering', code: 'CS204', faculty: 'f5', sessions: 2, color: 'rose' },
  { name: 'Programming Lab', code: 'CS205L', faculty: 'f6', sessions: 2, color: 'sand', lab: true },
];

export function createDemoData(): CollegeData {
  const courses: Course[] = ['g1', 'g2', 'g3'].flatMap((groupId, groupIndex) => subjects.map((s, index) => ({
    id: `c${groupIndex * 6 + index + 1}`, name: s.name, code: s.code, facultyId: s.faculty, groupId,
    weeklySessions: s.sessions, duration: s.lab ? 2 : 1, roomType: s.lab ? 'lab' : 'lecture', color: s.color,
  })));
  return {
    courses,
    faculty: [
      { id: 'f1', name: 'Dr. Olivia Bennett', email: 'olivia.b@college.edu', department: 'Computer Science', maxDailyPeriods: 5, unavailable: ['0-6', '4-6'] },
      { id: 'f2', name: 'Dr. James Wilson', email: 'james.w@college.edu', department: 'Computer Science', maxDailyPeriods: 5, unavailable: ['2-0', '2-1'] },
      { id: 'f3', name: 'Prof. Sophia Chen', email: 'sophia.c@college.edu', department: 'Computer Science', maxDailyPeriods: 5, unavailable: [] },
      { id: 'f4', name: 'Dr. Ethan Parker', email: 'ethan.p@college.edu', department: 'Mathematics', maxDailyPeriods: 4, unavailable: ['1-5', '1-6'] },
      { id: 'f5', name: 'Prof. Amelia Davis', email: 'amelia.d@college.edu', department: 'Computer Science', maxDailyPeriods: 4, unavailable: [] },
      { id: 'f6', name: 'Prof. Noah Mitchell', email: 'noah.m@college.edu', department: 'Computer Science', maxDailyPeriods: 6, unavailable: [] },
    ],
    groups: [
      { id: 'g1', name: 'CSE · Section A', department: 'Computer Science', size: 42, semester: 3 },
      { id: 'g2', name: 'CSE · Section B', department: 'Computer Science', size: 38, semester: 3 },
      { id: 'g3', name: 'CSE · Section C', department: 'Computer Science', size: 40, semester: 3 },
    ],
    rooms: [
      { id: 'r1', name: 'Room 101', building: 'Academic Block A', capacity: 60, type: 'lecture' },
      { id: 'r2', name: 'Room 102', building: 'Academic Block A', capacity: 50, type: 'lecture' },
      { id: 'r3', name: 'Room 201', building: 'Academic Block B', capacity: 60, type: 'lecture' },
      { id: 'r4', name: 'Computer Lab 1', building: 'Innovation Block', capacity: 45, type: 'lab' },
      { id: 'r5', name: 'Computer Lab 2', building: 'Innovation Block', capacity: 45, type: 'lab' },
    ],
    preferences: { days: [0, 1, 2, 3, 4], preferMorning: true, balancedDays: true, avoidLastPeriod: true },
  };
}
