export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Configuration missing: ${name}`);
  return value;
}
