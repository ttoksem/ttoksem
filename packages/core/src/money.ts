export function decimalToNanos(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Math.round(value * 1_000_000_000);
}

export function nanosToDecimal(value: number | null | undefined): number {
  if (value == null) return 0;
  return value / 1_000_000_000;
}

