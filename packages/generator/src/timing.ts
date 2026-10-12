/** Milliseconds since a `performance.now()` reading, rounded for logs and reports. */
export function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
