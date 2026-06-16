import axios from 'axios';

// Determine if we're running on the server (SSR inside the frontend container)
const isServer = typeof window === 'undefined';

// On the server, reach the backend directly over the Docker network
// (BACKEND_INTERNAL_URL=http://backend:8000); locally it falls back to localhost.
// In the browser, everything is same-origin and proxied by the next.config rewrites
// (/api/* and /_backend/* both forward to the backend), so no host is hard-coded.
const serverBackendOrigin = process.env.BACKEND_INTERNAL_URL || 'http://localhost:8000';

// Base for the versioned API
const baseURL = isServer ? `${serverBackendOrigin}/api/v1` : '/api/v1';

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
  (config) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
    }
    // add auth tokens here if needed in the future
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add a response interceptor
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    console.error('API Error:', error); 
    // Handle common errors here
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('API Error Response:', error.response.data);
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