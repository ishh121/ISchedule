import { useState, type FormEvent } from 'react';
import { Lock, Trash2, Unlock } from 'lucide-react';
import { contiguous, placementIssues } from '../scheduler';
import { DAYS, PERIODS, newId, type CollegeData, type Session } from '../types';
import Modal from './Modal';

export default function SessionEditor({
  data,
  sessions,
  session,
  initialCourseId,
  onSave,
  onDelete,
  onClose,
}: {
  data: CollegeData;
  sessions: Session[];
  session?: Session;
  initialCourseId?: string;
  onSave: (session: Session) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const initialCourse = data.courses.find(item => item.id === (session?.courseId ?? initialCourseId)) ?? data.courses[0];
  const firstPeriod = initialCourse ? PERIODS.findIndex((_, index) => contiguous(index, initialCourse.duration)) : 0;
  const initialRooms = initialCourse ? data.rooms.filter(room => room.type === initialCourse.roomType && room.capacity >= (data.groups.find(group => group.id === initialCourse.groupId)?.size ?? Infinity) && !(initialCourse.requiredFeatures?.some(feature => !room.features?.includes(feature)))) : [];
  const [courseId, setCourseId] = useState(session?.courseId ?? initialCourse?.id ?? '');
  const [day, setDay] = useState(session?.day ?? data.preferences.days[0] ?? 0);
  const [period, setPeriod] = useState(session?.period ?? Math.max(0, firstPeriod));
  const [roomId, setRoomId] = useState(session?.roomId ?? initialRooms[0]?.id ?? '');
  const [locked, setLocked] = useState(Boolean(session?.locked ?? !session));
  const [error, setError] = useState('');

  const course = data.courses.find(item => item.id === courseId);
  if (!course) return null;
  const group = data.groups.find(item => item.id === course.groupId);
  const rooms = data.rooms.filter(room => room.type === course.roomType && room.capacity >= (group?.size ?? Infinity) && !(course.requiredFeatures?.some(feature => !room.features?.includes(feature))));
  const periods = PERIODS.map((item, index) => ({ item, index })).filter(({ index }) => contiguous(index, course.duration));
  const selectedCourse = course;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate: Session = { id: session?.id ?? newId(), courseId, day, period, roomId, locked };
    if (!session && sessions.filter(item => item.courseId === candidate.courseId).length >= selectedCourse.weeklySessions) {
      setError(`${selectedCourse.name} already has all ${selectedCourse.weeklySessions} weekly sessions placed.`);
      return;
    }
    const issues = placementIssues(data, sessions.filter(item => item.id !== session?.id), candidate);
    if (issues.length) {
      setError(issues.join(' '));
      return;
    }
    onSave(candidate);
  }

  return <Modal title={`${session ? 'Edit' : 'Add'} ${course.name}`} description={`${course.code} · ${course.duration} period${course.duration === 1 ? '' : 's'} · ${group?.name ?? 'Unassigned group'}`} onClose={onClose}>
    <form onSubmit={submit}>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="session-editor-grid">
        {!session && <label className="span-2">Course<select value={courseId} onChange={event => { const nextId = event.target.value; const nextCourse = data.courses.find(item => item.id === nextId); const nextGroup = data.groups.find(item => item.id === nextCourse?.groupId); const nextRoom = data.rooms.find(room => room.type === nextCourse?.roomType && room.capacity >= (nextGroup?.size ?? Infinity)); setCourseId(nextId); setPeriod(nextCourse ? Math.max(0, PERIODS.findIndex((_, index) => contiguous(index, nextCourse.duration))) : 0); setRoomId(nextRoom?.id ?? ''); setError(''); }}>{data.courses.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>}
        <label>Teaching day<select value={day} onChange={event => setDay(Number(event.target.value))}>{data.preferences.days.map(value => <option key={value} value={value}>{DAYS[value]}</option>)}</select></label>
        <label>Start period<select value={period} onChange={event => setPeriod(Number(event.target.value))}>{periods.map(({ item, index }) => <option key={item.start} value={index}>{item.label} · ends {PERIODS[index + course.duration - 1].end}</option>)}</select></label>
        <label className="span-2">Room<select value={roomId} onChange={event => setRoomId(event.target.value)}>{rooms.length ? rooms.map(room => <option key={room.id} value={room.id}>{room.name} · {room.building} · {room.capacity} seats</option>) : <option value="">No compatible room available</option>}</select></label>
      </div>
      <button type="button" className={`lock-control ${locked ? 'locked' : ''}`} onClick={() => setLocked(value => !value)}><span className="lock-control-icon">{locked ? <Lock size={15} /> : <Unlock size={15} />}</span><span><strong>{locked ? 'Session is locked' : 'Lock this session'}</strong><small>{locked ? 'Regeneration will preserve this exact placement.' : 'Keep this placement when generating a new timetable.'}</small></span></button>
      <div className="modal-footer session-footer">{session && onDelete && <button type="button" className="button danger-button" onClick={onDelete}><Trash2 size={15} /> Remove session</button>}<span className="footer-spacer" /><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={!rooms.length}>Save placement</button></div>
    </form>
  </Modal>;
}
