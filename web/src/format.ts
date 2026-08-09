import type { Usage } from './types';

export const formatNumber = (value?: number) => new Intl.NumberFormat().format(value ?? 0);

export function totalInputTokens(usage?: Usage) {
  return (usage?.input_tokens ?? 0)
    + (usage?.cache_creation_input_tokens ?? 0)
    + (usage?.cache_read_input_tokens ?? 0);
}

export function formatTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function cachePercent(input?: number, cached?: number) {
  if (!input) return null;
  return Math.min(100, Math.round(((cached ?? 0) / input) * 100));
}
