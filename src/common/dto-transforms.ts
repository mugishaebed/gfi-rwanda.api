import { Transform } from 'class-transformer';

function parseJsonValue(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return JSON.parse(trimmed);
}

export const ParseBoolean = () =>
  Transform(({ value }) => {
    if (typeof value === 'boolean' || value === undefined || value === null) {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }

      if (normalized === 'false') {
        return false;
      }
    }

    return value;
  });

export const ParseNumber = () =>
  Transform(({ value }) => {
    if (typeof value === 'number' || value === undefined || value === null) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      return Number(value);
    }

    return value;
  });

export const ParseDate = () =>
  Transform(({ value }) => {
    if (value instanceof Date || value === undefined || value === null) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      return new Date(value);
    }

    return value;
  });

export const ParseJson = () =>
  Transform(({ value }) => parseJsonValue(value));

export const ParseStringArray = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed)
          ? parsed.map((item) => String(item))
          : undefined;
      }

      return [trimmed];
    }

    return value;
  });
