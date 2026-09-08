const PLACEHOLDER_RE = /\{\{\s*([0-9A-Za-z_]+)\s*\}\}/g;

// Return an ordered, deduplicated list of the placeholder keys in a template body.
// e.g. "Olá {{1}}, aqui é {{2}} da {{3}}. Sobre {{4}}." -> ["1", "2", "3", "4"]
export const extractPlaceholders = (body) => {
  if (!body) return [];
  const seen = new Set();
  const keys = [];
  let match;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(body)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      keys.push(match[1]);
    }
  }
  return keys;
};

// Substitute the collected values back into the template body for the preview.
export const renderPreview = (body, values) => {
  if (!body) return "";
  return body.replace(PLACEHOLDER_RE, (_, key) => {
    const v = values ? values[key] : undefined;
    return v === undefined || v === "" ? `{{${key}}}` : v;
  });
};

// Human-friendly "X hours ago" for the 24-hour session banner.
export const timeAgo = (isoString) => {
  if (!isoString) return "";
  const then = new Date(isoString).getTime();
  const diffMs = Date.now() - then;
  if (Number.isNaN(diffMs) || diffMs < 0) return "";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};
