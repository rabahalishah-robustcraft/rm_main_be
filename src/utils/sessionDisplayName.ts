/**
 * Formats a date for use as the default audio session display name.
 * Example output: "Interview Practice - Feb 20, 6:00 PM"
 */
export function formatSessionDisplayName(date: Date): string {
  const formatted = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return `Interview Practice - ${formatted}`;
}
