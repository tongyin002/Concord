/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend API URL (Cloudflare Worker) */
  readonly VITE_API_URL?: string;
  /** Frontend web app URL */
  readonly VITE_WEB_URL?: string;
  /** Zero sync server URL */
  readonly VITE_ZERO_URL?: string;
  /** WebSocket URL for real-time collaboration */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
