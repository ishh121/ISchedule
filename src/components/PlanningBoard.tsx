import { useState, type DragEvent } from 'react';
import { CalendarDays, CircleAlert, Download, Lock, Printer, RefreshCw, Sparkles } from 'lucide-react';
import './planning.css';
import PlanningReports from './PlanningReports';
import { exportSemesterIcs } from '../calendar';
import { exportCsv, exportIcs, validateSchedule } from '../scheduler';
import { copyGroupSchedule, previewGroupCopy, moveSession, type GroupCopyPreview } from '../planning';
import { downloadFile } from '../workspace';
import { DAYS, PERIODS, type AcademicTerm, type CollegeData, type ScheduleResult, type Session } from '../types';

export interface PlanningBoardProps {
  data: CollegeData;
  schedule: ScheduleResult | null;
  term?: AcademicTerm;
  canEdit: boolean;
  generating: boolean;
  progress: number;
  onGenerate: () => void;
  onEditSession: (s: Session) => void;
  onAddSession: () => void;
  onSessionsChange: (sessions: Session[], message: string) => void;
}

function sessionCourse(data: CollegeData, session: Session) {
  return data.courses.find(course => course.id === session.courseId);
}

export default function PlanningBoard({ data, schedule, term, canEdit, generating, progress, onGenerate, onEditSession, onAddSession, onSessionsChange }: PlanningBoardProps) {
  const [facultyId, setFacultyId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [moveMessage, setMoveMessage] = useState('');
  const [copySource, setCopySource] = useState(data.groups[0]?.id ?? '');
  const [copyTarget, setCopyTarget] = useState(data.groups[1]?.id ?? data.groups[0]?.id ?? '');
  const [copyPreview, setCopyPreview] = useState<GroupCopyPreview | null>(null);
  const sessions = schedule?.sessions ?? [];
  const filteredSessions = sessions.filter(session => {
    const course = sessionCourse(data, session);
    return Boolean(course) && (!facultyId || course?.facultyId === facultyId) && (!groupId || course?.groupId === groupId) && (!roomId || session.roomId === roomId);
  });
  const unscheduledCount = schedule?.unscheduled.reduce((total, item) => total + item.count, 0) ?? 0;
  const validationIssues = schedule ? validateSchedule(data, sessions) : [];

  function downloadCsv() {
    downloadFile(exportCsv(data, filteredSessions), 'ischedule-timetable.csv', 'text/csv;charset=utf-8');
  }

  function downloadIcs() {
    const ics = term ? exportSemesterIcs(data, filteredSessions, term) : exportIcs(data, filteredSessions);
    downloadFile(ics, 'ischedule-timetable.ics', 'text/calendar;charset=utf-8');
  }

  function dropSession(event: DragEvent<HTMLDivElement>, day: number, period: number) {
    event.preventDefault();
    if (!canEdit || !schedule) return;
    const sessionId = event.dataTransfer.getData('text/plain');
    if (!sessionId) return;
    const result = moveSession(data, sessions, sessionId, { day, period });
    setMoveMessage(result.ok ? '' : result.message);
    if (result.ok) onSessionsChange(result.sessions, result.message);
  }

  function previewCopy() {
    setCopyPreview(previewGroupCopy(data, sessions, copySource, copyTarget));
  }

  function confirmCopy() {
    const result = copyGroupSchedule(data, sessions, copySource, copyTarget, true);
    setCopyPreview(result.preview);
    if (result.ok) onSessionsChange(result.sessions, result.message);
  }

  function renderSession(session: Session, continuation = false) {
    const course = sessionCourse(data, session);
    if (!course) return null;
    const room = data.rooms.find(item => item.id === session.roomId);
    if (continuation) return <button type="button" className={`continued-session ${course.color}`} onClick={() => onEditSession(session)} disabled={!canEdit} title={canEdit ? `Edit ${course.code}` : 'Viewer access'} aria-label={`${course.code} continuation`}>Continues · {course.code}</button>;
    return <button type="button" draggable={canEdit && !session.locked} onDragStart={event => { event.dataTransfer.setData('text/plain', session.id); event.dataTransfer.effectAllowed = 'move'; }} className={`session-card ${course.color}`} onClick={() => onEditSession(session)} disabled={!canEdit} title={canEdit ? 'Edit or drag this session' : 'Viewer access'} aria-label={`Edit ${course.code} ${course.name}`}><strong>{course.code}{session.locked && <Lock size={10} className="session-lock" />}</strong><span>{course.name}</span><small>{room?.name ?? 'Room unavailable'} · {course.duration}p · {data.groups.find(group => group.id === course.groupId)?.name ?? 'Group unavailable'}</small></button>;
  }

  return <div className="planning-page page-stack">
     <div className="page-intro"><div><p className="eyebrow">Weekly planning board</p><h2>Build the academic rhythm</h2><p className="muted">Drag a session to a new day and period, or select it with the keyboard to edit its placement.</p></div><div className="intro-actions"><span className="quality-pill"><Sparkles size={15} /> Quality <strong>{schedule ? `${schedule.quality}%` : '—'}</strong></span>{schedule && <><button className="button secondary" onClick={onAddSession} disabled={!canEdit || !unscheduledCount}><span aria-hidden="true">＋</span> Place session</button><button className="button secondary" onClick={downloadCsv} disabled={!sessions.length}><Download size={16} /> CSV</button><button className="button secondary" onClick={downloadIcs} disabled={!sessions.length}>ICS</button><button className="button secondary" onClick={() => window.print()} disabled={!sessions.length}><Printer size={16} /> Print</button></>}<button className="button primary" onClick={onGenerate} disabled={!canEdit || generating || !data.courses.length}><RefreshCw size={16} className={generating ? 'spin' : ''} /> {generating ? `Generating ${progress}%` : schedule ? 'Regenerate' : 'Generate timetable'}</button></div></div>
    {!schedule ? <section className="empty-state card"><div className="empty-illustration"><CalendarDays size={32} /></div><h3>Your timetable is waiting</h3><p>Add courses, faculty, rooms, and groups, then generate a conflict-free arrangement.</p><button className="button primary" onClick={onGenerate} disabled={!canEdit || !data.courses.length || generating}><Sparkles size={16} /> Generate timetable</button></section> : <>
      <section className="planning-filters card" aria-label="Timetable filters"><div><strong>Filter the board</strong><small>Exports follow the current filters.</small></div><label>Faculty<select value={facultyId} onChange={event => setFacultyId(event.target.value)}><option value="">All faculty</option>{data.faculty.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}</select></label><label>Group<select value={groupId} onChange={event => setGroupId(event.target.value)}><option value="">All groups</option>{data.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>Room<select value={roomId} onChange={event => setRoomId(event.target.value)}><option value="">All rooms</option>{data.rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label></section>
      {moveMessage && <div className="notice error" role="alert"><CircleAlert size={17} /><span>{moveMessage}</span></div>}
      {unscheduledCount > 0 && <section className="planning-attention notice warning" aria-label="Unscheduled sessions"><CircleAlert size={17} /><div><strong>{unscheduledCount} session{unscheduledCount === 1 ? '' : 's'} still need attention.</strong><ul>{schedule.unscheduled.map(item => <li key={item.courseId}>{data.courses.find(course => course.id === item.courseId)?.code ?? item.courseId}: {item.count} · {item.reason}</li>)}</ul></div></section>}
      {validationIssues.length > 0 && <section className="planning-attention notice error" aria-label="Schedule conflicts"><CircleAlert size={17} /><div><strong>Some saved placements need review.</strong><ul>{validationIssues.slice(0, 8).map(issue => <li key={`${issue.sessionId}-${issue.message}`}>{issue.message}</li>)}</ul></div></section>}
      <section className="timetable-card card"><div className="timetable-toolbar"><div><h3>Weekly timetable</h3><p>{canEdit ? 'Drop a session on an open cell to validate and lock its new placement.' : 'Viewer access: timetable changes are disabled.'}</p></div><div className="legend"><span><i className="legend-dot sage" /> Lecture</span><span><i className="legend-dot sand" /> Lab</span><span><Lock size={12} /> Locked</span></div></div><div className="timetable-scroll"><div className="timetable-grid planning-grid"><div className="time-header">Time</div>{DAYS.map(day => <div className="day-header" key={day}>{day.slice(0, 3)}<small>{day}</small></div>)}{PERIODS.map((period, periodIndex) => <div className="timetable-row" key={period.start}><div className="time-label"><strong>{period.label}</strong><span>{period.start} – {period.end}</span></div>{DAYS.map((day, dayIndex) => { const starts = filteredSessions.filter(session => session.day === dayIndex && session.period === periodIndex); const continues = filteredSessions.filter(session => { const course = sessionCourse(data, session); return session.day === dayIndex && course && periodIndex > session.period && periodIndex < session.period + course.duration; }); return <div className={`timetable-cell ${continues.length ? 'continued' : ''}`} key={day} onDragOver={event => { if (canEdit) event.preventDefault(); }} onDrop={event => dropSession(event, dayIndex, periodIndex)}>{starts.map(session => <span className="planning-session" key={session.id}>{renderSession(session)}</span>)}{continues.map(session => <span className="planning-continuation" key={`continue-${session.id}`}>{renderSession(session, true)}</span>)}{!starts.length && !continues.length && <span className="empty-slot">·</span>}</div>; })}</div>)}</div></div></section>
      <section className="copy-planning card"><div className="card-heading"><div><h3>Copy a group timetable</h3><p>Matching course codes are previewed first. Existing sessions are never overwritten.</p></div><CalendarDays size={18} className="muted-icon" /></div><div className="copy-controls"><label>Source group<select value={copySource} onChange={event => { setCopySource(event.target.value); setCopyPreview(null); }}>{data.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><span className="copy-arrow" aria-hidden="true">→</span><label>Target group<select value={copyTarget} onChange={event => { setCopyTarget(event.target.value); setCopyPreview(null); }}>{data.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><button className="button secondary" onClick={previewCopy} disabled={!canEdit || !sessions.length}>Preview mapping</button></div>{copyPreview && <div className="copy-preview" role="status"><div className="copy-mapping-list">{copyPreview.mappings.map(mapping => <div className={`copy-mapping ${mapping.status}`} key={mapping.sourceCourseId}><strong>{mapping.sourceCode}</strong><span>→ {mapping.targetCode ?? 'No matching target course'}</span><small>{mapping.message ?? 'Mapped by course code'}</small></div>)}</div>{copyPreview.issues.length ? <div className="notice error"><CircleAlert size={16} /><span>{copyPreview.issues.join(' ')}</span></div> : <div className="copy-confirm"><span>{copyPreview.proposedSessions.length} session{copyPreview.proposedSessions.length === 1 ? '' : 's'} are ready. Confirm to add them without overwriting the target timetable.</span><button className="button primary" onClick={confirmCopy} disabled={!canEdit}>Confirm copy</button></div>}</div>}</section>
      <PlanningReports data={data} schedule={schedule} />
    </>}
  </div>;
}
