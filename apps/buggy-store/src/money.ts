export function computeTotal(items: { price: string; qty: number }[]): number {
  return items.reduce((sum, i) => sum + Number(i.price) * i.qty, 0);
}
// BUG B5: always two decimals, wrong for zero-decimal currencies (JPY, HUF, TWD)
export function formatAmount(total: number, _currency: string): string {
  return total.toFixed(2);
}
