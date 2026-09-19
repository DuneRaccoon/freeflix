import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

// Determine if we're running on the server (SSR inside the frontend container)
const isServer = typeof window === 'undefined';

// On the server, reach the backend directly over the Docker network
// (BACKEND_INTERNAL_URL=http://backend:8000); locally it falls back to localhost.
// In the browser, everything is same-origin and proxied by the next.config rewrites
// (/api/* and /_backend/* both forward to the backend), so no host is hard-coded.
const serverBackendOrigin = process.env.BACKEND_INTERNAL_URL || 'http://localhost:8000';

// Base for the versioned API
const baseURL = isServer ? `${serverBackendOrigin}/api/v1` : '/api/v1';

declare module 'axios' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface AxiosRequestConfig<D = any> {
    /**
     * Opt a request out of the global 401 -> /signin redirect. Set it on calls whose
     * 401 is a legitimate answer rather than an expired session — `GET /auth/me`
     * probing for a signed-out visitor, above all.
     */
    __allow401?: boolean;
  }
}

// Routes that render without a session. A 401 raised while the visitor is already
// on one of them is expected (the page itself is the sign-in affordance), so
// bouncing them to /signin would fight the page they are trying to use.
const PUBLIC_PATH_PREFIXES = ['/claim', '/signin', '/invite', '/auth'];

// One redirect per page load. TopNav polls /activity/count every 15s and several
// views fire parallel requests, so an unguarded redirect would stack up and thrash
// the history stack while the browser is already navigating away.
let redirecting = false;

/**
 * Server components have no cookie jar: they fetch through this client against
 * BACKEND_INTERNAL_URL, so the browser's session cookie never rides along and every
 * gated call comes back 401 — which `app/movies/[id]/page.tsx` and
 * `app/tv/[id]/page.tsx` turn into a silent notFound(). Forward the incoming
 * request's cookies instead.
 */
async function forwardServerCookies(
  config: InternalAxiosRequestConfig,
): Promise<InternalAxiosRequestConfig> {
  if (!isServer) return config;
  try {
    const { cookies } = await import('next/headers');
    const store = await cookies();
    const header = store
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    if (header) config.headers.Cookie = header;
  } catch {
    // cookies() throws outside a request scope (build-time prerender, a module-scope
    // call, a background job). Falling through unauthenticated is the right answer
    // there — those callers only ever touch public routes.
  }
  return config;
}

function handleUnauthorized(error: AxiosError): void {
  if (isServer || redirecting) return;
  if (error.config?.__allow401) return;
  const { pathname, search } = window.location;
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return;
  redirecting = true;
  window.location.replace(`/signin?next=${encodeURIComponent(`${pathname}${search}`)}`);
}

// root client exists to get system config and run healthchecks on the API.
// The backend's "/" and "/health" live outside /api/v1, so on the client they go
// through the dedicated /_backend proxy rewrite.
const rootClient = axios.create({
  baseURL: isServer ? serverBackendOrigin : '/_backend',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Create an Axios instance with default configs
const apiClient = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor
apiClient.interceptors.request.use(
  async (config) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
    }
    return forwardServerCookies(config);
  },
  (error) => {
    return Promise.reject(error);
  }
);

rootClient.interceptors.request.use(
  async (config) => forwardServerCookies(config),
  (error) => Promise.reject(error),
);

// Add a response interceptor
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error: AxiosError) => {
    // A 401 on a request that opted out of the redirect is an ANSWER, not a fault —
    // GET /auth/me probing for a signed-out visitor, and the owner's password sign-in.
    // Logging it painted the console red on every normal visit to /signin, which sends
    // anyone debugging a real problem down the wrong path.
    const expected401 = error.response?.status === 401 && error.config?.__allow401;
    if (!expected401) console.error('API Error:', error);
    // Handle common errors here
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      if (!expected401) console.error('API Error Response:', error.response.data);
      // 401 is a dead session; 423 is a live session whose profile is passcode-locked
      // and must reach the caller so the lock prompt can open.
      if (error.response.status === 401) handleUnauthorized(error);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('API No Response:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('API Request Error:', error.message);
    }
    
    return Promise.reject(error);
  }
);

// rootClient had no interceptors at all, so an expired session left the Settings
// system panel reporting "backend unreachable" forever instead of signing the
// viewer back in.
rootClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) handleUnauthorized(error);
    return Promise.reject(error);
  },
);


export const baseService = {

  healthcheck: async () => {
    const response = await rootClient.get('/health');
    return response.data;
  },

  root: async () => {
    const response = await rootClient.get('/');
    return response.data;
  }
}

export default apiClient;
