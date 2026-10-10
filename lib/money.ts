/** The one dollar formatter's billions rule: $1,000 million or more reads as billions with one decimal ("$2.6 billion"); callers keep their own commas below that. */
export function billions(amount: number): string | null {
  return amount >= 1_000_000_000 ? `$${(Math.round(amount / 100_000_000) / 10).toFixed(1)} billion` : null;
}
