let csrfToken;
let csrfRequest;

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    csrfRequest = fetch('/api/auth/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.csrfToken) throw new ApiError(data.error?.message || 'Unable to establish a secure session.', response.status);
        csrfToken = data.csrfToken;
        return csrfToken;
      }).finally(() => { csrfRequest = undefined; });
  }
  return csrfRequest;
}

export async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  let body = options.body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRF-Token', await ensureCsrf());
  const response = await fetch(`/api${path.startsWith('/') ? path : `/${path}`}`, { ...options, method, body, headers, credentials: 'same-origin' });
  const type = response.headers.get('content-type') || '';
  const data = response.status === 204 ? {} : type.includes('application/json') ? await response.json() : { error: { message: 'The server returned an unexpected response. Please try again.' } };
  if (!response.ok) {
    if (response.status === 403 && /csrf/i.test(data.error?.message || '') && !options.csrfRetried) {
      csrfToken = undefined;
      return api(path, { ...options, csrfRetried: true });
    }
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('exnett:unauthorized'));
    throw new ApiError(data.error?.message || data.message || 'The request could not be completed.', response.status, data.error?.details);
  }
  if (data.csrfToken) csrfToken = data.csrfToken;
  if (path === '/auth/logout') csrfToken = undefined;
  return data;
}

api.get = (path, options) => api(path, options);
api.post = (path, body, options) => api(path, { ...options, method: 'POST', body });
api.put = (path, body, options) => api(path, { ...options, method: 'PUT', body });
api.patch = (path, body, options) => api(path, { ...options, method: 'PATCH', body });
api.delete = (path, options) => api(path, { ...options, method: 'DELETE' });
export default api;
