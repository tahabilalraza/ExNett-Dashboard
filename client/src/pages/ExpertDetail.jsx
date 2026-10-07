import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Archive, Plus, Mail, Phone, Linkedin, MapPin, BriefcaseBusiness, Building2, UserRound, CalendarDays, ExternalLink, Trash2 } from 'lucide-react';
import { api } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLookups } from '../hooks/useLookups.js';
import { useToast } from '../hooks/useToast.js';
import { Alert, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, Field, Modal, Spinner, date, initials, money, safeUrl } from '../components/ui.jsx';
import ExpertForm from '../components/ExpertForm.jsx';
import { ActivityForm, ActivityTable } from './Activities.jsx';

const refId = value => value?._id || value || '';
const inputDate = value => value ? new Date(value).toISOString().slice(0, 10) : '';
function AssignmentForm({ expert, assignment = {}, assigned = [], lookups, onClose, onSaved }) {
  const [form, setForm] = useState({ project: refId(assignment.project), assignmentStatus: assignment.assignmentStatus || 'Added', assignedAt: inputDate(assignment.assignedAt), contactedAt: inputDate(assignment.contactedAt), screenedAt: inputDate(assignment.screenedAt), interviewDate: inputDate(assignment.interviewDate), completedAt: inputDate(assignment.completedAt), expertRate: assignment.expertRate ?? expert.hourlyRate ?? '', currency: assignment.currency || expert.currency || '', notes: assignment.notes || '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (field, value) => setForm(old => ({ ...old, [field]: value }));
  const save = async event => {
    event.preventDefault(); setSaving(true); setError('');
    const body = { ...form, expertRate: form.expertRate === '' ? null : Number(form.expertRate), currency: form.currency.trim().toUpperCase() };
    ['assignedAt', 'contactedAt', 'screenedAt', 'interviewDate', 'completedAt'].forEach(field => { body[field] = form[field] ? new Date(`${form[field]}T00:00:00.000Z`).toISOString() : null; });
    try {
      if (assignment._id) { delete body.project; await api.put(`/assignments/${assignment._id}`, body); }
      else { body.expert = expert._id; await api.post('/assignments', body); }
      await onSaved();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  return <Modal title={assignment._id ? 'Edit project assignment' : 'Assign expert to a project'} onClose={saving ? undefined : onClose}><form onSubmit={save} className="entity-form">{error && <Alert>{error}</Alert>}<div className="form-grid"><Field label="Project *" className="span-two"><select required value={form.project} disabled={!!assignment._id} onChange={event => set('project', event.target.value)}><option value="">Select a project</option>{lookups.projects.filter(project => assignment._id || !assigned.includes(project._id)).map(project => <option key={project._id} value={project._id}>{project.projectName}</option>)}</select></Field><Field label="Assignment status"><select value={form.assignmentStatus} onChange={event => set('assignmentStatus', event.target.value)}>{[...new Set(['Added', ...lookups.assignmentStatuses, form.assignmentStatus])].map(status => <option key={status}>{status}</option>)}</select></Field><Field label="Assigned date"><input type="date" value={form.assignedAt} onChange={event => set('assignedAt', event.target.value)} /></Field><Field label="Contacted date"><input type="date" value={form.contactedAt} onChange={event => set('contactedAt', event.target.value)} /></Field><Field label="Screened date"><input type="date" value={form.screenedAt} onChange={event => set('screenedAt', event.target.value)} /></Field><Field label="Interview date"><input type="date" value={form.interviewDate} onChange={event => set('interviewDate', event.target.value)} /></Field><Field label="Completed date"><input type="date" value={form.completedAt} onChange={event => set('completedAt', event.target.value)} /></Field><Field label="Expert rate"><input type="number" min="0" step="0.01" value={form.expertRate} onChange={event => set('expertRate', event.target.value)} /></Field><Field label="Currency"><input maxLength={3} pattern="[A-Za-z]{3}" value={form.currency} onChange={event => set('currency', event.target.value.toUpperCase())} placeholder="e.g. USD" /></Field><Field label="Assignment notes" className="span-two"><textarea rows={3} value={form.notes} onChange={event => set('notes', event.target.value)} /></Field></div><div className="form-actions"><Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>Save assignment</Button></div></form></Modal>;
}
function ProfileFact({ icon: Icon, label, children }) {
  return <div className="profile-fact"><Icon size={16} /><div><span>{label}</span><strong>{children || '—'}</strong></div></div>;
}
export default function ExpertDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { lookups, reload: reloadLookups } = useLookups();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [assignment, setAssignment] = useState(null);
  const [activity, setActivity] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const canManage = ['admin', 'manager'].includes(user.role);
  const load = async () => {
    setLoading(true);
    try { const response = await api.get(`/experts/${id}`); setResult(response); setError(''); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);
  const expert = result?.data;
  const assignments = result?.assignments || [];
  const activities = result?.activities || [];
  const saveProfile = async body => { await api.put(`/experts/${id}`, body); setEditing(false); notify('Expert profile updated.'); await load(); reloadLookups(); };
  const saveAssignment = async () => { setAssignment(null); notify('Project assignment saved.'); await load(); };
  const remove = async () => {
    setBusy(true);
    try {
      if (removing.type === 'expert') { await api.delete(`/experts/${id}`); notify('Expert archived.'); navigate('/experts'); }
      else { await api.delete(`/assignments/${removing.item._id}`); notify('Assignment removed.'); setRemoving(null); await load(); }
    } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
  };
  const assignmentColumns = [
    { key: 'project', label: 'Project', render: row => <div className="table-stack"><Link to={`/projects/${refId(row.project)}`} className="table-primary">{row.project?.projectName || 'Archived project'}</Link><small>{row.project?.projectId || ''}</small></div> },
    { key: 'assignmentStatus', label: 'Status', render: row => <Badge>{row.assignmentStatus}</Badge> },
    { key: 'assignedAt', label: 'Assigned', render: row => date(row.assignedAt) },
    { key: 'interviewDate', label: 'Interview', render: row => date(row.interviewDate) },
    { key: 'expertRate', label: 'Expert rate', render: row => money(row.expertRate, row.currency) },
    { key: 'notes', label: 'Notes', render: row => <span className="truncate" title={row.notes}>{row.notes || '—'}</span> },
    { key: 'actions', label: '', render: row => <div className="table-actions"><Button variant="secondary" aria-label="Edit assignment" onClick={() => setAssignment(row)}><Pencil size={14} /></Button>{canManage && <Button variant="ghost" aria-label="Remove assignment" onClick={() => setRemoving({ type: 'assignment', item: row })}><Trash2 size={14} /></Button>}</div> },
  ];
  if (loading && !result) return <Spinner label="Loading expert profile…" />;
  if (!expert) return <div className="page-stack"><Link to="/experts" className="back-link"><ArrowLeft size={15} />Expert network</Link><Alert action={<Button variant="secondary" onClick={load}>Retry</Button>}>{error || 'This expert could not be found.'}</Alert></div>;
  return <div className="page-stack"><Link to="/experts" className="back-link"><ArrowLeft size={15} />Expert network</Link>{error && <Alert>{error}</Alert>}<section className="panel profile-hero"><div className="profile-identity"><span className="avatar profile-avatar">{initials(expert.fullName)}</span><div><div className="profile-heading"><h1>{expert.fullName}</h1><Badge>{expert.status}</Badge></div><p>{expert.currentPosition || 'Position unspecified'}{expert.currentCompany && <> at <strong>{expert.currentCompany}</strong></>}</p><div className="profile-meta"><span>{expert.expertId}</span>{expert.country && <span><MapPin size={13} />{expert.country}</span>}{expert.industry?.name && <span>{expert.industry.name}</span>}</div></div></div><div className="profile-hero-actions"><Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={15} />Edit profile</Button>{canManage && <Button variant="ghost" onClick={() => setRemoving({ type: 'expert' })}><Archive size={16} />Archive</Button>}</div></section><div className="tabs" role="tablist" aria-label="Expert profile sections">{[{ key: 'overview', label: 'Overview' }, { key: 'assignments', label: 'Project assignments', count: assignments.length }, { key: 'activity', label: 'Activity timeline', count: activities.length }, { key: 'history', label: 'Legacy observations', count: expert.legacyObservations?.length || 0 }].map(item => <button key={item.key} id={`tab-${item.key}`} role="tab" aria-selected={tab === item.key} aria-controls={`panel-${item.key}`} className={tab === item.key ? 'tab-active' : ''} onClick={() => setTab(item.key)}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</button>)}</div><div role="tabpanel" aria-labelledby={`tab-${tab}`} id={`panel-${tab}`}>
      {tab === 'overview' && <div className="expert-overview-grid"><div className="page-stack"><Card title="Professional profile"><div className="profile-facts-grid"><ProfileFact icon={Building2} label="Current company">{expert.currentCompany}</ProfileFact><ProfileFact icon={BriefcaseBusiness} label="Current position">{expert.currentPosition}</ProfileFact><ProfileFact icon={BriefcaseBusiness} label="Industry">{expert.industry?.name}</ProfileFact><ProfileFact icon={BriefcaseBusiness} label="Sector">{expert.sector?.name}</ProfileFact><ProfileFact icon={MapPin} label="Country">{expert.country}</ProfileFact><ProfileFact icon={UserRound} label="Recruited by">{expert.recruitedBy?.name || expert.legacyRecruiter}</ProfileFact></div></Card><Card title="Remarks & expertise"><div className="remarks-content">{expert.remarks ? <p>{expert.remarks}</p> : <p className="muted">No profile remarks have been added.</p>}{expert.tags?.length > 0 && <div className="tag-list">{expert.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}</div>}</div></Card><Card title="Project connections" description="Independent statuses and rates for every engagement" action={<Button variant="secondary" onClick={() => setAssignment({})}><Plus size={14} />Assign</Button>}><DataTable columns={assignmentColumns.slice(0, 5)} rows={assignments.slice(0, 4)} emptyTitle="No project assignments yet" emptyDescription="Connect this expert to a project to track outreach and engagement." />{assignments.length > 4 && <Button variant="ghost" onClick={() => setTab('assignments')}>View all {assignments.length} assignments</Button>}</Card></div><div className="page-stack"><Card title="Contact details"><div className="contact-detail-list"><div><Mail size={16} /><div><span>Primary email</span>{expert.email ? <a href={`mailto:${expert.email}`}>{expert.email}</a> : <strong>Not provided</strong>}</div></div>{expert.emails?.filter(email => email !== expert.email).map(email => <div key={email}><Mail size={16} /><div><span>Additional email</span><a href={`mailto:${email}`}>{email}</a></div></div>)}<div><Phone size={16} /><div><span>Phone number</span>{expert.phoneNumber ? <a href={`tel:${expert.phoneNumber}`}>{expert.phoneNumber}</a> : <strong>Not provided</strong>}</div></div><div><Linkedin size={16} /><div><span>LinkedIn</span>{safeUrl(expert.linkedinProfile) ? <a href={safeUrl(expert.linkedinProfile)} target="_blank" rel="noopener noreferrer">View profile <ExternalLink size={12} /></a> : <strong>Not provided</strong>}</div></div></div></Card><Card title="Network details"><dl className="detail-list"><div><dt>Hourly rate</dt><dd>{money(expert.hourlyRate, expert.currency)}</dd></div><div><dt>Status</dt><dd><Badge>{expert.status}</Badge></dd></div><div><dt>Added to network</dt><dd>{date(expert.createdAt)}</dd></div><div><dt>Last updated</dt><dd>{date(expert.updatedAt)}</dd></div><div><dt>Project assignments</dt><dd>{assignments.length}</dd></div><div><dt>Recorded activities</dt><dd>{activities.length}</dd></div></dl><Button className="full-width" variant="secondary" onClick={() => setActivity({})}><Plus size={15} />Log activity</Button></Card></div></div>}
      {tab === 'assignments' && <Card title="Project assignments" description="Track this expert’s progress in every project independently." action={<Button onClick={() => setAssignment({})}><Plus size={16} />Assign to project</Button>}><DataTable columns={assignmentColumns} rows={assignments} emptyTitle="No assignments yet" emptyDescription="Assign this expert to a project to start tracking the engagement." /></Card>}
      {tab === 'activity' && <Card title="Activity timeline" description="Recorded interactions, outcomes, and consultation details." action={<Button onClick={() => setActivity({})}><Plus size={16} />Log activity</Button>}>{activities.length ? <ActivityTable rows={activities} onEdit={setActivity} onRefresh={load} user={user} /> : <EmptyState title="No activity recorded" description="Log an outreach, screening, consultation, or note for this expert." />}</Card>}
      {tab === 'history' && <Card title="Preserved legacy observations" description="Historical spreadsheet context retained during reviewed imports.">{expert.legacyObservations?.length ? <div className="legacy-observations">{expert.legacyObservations.map((observation, index) => <details key={index} className="legacy-observation"><summary><CalendarDays size={16} /><strong>Historical observation {index + 1}</strong><span>{observation.rowNumber ? `Source row ${observation.rowNumber}` : 'Import observation'}</span></summary><pre>{JSON.stringify(observation, null, 2)}</pre></details>)}</div> : <EmptyState title="No legacy observations" description="Historical observations appear after a reviewed import. New profiles don’t require a spreadsheet." />}</Card>}
    </div>{editing && <Modal title="Edit expert profile" wide onClose={() => setEditing(false)}><ExpertForm expert={expert} lookups={lookups} onSave={saveProfile} onCancel={() => setEditing(false)} /></Modal>}{assignment && <AssignmentForm expert={expert} assignment={assignment} assigned={assignments.map(row => refId(row.project))} lookups={lookups} onClose={() => setAssignment(null)} onSaved={saveAssignment} />}{activity && <ActivityForm activity={activity} defaults={{ expert: expert._id }} lookups={lookups} onClose={() => setActivity(null)} onSaved={async () => { setActivity(null); notify('Activity saved.'); await load(); }} />}{removing && <ConfirmDialog title={removing.type === 'expert' ? 'Archive this expert?' : 'Remove this assignment?'} description={removing.type === 'expert' ? 'This expert will leave active search results. Their profile, assignments, and activity history will be preserved.' : 'This connection will be removed from the active project roster. The expert’s profile and recorded activity will be preserved.'} confirmLabel={removing.type === 'expert' ? 'Archive expert' : 'Remove assignment'} onClose={() => setRemoving(null)} onConfirm={remove} loading={busy} />}</div>;
}
