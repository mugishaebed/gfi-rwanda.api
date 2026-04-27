const SCRIPT_TAG = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const EVENT_HANDLER_ATTR = /\son[a-z]+\s*=\s*(["']).*?\1/gi;
const JS_PROTOCOL_ATTR = /(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi;
const DATA_HTML_PROTOCOL_ATTR =
  /(href|src)\s*=\s*(["'])\s*data:text\/html[^"']*\2/gi;

export const sanitizeBlogHtml = (rawHtml: string) =>
  rawHtml
    .replace(SCRIPT_TAG, '')
    .replace(EVENT_HANDLER_ATTR, '')
    .replace(JS_PROTOCOL_ATTR, '$1="#"')
    .replace(DATA_HTML_PROTOCOL_ATTR, '$1="#"');
