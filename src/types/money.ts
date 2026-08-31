export type Money = number;

export function assertMoney(value: number, field = "amount"): Money {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite number >= 0`);
  }

  return value;
}
