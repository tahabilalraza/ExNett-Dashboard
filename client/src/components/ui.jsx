import { cloneElement, isValidElement, useEffect, useId, useRef } from 'react';
import { ChevronLeft, ChevronRight, X, Inbox, Loader2, AlertCircle } from 'lucide-react';

export function PageHeader({ title, description, action }) {
  return <div className="page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="page-actions">{action}</div>}</div>;
}
export function Button({ variant = 'primary', className = '', children, loading = false, disabled, ...props }) {
  return <button type="button" className={`button button-${variant} ${className}`} disabled={disabled || loading} {...props}>{loading && <Loader2 size={16} className="spin" />}{children}</button>;
}
export function Badge({ children, tone, className = '' }) {
  const label = String(children ?? '');
  const resolved = tone || (/cancel|archived|inactive|declined|rejected|failed|do not contact/i.test(label) ? 'muted' : /active|completed|approved|interviewed|done|success/i.test(label) ? 'success' : /progress|contact|screen|review|pending/i.test(label) ? 'warning' : 'neutral');
  return <span className={`badge badge-${resolved} ${className}`}>{children}</span>;
}
export function EmptyState({ title = 'No results yet', description, action }) {
  return <div className="empty-state"><div className="empty-icon"><Inbox size={26} /></div><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}
export function Modal({ title, children, onClose, wide = false }) {
  const titleId = useId();
  const container = useRef();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...(container.current?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || [])];
    focusable()[0]?.focus();
    const key = event => {
      if (event.key === 'Escape') onCloseRef.current?.();
      if (event.key === 'Tab') {
        const nodes = focusable();
        if (!nodes.length) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', key); previouslyFocused?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}><section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={container}><header className="modal-header"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></header><div className="modal-body">{children}</div></section></div>;
}
export function Field({ label, error, children, className = '', hint }) {
  const labelId = useId();
  const control = isValidElement(children) && ['input', 'select', 'textarea'].includes(children.type)
    ? cloneElement(children, { 'aria-labelledby': children.props['aria-labelledby'] || labelId })
    : children;
  return <label className={`field ${className}`}><span id={labelId} className="field-label">{label}</span>{control}{hint && <small className="field-hint">{hint}</small>}{error && <span className="field-error">{error}</span>}</label>;
}
export function TextInput({ label, error, hint, ...props }) { return <Field label={label} error={error} hint={hint}><input {...props} /></Field>; }
export function SelectInput({ label, options = [], placeholder, ...props }) {
  return <Field label={label}><select {...props}>{placeholder && <option value="">{placeholder}</option>}{options.map(option => typeof option === 'string' ? <option key={option} value={option}>{option}</option> : <option key={option.value ?? option._id} value={option.value ?? option._id}>{option.label ?? option.name ?? option.fullName ?? option.projectName ?? option.clientName}</option>)}</select></Field>;
}
export function DataTable({ columns, rows = [], onRowClick, rowKey = '_id', emptyTitle, emptyDescription }) {
  if (!rows.length) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return <div className="table-scroll"><table className="data-table"><thead><tr>{columns.map(column => <th key={column.key} className={column.className}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row[rowKey] || index} className={onRowClick ? 'clickable-row' : ''} onClick={onRowClick ? () => onRowClick(row) : undefined} tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? event => { if (event.key === 'Enter' && event.target === event.currentTarget) onRowClick(row); } : undefined}>{columns.map(column => <td key={column.key} className={column.className}>{column.render ? column.render(row) : row[column.key] ?? '—'}</td>)}</tr>)}</tbody></table></div>;
}
export function Pagination({ pagination, onPageChange }) {
  if (!pagination) return null;
  const { page = 1, limit = 25, total = 0, pages = Math.ceil(total / limit) } = pagination;
  return <div className="pagination"><span>{total ? `${((page - 1) * limit + 1).toLocaleString()}–${Math.min(page * limit, total).toLocaleString()} of ${total.toLocaleString()}` : '0 results'}</span><div className="pagination-controls"><button className="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={17} /></button><span>Page {page} of {Math.max(pages, 1)}</span><button className="icon-button" aria-label="Next page" disabled={page >= pages} onClick={() => onPageChange(page + 1)}><ChevronRight size={17} /></button></div></div>;
}
export function Alert({ children, type = 'error', action }) { return <div className={`alert alert-${type}`} role={type === 'error' ? 'alert' : 'status'}><AlertCircle size={18} /><div>{children}</div>{action}</div>; }
export function Spinner({ label = 'Loading…' }) { return <div className="loading-state" role="status"><Loader2 size={25} className="spin" /><span>{label}</span></div>; }
export function Card({ title, description, action, children, className = '' }) { return <section className={`panel ${className}`}>{title && <div className="panel-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>}<div className="panel-body">{children}</div></section>; }
export function ConfirmDialog({ title, description, confirmLabel = 'Confirm', onConfirm, onClose, loading, danger = true }) {
  return <Modal title={title} onClose={loading ? undefined : onClose}><p className="confirm-description">{description}</p><div className="form-actions"><Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></div></Modal>;
}
export function money(value, currency) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  if (!currency) return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} · unspecified`;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
}
export function date(value, options) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, options || { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}
export function initials(value = '') { return value.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'; }
export function safeUrl(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } }
