/** Express JSON serialization: Prisma BigInt values cannot be sent directly. */
export function jsonBigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value !== 'bigint') return value;
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(value) : value.toString();
}
