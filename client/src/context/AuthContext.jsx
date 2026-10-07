import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../services/api.js';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refreshUser = useCallback(async () => {
    try {
      const result = await api.get('/auth/me');
      setUser(result.user);
      setError('');
      return result.user;
    } catch (err) {
      setUser(null);
      if (err.status !== 401) setError(err.message);
      return null;
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    refreshUser();
    const expired = () => setUser(null);
    window.addEventListener('exnett:unauthorized', expired);
    return () => window.removeEventListener('exnett:unauthorized', expired);
  }, [refreshUser]);
  const login = async (email, password) => {
    const result = await api.post('/auth/login', { email, password });
    setUser(result.user);
    setError('');
    return result.user;
  };
  const logout = async () => {
    await api.post('/auth/logout', {});
    setUser(null);
  };
  return <AuthContext.Provider value={{ user, loading, error, login, logout, refreshUser }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
