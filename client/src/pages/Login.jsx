import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, ShieldCheck, Network, LockKeyhole, Quote } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Field, Spinner } from '../components/ui.jsx';

export default function Login() {
  const { user, loading, login, error: connectionError } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (loading) return <div className="boot-screen"><Spinner label="Connecting to your workspace…" /></div>;
  if (user) return <Navigate to={location.state?.from?.startsWith('/') && !location.state.from.startsWith('//') ? location.state.from : '/'} replace />;
  const submit = async event => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try { await login(email.trim(), password); } catch (err) { setError(err.message); } finally { setSubmitting(false); }
  };
  return <div className="login-page"><aside className="login-story"><div className="brand"><span className="brand-mark">e<span>n</span></span><span className="brand-name">ExNett<span>EXPERT NETWORK</span></span></div><div className="login-story-body"><span className="eyebrow"><Network size={16} /> CONNECTIONS THAT COUNT</span><h1>The right expertise.<br />A clearer perspective.</h1><p>Bring your expert network, projects, and conversations into one thoughtful workspace.</p><div className="network-art" aria-hidden="true"><div className="network-orbit orbit-one" /><div className="network-orbit orbit-two" /><div className="network-center"><Network size={39} strokeWidth={1.4} /></div>{[0, 1, 2, 3, 4, 5].map(index => <div key={index} className={`network-node node-${index}`} />)}</div><div className="login-story-note"><Quote size={22} /><span>Great decisions start with the right conversation.</span></div></div><div className="login-story-footer"><ShieldCheck size={16} /> A private home for your network</div></aside><main className="login-main" id="main-content"><div className="login-form-wrap"><div className="login-mobile-brand">ExNett<span>Expert network operations</span></div><span className="eyebrow">YOUR WORKSPACE AWAITS</span><h2>Welcome back.</h2><p className="login-intro">Sign in to manage your network and move work forward.</p>{(error || connectionError) && <Alert>{error || connectionError}</Alert>}<form onSubmit={submit} className="login-form"><Field label="Work email"><input autoFocus type="email" required autoComplete="username" placeholder="you@company.com" value={email} onChange={event => setEmail(event.target.value)} /></Field><Field label="Password"><div className="password-input"><input type={showPassword ? 'text' : 'password'} required autoComplete="current-password" placeholder="Enter your password" value={password} onChange={event => setPassword(event.target.value)} /><button type="button" className="icon-button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></Field><Button type="submit" loading={submitting} className="login-submit">Sign in <ArrowRight size={17} /></Button></form><div className="login-help"><LockKeyhole size={16} /><p>Access is managed by your workspace administrator. Contact them if you need help signing in.</p></div></div><footer className="login-footer">© {new Date().getFullYear()} ExNett<span>Expert network operations</span></footer></main></div>;
}
