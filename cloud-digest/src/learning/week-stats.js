import { query, rows } from './store.js';
import { topicList } from './topics.js';
import { taiwanDate, taiwanStart, addDays } from './reviews.js';

// 每週回顧：台灣時間週一 00:00 到下週一 00:00。保留、刪除、作答與複習都依這個範圍統計。
export function weekStart(date = taiwanDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z')))
    throw new Error('週開始日期格式需為 YYYY-MM-DD');
  const day = new Date(date + 'T00:00:00Z').getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

export async function weekStats(env, start = null) {
  const monday = weekStart(start || taiwanDate()),
    next = addDays(monday, 7);
  const from = taiwanStart(monday),
    to = taiwanStart(next);
  // 本週保留：目前仍保留、保留時間落在本週。
  const kept = (
    await query(
      env,
      "SELECT COUNT(*) AS count FROM learning_items WHERE triage='kept' AND kept_at>=? AND kept_at<?",
      from,
      to,
    ).first()
  ).count;
  // 本週刪除：手動與逾期分開；復原的文章不算，已清除的仍算。
  const deleted = await rows(
    env,
    'SELECT deleted_reason AS reason,COUNT(*) AS count FROM learning_items WHERE deleted_at>=? AND deleted_at<? GROUP BY deleted_reason',
    from,
    to,
  );
  // 作答：精讀與複習都算，依每題的判定統計；最常答錯的主題依文章主要主題統計部分正確與錯誤。
  const attempts = await rows(
    env,
    "SELECT a.grading_json,i.topic_primary FROM learning_attempts a LEFT JOIN learning_items i ON i.id=a.item_id WHERE a.created_at>=? AND a.created_at<? AND a.status='done'",
    from,
    to,
  );
  const answers = { total: 0, correct: 0, partial: 0, incorrect: 0 },
    misses = new Map();
  for (const a of attempts)
    for (const r of JSON.parse(a.grading_json || '{}').results || []) {
      answers.total++;
      answers[r.verdict]++;
      if (r.verdict !== 'correct') misses.set(a.topic_primary || null, (misses.get(a.topic_primary || null) || 0) + 1);
    }
  const topics = await topicList(env);
  const today = taiwanDate();
  const reviews = await query(
    env,
    `SELECT
      (SELECT COUNT(*) FROM learning_reviews r JOIN learning_items i ON i.id=r.item_id WHERE r.status='active' AND i.triage='kept') AS active,
      (SELECT COUNT(*) FROM learning_reviews r JOIN learning_items i ON i.id=r.item_id WHERE r.status='active' AND r.due_date>? AND r.due_date<=? AND i.triage='kept') AS upcoming,
      (SELECT COUNT(*) FROM learning_reviews WHERE status='done' AND completed_at>=? AND completed_at<?) AS completed`,
    today,
    addDays(today, 7),
    from,
    to,
  ).first();
  return {
    start: monday,
    end: addDays(monday, 6),
    previous: addDays(monday, -7),
    next: monday < weekStart() ? next : null,
    kept,
    deleted: {
      manual: deleted.find((d) => d.reason === 'manual')?.count || 0,
      expired: deleted.find((d) => d.reason === 'expired')?.count || 0,
    },
    answers: {
      ...answers,
      accuracy: answers.total ? Math.round((answers.correct / answers.total) * 1000) / 1000 : null,
    },
    missed_topics: [...misses]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => ({ id, name: topics.find((t) => t.id === id)?.name || '未分類', count })),
    // 複習的進行中與未來 7 天到期是目前的狀態；本週完成依完成時間統計。
    reviews: { active: reviews.active, upcoming_7_days: reviews.upcoming, completed: reviews.completed },
  };
}
