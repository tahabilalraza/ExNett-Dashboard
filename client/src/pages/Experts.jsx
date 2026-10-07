import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, SlidersHorizontal, Download, ArrowUpDown, Mail, Phone, Linkedin, X, Users, ChevronRight } from 'lucide-react';
import { api } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLookups } from '../hooks/useLookups.js';
import { useToast } from '../hooks/useToast.js';
import useDebounced from '../hooks/useDebounced.js';
import { PageHeader, Button, Alert, Badge, DataTable, Pagination, Modal, Field, Spinner, initials, money } from '../components/ui.jsx';
import ExpertForm from '../components/ExpertForm.jsx';
const filterKeys = ['country', 'industry', 'sector', 'status', 'assignmentStatus', 'currentCompany', 'currentPosition', 'recruitedBy', 'project', 'minRate', 'maxRate', 'hasEmail', 'hasPhone', 'hasLinkedIn', 'recentlyAdded', 'recentlyActive'];
const initialFilters = params => Object.fromEntries(filterKeys.map(key => [key, params.get(key) || '']));

export default function Experts() {
  const { user } = useAuth();
  const { lookups, error: lookupError } = useLookups();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const debouncedSearch = useDebounced(search);
  const [filters, setFilters] = useState(() => initialFilters(params));
  const [expanded, setExpanded] = useState(() => filterKeys.some(key => params.get(key)));
  const [page, setPage] = useState(Number(params.get('page')) || 1);
  const [sort, setSort] = useState(params.get('sort') || 'createdAt');
  const [order, setOrder] = useState(params.get('order') || 'desc');
  const [limit, setLimit] = useState(Number(params.get('limit')) || 25);
  const [result, setResult] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState(params.get('create') === '1');
  const filterCount = Object.values(filters).filter(Boolean).length;
  const query = useMemo(() => {
    const queryParams = new URLSearchParams({ page: String(page), limit: String(limit), sort, order });
    if (debouncedSearch.trim()) queryParams.set('search', debouncedSearch.trim());
    Object.entries(filters).forEach(([key, value]) => { if (value !== '') queryParams.set(key, value); });
    return queryParams.toString();
  }, [page, limit, sort, order, debouncedSearch, filters]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api.get(`/experts?${query}`, { signal: controller.signal }).then(response => { setResult(response); setError(''); }).catch(err => { if (err.name !== 'AbortError') setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, refresh]);
  useEffect(() => {
    setParams(query, { replace: true });
  }, [query, setParams]);
  // The global search can change the URL while this page stays mounted.
  useEffect(() => { const value = params.get('search') || ''; if (value !== debouncedSearch && value !== search) { setSearch(value); setPage(1); } }, [params]);
  const changeFilter = (key, value) => { setFilters(old => ({ ...old, [key]: value, ...(key === 'industry' ? { sector: '' } : {}) })); setPage(1); };
  const reset = () => { setSearch(''); setFilters(initialFilters(new URLSearchParams())); setPage(1); };
  const changeSort = key => { if (key === sort) setOrder(value => value === 'asc' ? 'desc' : 'asc'); else { setSort(key); setOrder('asc'); } setPage(1); };
  const sortLabel = (key, label) => <button className="table-sort" onClick={() => changeSort(key)}>{label}<ArrowUpDown size={12} className={sort === key ? 'sort-selected' : ''} /></button>;
  const createExpert = async body => { const response = await api.post('/experts', body); setCreating(false); notify('Expert added to your network.'); navigate(`/experts/${response.data._id}`); };
  const columns = [
    { key: 'fullName', label: sortLabel('fullName', 'Expert'), render: row => <div className="person-cell"><span className="avatar expert-avatar">{initials(row.fullName)}</span><div><Link to={`/experts/${row._id}`} onClick={event => event.stopPropagation()} className="table-primary">{row.fullName}</Link><span>{row.expertId}</span></div></div> },
    { key: 'currentCompany', label: sortLabel('currentCompany', 'Company / position'), render: row => <div className="table-stack"><strong>{row.currentCompany || '—'}</strong><span>{row.currentPosition || 'Position unspecified'}</span></div> },
    { key: 'country', label: sortLabel('country', 'Country') },
    { key: 'industry', label: 'Industry', render: row => <div className="table-stack"><span>{row.industry?.name || 'Unclassified'}</span>{row.sector?.name && <small>{row.sector.name}</small>}</div> },
    { key: 'status', label: 'Status', render: row => <Badge>{row.status}</Badge> },
    { key: 'hourlyRate', label: sortLabel('hourlyRate', 'Rate / hr'), render: row => <span className="tabular-number">{money(row.hourlyRate, row.currency)}</span> },
    { key: 'contact', label: 'Contact', render: row => <div className="contact-presence"><span title={row.email || 'No email'} className={row.email ? 'contact-available' : ''}><Mail size={14} /></span><span title={row.phoneNumber || 'No phone'} className={row.phoneNumber ? 'contact-available' : ''}><Phone size={14} /></span><span title={row.linkedinProfile ? 'LinkedIn available' : 'No LinkedIn'} className={row.linkedinProfile ? 'contact-available' : ''}><Linkedin size={14} /></span></div> },
    { key: 'open', label: '', render: () => <ChevronRight size={15} className="muted" /> },
  ];
  return <div className="page-stack"><PageHeader title="Expert network" description="Find the right perspective. Keep every connection in context." action={<><a className="button button-secondary" href={`/api/experts/export.csv?${query}`} download="exnett-experts.csv"><Download size={16} /> Export</a><Button onClick={() => setCreating(true)}><Plus size={16} /> Add expert</Button></>} />{error && <Alert action={<Button variant="secondary" onClick={() => setRefresh(value => value + 1)}>Retry</Button>}>{error}</Alert>}{lookupError && <Alert>{lookupError}</Alert>}<section className="panel expert-list-panel"><div className="list-toolbar"><div className="search-input"><Search size={17} /><input aria-label="Search experts" placeholder="Search names, companies, emails, tags…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</div><Button variant="secondary" className={expanded ? 'button-selected' : ''} onClick={() => setExpanded(value => !value)} aria-expanded={expanded}><SlidersHorizontal size={16} /> Filters {filterCount > 0 && <span className="filter-count">{filterCount}</span>}</Button><div className="list-count"><Users size={15} />{result.pagination?.total?.toLocaleString() ?? '—'} experts</div></div>
      {expanded && <div className="advanced-filters"><div className="filter-grid"><Field label="Country"><input value={filters.country} onChange={event => changeFilter('country', event.target.value)} placeholder="Any country" /></Field><Field label="Industry"><select value={filters.industry} onChange={event => changeFilter('industry', event.target.value)}><option value="">All industries</option>{lookups.industries.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select></Field><Field label="Sector"><select value={filters.sector} onChange={event => changeFilter('sector', event.target.value)}><option value="">All sectors</option>{lookups.sectors.filter(item => !filters.industry || (item.industry?._id || item.industry) === filters.industry).map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select></Field><Field label="Status"><select value={filters.status} onChange={event => changeFilter('status', event.target.value)}><option value="">All statuses</option>{lookups.expertStatuses.map(status => <option key={status}>{status}</option>)}</select></Field><Field label="Company"><input value={filters.currentCompany} onChange={event => changeFilter('currentCompany', event.target.value)} placeholder="Any company" /></Field><Field label="Position"><input value={filters.currentPosition} onChange={event => changeFilter('currentPosition', event.target.value)} placeholder="Any position" /></Field><Field label="Recruited by"><select value={filters.recruitedBy} onChange={event => changeFilter('recruitedBy', event.target.value)}><option value="">Any recruiter</option>{lookups.users.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select></Field><Field label="Project"><select value={filters.project} onChange={event => changeFilter('project', event.target.value)}><option value="">Any project</option>{lookups.projects.map(item => <option key={item._id} value={item._id}>{item.projectName}</option>)}</select></Field><Field label="Minimum rate"><input type="number" min="0" value={filters.minRate} onChange={event => changeFilter('minRate', event.target.value)} /></Field><Field label="Maximum rate"><input type="number" min="0" value={filters.maxRate} onChange={event => changeFilter('maxRate', event.target.value)} /></Field><Field label="Email"><select value={filters.hasEmail} onChange={event => changeFilter('hasEmail', event.target.value)}><option value="">Any</option><option value="true">Has email</option><option value="false">No email</option></select></Field><Field label="Phone"><select value={filters.hasPhone} onChange={event => changeFilter('hasPhone', event.target.value)}><option value="">Any</option><option value="true">Has phone</option><option value="false">No phone</option></select></Field><Field label="LinkedIn"><select value={filters.hasLinkedIn} onChange={event => changeFilter('hasLinkedIn', event.target.value)}><option value="">Any</option><option value="true">Has LinkedIn</option><option value="false">No LinkedIn</option></select></Field></div><div className="filter-footer"><label className="checkbox-field"><input type="checkbox" checked={filters.recentlyAdded === 'true'} onChange={event => changeFilter('recentlyAdded', event.target.checked ? 'true' : '')} /> Added in last 30 days</label><label className="checkbox-field"><input type="checkbox" checked={filters.recentlyActive === 'true'} onChange={event => changeFilter('recentlyActive', event.target.checked ? 'true' : '')} /> Active in last 30 days</label><Button variant="ghost" onClick={reset}>Clear filters</Button></div><p className="field-hint">Rate bounds apply to each recorded amount. Compare rates within the same currency.</p></div>}
      {(filterCount > 0 || search) && <div className="active-filters"><span>Filtered results</span>{search && <span className="filter-chip">Search: {search}</span>}{Object.entries(filters).filter(([, value]) => value).map(([key, value]) => <button key={key} className="filter-chip" onClick={() => changeFilter(key, '')}>{key.replace(/([A-Z])/g, ' $1')}: {['industry', 'sector', 'recruitedBy', 'project'].includes(key) ? 'selected' : value}<X size={11} /></button>)}<button className="text-link" onClick={reset}>Reset</button></div>}
      <div className={loading ? 'table-loading' : ''}>{loading && !result.pagination ? <Spinner label="Loading experts…" /> : <DataTable columns={columns} rows={result.data} onRowClick={row => navigate(`/experts/${row._id}`)} emptyTitle={search || filterCount ? 'No experts match these filters' : 'Build your expert network'} emptyDescription={search || filterCount ? 'Try fewer filters or a broader search.' : 'Add your first expert or preview a historical spreadsheet import.'} />}</div><div className="table-footer"><label className="rows-per-page">Rows <select aria-label="Rows per page" value={limit} onChange={event => { setLimit(Number(event.target.value)); setPage(1); }}><option>25</option><option>50</option><option>100</option></select></label><Pagination pagination={result.pagination} onPageChange={setPage} /></div>
    </section><div className="page-footnote">Experts stay connected to projects through assignments. {['admin', 'manager'].includes(user.role) && <Link to="/import">Import a spreadsheet <ChevronRight size={12} /></Link>}</div>{creating && <Modal title="Add an expert" wide onClose={() => setCreating(false)}><ExpertForm lookups={lookups} onSave={createExpert} onCancel={() => setCreating(false)} /></Modal>}</div>;
}
