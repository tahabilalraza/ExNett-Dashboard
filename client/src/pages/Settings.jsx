import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Save } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useLookups } from '../hooks/useLookups';
import { PageHeader, Button, Badge, Modal, DataTable, Pagination, Alert, Spinner } from '../components/ui';
import { Input, Select, Textarea, ErrorNotice, DeleteButton, SearchBox, useResource, useDebounce, idOf, displayName, canManage } from './Projects';

function ProfileSettings() {
  const { user, refreshUser } = useAuth(); const [values, setValues] = useState({ name: user.name, email: user.email, password: '', confirmPassword: '', currentPassword: '' }); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => { setValues(previous => ({ ...previous, name: user.name, email: user.email })); }, [user.name, user.email]);
  const set = (key, value) => setValues(previous => ({ ...previous, [key]: value }));
  const sensitive = values.email.trim().toLowerCase() !== user.email.toLowerCase() || Boolean(values.password);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    if (values.password !== values.confirmPassword) { setError('The new passwords do not match.'); setBusy(false); return; }
    if (new TextEncoder().encode(values.password).length > 72) { setError('Password must be at most 72 UTF-8 bytes.'); setBusy(false); return; }
    try { await api.patch('/auth/profile', { name: values.name, email: values.email, ...(values.password ? { password: values.password } : {}), ...(sensitive ? { currentPassword: values.currentPassword } : {}) }); await refreshUser(); setValues(previous => ({ ...previous, password: '', confirmPassword: '', currentPassword: '' })); setNotice('Your profile was updated.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="panel"><h2 className="section-title">Your profile</h2><p className="muted">Signed in as <strong>{user.role}</strong>.</p>{notice && <Alert type="success">{notice}</Alert>}<form onSubmit={submit}><ErrorNotice error={error} /><div className="form-grid"><Input label="Full name" value={values.name} onChange={value => set('name', value)} required maxLength={200} /><Input label="Email address" type="email" value={values.email} onChange={value => set('email', value)} required /><Input label="New password (optional)" type="password" value={values.password} onChange={value => set('password', value)} autoComplete="new-password" minLength={10} /><Input label="Confirm new password" type="password" value={values.confirmPassword} onChange={value => set('confirmPassword', value)} autoComplete="new-password" required={Boolean(values.password)} /></div>{sensitive && <Input label="Current password to authorize email or password change" type="password" value={values.currentPassword} onChange={value => set('currentPassword', value)} autoComplete="current-password" required />}<div className="form-actions"><Button type="submit" disabled={busy}><Save size={16} />{busy ? 'Saving…' : 'Save profile'}</Button></div></form></section>;
}
function OrganizationSettings({ onSaved }) {
  const { result, loading, error, reload } = useResource('/settings'); const [values, setValues] = useState(null); const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => { if (result?.data) setValues({ organizationName: result.data.organizationName || '', projectStatuses: (result.data.projectStatuses || []).join('\n'), assignmentStatuses: (result.data.assignmentStatuses || []).join('\n') }); }, [result]);
  const set = (key, value) => setValues(previous => ({ ...previous, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setBusy(true); setActionError(''); setNotice('');
    const payload = { organizationName: values.organizationName.trim(), projectStatuses: values.projectStatuses.split('\n').map(line => line.trim()).filter(Boolean), assignmentStatuses: values.assignmentStatuses.split('\n').map(line => line.trim()).filter(Boolean) };
    if (!payload.projectStatuses.length || !payload.assignmentStatuses.length) { setActionError('Keep at least one project status and one assignment status.'); setBusy(false); return; }
    if (payload.projectStatuses.length !== new Set(payload.projectStatuses).size || payload.assignmentStatuses.length !== new Set(payload.assignmentStatuses).size) { setActionError('Status names must be unique within each list.'); setBusy(false); return; }
    try { await api.put('/settings', payload); await reload(); await onSaved(); setNotice('Organization settings saved.'); }
    catch (err) { setActionError(err.message); } finally { setBusy(false); }
  }
  return <section className="panel"><h2 className="section-title">Organization and workflow</h2><ErrorNotice error={error} retry={reload} />{notice && <Alert type="success">{notice}</Alert>}{loading && !values ? <Spinner /> : values && <form onSubmit={submit}><ErrorNotice error={actionError} /><Input label="Organization name" value={values.organizationName} onChange={value => set('organizationName', value)} required maxLength={200} /><div className="form-grid"><Textarea label="Project statuses · one per line" rows={9} value={values.projectStatuses} onChange={value => set('projectStatuses', value)} required /><Textarea label="Assignment statuses · one per line" rows={9} value={values.assignmentStatuses} onChange={value => set('assignmentStatuses', value)} required /></div><p className="muted">These lists appear in project and assignment forms. Keep labels used by existing records so their workflow remains clear.</p><div className="form-actions"><Button type="submit" disabled={busy}><Save size={16} />{busy ? 'Saving…' : 'Save organization'}</Button></div></form>}</section>;
}
function TaxonomyForm({ kind, record, industries, onClose, onSaved }) {
  const [values, setValues] = useState({ name: record?.name || '', industry: idOf(record?.industry), active: record?.active ?? true }); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const payload = { name: values.name.trim(), active: values.active, ...(kind === 'sectors' ? { industry: values.industry } : {}) };
    try { if (record?._id) await api.put(`/${kind}/${record._id}`, payload); else await api.post(`/${kind}`, payload); await onSaved(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Modal title={`${record?._id ? 'Edit' : 'Add'} ${kind === 'sectors' ? 'sector' : 'industry'}`} onClose={() => !busy && onClose()}><form onSubmit={submit}><ErrorNotice error={error} /><Input label="Name" value={values.name} onChange={name => setValues(previous => ({ ...previous, name }))} required maxLength={200} />{kind === 'sectors' && <Select label="Industry" value={values.industry} onChange={industry => setValues(previous => ({ ...previous, industry }))} options={industries} required />}<Select label="Status" value={values.active ? 'active' : 'inactive'} onChange={value => setValues(previous => ({ ...previous, active: value === 'active' }))} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} required /><div className="toolbar form-actions"><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div></form></Modal>;
}
function TaxonomyTable({ kind, industries, onChanged }) {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const query = useDebounce(search); const [editing, setEditing] = useState(null); const { result, loading, error, reload } = useResource(`/${kind}?page=${page}&search=${encodeURIComponent(query)}`);
  useEffect(() => setPage(1), [query]);
  async function saved() { setEditing(null); await reload(); await onChanged(); }
  const columns = [{ key: 'name', label: 'Name' }, ...(kind === 'sectors' ? [{ key: 'industry', label: 'Industry', render: row => displayName(row.industry) || '—' }] : []), { key: 'active', label: 'Status', render: row => <Badge>{row.active ? 'Active' : 'Inactive'}</Badge> }, { key: 'actions', label: 'Actions', render: row => <div className="toolbar"><Button variant="secondary" onClick={() => setEditing(row)} aria-label={`Edit ${row.name}`}><Pencil size={15} /></Button><DeleteButton onDelete={async () => { await api.delete(`/${kind}/${row._id}`); await reload(); await onChanged(); }} /></div> }];
  return <section className="panel"><div className="toolbar section-toolbar"><h2 className="section-title">{kind === 'sectors' ? 'Sectors' : 'Industries'}</h2><Button onClick={() => setEditing({})}><Plus size={16} />Add {kind === 'sectors' ? 'sector' : 'industry'}</Button></div><SearchBox value={search} onChange={setSearch} placeholder={`Search ${kind}…`} /><ErrorNotice error={error} retry={reload} />{loading ? <Spinner /> : <><DataTable rows={result?.data || []} columns={columns} emptyTitle={`No ${kind} found`} /><Pagination pagination={result?.pagination} onPageChange={setPage} /></>}{editing && <TaxonomyForm kind={kind} record={editing} industries={industries} onClose={() => setEditing(null)} onSaved={saved} />}</section>;
}
export default function Settings() {
  const { user } = useAuth(); const { lookups = {}, reload } = useLookups(); const [tab, setTab] = useState('profile');
  return <div className="page-stack"><PageHeader title="Settings" description="Update your profile and configure the workspace." /><div className="tabs"><button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>Profile</button>{canManage(user) && <><button className={tab === 'organization' ? 'active' : ''} onClick={() => setTab('organization')}>Organization</button><button className={tab === 'taxonomy' ? 'active' : ''} onClick={() => setTab('taxonomy')}>Industries and sectors</button></>}</div>{tab === 'profile' ? <ProfileSettings /> : canManage(user) && tab === 'organization' ? <OrganizationSettings onSaved={reload} /> : canManage(user) && <><TaxonomyTable kind="industries" industries={lookups.industries} onChanged={reload} /><TaxonomyTable kind="sectors" industries={lookups.industries} onChanged={reload} /></>}</div>;
}
