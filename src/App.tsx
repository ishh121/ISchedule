import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  DoorOpen,
  FileJson,
  GraduationCap,
  LayoutDashboard,
  Lock,
  Plus,
  Printer,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
  LogOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import ResourceEditor, { singular, type ResourceKind } from './components/ResourceEditor';
import SessionEditor from './components/SessionEditor';
import { clearAuthToken, createInvitation, createVersion, currentUser, getPublishedWorkspace, getRemoteWorkspace, hasAuthToken, listUsers, listVersions, login, logout, publishVersion, register, requestPasswordReset, resetPassword, resetUserPassword, saveRemoteWorkspace, updateUserRole, verifyEmail, type AuthUser, type UserRole } from './api';
import { createDemoData } from './seed';
import { exportCsv, exportIcs, summarizeSchedule } from './scheduler';
import {
  DAYS,
  PERIODS,
  type CollegeData,
  type Page,
  type SavedWorkspace,
  type ScheduleResult,
  type Session,
} from './types';
import {
  downloadFile,
  loadWorkspace,
  parseWorkspace,
  STORAGE_KEY,
} from './workspace';

type NavigationItem = { id: Page; label: string; icon: LucideIcon };
type EditorState = { kind: ResourceKind; id?: string } | null;
type SessionEditorState = Session | 'new' | null;
type WorkerMessage =
  | { type: 'progress'; progress: number }
  | { type: 'result'; result: ScheduleResult }
  | { type: 'error'; message: string };

const navigation: NavigationItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'timetable', label: 'Timetable', icon: CalendarDays },
];

const resourceNavigation: NavigationItem[] = [
  { id: 'courses', label: 'Courses', icon: BookOpen },
  { id: 'faculty', label: 'Faculty', icon: GraduationCap },
  { id: 'rooms', label: 'Rooms', icon: DoorOpen },
  { id: 'groups', label: 'Student groups', icon: Users },
];

const pageTitles: Record<Page, string> = {
  overview: 'Overview',
  timetable: 'Timetable',
  courses: 'Courses',
  faculty: 'Faculty',
  rooms: 'Rooms',
  groups: 'Student groups',
  settings: 'Settings',
};

type SessionState =
  | { status: 'loading' }
  | { status: 'auth'; error?: string }
  | { status: 'ready'; user: AuthUser; workspace: SavedWorkspace; remote: boolean; revision: number; warning: string };

function App() {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    if (!hasAuthToken()) {
      setSession({ status: 'auth' });
      return;
    }
    Promise.all([currentUser(), getRemoteWorkspace()]).then(async ([user, remote]) => {
      const published = ['faculty', 'student', 'viewer'].includes(user.role) ? await getPublishedWorkspace() : null;
      setSession({ status: 'ready', user, workspace: published ?? remote.workspace, revision: remote.revision, remote: true, warning: published ? 'Viewing the latest published timetable.' : '' });
    }).catch(error => {
      clearAuthToken();
      setSession({ status: 'auth', error: error instanceof Error ? error.message : 'Your session expired. Please sign in again.' });
    });
  }, []);

  async function enterRemote(user: AuthUser) {
    const remote = await getRemoteWorkspace();
    const published = ['faculty', 'student', 'viewer'].includes(user.role) ? await getPublishedWorkspace() : null;
    setSession({ status: 'ready', user, workspace: published ?? remote.workspace, revision: remote.revision, remote: true, warning: published ? 'Viewing the latest published timetable.' : '' });
  }

  function enterOffline() {
    const local = loadWorkspace();
    setSession({ status: 'ready', user: { id: 'offline', name: 'Local planner', email: '', role: 'admin' }, workspace: local.workspace, revision: 0, remote: false, warning: local.warning || 'Offline mode: changes are saved only on this device.' });
  }

  async function signOut() {
    await logout();
    setSession({ status: 'auth' });
  }

  if (session.status === 'loading') return <div className="auth-loading"><span className="brand-mark"><Sparkles size={18} /></span><strong>Loading ISchedule…</strong></div>;
  if (session.status === 'auth' && window.location.pathname === '/verify-email') return <AccountActionScreen kind="verify" token={new URLSearchParams(window.location.search).get('token') ?? ''} />;
  if (session.status === 'auth' && window.location.pathname === '/reset-password') return <AccountActionScreen kind="reset" token={new URLSearchParams(window.location.search).get('token') ?? ''} />;
  if (session.status === 'auth') return <AuthScreen initialError={session.error} onSignedIn={enterRemote} onOffline={enterOffline} />;
  return <WorkspaceApp initialWorkspace={session.workspace} initialRevision={session.revision} initialWarning={session.warning} user={session.user} remote={session.remote} onLogout={signOut} />;
}

function WorkspaceApp({ initialWorkspace, initialRevision, initialWarning, user, remote, onLogout }: { initialWorkspace: SavedWorkspace; initialRevision: number; initialWarning: string; user: AuthUser; remote: boolean; onLogout: () => Promise<void> }) {
  const [workspace, setWorkspace] = useState<SavedWorkspace>(initialWorkspace);
  const [page, setPage] = useState<Page>('overview');
  const [editor, setEditor] = useState<EditorState>(null);
  const [sessionEditor, setSessionEditor] = useState<SessionEditorState>(null);
  const [notice, setNotice] = useState(initialWarning);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef(initialRevision);
  const syncRef = useRef(Promise.resolve());
  const canEdit = user.role === 'admin' || user.role === 'planner';
  const scopedCourses = user.role === 'faculty' && user.facultyId ? workspace.data.courses.filter(course => course.facultyId === user.facultyId) : user.role === 'student' && user.groupId ? workspace.data.courses.filter(course => course.groupId === user.groupId) : workspace.data.courses;
  const viewData = scopedCourses.length === workspace.data.courses.length ? workspace.data : { ...workspace.data, courses: scopedCourses };
  const viewCourseIds = new Set(scopedCourses.map(course => course.id));
  const viewSchedule = workspace.schedule && scopedCourses.length !== workspace.data.courses.length ? { ...workspace.schedule, sessions: workspace.schedule.sessions.filter(session => viewCourseIds.has(session.courseId)), unscheduled: workspace.schedule.unscheduled.filter(item => viewCourseIds.has(item.courseId)) } : workspace.schedule;

  function persist(next: SavedWorkspace) {
    setWorkspace(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      setNotice('The workspace is updated for this session, but could not be saved locally.');
    }
    if (remote) syncRef.current = syncRef.current.then(() => saveRemoteWorkspace(next, revisionRef.current)).then(result => { revisionRef.current = result.revision; }).catch(error => setNotice(error instanceof Error ? `Saved locally, but server sync failed: ${error.message}` : 'Saved locally, but server sync failed.'));
  }

  function updateData(data: CollegeData, message = 'Changes saved. Generate a new timetable when ready.') {
    if (!canEdit) {
      setNotice('Viewer accounts cannot edit this workspace.');
      return;
    }
    persist({ ...workspace, data, schedule: null });
    setNotice(message);
  }

  function openPage(nextPage: Page) {
    setPage(nextPage);
    setNotice('');
  }

  function generate() {
    if (generating || !canEdit) return;
    setGenerating(true);
    setProgress(0);
    setNotice('The scheduler is exploring conflict-free placements…');
    const worker = new Worker(new URL('./scheduler.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        setProgress(message.progress);
        return;
      }
      worker.terminate();
      workerRef.current = null;
      setGenerating(false);
      if (message.type === 'error') {
        setNotice(message.message);
        return;
      }
      persist({ ...workspace, schedule: message.result });
      setPage('timetable');
      setNotice(message.result.unscheduled.length ? 'Timetable generated with a few unscheduled sessions to review.' : 'Timetable generated successfully.');
    };
    worker.onerror = () => {
      worker.terminate();
      workerRef.current = null;
      setGenerating(false);
      setNotice('The scheduler could not finish. Check your resources and try again.');
    };
    worker.postMessage({ data: workspace.data, lockedSessions: workspace.schedule?.sessions.filter(session => session.locked) ?? [] });
  }

  function saveResource(data: CollegeData) {
    if (!canEdit) return;
    updateData(data);
    setEditor(null);
  }

  function deleteResource(kind: ResourceKind, id: string) {
    if (!canEdit) return;
    if (kind === 'faculty' && workspace.data.courses.some(course => course.facultyId === id)) {
      setNotice('This faculty member is assigned to a course. Reassign those courses before deleting them.');
      return;
    }
    if (kind === 'groups' && workspace.data.courses.some(course => course.groupId === id)) {
      setNotice('This student group is assigned to a course. Reassign those courses before deleting it.');
      return;
    }
    if (!window.confirm(`Delete this ${singular[kind]}?`)) return;
    const data = { ...workspace.data };
    if (kind === 'courses') data.courses = data.courses.filter(course => course.id !== id);
    if (kind === 'faculty') data.faculty = data.faculty.filter(member => member.id !== id);
    if (kind === 'rooms') data.rooms = data.rooms.filter(room => room.id !== id);
    if (kind === 'groups') data.groups = data.groups.filter(group => group.id !== id);
    updateData(data, `${singular[kind][0].toUpperCase()}${singular[kind].slice(1)} deleted.`);
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = parseWorkspace(await file.text());
      persist(imported);
      setPage('overview');
      setNotice('Backup restored successfully.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'This backup could not be read.');
    }
  }

  function exportBackup() {
    downloadFile(JSON.stringify(workspace, null, 2), 'ischedule-workspace.json', 'application/json');
    setNotice('Workspace backup downloaded.');
  }

  function exportSchedule() {
    if (!workspace.schedule) {
      setNotice('Generate a timetable before exporting it.');
      return;
    }
    downloadFile(exportCsv(workspace.data, workspace.schedule.sessions), 'ischedule-timetable.csv', 'text/csv;charset=utf-8');
    setNotice('Timetable CSV downloaded.');
  }

  function exportCalendar() {
    if (!workspace.schedule) {
      setNotice('Generate a timetable before exporting it.');
      return;
    }
    downloadFile(exportIcs(workspace.data, workspace.schedule.sessions), 'ischedule-timetable.ics', 'text/calendar;charset=utf-8');
    setNotice('Calendar file downloaded.');
  }

  function printSchedule() {
    if (!workspace.schedule) {
      setNotice('Generate a timetable before printing it.');
      return;
    }
    window.print();
  }

  function updateSchedule(sessions: Session[], message: string) {
    persist({ ...workspace, schedule: summarizeSchedule(workspace.data, sessions) });
    setNotice(message);
  }

  function saveSession(session: Session) {
    if (!workspace.schedule) return;
    const sessions = sessionEditor === 'new' ? [...workspace.schedule.sessions, session] : workspace.schedule.sessions.map(item => item.id === session.id ? session : item);
    updateSchedule(sessions, sessionEditor === 'new' ? 'Session manually placed.' : session.locked ? 'Placement saved and locked for future generations.' : 'Placement saved.');
    setSessionEditor(null);
  }

  function removeSession() {
    if (!workspace.schedule || !sessionEditor || sessionEditor === 'new' || !window.confirm('Remove this session from the timetable?')) return;
    updateSchedule(workspace.schedule.sessions.filter(item => item.id !== sessionEditor.id), 'Session removed. Generate again to fill the open slot.');
    setSessionEditor(null);
  }

  function addSession() {
    if (!workspace.schedule || !workspace.schedule.unscheduled.length) return;
    setSessionEditor('new');
  }

  function resetDemo() {
    if (!canEdit) return;
    if (!window.confirm('Replace your current workspace with the sample timetable data?')) return;
    persist({ version: 1, data: createDemoData(), schedule: null });
    setPage('overview');
    setNotice('Sample workspace restored.');
  }

  const renderPage = () => {
    if (page === 'overview') {
      return <Overview data={viewData} schedule={viewSchedule} onNavigate={openPage} onGenerate={generate} canEdit={canEdit} />;
    }
    if (page === 'timetable') {
      return <Timetable data={viewData} schedule={viewSchedule} onGenerate={generate} onExport={exportSchedule} onExportCalendar={exportCalendar} onPrint={printSchedule} onEditSession={setSessionEditor} onAddSession={addSession} canEdit={canEdit} generating={generating} progress={progress} />;
    }
    if (page === 'settings') {
      return <SettingsPage data={workspace.data} onChange={updateData} onImport={() => importRef.current?.click()} onExport={exportBackup} onReset={resetDemo} canEdit={canEdit} />;
    }
    return <ResourceList kind={page} data={workspace.data} schedule={workspace.schedule} onAdd={() => setEditor({ kind: page })} onEdit={id => setEditor({ kind: page, id })} onDelete={id => deleteResource(page, id)} canEdit={canEdit} />;
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Sparkles size={17} /></span><span>ISchedule</span></div>
        <div className="sidebar-label">Workspace</div>
        <nav className="nav-list" aria-label="Main navigation">
          {navigation.map(item => <NavButton key={item.id} item={item} active={page === item.id} onClick={() => openPage(item.id)} />)}
        </nav>
        <div className="sidebar-label resource-label">Manage</div>
         {canEdit && <nav className="nav-list" aria-label="Resource navigation">
           {resourceNavigation.map(item => <NavButton key={item.id} item={item} active={page === item.id} onClick={() => openPage(item.id)} />)}
         </nav>}
        <div className="sidebar-spacer" />
         {canEdit && <button className={`nav-button ${page === 'settings' ? 'active' : ''}`} onClick={() => openPage('settings')}><Settings2 size={18} /><span>Settings</span></button>}
       <div className="sidebar-footer"><span className="status-dot" /> {remote ? 'Shared workspace' : 'Local workspace'}<br /><small>{remote ? 'Synced to ISchedule server' : 'Saved on this device'}</small></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div><p className="eyebrow">Academic planning workspace</p><h1>{pageTitles[page]}</h1></div>
          <div className="topbar-actions">
            <button className="button secondary topbar-backup" onClick={exportBackup}><Download size={16} /> Backup</button>
            {workspace.schedule && <button className="button secondary topbar-backup" onClick={exportCalendar}>ICS</button>}
            <span className="account-chip"><span className="account-avatar">{user.name.split(' ').map(part => part[0]).slice(0, 2).join('')}</span><span><strong>{user.name}</strong><small>{user.role}</small></span></span>
            <button className="icon-button account-logout" onClick={() => void onLogout()} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
            <button className="button primary" onClick={generate} disabled={!canEdit || generating || !workspace.data.courses.length}><Sparkles size={16} /> {generating ? `Generating ${progress}%` : 'Generate timetable'}</button>
          </div>
        </header>
        <div className="content-wrap">
          {notice && <div className={`notice ${notice.includes('successfully') || notice.includes('saved') || notice.includes('downloaded') || notice.includes('restored') ? 'success' : 'info'}`} role="status"><span>{notice}</span><button className="notice-close" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={16} /></button></div>}
          {renderPage()}
          {remote && user.role === 'admin' && page === 'settings' && <><AdminUsers data={workspace.data} /><AdminWorkspaceControls /></>}
        </div>
      </main>

      <input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={importBackup} />
      {editor && <ResourceEditor kind={editor.kind} id={editor.id} data={workspace.data} onSave={saveResource} onClose={() => setEditor(null)} />}
      {sessionEditor && workspace.schedule && <SessionEditor data={workspace.data} sessions={workspace.schedule.sessions} session={sessionEditor === 'new' ? undefined : sessionEditor} initialCourseId={sessionEditor === 'new' ? workspace.schedule.unscheduled[0]?.courseId : undefined} onSave={saveSession} onDelete={sessionEditor === 'new' ? undefined : removeSession} onClose={() => setSessionEditor(null)} />}
    </div>
  );
}

function NavButton({ item, active, onClick }: { item: NavigationItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}><Icon size={18} /><span>{item.label}</span>{active && <ChevronRight className="nav-current" size={15} />}</button>;
}

function Overview({ data, schedule, onNavigate, onGenerate, canEdit }: { data: CollegeData; schedule: ScheduleResult | null; onNavigate: (page: Page) => void; onGenerate: () => void; canEdit: boolean }) {
  const requested = data.courses.reduce((total, course) => total + course.weeklySessions, 0);
  const placed = schedule?.sessions.length ?? 0;
  const attentionCount = schedule?.unscheduled.reduce((total, item) => total + item.count, 0) ?? 0;
  const stats = [
    { label: 'Weekly sessions', value: requested, detail: schedule ? `${placed} placed` : 'Ready to schedule', icon: CalendarDays, tone: 'mint' },
    { label: 'Courses', value: data.courses.length, detail: `${data.groups.length} student groups`, icon: BookOpen, tone: 'lavender' },
    { label: 'Faculty', value: data.faculty.length, detail: `${data.rooms.length} rooms available`, icon: GraduationCap, tone: 'peach' },
    { label: 'Schedule quality', value: schedule ? `${schedule.quality}%` : '—', detail: schedule ? 'Based on preferences' : 'Generate a timetable', icon: Sparkles, tone: 'blue' },
  ];

  return <div className="page-stack">
    <section className="welcome-panel">
      <div><span className="section-kicker"><Sparkles size={14} /> AI-assisted planning</span><h2>Make space for better teaching.</h2><p>ISchedule balances faculty availability, room capacity, student groups, and your preferences into one clear weekly timetable.</p><button className="button dark" onClick={onGenerate} disabled={!canEdit}><Sparkles size={16} /> {schedule ? 'Generate a new timetable' : 'Generate your first timetable'} <ArrowRight size={16} /></button></div>
      <div className="welcome-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-core"><CalendarDays size={29} /></div><span className="art-chip chip-one">No conflicts</span><span className="art-chip chip-two">AI balanced</span></div>
    </section>
    <section className="stats-grid">{stats.map(stat => <div className="stat-card" key={stat.label}><div className={`stat-icon ${stat.tone}`}><stat.icon size={19} /></div><div><p>{stat.label}</p><strong>{stat.value}</strong><span>{stat.detail}</span></div></div>)}</section>
    <div className="section-heading"><div><p className="eyebrow">Your workspace</p><h2>Plan at a glance</h2></div><button className="text-button" onClick={() => onNavigate('settings')}>Workspace settings <ArrowRight size={15} /></button></div>
    <section className="dashboard-grid">
      <div className="card quick-card"><div className="card-heading"><div><h3>Quick actions</h3><p>Keep your timetable moving.</p></div><span className="heading-icon"><Clock3 size={17} /></span></div><div className="quick-actions"><button onClick={() => onNavigate('courses')}><span className="quick-icon lavender"><BookOpen size={17} /></span><span><strong>Manage courses</strong><small>Set weekly sessions and faculty</small></span><ChevronRight size={16} /></button><button onClick={() => onNavigate('faculty')}><span className="quick-icon peach"><GraduationCap size={17} /></span><span><strong>Check faculty</strong><small>Review availability and limits</small></span><ChevronRight size={16} /></button><button onClick={() => onNavigate('rooms')}><span className="quick-icon blue"><DoorOpen size={17} /></span><span><strong>Review rooms</strong><small>Capacity and room types</small></span><ChevronRight size={16} /></button></div></div>
      <div className="card attention-card"><div className="card-heading"><div><h3>Needs attention</h3><p>Small checks before publishing.</p></div><span className={`attention-count ${attentionCount ? 'has-items' : ''}`}>{attentionCount}</span></div>{attentionCount ? <div className="attention-list">{schedule?.unscheduled.slice(0, 3).map(item => { const course = data.courses.find(row => row.id === item.courseId); return <div className="attention-row" key={item.courseId}><span className="warning-icon"><CircleAlert size={16} /></span><span><strong>{course?.name ?? 'Unknown course'}</strong><small>{item.count} session{item.count === 1 ? '' : 's'} could not be placed</small></span></div>; })}<button className="text-button" onClick={() => onNavigate('timetable')}>Review timetable <ArrowRight size={15} /></button></div> : <div className="empty-mini"><span className="empty-check"><Check size={18} /></span><strong>Everything looks ready</strong><p>Generate a timetable to see conflicts and quality insights here.</p><button className="text-button" onClick={onGenerate}>Run scheduler <ArrowRight size={15} /></button></div>}</div>
    </section>
  </div>;
}

function Timetable({ data, schedule: scheduleResult, onGenerate, onExport, onExportCalendar, onPrint, onEditSession, onAddSession, canEdit, generating, progress }: { data: CollegeData; schedule: ScheduleResult | null; onGenerate: () => void; onExport: () => void; onExportCalendar: () => void; onPrint: () => void; onEditSession: (session: Session) => void; onAddSession: () => void; canEdit: boolean; generating: boolean; progress: number }) {
  const schedule = scheduleResult as ScheduleResult;
  void onExportCalendar;
  const sessions = schedule?.sessions ?? [];
  const findCourse = (id: string) => data.courses.find(course => course.id === id);
  const sessionStartingAt = (day: number, period: number) => sessions.find(session => session.day === day && session.period === period);
  const sessionCovering = (day: number, period: number) => sessions.find(session => { const course = findCourse(session.courseId); return session.day === day && course && period > session.period && period < session.period + course.duration; });

  if (!scheduleResult) return <TimetableBoard data={data} schedule={scheduleResult} onGenerate={onGenerate} onExport={onExport} onExportCalendar={onExportCalendar} onPrint={onPrint} onEditSession={onEditSession} onAddSession={onAddSession} canEdit={canEdit} generating={generating} progress={progress} />;
  return <TimetableBoard data={data} schedule={scheduleResult} onGenerate={onGenerate} onExport={onExport} onExportCalendar={onExportCalendar} onPrint={onPrint} onEditSession={onEditSession} onAddSession={onAddSession} canEdit={canEdit} generating={generating} progress={progress} />;

  return <div className="page-stack">
    <div className="page-intro"><div><p className="eyebrow">Weekly view</p><h2>Your academic rhythm</h2><p className="muted">A conflict-free view across {data.groups.length} student group{data.groups.length === 1 ? '' : 's'} and {data.rooms.length} room{data.rooms.length === 1 ? '' : 's'}.</p></div><div className="intro-actions"><span className="quality-pill"><Sparkles size={15} /> Quality <strong>{schedule ? `${schedule.quality}%` : '—'}</strong></span>{schedule && <><button className="button secondary" onClick={onAddSession} disabled={!canEdit || !schedule.unscheduled.length}><Plus size={16} /> Place session</button><button className="button secondary" onClick={onExport}><Download size={16} /> CSV</button><button className="button secondary" onClick={onExportCalendar}>ICS</button><button className="button secondary" onClick={onPrint}><Printer size={16} /> Print</button></>}<button className="button primary" onClick={onGenerate} disabled={!canEdit || generating}><RefreshCw size={16} className={generating ? 'spin' : ''} /> {generating ? `Generating ${progress}%` : 'Regenerate'}</button></div></div>
    {!schedule ? <div className="empty-state card"><div className="empty-illustration"><CalendarDays size={32} /></div><h3>Your timetable is waiting</h3><p>Add your courses, faculty, rooms, and student groups, then let the scheduler find the best arrangement.</p><button className="button primary" onClick={onGenerate} disabled={!canEdit || !data.courses.length || generating}><Sparkles size={16} /> Generate timetable</button></div> : <>
      {schedule.unscheduled.length > 0 && <div className="notice warning"><CircleAlert size={17} /><span>{schedule.unscheduled.reduce((total, item) => total + item.count, 0)} session{schedule.unscheduled.reduce((total, item) => total + item.count, 0) === 1 ? '' : 's'} need manual attention. Review the course details below.</span></div>}
      <section className="timetable-card card"><div className="timetable-toolbar"><div><h3>Weekly timetable</h3><p>{canEdit ? 'Click any session to move it, remove it, or lock it before regenerating.' : 'Viewer access: timetable changes are disabled.'}</p></div><div className="legend"><span><i className="legend-dot sage" /> Lecture</span><span><i className="legend-dot sand" /> Lab</span><span><Lock size={12} /> Locked</span></div></div><div className="timetable-scroll"><div className="timetable-grid"><div className="time-header">Time</div>{DAYS.map(day => <div className="day-header" key={day}>{day.slice(0, 3)}<small>{day}</small></div>)}{PERIODS.map((period, periodIndex) => <div className="timetable-row" key={period.start}><div className="time-label"><strong>{period.label}</strong><span>{period.start} – {period.end}</span></div>{DAYS.map((day, dayIndex) => { const session = sessionStartingAt(dayIndex, periodIndex); const continued = !session && sessionCovering(dayIndex, periodIndex); const course = session ? findCourse(session.courseId) : continued ? findCourse(continued.courseId) : undefined; const room = session ? data.rooms.find(item => item.id === session.roomId) : undefined; return <div className={`timetable-cell ${continued ? 'continued' : ''}`} key={day}>{session && course ? <button type="button" className={`session-card ${course.color}`} onClick={() => onEditSession(session)} disabled={!canEdit} title={canEdit ? 'Edit session' : 'Viewer access'}><strong>{course.code}{session.locked && <Lock size={10} className="session-lock" />}</strong><span>{course.name}</span><small>{room?.name ?? 'Room unavailable'} · {course.duration}p</small></button> : continued ? <span className="continued-label">Continues</span> : <span className="empty-slot">·</span>}</div>; })}</div>)}</div></div></section>
      <section className="card schedule-summary"><div className="card-heading"><div><h3>Generation summary</h3><p>What the scheduler found in this run.</p></div><span className="generated-time">{new Date(schedule.generatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></div><div className="summary-metrics"><div><strong>{sessions.length}</strong><span>sessions placed</span></div><div><strong>{data.rooms.length}</strong><span>rooms available</span></div><div><strong>{schedule.unscheduled.reduce((total, item) => total + item.count, 0)}</strong><span>sessions remaining</span></div></div></section>
    </>}
  </div>;
}

function TimetableBoard({ data, schedule, onGenerate, onExport, onExportCalendar, onPrint, onEditSession, onAddSession, canEdit, generating, progress }: { data: CollegeData; schedule: ScheduleResult | null; onGenerate: () => void; onExport: () => void; onExportCalendar: () => void; onPrint: () => void; onEditSession: (session: Session) => void; onAddSession: () => void; canEdit: boolean; generating: boolean; progress: number }) {
  void onExportCalendar;
  const sessions = schedule?.sessions ?? [];
  const findCourse = (id: string) => data.courses.find(course => course.id === id);
  const starts = (day: number, period: number) => sessions.filter(session => session.day === day && session.period === period);
  const continues = (day: number, period: number) => sessions.filter(session => { const course = findCourse(session.courseId); return session.day === day && course && period > session.period && period < session.period + course.duration; });
  const unscheduledCount = schedule?.unscheduled.reduce((total, item) => total + item.count, 0) ?? 0;
  return <div className="page-stack">
    <div className="page-intro"><div><p className="eyebrow">Weekly view</p><h2>Your academic rhythm</h2><p className="muted">A conflict-free view across {data.groups.length} student group{data.groups.length === 1 ? '' : 's'} and {data.rooms.length} room{data.rooms.length === 1 ? '' : 's'}.</p></div><div className="intro-actions"><span className="quality-pill"><Sparkles size={15} /> Quality <strong>{schedule ? `${schedule.quality}%` : '—'}</strong></span>{schedule && <><button className="button secondary" onClick={onAddSession} disabled={!canEdit || !schedule.unscheduled.length}><Plus size={16} /> Place session</button><button className="button secondary" onClick={onExport}><Download size={16} /> CSV</button><button className="button secondary" onClick={onExportCalendar}>ICS</button><button className="button secondary" onClick={onPrint}><Printer size={16} /> Print</button></>}<button className="button primary" onClick={onGenerate} disabled={!canEdit || generating}><RefreshCw size={16} className={generating ? 'spin' : ''} /> {generating ? `Generating ${progress}%` : 'Regenerate'}</button></div></div>
    {!schedule ? <div className="empty-state card"><div className="empty-illustration"><CalendarDays size={32} /></div><h3>Your timetable is waiting</h3><p>Add your courses, faculty, rooms, and student groups, then let the scheduler find the best arrangement.</p><button className="button primary" onClick={onGenerate} disabled={!canEdit || !data.courses.length || generating}><Sparkles size={16} /> Generate timetable</button></div> : <>
      {unscheduledCount > 0 && <div className="notice warning"><CircleAlert size={17} /><span>{unscheduledCount} session{unscheduledCount === 1 ? '' : 's'} need manual attention. Review the course details below.</span></div>}
      <section className="timetable-card card"><div className="timetable-toolbar"><div><h3>Weekly timetable</h3><p>{canEdit ? 'Click any session to move it, remove it, or lock it before regenerating.' : 'Viewer access: timetable changes are disabled.'}</p></div><div className="legend"><span><i className="legend-dot sage" /> Lecture</span><span><i className="legend-dot sand" /> Lab</span><span><Lock size={12} /> Locked</span></div></div><div className="timetable-scroll"><div className="timetable-grid"><div className="time-header">Time</div>{DAYS.map(day => <div className="day-header" key={day}>{day.slice(0, 3)}<small>{day}</small></div>)}{PERIODS.map((period, periodIndex) => <div className="timetable-row" key={period.start}><div className="time-label"><strong>{period.label}</strong><span>{period.start} – {period.end}</span></div>{DAYS.map((day, dayIndex) => { const active = starts(dayIndex, periodIndex); const continuation = active.length ? [] : continues(dayIndex, periodIndex); return <div className={`timetable-cell ${continuation.length ? 'continued' : ''}`} key={day}>{active.length ? active.map(session => { const course = findCourse(session.courseId); const room = data.rooms.find(item => item.id === session.roomId); return course ? <button type="button" className={`session-card ${course.color}`} key={session.id} onClick={() => onEditSession(session)} disabled={!canEdit} title={canEdit ? 'Edit session' : 'Viewer access'}><strong>{course.code}{session.locked && <Lock size={10} className="session-lock" />}</strong><span>{course.name}</span><small>{room?.name ?? 'Room unavailable'} · {course.duration}p · {data.groups.find(group => group.id === course.groupId)?.name ?? ''}</small></button> : null; }) : continuation.map(session => <span className="continued-label" key={session.id}>Continues · {findCourse(session.courseId)?.code}</span>)}</div>; })}</div>)}</div></div></section>
      <section className="card schedule-summary"><div className="card-heading"><div><h3>Generation summary</h3><p>What the scheduler found in this run.</p></div><span className="generated-time">{new Date(schedule.generatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></div><div className="summary-metrics"><div><strong>{sessions.length}</strong><span>sessions placed</span></div><div><strong>{data.rooms.length}</strong><span>rooms available</span></div><div><strong>{unscheduledCount}</strong><span>sessions remaining</span></div></div></section>
    </>}
  </div>;
}

function ResourceList({ kind, data, schedule, onAdd, onEdit, onDelete, canEdit }: { kind: ResourceKind; data: CollegeData; schedule: ScheduleResult | null; onAdd: () => void; onEdit: (id: string) => void; onDelete: (id: string) => void; canEdit: boolean }) {
  const titles: Record<ResourceKind, string> = { courses: 'Courses', faculty: 'Faculty members', rooms: 'Rooms', groups: 'Student groups' };
  const descriptions: Record<ResourceKind, string> = { courses: 'Define what needs to be taught and how often.', faculty: 'Set teaching capacity and unavailable periods.', rooms: 'Make rooms and laboratories available to the solver.', groups: 'Tell ISchedule who shares each timetable.' };
  const rows = data[kind];
  const sessionCount = (id: string) => schedule?.sessions.filter(session => session.courseId === id).length ?? 0;
  if (!canEdit) { onAdd = () => undefined; onEdit = () => undefined; onDelete = () => undefined; }
  return <div className="page-stack"><div className="page-intro"><div><p className="eyebrow">Workspace resources</p><h2>{titles[kind]}</h2><p className="muted">{descriptions[kind]}</p></div><button className="button primary" onClick={onAdd}><Plus size={17} /> Add {singular[kind]}</button></div><section className="card resource-card">{rows.length ? <div className="table-scroll"><table className="resource-table"><thead><tr>{kind === 'courses' ? <><th>Course</th><th>Assigned faculty</th><th>Group</th><th>Weekly plan</th><th /></> : kind === 'faculty' ? <><th>Faculty member</th><th>Department</th><th>Daily limit</th><th>Availability</th><th /></> : kind === 'rooms' ? <><th>Room</th><th>Building</th><th>Type</th><th>Capacity</th><th /></> : <><th>Student group</th><th>Department</th><th>Semester</th><th>Students</th><th /></>}</tr></thead><tbody>{rows.map(row => { if (kind === 'courses') { const course = row as CollegeData['courses'][number]; const faculty = data.faculty.find(item => item.id === course.facultyId); const group = data.groups.find(item => item.id === course.groupId); return <tr key={course.id}><td><div className="resource-name"><span className={`table-color ${course.color}`} /><span><strong>{course.name}</strong><small>{course.code}</small></span></div></td><td>{faculty?.name ?? <span className="missing">Unassigned</span>}</td><td>{group?.name ?? <span className="missing">Unassigned</span>}</td><td><strong>{course.weeklySessions}×</strong><small className="table-subtext">{course.duration} period{course.duration === 1 ? '' : 's'} · {sessionCount(course.id)} placed</small></td><td><RowActions onEdit={() => onEdit(course.id)} onDelete={() => onDelete(course.id)} /></td></tr>; } if (kind === 'faculty') { const faculty = row as CollegeData['faculty'][number]; const unavailable = faculty.unavailable.length; return <tr key={faculty.id}><td><div className="resource-name avatar-name"><span className="avatar">{faculty.name.replace(/^(Dr\.?|Prof\.?)\s+/i, '').split(' ').map(part => part[0]).slice(0, 2).join('')}</span><span><strong>{faculty.name}</strong><small>{faculty.email || 'No email provided'}</small></span></div></td><td>{faculty.department}</td><td>{faculty.maxDailyPeriods} periods</td><td><span className="availability-status"><i className={unavailable ? 'status-dot muted-dot' : 'status-dot'} />{unavailable ? `${unavailable} blocked` : 'Fully available'}</span></td><td><RowActions onEdit={() => onEdit(faculty.id)} onDelete={() => onDelete(faculty.id)} /></td></tr>; } if (kind === 'rooms') { const room = row as CollegeData['rooms'][number]; return <tr key={room.id}><td><div className="resource-name"><span className={`room-icon ${room.type}`}><DoorOpen size={16} /></span><span><strong>{room.name}</strong><small>{room.type === 'lab' ? 'Laboratory' : 'Lecture room'}</small></span></div></td><td>{room.building}</td><td><span className={`type-badge ${room.type}`}>{room.type === 'lab' ? 'Lab' : 'Lecture'}</span></td><td>{room.capacity} seats</td><td><RowActions onEdit={() => onEdit(room.id)} onDelete={() => onDelete(room.id)} /></td></tr>; } const group = row as CollegeData['groups'][number]; return <tr key={group.id}><td><div className="resource-name"><span className="group-icon"><Users size={16} /></span><span><strong>{group.name}</strong><small>Semester {group.semester}</small></span></div></td><td>{group.department}</td><td>Semester {group.semester}</td><td>{group.size} students</td><td><RowActions onEdit={() => onEdit(group.id)} onDelete={() => onDelete(group.id)} /></td></tr>; })}</tbody></table></div> : <div className="table-empty"><div className="empty-illustration"><Plus size={25} /></div><h3>No {titles[kind].toLowerCase()} yet</h3><p>Add your first {singular[kind]} to give the scheduler more context.</p><button className="button secondary" onClick={onAdd}><Plus size={16} /> Add {singular[kind]}</button></div>}</section></div>;
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return <div className="row-actions"><button className="table-action" onClick={onEdit}>Edit</button><button className="table-action danger" aria-label="Delete" onClick={onDelete}><Trash2 size={15} /></button></div>;
}

function SettingsPage({ data, onChange, onImport, onExport, onReset, canEdit }: { data: CollegeData; onChange: (data: CollegeData, message?: string) => void; onImport: () => void; onExport: () => void; onReset: () => void; canEdit: boolean }) {
  if (!canEdit) { onChange = () => undefined; onImport = () => undefined; onReset = () => undefined; }
  const preferences = data.preferences;
  function toggleDay(day: number) {
    const days = preferences.days.includes(day) ? preferences.days.filter(item => item !== day) : [...preferences.days, day].sort((a, b) => a - b);
    if (!days.length) return;
    onChange({ ...data, preferences: { ...preferences, days } }, 'Teaching days updated. Generate a new timetable to apply the preference.');
  }
  function togglePreference(key: 'preferMorning' | 'balancedDays' | 'avoidLastPeriod' | 'avoidGaps') {
    onChange({ ...data, preferences: { ...preferences, [key]: !preferences[key] } }, 'Scheduling preference updated.');
  }
  const preferenceRows: { key: 'preferMorning' | 'balancedDays' | 'avoidLastPeriod' | 'avoidGaps'; label: string; description: string }[] = [
    { key: 'preferMorning', label: 'Prefer morning classes', description: 'Place more classes before the lunch break when possible.' },
    { key: 'balancedDays', label: 'Balance student days', description: 'Spread each group’s classes across the week instead of stacking them.' },
    { key: 'avoidLastPeriod', label: 'Avoid the last period', description: 'Use the final period only when it helps complete the timetable.' },
    { key: 'avoidGaps', label: 'Reduce empty gaps', description: 'Prefer compact student days with fewer long breaks between classes.' },
  ];
  return <div className="page-stack"><div className="page-intro"><div><p className="eyebrow">Workspace preferences</p><h2>Settings</h2><p className="muted">Shape how Campusly builds a timetable for your campus.</p></div></div><div className="settings-grid"><section className="card settings-card"><div className="card-heading"><div><h3>Teaching days</h3><p>Choose the days available for regular classes.</p></div><CalendarDays size={18} className="muted-icon" /></div><div className="day-toggle-grid">{DAYS.map((day, index) => <button key={day} className={`day-toggle ${preferences.days.includes(index) ? 'selected' : ''}`} onClick={() => toggleDay(index)}><span>{preferences.days.includes(index) ? <Check size={16} /> : null}</span>{day}</button>)}</div></section><section className="card settings-card"><div className="card-heading"><div><h3>Scheduling preferences</h3><p>Soft preferences guide the AI without breaking hard constraints.</p></div><Sparkles size={18} className="muted-icon" /></div><div className="preference-list">{preferenceRows.map(row => <button className="preference-row" key={row.key} onClick={() => togglePreference(row.key)}><span className={`toggle ${preferences[row.key] ? 'on' : ''}`}><span /></span><span><strong>{row.label}</strong><small>{row.description}</small></span></button>)}</div></section><section className="card settings-card backup-card"><div className="card-heading"><div><h3>Backup and restore</h3><p>Keep a portable copy of all resources and the latest timetable.</p></div><FileJson size={18} className="muted-icon" /></div><div className="settings-actions"><button className="button secondary" onClick={onExport}><Download size={16} /> Export JSON</button><button className="button secondary" onClick={onImport}><Upload size={16} /> Import JSON</button></div></section><section className="card settings-card danger-card"><div className="card-heading"><div><h3>Sample workspace</h3><p>Load a fresh set of courses, faculty, rooms, and groups for a quick demo.</p></div></div><button className="button secondary" onClick={onReset}>Restore sample data</button></section></div></div>;
}

function AdminUsers({ data }: { data: CollegeData }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { listUsers().then(setUsers).catch(reason => setError(reason instanceof Error ? reason.message : 'Users could not be loaded.')); }, []);
  async function changeRole(user: AuthUser, role: UserRole, linkedId: string) {
    try {
      // A role change must not carry a faculty ID into a student account (or vice versa).
      const link = user.role === role ? linkedId : '';
      const updated = await updateUserRole(user.id, role, role === 'faculty' ? link : undefined, role === 'student' ? link : undefined);
      setUsers(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Role could not be updated.'); }
  }
  async function resetPassword(user: AuthUser) {
    const password = window.prompt(`Set a temporary password for ${user.name} (8+ characters):`);
    if (!password) return;
    try { await resetUserPassword(user.id, password); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Password could not be reset.'); }
  }
  return <section className="card admin-users"><div className="card-heading"><div><p className="eyebrow">Administrator controls</p><h3>Accounts and access</h3><p>Assign roles and link faculty or student accounts to workspace records.</p></div><Users size={18} className="muted-icon" /></div>{error && <div className="notice error" role="alert">{error}</div>}<div className="admin-user-list">{users.map(user => <div className="admin-user-row" key={user.id}><div className="admin-user-identity"><span className="avatar">{user.name.split(' ').map(part => part[0]).slice(0, 2).join('')}</span><span><strong>{user.name}</strong><small>{user.email}</small></span></div><select value={user.role} onChange={event => void changeRole(user, event.target.value as UserRole, user.role === 'faculty' ? user.facultyId ?? '' : user.groupId ?? '')}><option value="admin">Admin</option><option value="planner">Planner</option><option value="faculty">Faculty</option><option value="student">Student</option><option value="viewer">Viewer</option></select>{user.role === 'faculty' && <select value={user.facultyId ?? ''} onChange={event => void changeRole(user, user.role, event.target.value)}><option value="">Link faculty record…</option>{data.faculty.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}{user.role === 'student' && <select value={user.groupId ?? ''} onChange={event => void changeRole(user, user.role, event.target.value)}><option value="">Link student group…</option>{data.groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}<button className="table-action" onClick={() => void resetPassword(user)}>Reset password</button></div>)}</div></section>;
}

function AdminWorkspaceControls() {
  const [versions, setVersions] = useState<{ id: number; name: string; revision: number; published: number; createdBy: string; createdAt: string }[]>([]);
  const [message, setMessage] = useState('');
  const refresh = () => { void listVersions().then(setVersions).catch(reason => setMessage(reason instanceof Error ? reason.message : 'Versions could not be loaded.')); };
  useEffect(refresh, []);
  async function create() {
    const name = window.prompt('Name this timetable version (for example: CSE Semester 3 · 2026–27):');
    if (!name) return;
    try { await createVersion(name); setMessage('Version saved.'); refresh(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Version could not be saved.'); }
  }
  async function invite() {
    const email = window.prompt('Email address to invite:');
    if (!email) return;
    const role = window.prompt('Role: planner, faculty, student, or viewer', 'planner') as UserRole;
    if (!['planner', 'faculty', 'student', 'viewer'].includes(role)) return;
    try { const result = await createInvitation(email, role); setMessage(`Invitation created: ${result.link}`); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Invitation could not be created.'); }
  }
  async function publish(id: number) {
    try { await publishVersion(id); setMessage('Version published.'); refresh(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Version could not be published.'); }
  }
  return <section className="card admin-users"><div className="card-heading"><div><p className="eyebrow">Publishing</p><h3>Timetable versions</h3><p>Save named semester drafts and publish one version for faculty and students.</p></div><CalendarDays size={18} className="muted-icon" /></div>{message && <div className="notice info" role="status">{message}</div>}<div className="settings-actions"><button className="button secondary" onClick={create}><Plus size={16} /> Save current version</button><button className="button secondary" onClick={invite}><Users size={16} /> Invite account</button></div><div className="admin-user-list">{versions.length ? versions.map(version => <div className="admin-user-row" key={version.id}><div className="admin-user-identity"><span className={`type-badge ${version.published ? 'published' : ''}`}>{version.published ? 'Published' : 'Draft'}</span><span><strong>{version.name}</strong><small>Revision {version.revision} · {version.createdBy}</small></span></div>{!version.published && <button className="table-action" onClick={() => void publish(version.id)}>Publish</button>}</div>) : <p className="muted">No saved versions yet.</p>}</div></section>;
}

function AuthScreen({ initialError, onSignedIn, onOffline }: { initialError?: string; onSignedIn: (user: AuthUser) => Promise<void>; onOffline: () => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? '');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      if (mode === 'forgot') {
        const result = await requestPasswordReset(String(form.get('email') ?? ''));
        setMessage(`If an account exists for this email, a reset link has been sent.${result.developmentToken ? ` Development link token: ${result.developmentToken}` : ''}`);
        setMode('login');
        return;
      }
      const invitation = new URLSearchParams(window.location.search).get('invite') ?? undefined;
      const user = mode === 'login'
        ? await login(String(form.get('email') ?? ''), String(form.get('password') ?? ''))
        : await register(String(form.get('name') ?? ''), String(form.get('email') ?? ''), String(form.get('password') ?? ''), String(form.get('role') ?? 'planner') as UserRole, invitation);
      await onSignedIn(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authentication failed.');
      clearAuthToken();
    } finally {
      setBusy(false);
    }
  }
  const isForgot = mode === 'forgot';
  return <div className="auth-shell"><div className="auth-card"><div className="auth-brand"><span className="brand-mark"><Sparkles size={18} /></span><strong>Campusly</strong></div><p className="eyebrow">Intelligent timetable planning</p><h1>{isForgot ? 'Reset your password.' : mode === 'login' ? 'Welcome back.' : 'Create your workspace.'}</h1><p className="auth-subtitle">{isForgot ? 'Enter your email and we will send a secure reset link.' : mode === 'login' ? 'Sign in to open your shared academic planning workspace.' : 'Start planning courses, rooms, faculty, and student groups together.'}</p>{error && <div className="notice error" role="alert">{error}</div>}{message && <div className="notice success" role="status">{message}</div>}<form className="auth-form" onSubmit={submit}>{mode === 'register' && <label>Full name<input name="name" required maxLength={100} autoComplete="name" placeholder="e.g. Nitish Kumar" /></label>}<label>Email<input name="email" required type="email" autoComplete="email" placeholder="you@college.edu" /></label>{!isForgot && <label>Password<input name="password" required type="password" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" /></label>}{mode === 'register' && <label>Account role<select name="role" defaultValue="planner"><option value="planner">Planner · can edit schedules</option><option value="viewer">Viewer · read-only access</option></select></label>}<button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? 'Connecting…' : isForgot ? 'Send reset link' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={16} /></button></form>{mode === 'login' && <button className="text-button auth-forgot" onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}>Forgot password?</button>}<div className="auth-divider"><span>or</span></div><button className="button secondary auth-offline" onClick={onOffline}>Continue with local workspace</button><p className="auth-switch">{isForgot ? 'Remembered your password?' : mode === 'login' ? 'New to Campusly?' : 'Already have an account?'} <button type="button" onClick={() => { setMode(isForgot || mode === 'register' ? 'login' : 'register'); setError(''); setMessage(''); }}>{isForgot || mode === 'register' ? 'Sign in' : 'Create an account'}</button></p></div></div>;
}

function AccountActionScreen({ kind, token }: { kind: 'verify' | 'reset'; token: string }) {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { if (kind === 'verify') await verifyEmail(token); else await resetPassword(token, password); setMessage(kind === 'verify' ? 'Email verified. You can now sign in.' : 'Password changed. You can now sign in.'); } catch (reason) { setError(reason instanceof Error ? reason.message : 'This link could not be used.'); }
  }
  return <div className="auth-shell"><div className="auth-card"><div className="auth-brand"><span className="brand-mark"><Sparkles size={18} /></span><strong>Campusly</strong></div><p className="eyebrow">Account security</p><h1>{kind === 'verify' ? 'Verify your email.' : 'Choose a new password.'}</h1>{error && <div className="notice error">{error}</div>}{message && <div className="notice success">{message}</div>}{kind === 'reset' && !message && <form className="auth-form" onSubmit={submit}><label>New password<input type="password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} /></label><button className="button primary auth-submit">Change password <ArrowRight size={16} /></button></form>}{kind === 'verify' && !message && <button className="button primary auth-submit" onClick={() => void submit(new Event('submit') as unknown as FormEvent<HTMLFormElement>)}>Verify email <ArrowRight size={16} /></button>}<p className="auth-switch"><a href="/">Return to sign in</a></p></div></div>;
}

export default App;
