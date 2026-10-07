import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, BriefcaseBusiness, Building2, Activity, Upload, ChartNoAxesCombined, Settings2, UserRoundCog, PanelLeftClose, PanelLeftOpen, Search, LogOut, ChevronRight, Menu, X, CircleHelp } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import { useToast } from './hooks/useToast.js';
import { api } from './services/api.js';
import { initials, Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Experts = lazy(() => import('./pages/Experts.jsx'));
const ExpertDetail = lazy(() => import('./pages/ExpertDetail.jsx'));
const Projects = lazy(() => import('./pages/Projects.jsx'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail.jsx'));
const Clients = lazy(() => import('./pages/Clients.jsx'));
const ClientDetail = lazy(() => import('./pages/ClientDetail.jsx'));
const Activities = lazy(() => import('./pages/Activities.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Team = lazy(() => import('./pages/Team.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Import = lazy(() => import('./pages/Import.jsx'));

const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/experts', label: 'Experts', icon: Users },
  { to: '/projects', label: 'Projects', icon: BriefcaseBusiness },
  { to: '/clients', label: 'Clients', icon: Building2 },
  { to: '/activities', label: 'Activity', icon: Activity },
  { to: '/reports', label: 'Reports', icon: ChartNoAxesCombined },
];

function Workspace() {
  const { user, logout } = useAuth();
  const { notify } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [organization, setOrganization] = useState({ organizationName: 'ExNett' });
  const [search, setSearch] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const privileged = ['admin', 'manager'].includes(user.role);
  useEffect(() => {
    api.get('/settings').then(result => setOrganization(result.data || {})).catch(() => notify('Workspace settings could not be loaded. Try reloading the page.', 'error'));
  }, []);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  const section = navigation.find(item => item.end ? location.pathname === '/' : location.pathname.startsWith(item.to))?.label || (location.pathname.startsWith('/import') ? 'Import experts' : location.pathname.startsWith('/team') ? 'Team' : 'Settings');
  const signOut = async () => {
    setLoggingOut(true);
    try { await logout(); } catch (err) { notify(err.message, 'error'); } finally { setLoggingOut(false); }
  };
  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} aria-label="Workspace navigation">
      <Link to="/" className="brand" aria-label="ExNett overview"><span className="brand-mark">e<span>n</span></span><span className="brand-name">ExNett<span>EXPERT NETWORK</span></span></Link>
      <button className="mobile-sidebar-close icon-button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={21} /></button>
      <div className="workspace-selector"><span className="workspace-avatar">{initials(organization.organizationName || 'ExNett')}</span><div><strong>{organization.organizationName || 'ExNett'}</strong><span>Operations workspace</span></div></div>
      <div className="nav-section-label">WORKSPACE</div>
      <nav>{navigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} title={collapsed ? label : undefined} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}><Icon size={19} strokeWidth={1.8} /><span>{label}</span></NavLink>)}</nav>
      <div className="nav-section-label nav-section-secondary">MANAGE</div>
      <nav>{privileged && <NavLink to="/import" className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`} title={collapsed ? 'Import experts' : undefined}><Upload size={19} strokeWidth={1.8} /><span>Import experts</span></NavLink>}{user.role === 'admin' && <NavLink to="/team" className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`} title={collapsed ? 'Team' : undefined}><UserRoundCog size={19} strokeWidth={1.8} /><span>Team</span></NavLink>}<NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`} title={collapsed ? 'Settings' : undefined}><Settings2 size={19} strokeWidth={1.8} /><span>Settings</span></NavLink></nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><CircleHelp size={18} /><div><strong>Built for meaningful connections</strong><span>Your experts. Your intelligence.</span></div></div><div className="sidebar-user"><Link to="/settings" className="user-profile" aria-label="Your profile"><span className="avatar">{initials(user.name)}</span><span><strong>{user.name}</strong><small>{user.role}</small></span></Link><button className="icon-button logout-button" aria-label="Sign out" onClick={signOut} disabled={loggingOut}><LogOut size={17} /></button></div></div>
    </aside>
    <div className="workspace-main"><header className="topbar"><div className="topbar-location"><button className="icon-button desktop-menu-toggle" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setCollapsed(value => !value)}>{collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button><button className="icon-button mobile-menu-toggle" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={21} /></button><span>Workspace</span><ChevronRight size={14} /><strong>{section}</strong></div><form className="global-search" onSubmit={event => { event.preventDefault(); if (search.trim()) { navigate(`/experts?search=${encodeURIComponent(search.trim())}`); setSearch(''); } }}><Search size={16} /><input aria-label="Search all experts" placeholder="Search experts…" value={search} onChange={event => setSearch(event.target.value)} /><kbd>↵</kbd></form><Link to="/settings" className="topbar-avatar avatar" title={user.name}>{initials(user.name)}</Link></header>
      {organization.demoMode && <div className="demo-banner"><span className="demo-dot" />Demo workspace · synthetic data<span className="demo-banner-hint">Use a separate private database for historical records</span></div>}
      <main id="main-content" className="page-content"><Suspense fallback={<Spinner label="Loading page…" />}><Outlet /></Suspense></main><footer className="workspace-footer"><span>ExNett · Expert network operations</span><span>Private workspace</span></footer>
    </div>
  </div>;
}

function Authenticated() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="boot-screen"><Spinner label="Connecting to your workspace…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Workspace />;
}
function RoleGate({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) return <div className="empty-state"><h1>Access restricted</h1><p>Your role does not have access to this section.</p><Link to="/" className="button button-secondary">Return to overview</Link></div>;
  return children;
}
function NotFound() { return <div className="empty-state"><h1>Page not found</h1><p>This page may have moved, or the address may be incomplete.</p><Link to="/" className="button button-primary">Go to overview</Link></div>; }
export default function App() {
  return <><a className="skip-link" href="#main-content">Skip to content</a><Routes><Route path="/login" element={<Login />} /><Route element={<Authenticated />}><Route index element={<Dashboard />} /><Route path="experts" element={<Experts />} /><Route path="experts/:id" element={<ExpertDetail />} /><Route path="projects" element={<Projects />} /><Route path="projects/:id" element={<ProjectDetail />} /><Route path="clients" element={<Clients />} /><Route path="clients/:id" element={<ClientDetail />} /><Route path="activities" element={<Activities />} /><Route path="reports" element={<Reports />} /><Route path="import" element={<RoleGate roles={['admin', 'manager']}><Import /></RoleGate>} /><Route path="team" element={<RoleGate roles={['admin']}><Team /></RoleGate>} /><Route path="settings" element={<Settings />} /><Route path="*" element={<NotFound />} /></Route></Routes></>;
}
