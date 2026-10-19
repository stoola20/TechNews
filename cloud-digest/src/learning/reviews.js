import { query, rows, item, nowIso } from './store.js';
import { now } from './clock.js';
import { articleSummaries } from './library.js';

// 今日複習：答錯、部分正確或勾「不確定」的題目進入複習，依 1、3、7、21 天的固定階梯排程。
// 答對且沒勾不確定往上一階（第 4 階答對就完成）；部分正確留在同一階；答錯或不確定回到第 1 階、明天再來。
export const LADDER = [1, 3, 7, 21];
export const DAILY_LIMIT = 10;
const DAY = 86400000,
  TW = 8 * 3600000;

// 台灣日期（YYYY-MM-DD），從注入的 now() 計算。
export const taiwanDate = (time = now()) => new Date(time + TW).toISOString().slice(0, 10);
export const addDays = (date, days) =>
  new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
// 台灣日期 date 的 00:00 對應的 UTC 時間。
export const taiwanStart = (date) => new Date(Date.parse(date + 'T00:00:00Z') - TW).toISOString();

// 依這次結果算出下一個階數與到期日；回傳 null 表示完成。
export function nextStep(stage, verdict, unsure, today = taiwanDate()) {
  if (verdict === 'incorrect' || unsure) return { stage: 1, due: addDays(today, LADDER[0]) };
  if (verdict === 'partial') return { stage, due: addDays(today, LADDER[stage - 1]) };
  if (stage >= LADDER.length) return null;
  return { stage: stage + 1, due: addDays(today, LADDER[stage]) };
}

async function applyStep(env, review, verdict, unsure) {
  const step = nextStep(review.stage, verdict, unsure),
    time = nowIso();
  if (!step)
    await query(
      env,
      "UPDATE learning_reviews SET status='done',last_result=?,completed_at=?,updated_at=? WHERE id=?",
      verdict,
      time,
      time,
      review.id,
    ).run();
  else
    await query(
      env,
      'UPDATE learning_reviews SET stage=?,due_date=?,last_result=?,updated_at=? WHERE id=?',
      step.stage,
      step.due,
      unsure ? 'unsure' : verdict,
      time,
      review.id,
    ).run();
}

// 批改完成後更新複習，每次作答只套用一次。精讀作答：沒有進行中的複習時，部分正確、錯誤或不確定的題目建立第 1 階、
// 到期日為明天；已在複習中的題目，重做的結果也套用階梯規則。複習作答：更新那一題。
export async function applyReviews(env, attemptId) {
  const claimed = await query(
    env,
    "UPDATE learning_attempts SET review_applied=1 WHERE id=? AND status='done' AND review_applied=0",
    attemptId,
  ).run();
  if (!claimed.meta.changes) return 0;
  const attempt = await query(env, 'SELECT * FROM learning_attempts WHERE id=?', attemptId).first();
  const results = JSON.parse(attempt.grading_json || '{}').results || [],
    answers = JSON.parse(attempt.answers_json || '[]');
  let changed = 0;
  for (const r of results) {
    const unsure = !!answers.find((a) => a.number === r.number)?.unsure;
    const review =
      attempt.context === 'review'
        ? await query(env, "SELECT * FROM learning_reviews WHERE id=? AND status='active'", attempt.review_id).first()
        : await query(
            env,
            "SELECT * FROM learning_reviews WHERE quiz_id=? AND number=? AND status='active'",
            attempt.quiz_id,
            r.number,
          ).first();
    if (review) {
      await applyStep(env, review, r.verdict, unsure);
      changed++;
    } else if (attempt.context === 'quiz' && (r.verdict !== 'correct' || unsure)) {
      const time = nowIso();
      // 已完成的同一題又答錯：重新開始第 1 階。
      await query(
        env,
        `INSERT INTO learning_reviews(id,quiz_id,number,item_id,stage,due_date,status,last_result,created_at,updated_at) VALUES(?,?,?,?,1,?,'active',?,?,?)
        ON CONFLICT(quiz_id,number) DO UPDATE SET stage=1,due_date=excluded.due_date,status='active',last_result=excluded.last_result,completed_at=NULL,updated_at=excluded.updated_at`,
        crypto.randomUUID(),
        attempt.quiz_id,
        r.number,
        attempt.item_id,
        addDays(taiwanDate(), LADDER[0]),
        unsure ? 'unsure' : r.verdict,
        time,
        time,
      ).run();
      changed++;
    }
  }
  return changed;
}

// 今天已作答的複習題數（台灣日期），計入每日上限。
async function answeredToday(env, today) {
  return (
    await query(
      env,
      "SELECT COUNT(DISTINCT review_id) AS count FROM learning_attempts WHERE created_at>=? AND created_at<? AND context='review'",
      taiwanStart(today),
      taiwanStart(addDays(today, 1)),
    ).first()
  ).count;
}

// 今日複習：到期日在今天以前、進行中、文章仍保留的題目，依到期日舊到新；扣掉今天已作答的，最多 10 題。
export async function todayReviews(env) {
  const today = taiwanDate(),
    done = await answeredToday(env, today);
  const due = await rows(
    env,
    `SELECT r.id,r.quiz_id,r.number,r.item_id,r.stage,r.due_date,q.questions_json FROM learning_reviews r
    JOIN learning_items i ON i.id=r.item_id JOIN learning_quizzes q ON q.id=r.quiz_id
    WHERE r.status='active' AND r.due_date<=? AND i.triage='kept' ORDER BY r.due_date,r.created_at LIMIT ?`,
    today,
    DAILY_LIMIT,
  );
  const total = (
    await query(
      env,
      "SELECT COUNT(*) AS count FROM learning_reviews r JOIN learning_items i ON i.id=r.item_id WHERE r.status='active' AND r.due_date<=? AND i.triage='kept'",
      today,
    ).first()
  ).count;
  const list = due.slice(0, Math.max(0, DAILY_LIMIT - done));
  const titles = new Map((await articleSummaries(env, [...new Set(list.map((r) => r.item_id))])).map((a) => [a.id, a]));
  return {
    today,
    limit: DAILY_LIMIT,
    answered_today: done,
    total_due: total,
    items: list.map((r) => {
      const q = JSON.parse(r.questions_json).find((x) => x.number === r.number) || {};
      const article = titles.get(r.item_id) || {};
      return {
        id: r.id,
        quiz_id: r.quiz_id,
        number: r.number,
        item_id: r.item_id,
        title: article.title || '',
        publisher: article.publisher || '',
        stage: r.stage,
        due_date: r.due_date,
        type: q.type,
        question: q.question,
      };
    }),
  };
}

// 列表頂端的入口：今天還要做的複習題數。
export async function todayCount(env) {
  const r = await todayReviews(env);
  return r.items.length;
}

// 複習作答前的檢查：題目進行中、文章仍保留、已到期。
export async function reviewForAttempt(env, id) {
  const review = await query(env, 'SELECT * FROM learning_reviews WHERE id=?', id).first();
  if (!review) return { error: ['複習題不存在', 404] };
  const row = await item(env, review.item_id);
  if (review.status !== 'active' || !row || row.triage !== 'kept') return { error: ['這題目前不在複習中', 409] };
  if (review.due_date > taiwanDate()) return { error: ['這題還沒到期', 409] };
  return { review };
}
