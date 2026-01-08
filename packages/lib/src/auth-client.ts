import { createAuthClient } from 'better-auth/react';

/**
 * Creates a Better Auth client instance.
 * @param baseURL - The backend API URL (e.g., http://localhost:8787)
 */
export function createAuth(baseURL: string) {
  return createAuthClient({
    baseURL,
    /**
     * We're calling the API from a different origin in dev (5173 -> 8787),
     * so we must explicitly include cookies on fetch requests.
     */
    fetchOptions: {
      credentials: 'include',
    },
  });
}

/**
 * Default auth client for development.
 * In production, use createAuth() with your actual API URL.
 */
export const authClient = createAuth('http://localhost:8787');
