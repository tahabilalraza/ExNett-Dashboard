import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Button, Badge, EmptyState, Modal, DataTable, Pagination, Spinner } from '../components/ui';
import { Input, Select, Textarea, ErrorNotice, DeleteButton, SearchBox, useResource, useDebounce, canManage } from './Projects';
const blank = { clientName: '', status: 'Active', primaryContactName: '', primaryContactEmail: '', phone: '', notes: '' };
export function ClientForm({ client, onClose, onSaved }) {
  const [values, setValues] = useState(() => ({ ...blank, ...client })); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (key, value) => setValues(previous => ({ ...previous, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const payload = Object.fromEntries(Object.keys(blank).map(key => [key, values[key]]));
    try { const result = client?._id ? await api.put(`/clients/${client._id}`, payload) : await api.post('/clients', payload); await onSaved(result.data); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Modal title={client?._id ? 'Edit client' : 'Create client'} onClose={() => !busy && onClose()}><form onSubmit={submit}><ErrorNotice error={error} /><div className="form-grid"><Input label="Client name" value={values.clientName} onChange={value => set('clientName', value)} required maxLength={200} /><Select label="Status" value={values.status} onChange={value => set('status', value)} options={['Active', 'Inactive', 'Prospect']} required /><Input label="Primary contact" value={values.primaryContactName} onChange={value => set('primaryContactName', value)} /><Input label="Contact email" type="email" value={values.primaryContactEmail} onChange={value => set('primaryContactEmail', value)} /><Input label="Phone" type="tel" value={values.phone} onChange={value => set('phone', value)} /></div><Textarea label="Notes" value={values.notes} onChange={value => set('notes', value)} /><div className="toolbar form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save client'}</Button></div></form></Modal>;
}
export default function Clients() {
  const { user } = useAuth(); const [search, setSearch] = useState(''); const query = useDebounce(search); const [status, setStatus] = useState(''); const [page, setPage] = useState(1); const [editing, setEditing] = useState(null);
  const { result, loading, error, reload } = useResource(`/clients?page=${page}&search=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}`);
  useEffect(() => setPage(1), [query, status]);
  const columns = [{ key: 'clientName', label: 'Client', render: row => <Link className="record-link" to={`/clients/${row._id}`}>{row.clientName}<small>{row.clientId}</small></Link> }, { key: 'status', label: 'Status', render: row => <Badge>{row.status}</Badge> }, { key: 'primaryContactName', label: 'Primary contact' }, { key: 'primaryContactEmail', label: 'Email', render: row => row.primaryContactEmail ? <a href={`mailto:${row.primaryContactEmail}`}>{row.primaryContactEmail}</a> : '—' }, { key: 'phone', label: 'Phone' }, { key: 'actions', label: 'Actions', render: row => <div className="toolbar"><Button variant="secondary" onClick={() => setEditing(row)} aria-label={`Edit ${row.clientName}`}><Pencil size={15} /></Button>{canManage(user) && <DeleteButton onDelete={async () => { await api.delete(`/clients/${row._id}`); await reload(); }} />}</div> }];
  return <div className="page-stack"><PageHeader title="Clients" description="Keep client contacts and their project history in one place." action={<Button onClick={() => setEditing({})}><Plus size={17} />Create client</Button>} /><div className="panel"><div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Search clients…" /><Select label="Status" value={status} onChange={setStatus} options={['Active', 'Inactive', 'Prospect']} placeholder="All statuses" /></div><ErrorNotice error={error} retry={reload} />{loading ? <Spinner /> : result?.data?.length ? <><DataTable columns={columns} rows={result.data} /><Pagination pagination={result.pagination} onPageChange={setPage} /></> : <EmptyState title="No clients found" description={search || status ? 'Try another search or filter.' : 'Create a client before connecting a new project.'} action={<Button onClick={() => setEditing({})}>Create client</Button>} />}</div>{editing && <ClientForm client={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}</div>;
}
