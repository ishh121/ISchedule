import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The server entry is JavaScript and is exercised through Vitest's runtime loader.
import { createApplication } from '../server/app.mjs';
import { generateSchedule, summarizeSchedule, validateSchedule } from '../src/scheduler';
import type { SavedWorkspace, ScheduleResult } from '../src/types';
import { createDemoData } from './fixtures/demo';

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

async function populateWorkspace(cookie: string, workspaceId = 1) {
  const path = `/api/workspace?workspaceId=${workspaceId}`;
  const current = await json(path, cookie);
  expect(current.response.status).toBe(200);
  const data = createDemoData();
  const saved = await json(path, cookie, 'PUT', { workspace: { ...current.body.workspace, data, schedule: null }, revision: current.body.revision });
  expect(saved.response.status).toBe(200);
  const fresh = await json(path, cookie);
  expect(fresh.response.status).toBe(200);
  expect(fresh.body.workspace.data).toEqual(data);
  expect(fresh.body.workspace.schedule).toBeNull();
  return fresh;
}

function expectEmptyWorkspace(result: Result) {
  expect(result.response.status).toBe(200);
  expect(result.body.revision).toBe(0);
  expect(result.body.workspace.version).toBe(1);
  for (const kind of ['courses', 'faculty', 'rooms', 'groups']) expect(result.body.workspace.data[kind], kind).toEqual([]);
  expect(result.body.workspace.data.preferences).toMatchObject({ days: [0, 1, 2, 3, 4], preferMorning: true, balancedDays: true, avoidLastPeriod: true });
  expect(result.body.workspace.schedule).toBeNull();
}

beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SMTP_HOST', '');
  vi.stubEnv('MAIL_FROM', '');
  vi.stubEnv('OPENAI_API_KEY', 'test-provider-key');
  vi.stubEnv('OPENAI_BASE_URL', 'http://ai.test/v1');
  await start();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await app.close();
  vi.unstubAllEnvs();
});

describe('account access and workspace scoping', () => {
  it('starts the bootstrap workspace empty with default preferences and no schedule', async () => {
    const owner = await register('empty-owner@example.test');
    expectEmptyWorkspace(await json('/api/workspace', owner.cookie!));
  });

  it('creates an empty workspace with default preferences even when an existing workspace has resources', async () => {
    const owner = await register('new-empty-owner@example.test');
    const cookie = owner.cookie!;
    await populateWorkspace(cookie);
    const created = await json('/api/workspaces', cookie, 'POST', { name: 'Empty new workspace' });
    expect(created.response.status).toBe(201);
    expectEmptyWorkspace(await json(`/api/workspace?workspaceId=${created.body.id}`, cookie));
    expect((await json('/api/workspace', cookie)).body.workspace.data).toEqual(createDemoData());
  });

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
    const primary = await populateWorkspace(cookie);
    const primarySchedule = generateSchedule(primary.body.workspace.data, undefined, 11, 8);
    expect(primarySchedule.sessions.length).toBeGreaterThan(0);
    expect((await json('/api/workspace', cookie, 'PUT', { workspace: { ...primary.body.workspace, schedule: primarySchedule }, revision: primary.body.revision })).response.status).toBe(200);
    const copyWithoutSchedule = await json('/api/workspaces', cookie, 'POST', { name: 'Data-only copy', sourceWorkspaceId: 1 });
    const copyWithSchedule = await json('/api/workspaces', cookie, 'POST', { name: 'Schedule copy', sourceWorkspaceId: 1, copySchedule: true });
    expect(copyWithoutSchedule.response.status).toBe(201);
    expect(copyWithSchedule.response.status).toBe(201);
    const dataOnlyCopy = await json(`/api/workspace?workspaceId=${copyWithoutSchedule.body.id}`, cookie);
    const scheduleCopy = await json(`/api/workspace?workspaceId=${copyWithSchedule.body.id}`, cookie);
    expect(dataOnlyCopy.body.workspace.data).toEqual(primary.body.workspace.data);
    expect(dataOnlyCopy.body.workspace.schedule).toBeNull();
    expect(scheduleCopy.body.workspace.data).toEqual(primary.body.workspace.data);
    expect(scheduleCopy.body.workspace.schedule.sessions).toEqual(primarySchedule.sessions);
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
    const workspace = await populateWorkspace(ownerCookie);
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
    expect(published.body.version.payload.data.courses.length).toBeGreaterThan(0);
    expect(published.body.version.payload.data.courses.every((course: { facultyId: string }) => course.facultyId === facultyId)).toBe(true);
    expect(published.body.version.payload.data.courses.length).toBeLessThan(workspace.body.workspace.data.courses.length);
  });

  it('shows the published timetable to viewers without exposing the draft workspace', async () => {
    const owner = await register('viewer-publication-owner@example.test');
    const ownerCookie = owner.cookie!;
    const current = await populateWorkspace(ownerCookie);
    const schedule = generateSchedule(current.body.workspace.data, undefined, 13, 8);
    const saved = await json('/api/workspace', ownerCookie, 'PUT', { workspace: { ...current.body.workspace, schedule }, revision: current.body.revision });
    expect(saved.response.status).toBe(200);

    const viewer = await register('published-viewer@example.test');
    expect((await json('/api/published', viewer.cookie!)).body.version).toBeNull();
    const version = await json('/api/versions', ownerCookie, 'POST', { name: 'Viewer timetable' });
    expect((await json(`/api/versions/${version.body.id}/publish`, ownerCookie, 'POST', {})).response.status).toBe(200);

    const published = await json('/api/published', viewer.cookie!);
    expect(published.response.status).toBe(200);
    expect(published.body.version.payload.data.courses).toHaveLength(saved.body.workspace.data.courses.length);
    expect(published.body.version.payload.schedule.sessions).toHaveLength(schedule.sessions.length);
    expect((await json('/api/workspace', viewer.cookie!)).response.status).toBe(403);
  });

  it('lists history and restores an older draft as a new revision', async () => {
    const owner = await register('history-owner@example.test');
    const ownerCookie = owner.cookie!;
    const first = await populateWorkspace(ownerCookie);
    const changed = JSON.parse(JSON.stringify(first.body.workspace));
    changed.data.preferences.avoidFirstPeriod = true;
    const second = await json('/api/workspace', ownerCookie, 'PUT', { workspace: changed, revision: first.body.revision });
    expect(second.body.revision).toBe(2);

    const history = await json('/api/history', ownerCookie);
    expect(history.response.status).toBe(200);
    expect(history.body.history.map((entry: { revision: number }) => entry.revision)).toEqual([2, 1]);
    expect(history.body.history.every((entry: { payload?: unknown }) => entry.payload === undefined)).toBe(true);

    const restored = await json('/api/history/restore', ownerCookie, 'POST', { targetRevision: 1, revision: 2 });
    expect(restored.response.status).toBe(200);
    expect(restored.body.revision).toBe(3);
    expect(restored.body.workspace).toEqual(first.body.workspace);

    const stale = await json('/api/history/restore', ownerCookie, 'POST', { targetRevision: 2, revision: 2 });
    expect(stale.response.status).toBe(409);
    const latest = await json('/api/workspace', ownerCookie);
    expect(latest.body.revision).toBe(3);
    expect(latest.body.workspace).toEqual(first.body.workspace);

    const viewer = await register('history-viewer@example.test');
    expect((await json('/api/history', viewer.cookie!)).response.status).toBe(403);
    expect((await json('/api/history/restore', viewer.cookie!, 'POST', { targetRevision: 1, revision: 3 })).response.status).toBe(403);
  });
});

describe('faculty availability and audit', () => {
  it('uses scoped faculty links, optimistic revisions, conflict checks, and admin-only audit', async () => {
    const owner = await register('availability-owner@example.test');
    const ownerCookie = owner.cookie!;
    const current = await populateWorkspace(ownerCookie);
    const facultyId = current.body.workspace.data.faculty[0].id;
    const invite = await json('/api/invitations', ownerCookie, 'POST', { email: 'availability-faculty@example.test', role: 'faculty', facultyId });
    const faculty = await register('availability-faculty@example.test', 'viewer', 1, invite.body.token);
    expect(faculty.body.user.role).toBe('faculty');

    const availability = await json('/api/availability', faculty.cookie!);
    expect(availability.response.status).toBe(200);
    expect(availability.body.faculty.id).toBe(facultyId);
    expect(availability.body.revision).toBe(current.body.revision);
    expect(availability.body.workspace).toBeUndefined();
    expect((await json('/api/audit', faculty.cookie!)).response.status).toBe(403);

    const revision = availability.body.revision;
    const disjoint = await json('/api/availability', faculty.cookie!, 'PUT', { unavailable: ['1-1'], preferred: ['1-1'], revision });
    expect(disjoint.response.status).toBe(400);
    const changed = await json('/api/availability', faculty.cookie!, 'PUT', { unavailable: ['1-1'], preferred: ['2-2'], revision });
    expect(changed.response.status).toBe(200);
    expect(changed.body.revision).toBe(revision + 1);
    expect((await json('/api/availability', faculty.cookie!, 'PUT', { unavailable: [], preferred: [], revision })).response.status).toBe(409);

    const fresh = await json('/api/workspace', ownerCookie);
    const schedule = generateSchedule(fresh.body.workspace.data, undefined, 17, 8);
    const next = { ...fresh.body.workspace, schedule };
    const saved = await json('/api/workspace', ownerCookie, 'PUT', { workspace: next, revision: fresh.body.revision });
    expect(saved.response.status).toBe(200);
    const session = schedule.sessions.find((item: { courseId: string }) => fresh.body.workspace.data.courses.find((course: { id: string; facultyId: string }) => course.id === item.courseId)?.facultyId === facultyId);
    expect(session).toBeDefined();
    const conflict = await json('/api/availability', faculty.cookie!, 'PUT', { unavailable: [`${session!.day}-${session!.period}`], preferred: [], revision: saved.body.revision });
    expect(conflict.response.status).toBe(400);
    expect(conflict.body.error).toContain('draft timetable');
    expect((await json('/api/audit', ownerCookie)).response.status).toBe(200);
  });

  it('rejects unavailable continuation periods in a published-only multi-period session', async () => {
    const owner = await register('published-duration-owner@example.test');
    const ownerCookie = owner.cookie!;
    const initial = await populateWorkspace(ownerCookie);
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
  it('rejects an empty workspace before calling the AI provider', async () => {
    const owner = await register('ai-empty@example.test');
    const current = await json('/api/workspace', owner.cookie!);
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const result = await json('/api/ai/plan', owner.cookie!, 'POST', { workspace: current.body.workspace });

    expect(result.response.status).toBe(400);
    expect(result.body.error).toContain('Add at least one course');
    expect(provider).not.toHaveBeenCalled();
    expect((await json('/api/workspace', owner.cookie!)).body).toEqual(current.body);
  });

  async function planningWorkspace(cookie: string, courseCount = 1) {
    const current = await populateWorkspace(cookie);
    const source: SavedWorkspace = current.body.workspace;
    const workspace: SavedWorkspace = {
      ...source,
      data: {
        ...source.data,
        courses: source.data.courses.slice(0, courseCount).map((course, index) => ({
          ...course,
          id: index === 0 ? 'e2e-course' : `e2e-course-${index + 1}`,
          code: `AI${101 + index}`,
          weeklySessions: 2,
        })),
      },
      schedule: null,
    };
    return { current, workspace };
  }

  it('requests exact course IDs with a strict schema and generates a conflict-free schedule preserving locks', async () => {
    const owner = await register('ai-exact-ids@example.test');
    const { workspace } = await planningWorkspace(owner.cookie!, 2);
    const schedule = generateSchedule(workspace.data, undefined, 31, 1);
    expect(schedule.sessions).toHaveLength(4);
    const lockedSession = { ...schedule.sessions[0], locked: true };
    workspace.schedule = summarizeSchedule(workspace.data, [lockedSession], schedule.generatedAt);
    const courseIds = workspace.data.courses.map(course => course.id);
    const provider = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ courseOrder: [...courseIds].reverse() }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', provider);

    const result = await json('/api/ai/plan', owner.cookie!, 'POST', { workspace });
    expect(result.response.status).toBe(200);
    const planned: ScheduleResult = result.body.schedule;
    expect(planned.sessions).toHaveLength(4);
    expect(planned.unscheduled).toEqual([]);
    expect(validateSchedule(workspace.data, planned.sessions)).toEqual([]);
    for (const course of workspace.data.courses) expect(planned.sessions.filter(session => session.courseId === course.id)).toHaveLength(course.weeklySessions);
    expect(planned.sessions.find(session => session.id === lockedSession.id)).toEqual(lockedSession);

    expect(provider).toHaveBeenCalledOnce();
    const [url, init] = provider.mock.calls[0];
    expect(url).toBe('http://ai.test/v1/chat/completions');
    expect(init?.method).toBe('POST');
    const request = JSON.parse(String(init?.body));
    expect(request.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'course_priority',
        strict: true,
        schema: {
          type: 'object',
          required: ['courseOrder'],
          additionalProperties: false,
          properties: {
            courseOrder: { type: 'array', minItems: courseIds.length, maxItems: courseIds.length, items: { type: 'string' } },
          },
        },
      },
    });
    const allowedIds = request.response_format.json_schema.schema.properties.courseOrder.items.enum;
    expect([...allowedIds].sort()).toEqual([...courseIds].sort());
    const prompt = JSON.parse(request.messages.find((message: { role: string }) => message.role === 'user').content);
    expect(prompt.data.courses).toEqual(expect.arrayContaining(workspace.data.courses.map(({ id, code }) => expect.objectContaining({ id, code }))));
    expect(prompt.lockedSessions).toEqual([lockedSession]);
    const instructions = [
      ...request.messages.filter((message: { role: string }) => message.role === 'system').map((message: { content: string }) => message.content),
      ...prompt.instructions,
    ].join('\n');
    expect(instructions).toMatch(/\bcourse(?:\.|\s+)ids?\b/i);
    expect(instructions).toMatch(/\b(?:not|never|instead of|rather than)\b[^\n]*(?:\bcodes?\b|\bcourse\.code\b)/i);
  });

  it.each([
    { name: 'course codes instead of IDs', courseCount: 1, courseOrder: ['AI101'] },
    { name: 'duplicate course IDs', courseCount: 2, courseOrder: ['e2e-course', 'e2e-course'] },
    { name: 'unknown course IDs', courseCount: 1, courseOrder: ['unknown-course'] },
  ])('rejects $name without saving a draft', async ({ courseCount, courseOrder }) => {
    const owner = await register('ai-rejected-order@example.test');
    const { current, workspace } = await planningWorkspace(owner.cookie!, courseCount);
    expect(courseOrder).toHaveLength(workspace.data.courses.length);
    const history = await json('/api/history', owner.cookie!);
    expect(history.response.status).toBe(200);
    const provider = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ courseOrder }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', provider);

    const result = await json('/api/ai/plan', owner.cookie!, 'POST', { workspace });
    expect(provider).toHaveBeenCalledOnce();
    expect(result.response.status).toBe(502);
    expect(result.body.error).toEqual(expect.any(String));
    expect(result.body.schedule).toBeUndefined();
    const fresh = await json('/api/workspace', owner.cookie!);
    expect(fresh.response.status).toBe(200);
    expect(fresh.body).toEqual(current.body);
    const freshHistory = await json('/api/history', owner.cookie!);
    expect(freshHistory.response.status).toBe(200);
    expect(freshHistory.body).toEqual(history.body);
  });

  it('returns a generic provider error for an invalid AI priority response', async () => {
    const owner = await register('ai-owner@example.test');
    const workspace = await populateWorkspace(owner.cookie!);
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
