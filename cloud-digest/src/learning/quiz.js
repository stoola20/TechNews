import { query, rows, item, nowIso, hash, budget, setting, BudgetPaused } from './store.js';
import { geminiJson } from './gemini.js';
import { textProvider, ensureJob, PRIORITY, localModel, fail, JobConflict } from './local.js';
import { itemChunks } from './rag-index.js';
import { keywords, mediaChunkId } from './retrieval.js';
import { setTriage, triageState } from './triage.js';
import { articleSummaries } from './library.js';
import { webCheck } from './web-check.js';
import {
  QUIZ_PROMPT_VERSION,
  GRADE_PROMPT_VERSION,
  quizRequest,
  gradeRequest,
  validateQuiz,
  validateGrade,
} from './quiz-prompt.js';

// 精讀問答：按下「開始問答」才出題；出題與批改跟隨文字模型設定（Gemini 同步、本機交給 Mac）。
export const ANSWER_MAX = 2000;
const EXTRA_PER_QUESTION = 3;

export class QuizError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'QuizError';
    this.status = status;
  }
}

// 費用暫停或手動暫停時不出題也不批改，回 429 並說明原因。
async function ensureRunning(env) {
  const b = await budget(env);
  if (!b.paused) return;
  const control = await setting(env, 'control');
  throw new BudgetPaused(
    control.reason === 'manual'
      ? '已手動暫停全部處理，暫時不出題也不批改。到管理頁恢復處理後再試。'
      : '費用暫停中，暫時不出題也不批改。到管理頁確認預算後手動恢復。',
  );
}

// 本篇的片段：教材正文、可用來源與媒體解析，每段帶穩定 ID，格式沿用追問片段。
export async function articleChunks(env, row) {
  const raw = await itemChunks(env, row);
  const evidence = new Map(
    (await rows(env, 'SELECT id,url,relation FROM learning_evidence WHERE item_id=?', row.id)).map((e) => [e.id, e]),
  );
  const media = new Map(
    (
      await rows(
        env,
        'SELECT a.id,m.url FROM learning_media_analyses a JOIN learning_media m ON m.id=a.media_id WHERE a.item_id=?',
        row.id,
      )
    ).map((m) => [m.id, m.url]),
  );
  return raw.map((c) => {
    const base = { item_id: row.id, range_start: c.start, content: c.text };
    if (c.kind === 'body') return { ...base, id: `body:${row.id}:${c.start}`, url: row.url, relation: 'article_body' };
    if (c.kind === 'source') {
      const e = evidence.get(c.ref_id);
      return { ...base, id: `${c.ref_id}:${c.start}`, url: e.url, relation: e.relation };
    }
    return { ...base, id: mediaChunkId(c.ref_id, c.start), url: media.get(c.ref_id), relation: 'media_evidence' };
  });
}

const parse = (value, fallback) => {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
};

// 題組畫面：題目不含參考答案，批改後才在作答結果顯示。題組的 revision 落後時標示文章已更新。
export async function quizView(env, quiz, row = null) {
  const current = row || (await item(env, quiz.item_id));
  const attempts = await rows(
    env,
    "SELECT id,status,grading_json,created_at FROM learning_attempts WHERE quiz_id=? AND context='quiz' ORDER BY created_at DESC",
    quiz.id,
  );
  return {
    id: quiz.id,
    item_id: quiz.item_id,
    status: quiz.status,
    error: quiz.error,
    provider: quiz.provider,
    model: quiz.model,
    revision: quiz.revision,
    stale: !!current && quiz.revision < current.revision,
    created_at: quiz.created_at,
    questions: parse(quiz.questions_json, []).map((q) => ({
      number: q.number,
      type: q.type,
      question: q.question,
      related_id: q.related_id,
    })),
    related: parse(quiz.related_json, []),
    attempts: attempts.map((a) => ({
      id: a.id,
      status: a.status,
      created_at: a.created_at,
      summary: parse(a.grading_json, {}).summary || null,
    })),
  };
}

export async function listQuizzes(env, itemId) {
  const row = await item(env, itemId);
  const list = await rows(
    env,
    'SELECT * FROM learning_quizzes WHERE item_id=? ORDER BY created_at DESC LIMIT 20',
    itemId,
  );
  return Promise.all(list.map((q) => quizView(env, q, row)));
}

// 出題。fresh=true 時附上這篇已出過的題目，要求新題避開。deps.related 由連結題提供相關保留文章。
export async function createQuiz(env, itemId, { fresh = false } = {}, deps = {}) {
  const row = await item(env, itemId);
  if (!row || row.status === 'dismissed') throw new QuizError('文章不存在', 404);
  if (!['ready', 'partial'].includes(row.status) || triageState(row) === 'deleted')
    throw new QuizError('只有已完成、而且不在最近刪除的文章可以出題', 409);
  await ensureRunning(env);
  const chunks = await articleChunks(env, row);
  if (!chunks.length) throw new QuizError('這篇沒有可以出題的內容', 409);
  // 願意測驗的文章就是要留的：待決定文章出題時同時改成保留。
  if (triageState(row) === 'pending') await setTriage(env, row, 'kept');
  const related = deps.related ? await deps.related(env, row) : { articles: [], chunks: [] };
  const previous = fresh
    ? (
        await rows(env, "SELECT questions_json FROM learning_quizzes WHERE item_id=? AND status='ready'", itemId)
      ).flatMap((q) => parse(q.questions_json, []).map((x) => x.question))
    : [];
  const all = [...chunks, ...related.chunks];
  const input = {
    kind: 'quiz',
    prompt_version: QUIZ_PROMPT_VERSION,
    title: row.title,
    chunks: all.map((c, i) => ({ ref: `C${i + 1}`, ...c })),
    related: related.articles,
    previous,
  };
  const id = crypto.randomUUID(),
    time = nowIso(),
    provider = await textProvider(env);
  await query(
    env,
    "INSERT INTO learning_quizzes(id,item_id,revision,status,related_json,provider,prompt_version,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?,?,?)",
    id,
    itemId,
    row.revision,
    JSON.stringify(related.articles.map((a) => ({ id: a.id, title: a.title, ref: a.ref }))),
    provider === 'local' ? 'ollama' : 'gemini',
    QUIZ_PROMPT_VERSION,
    time,
    time,
  ).run();
  if (provider === 'local') {
    const jobId = await ensureJob(env, {
      kind: 'quiz',
      questionId: id,
      priority: PRIORITY.quiz,
      input,
      fingerprint: await hash(JSON.stringify({ input, model: localModel(env) })),
    });
    await query(
      env,
      "UPDATE learning_quizzes SET status='waiting_local',job_id=?,model=?,updated_at=? WHERE id=?",
      jobId,
      localModel(env),
      nowIso(),
      id,
    ).run();
  } else
    try {
      const questions = validateQuiz(input, await geminiJson(env, { ...quizRequest(input), fetcher: deps.fetcher }));
      await saveQuestions(env, id, input, questions, env.LEARNING_MODEL || 'gemini-3.8-flash').run();
    } catch (error) {
      if (error.name === 'BudgetPaused') {
        await query(env, 'DELETE FROM learning_quizzes WHERE id=?', id).run();
        throw error;
      }
      await query(
        env,
        "UPDATE learning_quizzes SET status='error',error=?,updated_at=? WHERE id=?",
        String(error.message || '出題失敗').slice(0, 300),
        nowIso(),
        id,
      ).run();
    }
  return quizView(
    env,
    await query(env, 'SELECT * FROM learning_quizzes WHERE id=?', id).first(),
    await item(env, itemId),
  );
}

// 保存題目的 SQL，連同每題出處片段的內容；之後文章更新，批改仍用出題時的證據。本機回報時放進同一個 batch。
function saveQuestions(env, id, input, questions, model, guard = []) {
  const byId = new Map(input.chunks.map((c) => [c.id, c]));
  const stored = questions.map((q) => ({
    ...q,
    evidence: q.citations.map((cid) => {
      const { ref, ...chunk } = byId.get(cid);
      return chunk;
    }),
  }));
  return query(
    env,
    `UPDATE learning_quizzes SET status='ready',questions_json=?,model=?,error=NULL,updated_at=? WHERE id=? ${guard.length ? guard[0] : ''}`,
    JSON.stringify(stored),
    String(model || '').slice(0, 80),
    nowIso(),
    id,
    ...guard.slice(1),
  );
}

// 本機出題完成：驗證輸出，失敗算一次模型失敗並回報 422，可以重試。
export async function completeQuiz(env, job, input, data) {
  let questions;
  try {
    questions = validateQuiz(input, data.output);
  } catch (error) {
    await fail(env, job.id, job.attempt_token, error.message);
    throw new JobConflict(error.message, 'invalid_output');
  }
  const time = nowIso();
  const result = await env.DB.batch([
    query(
      env,
      "UPDATE learning_jobs SET status='done',result_json='{}',completed_at=?,updated_at=?,lease_until=NULL WHERE id=? AND status='leased' AND attempt_token=?",
      time,
      time,
      job.id,
      job.attempt_token,
    ),
    saveQuestions(env, job.question_id, input, questions, data.model?.name, [
      "AND job_id=? AND EXISTS(SELECT 1 FROM learning_jobs WHERE id=? AND status='done' AND attempt_token=?)",
      job.id,
      job.id,
      job.attempt_token,
    ]),
  ]);
  return { ok: true, replay: !result[1].meta.changes };
}

// 本篇內與「題目＋答案」最相關的片段：依關鍵字命中數，每題最多 3 段，不重複出處片段。
function matchingChunks(chunks, text, skip) {
  const terms = keywords(text);
  if (!terms.length) return [];
  return chunks
    .filter((c) => !skip.has(c.id))
    .map((c) => ({ c, score: terms.filter((t) => c.content.toLowerCase().includes(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, EXTRA_PER_QUESTION)
    .map((x) => x.c);
}

// 作答：一次送出全部答案（複習時一題）。空白答案不送模型，直接判錯並附參考答案。
// deps.library 由批改第二層提供其他保留文章的片段；hooks.graded 在批改完成後執行（例如建立複習）。
export async function submitAttempt(
  env,
  quizId,
  data,
  deps = {},
  { context = 'quiz', numbers = null, reviewId = null } = {},
) {
  const quiz = await query(env, 'SELECT * FROM learning_quizzes WHERE id=?', quizId).first();
  if (!quiz) throw new QuizError('題組不存在', 404);
  if (quiz.status !== 'ready') throw new QuizError('題目還沒準備好', 409);
  const row = await item(env, quiz.item_id);
  if (!row || row.status === 'dismissed' || triageState(row) === 'deleted')
    throw new QuizError('這篇已在最近刪除或已清除，不能作答', 409);
  const questions = parse(quiz.questions_json, []).filter((q) => !numbers || numbers.includes(q.number));
  const given = Array.isArray(data?.answers) ? data.answers : [];
  const answers = questions.map((q) => {
    const a = given.find((x) => Number(x?.number) === q.number) || {};
    const text = a.answer == null ? '' : a.answer;
    if (typeof text !== 'string' || text.length > ANSWER_MAX) throw new QuizError(`答案需為 0–${ANSWER_MAX} 字`, 400);
    return { number: q.number, answer: text.trim(), unsure: a.unsure === true };
  });
  await ensureRunning(env);
  const id = crypto.randomUUID(),
    time = nowIso(),
    provider = await textProvider(env);
  await query(
    env,
    "INSERT INTO learning_attempts(id,quiz_id,item_id,context,review_id,answers_json,status,provider,created_at,updated_at) VALUES(?,?,?,?,?,?,'grading',?,?,?)",
    id,
    quizId,
    quiz.item_id,
    context,
    reviewId,
    JSON.stringify(answers),
    provider === 'local' ? 'ollama' : 'gemini',
    time,
    time,
  ).run();
  const asked = answers.filter((a) => a.answer);
  // 第一層：題目出處，加上本篇內與「題目＋答案」相關的片段；第二層：其他保留文章（由 deps.library 提供）。
  const current = await articleChunks(env, row);
  const evidence = [],
    seen = new Set();
  const addChunk = (chunk, layer) => {
    if (seen.has(chunk.id)) return;
    seen.add(chunk.id);
    evidence.push({ ...chunk, layer });
  };
  const gradeQuestions = [];
  for (const a of asked) {
    const q = questions.find((x) => x.number === a.number);
    for (const c of q.evidence) addChunk(c, c.item_id === quiz.item_id ? 'article' : 'library');
    for (const c of matchingChunks(current, q.question + '\n' + a.answer, seen)) addChunk(c, 'article');
    if (deps.library)
      for (const c of await deps.library(env, quiz.item_id, q.question + '\n' + a.answer)) addChunk(c, 'library');
    gradeQuestions.push({
      number: q.number,
      question: q.question,
      reference: q.reference,
      answer: a.answer,
      unsure: a.unsure,
    });
  }
  const input = {
    kind: 'grade',
    prompt_version: GRADE_PROMPT_VERSION,
    attempt_id: id,
    questions: gradeQuestions,
    chunks: evidence.map((c, i) => ({ ref: `C${i + 1}`, ...c })),
  };
  if (!asked.length) {
    await finishAttempt(env, id, input, [], null, deps.hooks);
  } else if (provider === 'local') {
    const jobId = await ensureJob(env, {
      kind: 'grade',
      questionId: id,
      priority: PRIORITY.grade,
      input,
      fingerprint: await hash(JSON.stringify({ input, model: localModel(env) })),
    });
    await query(
      env,
      "UPDATE learning_attempts SET status='waiting_local',job_id=?,model=?,updated_at=? WHERE id=?",
      jobId,
      localModel(env),
      nowIso(),
      id,
    ).run();
  } else
    try {
      const results = validateGrade(input, await geminiJson(env, { ...gradeRequest(input), fetcher: deps.fetcher }));
      await finishAttempt(env, id, input, results, env.LEARNING_MODEL || 'gemini-3.8-flash', deps.hooks);
    } catch (error) {
      if (error.name === 'BudgetPaused') {
        await query(env, 'DELETE FROM learning_attempts WHERE id=?', id).run();
        throw error;
      }
      await query(
        env,
        "UPDATE learning_attempts SET status='error',error=?,updated_at=? WHERE id=?",
        String(error.message || '批改失敗').slice(0, 300),
        nowIso(),
        id,
      ).run();
    }
  return attemptView(env, await query(env, 'SELECT * FROM learning_attempts WHERE id=?', id).first());
}

// 組合批改結果：空白答案直接判錯，其他依模型結果；出處附上片段內容與層級（本篇、其他保留文章）。
function gradingResult(quiz, attempt, input, results) {
  const questions = parse(quiz.questions_json, []),
    answers = parse(attempt.answers_json, []);
  const chunks = new Map(input.chunks.map((c) => [c.id, c]));
  const list = answers.map((a) => {
    const q = questions.find((x) => x.number === a.number);
    const r = results.find((x) => x.number === a.number);
    const blank = !a.answer || !r;
    const cited = blank ? q.citations : r.citations;
    return {
      number: a.number,
      verdict: blank ? 'incorrect' : r.verdict,
      feedback: blank ? '沒有作答。參考答案：' + q.reference : r.feedback,
      blank,
      needs_web: !blank && r.needs_web,
      claim: blank ? '' : r.claim,
      sources: cited
        .map((cid) => chunks.get(cid) || q.evidence.find((c) => c.id === cid))
        .filter(Boolean)
        .map((c) => ({
          id: c.id,
          layer: c.layer || (c.item_id === quiz.item_id ? 'article' : 'library'),
          item_id: c.item_id,
          url: c.url,
          relation: c.relation,
          range_start: c.range_start || 0,
          excerpt: c.content.slice(0, 500),
        })),
    };
  });
  const count = (v) => list.filter((r) => r.verdict === v).length;
  return {
    results: list,
    summary: {
      total: list.length,
      correct: count('correct'),
      partial: count('partial'),
      incorrect: count('incorrect'),
    },
  };
}

async function finishAttempt(env, id, input, results, model, hooks = {}, guard = []) {
  const attempt = await query(env, 'SELECT * FROM learning_attempts WHERE id=?', id).first();
  const quiz = await query(env, 'SELECT * FROM learning_quizzes WHERE id=?', attempt.quiz_id).first();
  const grading = gradingResult(quiz, attempt, input, results);
  // 有題目需要上網查證時先停在 web_check，由 hooks.graded 接著查證；本機批改也由 Worker 查證。
  const statement = query(
    env,
    `UPDATE learning_attempts SET status=?,grading_json=?,model=COALESCE(?,model),error=NULL,updated_at=? WHERE id=? ${guard.length ? guard[0] : ''}`,
    grading.results.some((r) => r.needs_web) ? 'web_check' : 'done',
    JSON.stringify(grading),
    model ? String(model).slice(0, 80) : null,
    nowIso(),
    id,
    ...guard.slice(1),
  );
  if (guard.length) return statement;
  await statement.run();
  if (hooks.graded) await hooks.graded(env, id);
}

// 網路查證：更新需要查證的題目，失敗時保留第一輪結果並記下原因。重複執行時只處理仍在 web_check 的作答。
export async function completeWebCheck(env, attemptId, fetcher = fetch) {
  const attempt = await query(
    env,
    "SELECT * FROM learning_attempts WHERE id=? AND status='web_check'",
    attemptId,
  ).first();
  if (!attempt) return false;
  const quiz = await query(env, 'SELECT * FROM learning_quizzes WHERE id=?', attempt.quiz_id).first();
  const grading = parse(attempt.grading_json, { results: [] });
  const checked = await webCheck(env, attempt, parse(quiz.questions_json, []), grading.results, fetcher);
  const count = (v) => checked.results.filter((r) => r.verdict === v).length;
  const result = await query(
    env,
    "UPDATE learning_attempts SET status='done',web_check=?,grading_json=?,updated_at=? WHERE id=? AND status='web_check'",
    checked.web_check,
    JSON.stringify({
      results: checked.results,
      summary: {
        total: checked.results.length,
        correct: count('correct'),
        partial: count('partial'),
        incorrect: count('incorrect'),
      },
      web_note: checked.note,
    }),
    nowIso(),
    attemptId,
  ).run();
  return !!result.meta.changes;
}

// 本機批改完成：驗證輸出，失敗算一次模型失敗並回報 422。
export async function completeGrade(env, job, input, data, hooks = {}) {
  let results;
  try {
    results = validateGrade(input, data.output);
  } catch (error) {
    await fail(env, job.id, job.attempt_token, error.message);
    throw new JobConflict(error.message, 'invalid_output');
  }
  const time = nowIso();
  const result = await env.DB.batch([
    query(
      env,
      "UPDATE learning_jobs SET status='done',result_json='{}',completed_at=?,updated_at=?,lease_until=NULL WHERE id=? AND status='leased' AND attempt_token=?",
      time,
      time,
      job.id,
      job.attempt_token,
    ),
    await finishAttempt(env, job.question_id, input, results, data.model?.name, hooks, [
      "AND job_id=? AND EXISTS(SELECT 1 FROM learning_jobs WHERE id=? AND status='done' AND attempt_token=?)",
      job.id,
      job.id,
      job.attempt_token,
    ]),
  ]);
  if (result[1].meta.changes && hooks.graded) await hooks.graded(env, job.question_id);
  return { ok: true, replay: !result[1].meta.changes };
}

// 作答畫面：每題的判定、你的答案、回饋、參考答案，以及依本篇／其他保留文章／網路分組的出處。
export async function attemptView(env, attempt) {
  const quiz = await query(env, 'SELECT * FROM learning_quizzes WHERE id=?', attempt.quiz_id).first();
  const questions = parse(quiz?.questions_json, []),
    answers = parse(attempt.answers_json, []),
    grading = parse(attempt.grading_json, null);
  const libraryIds = [
    ...new Set(
      (grading?.results || []).flatMap((r) => r.sources.filter((s) => s.layer === 'library').map((s) => s.item_id)),
    ),
  ];
  const titles = new Map((await articleSummaries(env, libraryIds)).map((a) => [a.id, a.title]));
  return {
    id: attempt.id,
    quiz_id: attempt.quiz_id,
    item_id: attempt.item_id,
    context: attempt.context,
    status: attempt.status,
    error: attempt.error,
    provider: attempt.provider,
    model: attempt.model,
    web_check: attempt.web_check,
    web_note: grading?.web_note || null,
    created_at: attempt.created_at,
    summary: grading?.summary || null,
    results: answers.map((a) => {
      const q = questions.find((x) => x.number === a.number) || {};
      const r = grading?.results.find((x) => x.number === a.number);
      const sources = r?.sources || [];
      return {
        number: a.number,
        type: q.type,
        question: q.question,
        answer: a.answer,
        unsure: a.unsure,
        ...(r
          ? {
              verdict: r.verdict,
              feedback: r.feedback,
              reference: q.reference,
              needs_web: r.needs_web,
              web_checked: !!r.web_checked,
              sources: {
                article: sources.filter((s) => s.layer === 'article'),
                library: sources
                  .filter((s) => s.layer === 'library')
                  .map((s) => ({ ...s, title: titles.get(s.item_id) || '' })),
                web: r.web_sources || [],
              },
            }
          : {}),
      };
    }),
  };
}
