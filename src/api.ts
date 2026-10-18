import type { CollegeData, Faculty, SavedWorkspace, ScheduleResult, WorkspaceSummary, AcademicTerm } from './types';

export type UserRole = 'admin' | 'planner' | 'faculty' | 'student' | 'viewer';
export interface AuthUser { id: string; name: string; email: string; role: UserRole; facultyId?: string | null; groupId?: string | null; active?: boolean; emailVerified?: boolean; createdAt?: string }
const ACTIVE_KEY = 'ischedule.auth.active';
let activeWorkspaceId = 1;

type ApiResponse<T> = T & { error?: string };

function scopedPath(path: string) {
  const url = new URL(path, 'http://ischedule.local');
  url.searchParams.set('workspaceId', String(activeWorkspaceId));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function setActiveWorkspaceId(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Workspace ID must be a positive integer.');
  activeWorkspaceId = id;
}
export function getActiveWorkspaceId() { return activeWorkspaceId; }

async function request<T>(path: string, options: RequestInit = {}, scoped = true): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(scoped ? scopedPath(path) : path, { ...options, headers, credentials: 'include' });
  const value = await response.json() as ApiResponse<T>;
  if (!response.ok) throw new Error(value.error || 'The server request failed.');
  return value;
}

export function hasAuthToken() { return localStorage.getItem(ACTIVE_KEY) === '1'; }
export function clearAuthToken() { localStorage.removeItem(ACTIVE_KEY); }

async function authRequest(path: string, value: Record<string, unknown>) {
  const result = await request<{ user: AuthUser }>(path, { method: 'POST', body: JSON.stringify(value) });
  localStorage.setItem(ACTIVE_KEY, '1');
  return result.user;
}

export function login(email: string, password: string) { return authRequest('/api/auth/login', { email, password }); }
export function register(name: string, email: string, password: string, role: UserRole, invite?: string) { return authRequest('/api/auth/register', { name, email, password, role, invite }); }
export async function currentUser() { return (await request<{ user: AuthUser }>('/api/auth/me')).user; }
export async function logout() { try { await request('/api/auth/logout', { method: 'POST', body: '{}' }, false); } catch { /* The local session marker is still cleared if the server is offline. */ } finally { clearAuthToken(); } }
export async function getRemoteWorkspace() { return request<{ workspace: SavedWorkspace; revision: number }>('/api/workspace'); }
export async function getPublishedWorkspace() { return (await request<{ version: { payload: SavedWorkspace } | null }>('/api/published')).version?.payload ?? null; }
export async function saveRemoteWorkspace(workspace: SavedWorkspace, revision: number) { return request<{ workspace: SavedWorkspace; revision: number }>('/api/workspace', { method: 'PUT', body: JSON.stringify({ workspace, revision }) }); }
export async function listWorkspaces(): Promise<WorkspaceSummary[]> { return (await request<{ workspaces: WorkspaceSummary[] }>('/api/workspaces', {}, false)).workspaces; }
export async function createWorkspace(input: { name: string; term?: AcademicTerm; sourceWorkspaceId?: number; copySchedule?: boolean }): Promise<{ id: number }> {
  return request<{ id: number }>('/api/workspaces', { method: 'POST', body: JSON.stringify(input) }, false);
}
export async function generateAiSchedule(data: CollegeData, schedule: ScheduleResult | null) {
  return (await request<{ schedule: ScheduleResult }>('/api/ai/plan', { method: 'POST', body: JSON.stringify({ workspace: { version: 1, data, schedule } }) })).schedule;
}
export async function listUsers() { return (await request<{ users: AuthUser[] }>('/api/users')).users; }
export async function updateUserRole(id: string, role: UserRole, facultyId?: string, groupId?: string) { return (await request<{ user: AuthUser }>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ role, facultyId, groupId }) })).user; }
export async function resetUserPassword(id: string, password: string) { await request(`/api/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }); }
export async function requestPasswordReset(email: string) { return request<{ ok: boolean; developmentToken?: string }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }, false); }
export async function resetPassword(token: string, password: string) { await request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }, false); }
export async function verifyEmail(token: string) { await request('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }, false); }
export async function createInvitation(email: string, role: UserRole) { return request<{ link: string; token?: string }>('/api/invitations', { method: 'POST', body: JSON.stringify({ email, role }) }); }
export async function listVersions() { return (await request<{ versions: { id: number; name: string; revision: number; published: number; createdBy: string; createdAt: string }[] }>('/api/versions')).versions; }
export async function createVersion(name: string) { return request<{ id: number }>('/api/versions', { method: 'POST', body: JSON.stringify({ name }) }); }
export async function publishVersion(id: number) { await request(`/api/versions/${id}/publish`, { method: 'POST', body: '{}' }); }
export async function listAudit() { return (await request<{ audit: { actor: string; action: string; details: string; createdAt: string }[] }>('/api/audit')).audit; }
export async function getAvailability(): Promise<{ faculty: Faculty; revision: number }> { return request<{ faculty: Faculty; revision: number }>('/api/availability'); }
export async function saveAvailability(unavailable: string[], preferred: string[], revision: number): Promise<{ faculty: Faculty; revision: number }> {
  return request<{ faculty: Faculty; revision: number }>('/api/availability', { method: 'PUT', body: JSON.stringify({ unavailable, preferred, revision }) });
}
