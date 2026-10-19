// 排程以明確任務分流，不再用單一舊 Cron 字串判定所有日次行為。
// Cloudflare Cron 使用 UTC：00:00 UTC = 台灣時間 08:00。08:00 是開始時間，不是完成時間。
export const CRON_TASKS = {
  '0 0 * * *': ['official', 'bookmark_daily', 'author_recheck'],
  '*/10 * * * *': ['bookmark_partial'],
  '*/5 * * * *': ['maintenance'],
};

export function tasksFor(cron) {
  return CRON_TASKS[cron] || [];
}
