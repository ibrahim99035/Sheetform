import { APP_CURRENCY } from "./constants";

export function fmtCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: APP_CURRENCY,
    maximumFractionDigits: 2,
  }).format(n);
}