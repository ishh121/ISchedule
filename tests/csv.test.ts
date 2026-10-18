import { describe, expect, it } from 'vitest';
import { createDemoData } from '../src/seed';
import { csvTemplate, previewCsvImport } from '../src/csv';

describe('resource CSV import', () => {
  it('imports a valid row for each resource kind', () => {
    const data = createDemoData();
    const imports = [
      ['courses', 'id,name,code,facultyId,groupId,weeklySessions,duration,roomType,color,requiredFeatures\ncourse-new,New Course,CS999,f1,g1,2,1,lecture,sage,projector'] as const,
      ['faculty', 'id,name,department,maxDailyPeriods,unavailable,preferred\nfaculty-new,New Faculty,Computer Science,5,4-6,0-0|1-1'] as const,
      ['rooms', 'id,name,building,capacity,type,features\nroom-new,New Room,Block C,80,lecture,projector|whiteboard'] as const,
      ['groups', 'id,name,department,size,semester\ngroup-new,New Group,Computer Science,35,4'] as const,
    ];

    for (const [kind, text] of imports) {
      const result = previewCsvImport(data, kind, text);
      expect(result.valid, `${kind} should be valid`).toBe(true);
      expect(result.additions).toBe(1);
      expect(result.data[kind].some(row => row.id.endsWith('-new'))).toBe(true);
    }
  });

  it('handles BOM, quoted commas, newlines, and escaped quotes', () => {
    const data = createDemoData();
    const text = '\uFEFFid,name,code,facultyId,groupId,weeklySessions,duration,roomType,color\ncourse-new,"Course, with a ""quote""\nand a new line",CS999,f1,g1,2,1,lecture,sage';
    const result = previewCsvImport(data, 'courses', text);

    expect(result.valid).toBe(true);
    expect(result.data.courses.find(course => course.id === 'course-new')?.name).toBe('Course, with a "quote"\nand a new line');
  });

  it('rejects malformed headers, duplicate IDs, and non-finite numbers', () => {
    const data = createDemoData();
    const duplicate = previewCsvImport(data, 'groups', 'id,name,department,size,semester,id\ng-new,Group,Computer Science,30,3,g-other');
    const invalid = previewCsvImport(data, 'groups', 'id,name,department,size,semester\ng-new,Group,Computer Science,Infinity,3\ng-new,Other,Computer Science,30,3');
    const malformed = previewCsvImport(data, 'groups', 'id,name,department,size,semester\ng-new,"Unclosed,Computer Science,30,3');

    expect(duplicate.errors.some(error => error.message.includes('Duplicate header'))).toBe(true);
    expect(invalid.errors.some(error => error.message.includes('finite'))).toBe(true);
    expect(invalid.errors.some(error => error.message.includes('Duplicate id'))).toBe(true);
    expect(malformed.errors.some(error => error.message.includes('opening quote'))).toBe(true);
    expect(invalid.canImport).toBe(false);
  });

  it('rejects missing references and overlapping preferred periods', () => {
    const data = createDemoData();
    const course = previewCsvImport(data, 'courses', 'id,name,code,facultyId,groupId,weeklySessions,duration,roomType,color\nc-new,Course,CS999,missing-faculty,g1,2,1,lecture,sage');
    const faculty = previewCsvImport(data, 'faculty', 'id,name,department,maxDailyPeriods,unavailable,preferred\nf-new,Faculty,Computer Science,5,0-0,0-0');

    expect(course.errors.some(error => error.field === 'facultyId' && error.message.includes('existing faculty'))).toBe(true);
    expect(faculty.errors.some(error => error.field === 'preferred' && error.message.includes('disjoint'))).toBe(true);
  });

  it('preserves omitted optional values and existing rows during updates', () => {
    const data = createDemoData();
    data.rooms[0].features = ['projector'];
    data.courses[0].requiredFeatures = ['projector'];
    data.faculty[0].preferred = ['1-1'];
    const roomCount = data.rooms.length;
    const courseCount = data.courses.length;
    const facultyCount = data.faculty.length;

    const room = previewCsvImport(data, 'rooms', 'id,name,building,capacity,type\nr1,Updated Room,Academic Block A,60,lecture');
    const course = previewCsvImport(data, 'courses', 'id,name,code,facultyId,groupId,weeklySessions,duration,roomType,color\nc1,Updated Course,CS201,f1,g1,3,1,lecture,sage');
    const faculty = previewCsvImport(data, 'faculty', 'id,name,department,maxDailyPeriods\nf1,Updated Faculty,Computer Science,5');
    const added = previewCsvImport(data, 'groups', 'id,name,department,size,semester\ng-new,New Group,Computer Science,30,3');

    expect(room.valid).toBe(true);
    expect(room.data.rooms.find(item => item.id === 'r1')?.features).toEqual(['projector']);
    expect(course.data.courses.find(item => item.id === 'c1')?.requiredFeatures).toEqual(['projector']);
    expect(faculty.data.faculty.find(item => item.id === 'f1')?.preferred).toEqual(['1-1']);
    expect(added.data.groups).toHaveLength(data.groups.length + 1);
    expect(room.data.rooms).toHaveLength(roomCount);
    expect(course.data.courses).toHaveLength(courseCount);
    expect(faculty.data.faculty).toHaveLength(facultyCount);
  });

  it('provides templates with explicit IDs and model fields', () => {
    expect(csvTemplate('courses').split('\r\n')[0]).toContain('facultyId,groupId');
    expect(csvTemplate('faculty')).toContain('faculty-001');
    expect(csvTemplate('rooms')).toContain('features');
    expect(csvTemplate('groups')).toContain('group-001');
  });

  it('enforces the 500-record limit', () => {
    const data = createDemoData();
    const rows = Array.from({ length: 501 }, (_, index) => `g-new-${index},Group ${index},Computer Science,30,3`).join('\n');
    const result = previewCsvImport(data, 'groups', `id,name,department,size,semester\n${rows}`);

    expect(result.canImport).toBe(false);
    expect(result.errors.some(error => error.message.includes('at most 500'))).toBe(true);
  });
});
