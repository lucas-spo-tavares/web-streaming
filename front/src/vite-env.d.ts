interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_CLIENT_ID?: string;
  readonly VITE_AWS_REGION?: string;
}
