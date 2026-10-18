import { COLORS, type CollegeData, type Course, type Faculty, type Room, type StudentGroup } from './types';
import { dataIssues } from './workspace';

export type CsvImportKind = 'courses' | 'faculty' | 'rooms' | 'groups';

export interface CsvImportIssue {
  row?: number;
  field?: string;
  message: string;
}

export interface CsvPreviewRow {
  row: number;
  values: Record<string, string>;
  action: 'add' | 'update' | 'invalid';
  issues: CsvImportIssue[];
}

export interface CsvImportPreview {
  kind: CsvImportKind;
  headers: string[];
  rows: CsvPreviewRow[];
  errors: CsvImportIssue[];
  issues: CsvImportIssue[];
  data: CollegeData;
  dataFingerprint: string;
  totalRows: number;
  additions: number;
  updates: number;
  valid: boolean;
  canImport: boolean;
}

export const CSV_FIELDS: Record<CsvImportKind, readonly string[]> = {
  courses: ['id', 'name', 'code', 'facultyId', 'groupId', 'weeklySessions', 'duration', 'roomType', 'color', 'requiredFeatures'],
  faculty: ['id', 'name', 'email', 'department', 'maxDailyPeriods', 'unavailable', 'preferred'],
  rooms: ['id', 'name', 'building', 'capacity', 'type', 'features'],
  groups: ['id', 'name', 'department', 'size', 'semester'],
};

const REQUIRED_FIELDS: Record<CsvImportKind, readonly string[]> = {
  courses: ['id', 'name', 'code', 'facultyId', 'groupId', 'weeklySessions', 'duration', 'roomType', 'color'],
  faculty: ['id', 'name', 'department', 'maxDailyPeriods'],
  rooms: ['id', 'name', 'building', 'capacity', 'type'],
  groups: ['id', 'name', 'department', 'size', 'semester'],
};

const TEMPLATE_ROWS: Record<CsvImportKind, Record<string, string>> = {
  courses: {
    id: 'course-001', name: 'Sample course', code: 'CS101', facultyId: 'faculty-001', groupId: 'group-001',
    weeklySessions: '3', duration: '1', roomType: 'lecture', color: 'sage', requiredFeatures: 'projector',
  },
  faculty: {
    id: 'faculty-001', name: 'Dr. Sample Faculty', email: 'faculty@example.edu', department: 'Computer Science',
    maxDailyPeriods: '5', unavailable: '0-6|4-6', preferred: '0-0|1-1',
  },
  rooms: {
    id: 'room-001', name: 'Sample Room', building: 'Academic Block A', capacity: '50', type: 'lecture', features: 'projector|whiteboard',
  },
  groups: {
    id: 'group-001', name: 'Sample group', department: 'Computer Science', size: '40', semester: '3',
  },
};

interface ParsedCsvRow {
  row: number;
  fields: string[];
}

interface CsvParseResult {
  rows: ParsedCsvRow[];
  error?: CsvImportIssue;
}

interface RowCandidate {
  row: number;
  id: string;
  value?: Course | Faculty | Room | StudentGroup;
  issues: CsvImportIssue[];
}

function emptyClone(data: CollegeData): CollegeData {
  return {
    ...data,
    courses: [...data.courses],
    faculty: [...data.faculty],
    rooms: [...data.rooms],
    groups: [...data.groups],
  };
}

export function dataFingerprint(data: CollegeData): string {
  return JSON.stringify(data);
}

function issue(message: string, row?: number, field?: string): CsvImportIssue {
  return { ...(row === undefined ? {} : { row }), ...(field === undefined ? {} : { field }), message };
}

function addIssue(issues: CsvImportIssue[], next: CsvImportIssue) {
  if (!issues.some(existing => existing.row === next.row && existing.field === next.field && existing.message === next.message)) issues.push(next);
}

function parseCsv(text: string): CsvParseResult {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: ParsedCsvRow[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;
  let line = 1;
  let rowLine = 1;

  const finishRow = () => {
    fields.push(field);
    if (fields.some(value => value.trim() !== '')) rows.push({ row: rowLine, fields });
    fields = [];
    field = '';
    afterQuote = false;
    rowLine = line;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
        if (character === '\n') line += 1;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ',' || character === '\n' || character === '\r') {
        afterQuote = false;
      } else if (character === ' ' || character === '\t') {
        continue;
      } else {
        return { rows, error: issue('Malformed CSV: a quoted field contains characters after its closing quote.', line) };
      }
    }

    if (character === '"') {
      if (field.length > 0) return { rows, error: issue('Malformed CSV: quoted fields must start at the beginning of a field.', line) };
      inQuotes = true;
    } else if (character === ',') {
      fields.push(field);
      field = '';
    } else if (character === '\n') {
      finishRow();
      line += 1;
    } else if (character === '\r') {
      finishRow();
      if (source[index + 1] === '\n') index += 1;
      line += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) return { rows, error: issue('Malformed CSV: an opening quote is not closed.', rowLine) };
  if (field.length > 0 || fields.length > 0) finishRow();
  return { rows };
}

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function serializeCsv(rows: string[][]): string {
  return `${rows.map(row => row.map(escapeCsv).join(',')).join('\r\n')}\r\n`;
}

/** Return a ready-to-download header and example row for one resource kind. */
export function csvTemplate(kind: CsvImportKind): string {
  const fields = CSV_FIELDS[kind];
  return serializeCsv([fields as string[], fields.map(field => TEMPLATE_ROWS[kind][field] ?? '')]);
}

export const templateCsv = csvTemplate;
export const getCsvTemplate = csvTemplate;

function valuesFor(headers: string[], fields: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, fields[index] ?? '']));
}

function trimmed(value: string | undefined): string {
  return (value ?? '').trim();
}

function textField(fields: Record<string, string>, field: string, row: number, issues: CsvImportIssue[], max = 200): string {
  const value = trimmed(fields[field]);
  if (!value) addIssue(issues, issue('This field is required.', row, field));
  else if (value.length > max) addIssue(issues, issue(`Use no more than ${max} characters.`, row, field));
  return value;
}

function numberField(fields: Record<string, string>, field: string, row: number, issues: CsvImportIssue[], min: number, max: number): number {
  const raw = trimmed(fields[field]);
  if (!raw) {
    addIssue(issues, issue('This number is required.', row, field));
    return NaN;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    addIssue(issues, issue('The number must be finite.', row, field));
    return NaN;
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    addIssue(issues, issue(`Use a whole number from ${min} to ${max}.`, row, field));
    return NaN;
  }
  return value;
}

function listField(fields: Record<string, string>, field: string, row: number, issues: CsvImportIssue[], optional = true): string[] | undefined {
  const raw = trimmed(fields[field]);
  if (!raw) return optional ? undefined : [];
  const values = raw.split('|').map(value => value.trim());
  if (values.some(value => !value)) {
    addIssue(issues, issue('Use | between values and do not leave an empty item.', row, field));
    return undefined;
  }
  const unique = [...new Set(values)];
  if (unique.some(value => value.length > 60)) addIssue(issues, issue('Each value must be 60 characters or fewer.', row, field));
  return unique;
}

function slotField(fields: Record<string, string>, field: string, row: number, issues: CsvImportIssue[], optional = true): string[] | undefined {
  const values = listField(fields, field, row, issues, optional);
  if (!values) return values;
  if (values.some(value => !/^[0-4]-[0-6]$/.test(value))) addIssue(issues, issue('Use period IDs such as 0-0 or 4-6.', row, field));
  return values;
}

function enumField(fields: Record<string, string>, field: string, row: number, issues: CsvImportIssue[], allowed: readonly string[]): string {
  const value = trimmed(fields[field]);
  if (!allowed.includes(value)) addIssue(issues, issue(`Use one of: ${allowed.join(', ')}.`, row, field));
  return value;
}

function candidateFor(kind: CsvImportKind, fields: Record<string, string>, row: number, existing: CollegeData): RowCandidate {
  const issues: CsvImportIssue[] = [];
  const id = textField(fields, 'id', row, issues);
  const name = textField(fields, 'name', row, issues);

  if (kind === 'courses') {
    const facultyId = textField(fields, 'facultyId', row, issues);
    const groupId = textField(fields, 'groupId', row, issues);
    const code = textField(fields, 'code', row, issues);
    const weeklySessions = numberField(fields, 'weeklySessions', row, issues, 1, 5);
    const duration = numberField(fields, 'duration', row, issues, 1, 3);
    const roomType = enumField(fields, 'roomType', row, issues, ['lecture', 'lab']);
    const color = enumField(fields, 'color', row, issues, COLORS);
    const requiredFeatures = listField(fields, 'requiredFeatures', row, issues);
    if (facultyId && !existing.faculty.some(member => member.id === facultyId)) addIssue(issues, issue('Reference an existing faculty id.', row, 'facultyId'));
    if (groupId && !existing.groups.some(group => group.id === groupId)) addIssue(issues, issue('Reference an existing group id.', row, 'groupId'));
    const value: Course = { id, name, code, facultyId, groupId, weeklySessions, duration, roomType: roomType as Course['roomType'], color: color as Course['color'], ...(requiredFeatures === undefined ? {} : { requiredFeatures }) };
    return { row, id, value, issues };
  }

  if (kind === 'faculty') {
    const email = trimmed(fields.email);
    if (email.length > 200) addIssue(issues, issue('Use no more than 200 characters.', row, 'email'));
    const department = textField(fields, 'department', row, issues);
    const maxDailyPeriods = numberField(fields, 'maxDailyPeriods', row, issues, 1, 7);
    const unavailable = slotField(fields, 'unavailable', row, issues, false) ?? [];
    const preferred = slotField(fields, 'preferred', row, issues);
    const current = existing.faculty.find(member => member.id === id);
    const effectiveUnavailable = trimmed(fields.unavailable) ? unavailable : current?.unavailable ?? unavailable;
    const effectivePreferred = preferred ?? current?.preferred;
    if (effectivePreferred?.some(slot => effectiveUnavailable.includes(slot))) addIssue(issues, issue('Preferred periods must be disjoint from unavailable periods.', row, 'preferred'));
    const value: Faculty = { id, name, email, department, maxDailyPeriods, unavailable, ...(preferred === undefined ? {} : { preferred }) };
    return { row, id, value, issues };
  }

  if (kind === 'rooms') {
    const building = textField(fields, 'building', row, issues);
    const capacity = numberField(fields, 'capacity', row, issues, 1, 1000);
    const type = enumField(fields, 'type', row, issues, ['lecture', 'lab']);
    const features = listField(fields, 'features', row, issues);
    const value: Room = { id, name, building, capacity, type: type as Room['type'], ...(features === undefined ? {} : { features }) };
    return { row, id, value, issues };
  }

  const department = textField(fields, 'department', row, issues);
  const size = numberField(fields, 'size', row, issues, 1, 1000);
  const semester = numberField(fields, 'semester', row, issues, 1, 12);
  const value: StudentGroup = { id, name, department, size, semester };
  return { row, id, value, issues };
}

function mergeValue(kind: CsvImportKind, data: CollegeData, candidate: RowCandidate, fields: Record<string, string>): void {
  if (!candidate.value) return;
  if (kind === 'courses') {
    const current = data.courses.find(course => course.id === candidate.id);
    const value = candidate.value as Course;
    const requiredFeatures = trimmed(fields.requiredFeatures) ? value.requiredFeatures : current?.requiredFeatures;
    const next = { ...(current ?? {}), ...value, ...(requiredFeatures === undefined ? {} : { requiredFeatures }) } as Course;
    data.courses = current ? data.courses.map(course => course.id === candidate.id ? next : course) : [...data.courses, next];
  } else if (kind === 'faculty') {
    const current = data.faculty.find(member => member.id === candidate.id);
    const value = candidate.value as Faculty;
    const next: Faculty = {
      ...(current ?? {}),
      ...value,
      email: trimmed(fields.email) ? value.email : current?.email ?? '',
      unavailable: trimmed(fields.unavailable) ? value.unavailable : current?.unavailable ?? [],
      ...(trimmed(fields.preferred) ? { preferred: value.preferred } : current?.preferred === undefined ? {} : { preferred: current.preferred }),
    } as Faculty;
    data.faculty = current ? data.faculty.map(member => member.id === candidate.id ? next : member) : [...data.faculty, next];
  } else if (kind === 'rooms') {
    const current = data.rooms.find(room => room.id === candidate.id);
    const value = candidate.value as Room;
    const next = { ...(current ?? {}), ...value, ...(trimmed(fields.features) ? { features: value.features } : current?.features === undefined ? {} : { features: current.features }) } as Room;
    data.rooms = current ? data.rooms.map(room => room.id === candidate.id ? next : room) : [...data.rooms, next];
  } else {
    const current = data.groups.find(group => group.id === candidate.id);
    const value = candidate.value as StudentGroup;
    const next = { ...(current ?? {}), ...value } as StudentGroup;
    data.groups = current ? data.groups.map(group => group.id === candidate.id ? next : group) : [...data.groups, next];
  }
}

function rowsFor(kind: CsvImportKind, data: CollegeData): Array<Course | Faculty | Room | StudentGroup> {
  return data[kind];
}

function finishPreview(kind: CsvImportKind, data: CollegeData, headers: string[], rows: CsvPreviewRow[], errors: CsvImportIssue[], original: CollegeData, additions: number, updates: number): CsvImportPreview {
  const uniqueErrors: CsvImportIssue[] = [];
  errors.forEach(next => addIssue(uniqueErrors, next));
  return {
    kind,
    headers,
    rows,
    errors: uniqueErrors,
    issues: uniqueErrors,
    data,
    dataFingerprint: dataFingerprint(original),
    totalRows: rows.length,
    additions,
    updates,
    valid: uniqueErrors.length === 0,
    canImport: uniqueErrors.length === 0,
  };
}

/** Parse and validate one resource CSV without mutating the supplied workspace. */
export function previewCsvImport(data: CollegeData, kind: CsvImportKind, text: string): CsvImportPreview {
  const original = data;
  const parsed = parseCsv(text);
  const base = emptyClone(data);
  if (parsed.error) return finishPreview(kind, base, [], [], [parsed.error], original, 0, 0);
  if (!parsed.rows.length) return finishPreview(kind, base, [], [], [issue('CSV must include a header row.')], original, 0, 0);

  const headers = parsed.rows[0].fields.map(value => value.trim());
  const errors: CsvImportIssue[] = [];
  const allowed = new Set(CSV_FIELDS[kind]);
  const seen = new Set<string>();
  headers.forEach((header, index) => {
    if (!header) addIssue(errors, issue('Header names cannot be empty.', 1));
    if (seen.has(header)) addIssue(errors, issue(`Duplicate header "${header}".`, 1, header || `column ${index + 1}`));
    seen.add(header);
    if (header && !allowed.has(header)) addIssue(errors, issue(`Unknown field "${header}" for ${kind}.`, 1, header));
  });
  REQUIRED_FIELDS[kind].forEach(field => {
    if (!headers.includes(field)) addIssue(errors, issue(`Missing required header "${field}".`, 1, field));
  });
  const dataRows = parsed.rows.slice(1);
  if (!dataRows.length) addIssue(errors, issue('CSV must include at least one data row.', 1));
  if (dataRows.length > 500) addIssue(errors, issue('A CSV import can contain at most 500 records.', 1));
  const importedIds = new Set<string>();
  const previews: CsvPreviewRow[] = [];
  const candidates: Array<{ candidate: RowCandidate; fields: Record<string, string> }> = [];
  let additions = 0;
  let updates = 0;

  dataRows.forEach(parsedRow => {
    const rowIssues: CsvImportIssue[] = [];
    if (parsedRow.fields.length !== headers.length) {
      addIssue(rowIssues, issue(`Expected ${headers.length} fields but found ${parsedRow.fields.length}.`, parsedRow.row));
    }
    const values = valuesFor(headers, parsedRow.fields);
    const candidate = candidateFor(kind, values, parsedRow.row, data);
    candidate.issues.forEach(next => addIssue(rowIssues, next));
    if (candidate.id && importedIds.has(candidate.id)) addIssue(rowIssues, issue(`Duplicate id "${candidate.id}" in this CSV.`, parsedRow.row, 'id'));
    if (candidate.id) importedIds.add(candidate.id);
    if (candidate.id && rowsFor(kind, data).some(record => record.id === candidate.id)) updates += 1;
    else additions += 1;
    candidate.issues = rowIssues;
    candidates.push({ candidate, fields: values });
    previews.push({ row: parsedRow.row, values, action: rowIssues.length ? 'invalid' : rowsFor(kind, data).some(record => record.id === candidate.id) ? 'update' : 'add', issues: rowIssues });
    rowIssues.forEach(next => addIssue(errors, next));
  });

  const currentCount = rowsFor(kind, data).length;
  if (currentCount + additions > 500) addIssue(errors, issue(`${kind} would contain ${currentCount + additions} records; the maximum is 500.`, 1));

  const validationData = emptyClone(data);
  candidates.forEach(({ candidate, fields }) => mergeValue(kind, validationData, candidate, fields));
  const validationIssues = dataIssues(validationData);
  validationIssues.forEach(message => addIssue(errors, issue(message)));
  if (!errors.length) candidates.forEach(({ candidate, fields }) => mergeValue(kind, base, candidate, fields));
  return finishPreview(kind, base, headers, previews, errors, original, additions, updates);
}
