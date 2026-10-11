import { useState, type FormEvent } from 'react';
import { COLORS, DAYS, PERIODS, newId, type CollegeData, type Course, type Faculty, type Room, type StudentGroup } from '../types';
import { dataIssues } from '../workspace';
import Modal from './Modal';

export type ResourceKind = 'courses' | 'faculty' | 'rooms' | 'groups';
export const singular: Record<ResourceKind, string> = { courses: 'course', faculty: 'faculty member', rooms: 'room', groups: 'student group' };

export default function ResourceEditor({ kind, id, data, onSave, onClose }: { kind: ResourceKind; id?: string; data: CollegeData; onSave: (data: CollegeData) => void; onClose: () => void }) {
  const existing = data[kind].find(row => row.id === id);
  const course = kind === 'courses' ? existing as Course | undefined : undefined;
  const faculty = kind === 'faculty' ? existing as Faculty | undefined : undefined;
  const room = kind === 'rooms' ? existing as Room | undefined : undefined;
  const group = kind === 'groups' ? existing as StudentGroup | undefined : undefined;
  const [unavailable, setUnavailable] = useState(faculty?.unavailable ?? []);
  const [error, setError] = useState('');
  const missing = kind === 'courses' && (!data.faculty.length || !data.groups.length);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const str = (key: string) => String(form.get(key) ?? '').trim();
    const num = (key: string) => Number(form.get(key));
    const common = { id: existing?.id ?? newId(), name: str('name') };
    const next = { ...data };
    if (kind === 'courses') {
      const row: Course = { ...common, code: str('code'), facultyId: str('facultyId'), groupId: str('groupId'), weeklySessions: num('weeklySessions'), duration: num('duration'), roomType: str('roomType') as Course['roomType'], color: str('color') as Course['color'], requiredFeatures: course?.requiredFeatures };
      next.courses = existing ? data.courses.map(c => c.id === id ? row : c) : [...data.courses, row];
    } else if (kind === 'faculty') {
      const row: Faculty = { ...common, email: str('email'), department: str('department'), maxDailyPeriods: num('maxDailyPeriods'), unavailable, preferred: faculty?.preferred };
      next.faculty = existing ? data.faculty.map(f => f.id === id ? row : f) : [...data.faculty, row];
    } else if (kind === 'rooms') {
      const row: Room = { ...common, building: str('building'), capacity: num('capacity'), type: str('type') as Room['type'], features: room?.features };
      next.rooms = existing ? data.rooms.map(r => r.id === id ? row : r) : [...data.rooms, row];
    } else {
      const row: StudentGroup = { ...common, department: str('department'), size: num('size'), semester: num('semester') };
      next.groups = existing ? data.groups.map(g => g.id === id ? row : g) : [...data.groups, row];
    }
    const issues = dataIssues(next);
    if (issues.length) { setError(issues[0]); return; }
    onSave(next);
  }

  return <Modal title={`${existing ? 'Edit' : 'Add'} ${singular[kind]}`} description="Keep your scheduling details in one place." onClose={onClose} wide={kind === 'faculty'}>
    <form onSubmit={submit}>
      {(error || missing) && <div className="notice error" role="alert">{error || 'Add at least one faculty member and student group before creating a course.'}</div>}
      <div className="form-grid">
        <label className="span-2">{kind === 'faculty' ? 'Full name' : 'Name'}<input name="name" defaultValue={existing?.name} required maxLength={200} placeholder={kind === 'courses' ? 'e.g. Data Structures' : kind === 'rooms' ? 'e.g. Room 101' : kind === 'groups' ? 'e.g. CSE · Section A' : 'e.g. Dr. Olivia Bennett'} /></label>
        {kind === 'courses' && <>
          <label>Course code<input name="code" defaultValue={course?.code} required maxLength={200} placeholder="e.g. CS201" /></label>
          <label>Student group<select name="groupId" defaultValue={course?.groupId ?? data.groups[0]?.id} required>{data.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          <label className="span-2">Assigned faculty<select name="facultyId" defaultValue={course?.facultyId ?? data.faculty[0]?.id} required>{data.faculty.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label>Sessions per week<input name="weeklySessions" type="number" min={1} max={5} defaultValue={course?.weeklySessions ?? 3} required /></label>
          <label>Periods per session<select name="duration" defaultValue={course?.duration ?? 1}><option value={1}>1 period · 1 hour</option><option value={2}>2 consecutive periods</option><option value={3}>3 consecutive periods</option></select></label>
          <label>Required room<select name="roomType" defaultValue={course?.roomType ?? 'lecture'}><option value="lecture">Lecture room</option><option value="lab">Laboratory</option></select></label>
          <label>Timetable color<select name="color" defaultValue={course?.color ?? 'sage'}>{COLORS.map(color => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}</select></label>
          <p className="form-hint span-2">Each course meets at most once per day. Multi-period sessions stay together and never cross a break.</p>
        </>}
        {kind === 'faculty' && <>
          <label>Email<input name="email" type="email" defaultValue={faculty?.email} placeholder="name@college.edu" /></label>
          <label>Department<input name="department" defaultValue={faculty?.department ?? 'Computer Science'} required maxLength={200} /></label>
          <label>Daily teaching limit<input name="maxDailyPeriods" type="number" min={1} max={7} defaultValue={faculty?.maxDailyPeriods ?? 5} required /></label>
          <div className="availability span-2"><h3>Weekly availability</h3><p>Click a period to mark it unavailable. <span className="unavailable-key" /> Unavailable</p>
            <div className="availability-scroll"><table><thead><tr><th scope="col">Period</th>{DAYS.map(day => <th key={day} scope="col">{day.slice(0, 3)}</th>)}</tr></thead><tbody>{PERIODS.map((period, p) => <tr key={period.start}><th scope="row">{period.start}</th>{DAYS.map((day, d) => {
              const key = `${d}-${p}`;
              const blocked = unavailable.includes(key);
              return <td key={day}><button type="button" className={blocked ? 'availability-slot blocked' : 'availability-slot'} aria-label={`${day} ${period.start} unavailable`} aria-pressed={blocked} onClick={() => setUnavailable(current => blocked ? current.filter(slot => slot !== key) : [...current, key])}>{blocked ? '−' : '✓'}</button></td>;
            })}</tr>)}</tbody></table></div>
          </div>
        </>}
        {kind === 'rooms' && <>
          <label className="span-2">Building<input name="building" defaultValue={room?.building} placeholder="e.g. Academic Block A" required maxLength={200} /></label>
          <label>Capacity (seats)<input name="capacity" type="number" min={1} max={1000} defaultValue={room?.capacity ?? 50} required /></label>
          <label>Room type<select name="type" defaultValue={room?.type ?? 'lecture'}><option value="lecture">Lecture room</option><option value="lab">Laboratory</option></select></label>
        </>}
        {kind === 'groups' && <>
          <label className="span-2">Department<input name="department" defaultValue={group?.department ?? 'Computer Science'} required maxLength={200} /></label>
          <label>Number of students<input name="size" type="number" min={1} max={1000} defaultValue={group?.size ?? 40} required /></label>
          <label>Semester<input name="semester" type="number" min={1} max={12} defaultValue={group?.semester ?? 3} required /></label>
        </>}
      </div>
      <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={missing}>Save {singular[kind]}</button></div>
    </form>
  </Modal>;
}
