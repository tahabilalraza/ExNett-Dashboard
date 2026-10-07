import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Pencil, Archive, ExternalLink } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useLookups } from '../hooks/useLookups';
import { PageHeader, Button, Badge, EmptyState, Modal, Field, DataTable, Pagination, Alert, Spinner, date } from '../components/ui';

export const idOf = value => typeof value === 'object' && value ? value._id : value || '';
export const displayName = value => typeof value === 'object' && value ? value.fullName || value.projectName || value.clientName || value.name || '' : '';
export const canManage = user => ['admin', 'manager'].includes(user?.role);
export const textValue = value => value ?? '';
export const dateInput = value => value ? String(value).slice(0, 10) : '';
export const cleanRefs = (values, refs = []) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, refs.includes(key) ? value || null : value]));
export function useResource(path) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setError('');
    try { const data = await api.get(path); if (current === sequence.current) setResult(data); }
    catch (err) { if (current === sequence.current) setError(err.message || 'Unable to load data.'); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [path]);
  useEffect(() => { reload(); return () => { sequence.current += 1; }; }, [reload]);
  return { result, loading, error, reload };
}
export function useDebounce(value, delay = 250) {
  const [delayed, setDelayed] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDelayed(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return delayed;
}
export function Input({ label, value, onChange, ...props }) {
  return <Field label={label}><input value={textValue(value)} onChange={event => onChange(event.target.value)} {...props} /></Field>;
}
export function Textarea({ label, value, onChange, ...props }) {
  return <Field label={label}><textarea value={textValue(value)} onChange={event => onChange(event.target.value)} rows={3} {...props} /></Field>;
}
export function Select({ label, value, onChange, options = [], placeholder = 'Select…', required, ...props }) {
  return <Field label={label}><select value={idOf(value)} onChange={event => onChange(event.target.value)} required={required} {...props}><option value="">{placeholder}</option>{options.map(option => { const key = typeof option === 'string' ? option : option._id ?? option.value; const name = typeof option === 'string' ? option : option.label ?? displayName(option); return <option key={key} value={key}>{name}</option>; })}</select></Field>;
}
export function ErrorNotice({ error, retry }) {
  return error ? <Alert type="error"><span>{error}</span>{retry && <Button variant="secondary" onClick={retry}>Retry</Button>}</Alert> : null;
}
export function DeleteButton({ label = 'Archive', onDelete, disabled }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    setBusy(true); setError('');
    try { await onDelete(); setConfirm(false); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <><Button variant="danger" type="button" disabled={disabled} onClick={() => setConfirm(true)}><Archive size={15} />{label}</Button>{confirm && <Modal title={`${label} this record?`} onClose={() => !busy && setConfirm(false)}><p>This removes the record from active views. Historical relationships remain available for reporting.</p><ErrorNotice error={error} /><div className="toolbar"><Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>Cancel</Button><Button variant="danger" onClick={remove} disabled={busy}>{busy ? 'Saving…' : label}</Button></div></Modal>}</>;
}
export function SearchBox({ value, onChange, placeholder }) {
  return <div className="search-input"><Search size={17} aria-hidden="true" /><input aria-label={placeholder || 'Search'} placeholder={placeholder || 'Search…'} value={value} onChange={event => onChange(event.target.value)} /></div>;
}

const blankProject = { projectName: '', client: '', industry: '', sector: '', owner: '', status: 'Draft', priority: 'Normal', startDate: '', deadline: '', completedDate: '', description: '', notes: '' };
export function ProjectForm({ project, lookups, onSaved, onClose }) {
  const [values, setValues] = useState(() => ({ ...blankProject, ...project, client: idOf(project?.client), industry: idOf(project?.industry), sector: idOf(project?.sector), owner: idOf(project?.owner), startDate: dateInput(project?.startDate), deadline: dateInput(project?.deadline), completedDate: dateInput(project?.completedDate) }));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (key, value) => setValues(previous => ({ ...previous, [key]: value, ...(key === 'industry' ? { sector: '' } : {}) }));
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const payload = cleanRefs(Object.fromEntries(Object.keys(blankProject).map(key => [key, values[key]])), ['client', 'industry', 'sector', 'owner']);
    ['startDate', 'deadline', 'completedDate'].forEach(key => { payload[key] = values[key] || null; });
    try { const result = project?._id ? await api.put(`/projects/${project._id}`, payload) : await api.post('/projects', payload); await onSaved(result.data); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Modal title={project?._id ? 'Edit project' : 'Create project'} onClose={() => !busy && onClose()}><form onSubmit={submit}><ErrorNotice error={error} /><div className="form-grid"><Input label="Project name" value={values.projectName} onChange={value => set('projectName', value)} required maxLength={200} /><Select label="Client" value={values.client} onChange={value => set('client', value)} options={lookups.clients} placeholder="No client" /><Select label="Industry" value={values.industry} onChange={value => set('industry', value)} options={lookups.industries} placeholder="Unclassified" /><Select label="Sector" value={values.sector} onChange={value => set('sector', value)} options={(lookups.sectors || []).filter(sector => !values.industry || idOf(sector.industry) === values.industry)} placeholder="Unclassified" /><Select label="Owner" value={values.owner} onChange={value => set('owner', value)} options={lookups.users} placeholder="Unassigned" /><Select label="Status" value={values.status} onChange={value => set('status', value)} options={lookups.projectStatuses || ['Draft']} required /><Select label="Priority" value={values.priority} onChange={value => set('priority', value)} options={['Low', 'Normal', 'High', 'Urgent']} required /><Input label="Start date" type="date" value={values.startDate} onChange={value => set('startDate', value)} /><Input label="Deadline" type="date" value={values.deadline} onChange={value => set('deadline', value)} /><Input label="Completed date" type="date" value={values.completedDate} onChange={value => set('completedDate', value)} /></div><Textarea label="Description" value={values.description} onChange={value => set('description', value)} /><Textarea label="Internal notes" value={values.notes} onChange={value => set('notes', value)} /><div className="toolbar form-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save project'}</Button></div></form></Modal>;
}
export default function Projects() {
  const { user } = useAuth(); const { lookups = {}, error: lookupError } = useLookups();
  const [search, setSearch] = useState(''); const query = useDebounce(search); const [status, setStatus] = useState(''); const [page, setPage] = useState(1); const [editing, setEditing] = useState(null);
  const { result, loading, error, reload } = useResource(`/projects?page=${page}&search=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}&sort=createdAt&order=desc`);
  useEffect(() => setPage(1), [query, status]);
  const rows = result?.data || [];
  const columns = [{ key: 'projectName', label: 'Project', render: row => <Link className="record-link" to={`/projects/${row._id}`}>{row.projectName}<small>{row.projectId}</small></Link> }, { key: 'client', label: 'Client', render: row => row.client ? <Link to={`/clients/${idOf(row.client)}`}>{displayName(row.client)}</Link> : '—' }, { key: 'status', label: 'Status', render: row => <Badge>{row.status}</Badge> }, { key: 'priority', label: 'Priority' }, { key: 'owner', label: 'Owner', render: row => displayName(row.owner) || 'Unassigned' }, { key: 'deadline', label: 'Deadline', render: row => date(row.deadline) }, { key: 'actions', label: 'Actions', render: row => <div className="toolbar"><Button variant="secondary" onClick={() => setEditing(row)} aria-label={`Edit ${row.projectName}`}><Pencil size={15} /></Button><Link className="button button-secondary" to={`/projects/${row._id}`} aria-label={`Open ${row.projectName}`}><ExternalLink size={15} /></Link>{canManage(user) && <DeleteButton onDelete={async () => { await api.delete(`/projects/${row._id}`); await reload(); }} />}</div> }];
  return <div className="page-stack"><PageHeader title="Projects" description="Manage client briefs, deadlines, and expert pipelines." action={<Button onClick={() => setEditing({})}><Plus size={17} />Create project</Button>} /><ErrorNotice error={lookupError} /><div className="panel"><div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Search projects…" /><Select label="Status" value={status} onChange={setStatus} options={lookups.projectStatuses} placeholder="All statuses" /></div><ErrorNotice error={error} retry={reload} />{loading ? <Spinner /> : rows.length ? <><DataTable columns={columns} rows={rows} /><Pagination pagination={result?.pagination} onPageChange={setPage} /></> : <EmptyState title="No projects found" description={search || status ? 'Adjust your search or status filter.' : 'Create a project to organize a client brief and its expert pipeline.'} action={<Button onClick={() => setEditing({})}>Create project</Button>} />}</div>{editing && <ProjectForm project={editing} lookups={lookups} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}</div>;
}
