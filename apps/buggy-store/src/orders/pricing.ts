// BUG B2: trusts the amount sent by the browser
export function resolveAmount(serverTotal: string, clientTotal?: string): string {
  return clientTotal ?? serverTotal;
}
