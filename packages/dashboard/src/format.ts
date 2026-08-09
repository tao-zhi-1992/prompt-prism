export function formatTime(value: string, locale?: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export type HttpTone = 'good' | 'bad' | 'neutral';

export function httpStatusTone(status?: number | null): HttpTone {
  if (status === undefined || status === null) return 'neutral';
  return status >= 200 && status <= 299 ? 'good' : 'bad';
}

export function formatHttpStatus(status?: number | null) {
  return `HTTP ${status ?? '—'}`;
}
