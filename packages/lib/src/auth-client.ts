import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  /** The base URL of the server (optional if you're using the same domain) */
  baseURL: 'http://localhost:3000',
  /**
   * We're calling the API from a different origin in dev (5173 -> 3000),
   * so we must explicitly include cookies on fetch requests.
   */
  fetchOptions: {
    credentials: 'include',
  },
});
