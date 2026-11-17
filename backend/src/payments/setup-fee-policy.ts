/** Existing installations retain setup-fee history across renewals and systems. */
export async function setupAlreadyPaid(
  db: any,
  customer: any,
  systemId: number,
): Promise<boolean> {
  const [licenses, payments] = await Promise.all([
    db.license.count({
      where: { customerId: customer.id, isTrial: false, plan: { systemId } },
    }),
    db.payment.count({
      where: { customerId: customer.id, status: "PAID", plan: { systemId } },
    }),
  ]);
  if (licenses > 0 || payments > 0) return true;
  if (systemId !== 1 || !customer.downloadEnabled) return false;
  // Preserve older manually unlocked PMS customers without letting another
  // system's purchase suppress the first PMS setup charge.
  const [otherLicenses, otherPayments] = await Promise.all([
    db.license.count({
      where: {
        customerId: customer.id,
        isTrial: false,
        plan: { systemId: { not: systemId } },
      },
    }),
    db.payment.count({
      where: {
        customerId: customer.id,
        status: "PAID",
        plan: { systemId: { not: systemId } },
      },
    }),
  ]);
  return otherLicenses === 0 && otherPayments === 0;
}
