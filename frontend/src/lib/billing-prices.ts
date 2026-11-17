/** Parse currency input without rounding extra decimals or accepting exponent notation. */
export function minorUnits(value: string, optional = false): number | null {
  const text = value.trim();
  if (optional && !text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error("أدخل سعرًا صحيحًا بمنزلتين عشريتين بحد أقصى.");
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 2147483647)
    throw new Error("السعر أكبر من الحد المسموح.");
  return result;
}
export function annualMinorUnits(monthly: number): number {
  if (!Number.isSafeInteger(monthly) || monthly < 0)
    throw new Error("Invalid monthly price");
  const annual = Number((BigInt(monthly) * 102n + 5n) / 10n);
  if (annual > 2147483647)
    throw new Error("Annual price exceeds the supported range");
  return annual;
}
