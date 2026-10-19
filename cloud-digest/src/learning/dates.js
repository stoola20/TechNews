// 來源的發表時間格式混雜：RSS 的 RFC 2822（GMT、數字時差或 PDT 等美國時區縮寫）、ISO 8601、只有日期。
// 只接受帶時區或只有日期的寫法，沒有時區的時間一律視為 UTC，避免依執行環境的時區解讀。
const RFC2822 =
  /^(?:[A-Za-z]{3},\s*)?\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(?:[A-Z]{1,4}|[+-]\d{4})$/;
const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/;

export function normalizePublished(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let time = NaN;
  const iso = text.match(ISO);
  if (iso) time = Date.parse(iso[2] ? `${iso[1]}T${iso[2]}${iso[3] || 'Z'}` : `${iso[1]}T00:00:00Z`);
  else if (RFC2822.test(text)) time = Date.parse(text);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  if (date.getUTCFullYear() < 1990 || date.getUTCFullYear() > 2100) return null;
  return date.toISOString();
}

// 發表時間是否早於「基準時間往前 days 天」。沒有日期或無法解析時回傳 false，交給抓到原文後再判斷。
export function publishedBefore(value, reference, days) {
  const published = normalizePublished(value);
  return !!published && Date.parse(published) < reference - days * 86400000;
}
