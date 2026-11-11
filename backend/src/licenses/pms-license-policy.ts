export const PMS_DAY = 86_400_000;
export function pmsLeaseWindow(expiresAt: Date | null, now = Date.now()) {
  const expiryBound = expiresAt ? expiresAt.getTime() + 14 * PMS_DAY : Number.MAX_SAFE_INTEGER;
  return { expired: now > expiryBound, nextCheckAt: Math.min(now + 7 * PMS_DAY, expiryBound),
    offlineUntil: Math.min(now + 14 * PMS_DAY, expiryBound) };
}
