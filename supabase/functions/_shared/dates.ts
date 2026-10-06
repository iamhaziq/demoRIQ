/** Today's date in Malaysia (UTC+8) as ISO yyyy-mm-dd. */
export function todayMYT(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
}
