import { useEffect, useState, type ChangeEvent } from 'react';
import { Download, FileUp, ShieldCheck } from 'lucide-react';
import type { CollegeData } from '../types';
import { csvTemplate, dataFingerprint, previewCsvImport, type CsvImportKind, type CsvImportPreview, type CsvImportIssue } from '../csv';
import './resources.css';

export const MAX_CSV_FILE_BYTES = 2 * 1024 * 1024;

const labels: Record<CsvImportKind, string> = {
  courses: 'Courses',
  faculty: 'Faculty',
  rooms: 'Rooms',
  groups: 'Student groups',
};

export interface BulkImportProps {
  data: CollegeData;
  onImport: (data: CollegeData) => void;
}

function downloadTemplate(kind: CsvImportKind) {
  const url = URL.createObjectURL(new Blob([csvTemplate(kind)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `ischedule-${kind}-template.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function issueText(next: CsvImportIssue): string {
  const location = next.row === undefined ? '' : `Row ${next.row}${next.field ? ` · ${next.field}` : ''}: `;
  return `${location}${next.message}`;
}

export default function BulkImport({ data, onImport }: BulkImportProps) {
  const [kind, setKind] = useState<CsvImportKind>('courses');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [fileError, setFileError] = useState('');
  const [message, setMessage] = useState('');
  const stale = Boolean(preview && preview.dataFingerprint !== dataFingerprint(data));
  const hasErrors = Boolean(fileError || preview?.errors.length || stale);

  useEffect(() => {
    if (text) setPreview(previewCsvImport(data, kind, text));
  }, [kind]);

  function updateText(next: string) {
    setText(next);
    setFileError('');
    setMessage('');
    setPreview(next ? previewCsvImport(data, kind, next) : null);
  }

  function changeKind(next: CsvImportKind) {
    setKind(next);
    setPreview(null);
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_CSV_FILE_BYTES) {
      setFileError('CSV files must be 2 MB or smaller.');
      setPreview(null);
      setMessage('');
      return;
    }
    try {
      updateText(await file.text());
    } catch {
      setFileError('This CSV file could not be read.');
      setPreview(null);
    }
  }

  function confirmImport() {
    if (!preview || hasErrors) return;
    if (preview.dataFingerprint !== dataFingerprint(data)) {
      setMessage('The workspace changed while this preview was open. Review the CSV again before confirming.');
      return;
    }
    onImport(preview.data);
    setMessage(`Imported ${preview.totalRows} ${labels[kind].toLowerCase()} (${preview.additions} added, ${preview.updates} updated).`);
    setText('');
    setPreview(null);
  }

  return <section className="card bulk-import-card" aria-labelledby="bulk-import-title">
    <div className="card-heading">
      <div><p className="eyebrow">Structured resource import</p><h3 id="bulk-import-title">Bulk CSV import</h3><p>Add or update resources without removing rows that are not in the file.</p></div>
      <FileUp size={19} className="muted-icon" />
    </div>
    <div className="bulk-import-controls">
      <label>Resource type<select value={kind} onChange={event => changeKind(event.target.value as CsvImportKind)}>{(Object.keys(labels) as CsvImportKind[]).map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
      <label className="bulk-file-label">Choose CSV<input type="file" accept=".csv,text/csv" onChange={event => void readFile(event)} /></label>
      <button type="button" className="button secondary" onClick={() => downloadTemplate(kind)}><Download size={15} /> Download {labels[kind].toLowerCase()} template</button>
    </div>
    <p className="bulk-import-help">Use explicit IDs from the template. Course <code>facultyId</code> and <code>groupId</code> must match existing IDs. Array fields use <code>|</code> between values. Existing IDs update their row; optional fields left blank or omitted preserve existing values.</p>
    {fileError && <div className="notice error" role="alert">{fileError}</div>}
    <label className="bulk-text-label">CSV text preview<textarea aria-label="CSV text preview" value={text} onChange={event => updateText(event.target.value)} placeholder="Choose a CSV file or paste CSV text here…" rows={7} /></label>
    {preview && <>
      <div className="bulk-summary" role="status"><span><strong>{preview.totalRows}</strong> row{preview.totalRows === 1 ? '' : 's'} · <strong>{preview.additions}</strong> add · <strong>{preview.updates}</strong> update</span>{preview.valid && !stale && <span className="bulk-valid"><ShieldCheck size={15} /> Ready to import</span>}</div>
      {stale && <div className="notice warning" role="alert">The workspace changed after this preview was created. Re-enter or reselect the CSV before confirming.</div>}
      {preview.errors.length > 0 && <div className="notice error bulk-error-list" role="alert"><strong>Fix these CSV errors before confirming:</strong><ul>{preview.errors.map((next, index) => <li key={`${next.row ?? 'file'}-${next.field ?? 'general'}-${index}`}>{issueText(next)}</li>)}</ul></div>}
      <div className="bulk-preview-scroll"><table className="bulk-preview-table"><thead><tr>{preview.headers.map(header => <th key={header}>{header}</th>)}<th>Status</th></tr></thead><tbody>{preview.rows.length ? preview.rows.map(row => <tr key={row.row} className={row.issues.length ? 'has-error' : ''}>{preview.headers.map(header => <td key={header} title={row.values[header]}>{row.values[header]}</td>)}<td><span className={`bulk-row-status ${row.action}`} title={row.issues.map(issueText).join(' ')}>{row.issues.length ? `${row.issues.length} error${row.issues.length === 1 ? '' : 's'}` : row.action}</span></td></tr>) : <tr><td colSpan={preview.headers.length + 1}>No data rows found.</td></tr>}</tbody></table></div>
    </>}
    {message && <div className="notice success" role="status">{message}</div>}
    <div className="bulk-import-footer"><small>Maximum 500 records per resource kind · maximum file size 2 MB</small><button type="button" className="button primary" onClick={confirmImport} disabled={!preview || hasErrors}>Confirm import</button></div>
  </section>;
}
