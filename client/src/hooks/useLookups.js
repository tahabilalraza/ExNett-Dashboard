import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.js';
const defaults = { experts: [], projects: [], clients: [], industries: [], sectors: [], users: [], projectStatuses: [], assignmentStatuses: [], activityTypes: [], expertStatuses: [] };
export function useLookups() {
  const [lookups, setLookups] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get('/lookups');
      setLookups({ ...defaults, ...(result.data || result) });
      setError('');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { lookups, loading, error, reload };
}
export default useLookups;
