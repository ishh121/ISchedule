import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The server entry is JavaScript and is exercised through Vitest's runtime loader.
import { createApplication } from '../server/app.mjs';
import { generateSchedule } from '../src/scheduler';

type App = ReturnType<typeof createApplication>;
type Result = { response: Response; body: any; cookie?: string };

let app: App;
let baseUrl = '';
const originalFetch = globalThis.fetch;

async function start() {
  app = createApplication();
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
}

async function call(path: string, options: RequestInit = {}, cookie = ''): Promise<Result> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  const response = await originalFetch(`${baseUrl}${path}`, { ...options, headers });
  const body = await response.json();
  const setCookie = response.headers.get('set-cookie');
  return { response, body, cookie: setCookie?.split(';')[0] };
}

async function register(email: string, role = 'viewer', workspaceId = 1, invite?: string) {
  return call(`/api/auth/register?workspaceId=${workspaceId}`, { method: 'POST', body: JSON.stringify({ name: email.split('@')[0], email, password: 'password-123', role, invite }) });
}

async function login(email: string, workspaceId = 1) {
  return call(`/api/auth/login?workspaceId=${workspaceId}`, { method: 'POST', body: JSON.stringify({ email, password: 'password-123' }) });
}

async function json(path: string, cookie: string, method = 'GET', body?: unknown) {
  return call(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, cookie);
}

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  process.env.OPENAI_API_KEY = 'test-provider-key';
  process.env.OPENAI_BASE_URL = 'http://ai.test/v1';
  await start();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('account access and workspace scoping', () => {
  it('bootstraps an admin, makes later self-registration a viewer, and blocks inactive login', async () => {
    const first = await register('owner@example.test', 'planner');
    expect(first.response.status).toBe(201);
    expect(first.body.user.role).toBe('admin');
    const adminCookie = first.cookie!;
    expect((await register('owner@example.test')).response.status).toBe(409);

    expect((await json('/api/workspace', adminCookie)).response.status).toBe(200);
    const later = await register('later@example.test', 'planner');
    expect(later.body.user.role).toBe('viewer');
    expect((await json('/api/workspace', later.cookie!)).response.status).toBe(403);

    const users = await json('/api/users', adminCookie);
    const laterUser = users.body.users.find((user: { email: string }) => user.email === 'later@example.test');
    const updated = await json(`/api/users/${laterUser.id}`, adminCookie, 'PUT', { role: 'viewer', active: false });
    expect(updated.response.status).toBe(200);
    expect((await login('later@example.test')).response.status).toBe(401);

    const reset = await json(`/api/users/${laterUser.id}/reset-password`, adminCookie, 'POST', { password: 'new-password-123' });
    expect(reset.response.status).toBe(200);
    expect((await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'later@example.test', password: 'new-password-123' }) })).response.status).toBe(401);
  });

  it('returns safe workspace metadata to signed-in users and rejects invalid scopes', async () => {
    const owner = await register('metadata@example.test');
    const invalidTerm = await json('/api/workspaces', owner.cookie!, 'POST', { name: 'Invalid term', term: { academicYear: '2027/28', semester: 'Spring', department: 'CS', startDate: '2028-05-20', endDate: '2028-01-10', timeZone: 'Not/AZone' } });
    expect(invalidTerm.response.status).toBe(400);
    const created = await json('/api/workspaces', owner.cookie!, 'POST', { name: 'Spring 2028', term: { academicYear: '2027/28', semester: 'Spring', department: 'CS', startDate: '2028-01-10', endDate: '2028-05-20', timeZone: 'America/New_York' } });
    expect(created.response.status).toBe(201);
    const list = await json('/api/workspaces', owner.cookie!);
    expect(list.body.workspaces).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.id, name: 'Spring 2028', term: expect.objectContaining({ semester: 'Spring' }) })]));
    expect(JSON.stringify(list.body)).not.toContain('courses');
    expect((await json('/api/workspace?workspaceId=not-a-number', owner.cookie!)).response.status).toBe(400);
    expect((await json('/api/workspace?workspaceId=99999', owner.cookie!)).response.status).toBe(404);
  });
});

describe('published, versions, and history isolation', () => {
  it('keeps draft, versions, history, and publication isolated by workspace', async () => {
    const owner = await register('scope-owner@example.test');
    const cookie = owner.cookie!;
    const primary = await json('/api/workspace', cookie);
    const primarySchedule = generateSchedule(primary.body.workspace.data, undefined, 11, 8);
    await json('/api/workspace', cookie, 'PUT', { workspace: { ...primary.body.workspace, schedule: primarySchedule }, revision: primary.body.revision });
    const copyWithoutSchedule = await json('/api/workspaces', cookie, 'POST', { name: 'Data-only copy', sourceWorkspaceId: 1 });
    const copyWithSchedule = await json('/api/workspaces', cookie, 'POST', { name: 'Schedule copy', sourceWorkspaceId: 1, copySchedule: true });
    expect((await json(`/api/workspace?workspaceId=${copyWithoutSchedule.body.id}`, cookie)).body.workspace.schedule).toBeNull();
    expect((await json(`/api/workspace?workspaceId=${copyWithSchedule.body.id}`, cookie)).body.workspace.schedule).not.toBeNull();
    const created = await json('/api/workspaces', cookie, 'POST', { name: 'Second workspace' });
    const workspaceId = created.body.id as number;
    const second = await json(`/api/workspace?workspaceId=${workspaceId}`, cookie);
    expect(second.body.revision).toBe(0);

    const saved = JSON.parse(JSON.stringify(second.body.workspace));
    saved.data.preferences.avoidFirstPeriod = true;
    const savedSecond = await json(`/api/workspace?workspaceId=${workspaceId}`, cookie, 'PUT', { workspace: saved, revision: 0 });
    expect(savedSecond.body.revision).toBe(1);
    const versionSecond = await json(`/api/versions?workspaceId=${workspaceId}`, cookie, 'POST', { name: 'Second draft' });
    expect(versionSecond.response.status).toBe(201);
    expect((await json(`/api/versions/${versionSecond.body.id}/publish?workspaceId=${workspaceId}`, cookie, 'POST', {})).response.status).toBe(200);
    expect((await json('/api/published', cookie)).body.version).toBeNull();
    expect((await json(`/api/published?workspaceId=${workspaceId}`, cookie)).body.version).not.toBeNull();
    expect((await json('/api/versions', cookie)).body.versions).toEqual([]);
    expect((await json(`/api/history?workspaceId=${workspaceId}`, cookie)).body.history.map((entry: { revision: number }) => entry.revision)).toContain(1);
    expect((await json(`/api/versions/${versionSecond.body.id}/publish`, cookie, 'POST', {})).response.status).toBe(404);
  });

  it('does not expose an unpublished draft to faculty or unlinked users', async () => {
    const owner = await register('publish-owner@example.test');
    const ownerCookie = owner.cookie!;
    const workspace = await json('/api/workspace', ownerCookie);
    const facultyId = workspace.body.workspace.data.faculty[0].id;
    const invitation = await json('/api/invitations', ownerCookie, 'POST', { email: 'faculty@example.test', role: 'faculty', facultyId });
    const faculty = await register('faculty@example.test', 'planner', 1, invitation.body.token);
    expect(faculty.body.user.role).toBe('faculty');
    expect(faculty.body.user.facultyId).toBe(facultyId);
    expect((await json('/api/workspace', faculty.cookie!)).response.status).toBe(403);
    expect((await json('/api/published', faculty.cookie!)).body.version).toBeNull();
    expect(invitation.body.token).toBeTruthy();

    const version = await json('/api/versions', ownerCookie, 'POST', { name: 'Published timetable' });
    await json(`/api/versions/${version.body.id}/publish`, ownerCookie, 'POST', {});
    const published = await json('/api/published', faculty.cookie!);
    expect(published.body.version.payload.data.courses.every((course: { facultyId: string }) => course.facultyId === facultyId)).toBe(true);
    expect(published.body.version.payload.data.courses.length).toBeLessThan(workspace.body.workspace.data.courses.length);
  });
});

describe('faculty availability and audit', () => {
  it('uses scoped faculty links, optimistic revisions, conflict checks, and admin-only audit', async () => {
    const owner = await register('availability-owner@example.test');
    const ownerCookie = owner.cookie!;
    const current = await json('/api/workspace', ownerCookie);
    const facultyId = current.body.workspace.data.faculty[0].id;
    const invite = await json('/api/invitations', ownerCookie, 'POST', { email: 'availability-faculty@example.test', role: 'faculty', facultyId });
    const faculty = await register('availability-faculty@example.test', 'viewer', 1, invite.body.token);
    expect(faculty.body.user.role).toBe('faculty');

    const availability = await json('/api/availability', faculty.cookie!);
    expect(availability.response.status).toBe(200);
    expect(availability.body.faculty.id).toBe(facultyId);
    expect(availability.body.revision).toBe(0);
    expect(availability.body.workspace).toBeUndefined();
    expect((await json('/api/audit', faculty.cookie!)).response.status).toBe(403);

    const disjoint = await json('/api/availability', faculty.cookie!, 'PUT', { unavailable: ['1-1'], preferred: ['1-1'], revision: 0 });
    expect(disjoint.response.status).toBe(400);
    const changed = await json('/api/availability', faculty.cookie!, 'PUT', { unavailable: ['1-1'], preferred: ['2-2'], revision: 0 });
    expect(changed.response.status).toBe(200);
    expect(changed.body.revision).toBe(1);
    expect((await json('/api/availability', faculty.cookie!, 'PUT', { unavailable: [], preferred: [], revision: 0 })).response.status).toBe(409);

    const fresh = await json('/api/workspace', ownerCookie);
    const schedule = generateSchedule(fresh.body.workspace.data, undefined, 17, 8);
    const next = { ...fresh.body.workspace, schedule };
    const saved = await json('/api/workspace', ownerCookie, 'PUT', { workspace: next, revision: fresh.body.revision });
    const session = schedule.sessions.find((item: { courseId: string }) => fresh.body.workspace.data.courses.find((course: { id: string; facultyId: string }) => course.id === item.courseId)?.facultyId === facultyId);
    if (session) {
      const conflict = await json('/api/availability', faculty.cookie!, 'PUT', { unavailable: [`${session.day}-${session.period}`], preferred: [], revision: saved.body.revision });
      expect(conflict.response.status).toBe(400);
      expect(conflict.body.error).toContain('draft timetable');
    }
    expect((await json('/api/audit', ownerCookie)).response.status).toBe(200);
  });

  it('rejects unavailable continuation periods in a published-only multi-period session', async () => {
    const owner = await register('published-duration-owner@example.test');
    const ownerCookie = owner.cookie!;
    const initial = await json('/api/workspace', ownerCookie);
    const source = initial.body.workspace;
    const labCourse = source.data.courses.find((course: { duration: number }) => course.duration > 1);
    const faculty = source.data.faculty.find((member: { id: string }) => member.id === labCourse.facultyId);
    const group = source.data.groups.find((item: { id: string }) => item.id === labCourse.groupId);
    const room = source.data.rooms.find((item: { type: string }) => item.type === labCourse.roomType);
    const isolatedData = {
      courses: [{ ...labCourse, weeklySessions: 1 }],
      faculty: [faculty],
      groups: [group],
      rooms: [room],
      preferences: source.data.preferences,
    };
    const publishedSchedule = generateSchedule(isolatedData, undefined, 23, 1);
    expect(publishedSchedule.sessions).toHaveLength(1);

    const saved = await json('/api/workspace', ownerCookie, 'PUT', { workspace: { version: 1, data: isolatedData, schedule: publishedSchedule }, revision: initial.body.revision });
    expect(saved.response.status).toBe(200);
    const version = await json('/api/versions', ownerCookie, 'POST', { name: 'Published lab' });
    expect((await json(`/api/versions/${version.body.id}/publish`, ownerCookie, 'POST', {})).response.status).toBe(200);
    const cleared = await json('/api/workspace', ownerCookie, 'PUT', { workspace: { ...saved.body.workspace, schedule: null }, revision: saved.body.revision });
    expect(cleared.body.workspace.schedule).toBeNull();

    const facultyInvite = await json('/api/invitations', ownerCookie, 'POST', { email: 'published-duration-faculty@example.test', role: 'faculty', facultyId: faculty.id });
    const linkedFaculty = await register('published-duration-faculty@example.test', 'viewer', 1, facultyInvite.body.token);
    const session = publishedSchedule.sessions[0];
    const continuation = `${session.day}-${session.period + 1}`;
    const conflict = await json('/api/availability', linkedFaculty.cookie!, 'PUT', { unavailable: [continuation], preferred: [], revision: cleared.body.revision });
    expect(conflict.response.status).toBe(400);
    expect(conflict.body.error).toContain('published timetable');
  });
});

describe('AI boundary validation', () => {
  it('returns a generic provider error for an invalid AI priority response', async () => {
    const owner = await register('ai-owner@example.test');
    const workspace = await json('/api/workspace', owner.cookie!);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('http://ai.test/')) return new Response(JSON.stringify({ choices: [{ message: { content: '{"courseOrder":["unknown"]}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return originalFetch(input, init);
    });
    const result = await json('/api/ai/plan', owner.cookie!, 'POST', { workspace: workspace.body.workspace });
    expect(result.response.status).toBe(502);
    expect(result.body.error).toContain('invalid course priority list');
    expect(result.body.error).not.toContain('OpenAI');
  });
});
