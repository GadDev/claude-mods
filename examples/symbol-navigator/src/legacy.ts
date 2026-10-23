// Same declaration name, different symbol. This one has no checkout references.
export function quoteTotal(cents: number): string {
  return `Legacy quote: ${cents / 100}`;
}
