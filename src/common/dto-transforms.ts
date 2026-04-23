import {
  plainToInstance,
  Transform,
  type ClassConstructor,
} from 'class-transformer';

function parseJsonValue(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return JSON.parse(trimmed) as unknown;
}

export const ParseBoolean = () =>
  Transform(({ value }) => {
    const rawValue: unknown = value;

    if (
      typeof rawValue === 'boolean' ||
      rawValue === undefined ||
      rawValue === null
    ) {
      return rawValue;
    }

    if (typeof rawValue === 'string') {
      const normalized = rawValue.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }

      if (normalized === 'false') {
        return false;
      }
    }

    return rawValue;
  });

export const ParseNumber = () =>
  Transform(({ value }) => {
    const rawValue: unknown = value;

    if (
      typeof rawValue === 'number' ||
      rawValue === undefined ||
      rawValue === null
    ) {
      return rawValue;
    }

    if (typeof rawValue === 'string' && rawValue.trim() !== '') {
      return Number(rawValue);
    }

    return rawValue;
  });

export const ParseDate = () =>
  Transform(({ value }) => {
    const rawValue: unknown = value;

    if (
      rawValue instanceof Date ||
      rawValue === undefined ||
      rawValue === null
    ) {
      return rawValue;
    }

    if (typeof rawValue === 'string' && rawValue.trim() !== '') {
      return new Date(rawValue);
    }

    return rawValue;
  });

export const ParseJson = () => Transform(({ value }) => parseJsonValue(value));

export function ParseJsonArrayOf<T extends object>(
  classType: ClassConstructor<T>,
): PropertyDecorator {
  return Transform(({ value }) => {
    const parsed = parseJsonValue(value);

    if (!Array.isArray(parsed)) {
      return parsed;
    }

    return parsed.map((item) => plainToInstance(classType, item));
  });
}

export const ParseStringArray = () =>
  Transform(({ value }) => {
    const rawValue: unknown = value;

    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return undefined;
    }

    if (Array.isArray(rawValue)) {
      return rawValue.map((item) => String(item));
    }

    if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      if (trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed) as unknown;
        return Array.isArray(parsed)
          ? parsed.map((item) => String(item))
          : undefined;
      }

      return [trimmed];
    }

    return rawValue;
  });
