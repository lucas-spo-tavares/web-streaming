export interface Environment {
  [key: string]: string | undefined;
}
export interface Issue {
  name: string;
  message: string;
}
export const FRONT_KEYS: readonly ['VITE_API_URL', 'VITE_CLIENT_ID', 'VITE_AWS_REGION'];
export const OPERATIONS: readonly string[];
export const MAX_UPLOAD_BYTES: number;
export const REGION_PATTERN: RegExp;
export function validateFront(env: Environment): Issue[];
export function validateBackend(env: Environment, operation?: string): Issue[];
export function validateFields(
  env: Environment,
  rules: Record<string, { check: (value: string) => boolean; message: string }>,
): Issue[];
export function isRegion(value: string): boolean;
export function isBucket(value: string): boolean;
export function isHostname(value: string): boolean;
export function isParameterArn(value: string): boolean;
export function isIntegerIn(value: string, min: number, max: number): boolean;
export function assertValid(issues: Issue[]): void;
