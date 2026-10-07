import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
const ToastContext = createContext(null);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Set());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const dismiss = id => setToasts(items => items.filter(item => item.id !== id));
  const notify = useCallback((message, type = 'success') => {
    const id = crypto.randomUUID();
    setToasts(items => [...items.slice(-3), { id, message, type }]);
    const timer = setTimeout(() => { dismiss(id); timers.current.delete(timer); }, 6000);
    timers.current.add(timer);
  }, []);
  return <ToastContext.Provider value={{ notify }}>
    {children}
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map(toast => <div key={toast.id} className={`toast toast-${toast.type}`} role="status">
        {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
        <span>{toast.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}><X size={15} /></button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}
export const useToast = () => useContext(ToastContext);
