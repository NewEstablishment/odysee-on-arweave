// Shared field helpers for native committed messages. Every native feature
// reads the same wire shapes (kebab and snake key aliases, bounded text,
// reference strings), so these live once. See docs/native-messages.md for
// the envelope contract these helpers implement.
import { isNativeMessageId } from './nativeMessageVerification.ts';

export { isNativeMessageId };

export function field(source: any, ...keys: Array<string>): any {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key];
  }
}

export function optionalString(source: any): string | undefined {
  return typeof source === 'string' && source ? source : undefined;
}

export function integer(source: any, fallback: number): number {
  const parsed = Math.floor(Number(source));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function optionalInteger(source: any): number | undefined {
  if (source === undefined || source === null || source === '') return undefined;
  const parsed = Math.floor(Number(source));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function booleanField(source: any): boolean | null {
  if (source === true || source === 'true' || source === 1 || source === '1') return true;
  if (source === false || source === 'false' || source === 0 || source === '0') return false;
  return null;
}

export function normalizeMessageId(source: any): string {
  return String(source || '').replace(/^\/+/, '');
}

export function hasControlCharacters(source: string): boolean {
  return Array.from(source).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function hasUnsafeControlCharacters(source: string): boolean {
  return Array.from(source).some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
}

export function boundedText(value: string, maxLength: number): boolean {
  return value.trim().length > 0 && value.length <= maxLength && !hasControlCharacters(value);
}

// Reference strings (version refs, revision pointers). The historical max
// differs per feature (128 for reactions, 193 for owner-derived subscription
// refs), so the bound is a parameter; specs pass their own. New specs should
// use MAX_REFERENCE_LENGTH.
export const MAX_REFERENCE_LENGTH = 193;

export function validReference(reference: string, maxLength: number = MAX_REFERENCE_LENGTH): boolean {
  return reference.length >= 16 && reference.length <= maxLength && !hasControlCharacters(reference);
}

export function validTarget(target: string): boolean {
  return target.length > 0 && target.length <= 1024 && !hasControlCharacters(target);
}

export function compact<T extends Record<string, any>>(source: T): T {
  return Object.fromEntries(Object.entries(source).filter(([, sourceValue]) => sourceValue !== undefined)) as T;
}

export function numberField(source: Record<string, any> | undefined, ...keys: Array<string>): number | undefined {
  const sourceValue = field(source, ...keys);
  if (sourceValue === undefined) return undefined;
  const parsed = Number(sourceValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function stableJson(source: any): string {
  if (!source || typeof source !== 'object') return JSON.stringify(source);
  if (Array.isArray(source)) return `[${source.map(stableJson).join(',')}]`;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`)
    .join(',')}}`;
}
