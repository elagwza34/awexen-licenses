/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the API, e.g. "/api/v1". */
  readonly VITE_API_BASE_URL?: string;
  /** Dev-server proxy target; never reaches the browser bundle. */
  readonly VITE_API_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
