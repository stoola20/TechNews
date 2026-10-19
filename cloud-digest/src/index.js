import { tasksFor } from './schedule.js';
import { learning } from './learning/http.js';

function log(event, details = {}) {
  console.log(JSON.stringify({ event, ...details }));
}

// 官方來源、X 書籤與分享都走文章庫；Worker 只剩文章庫與健康檢查兩個入口。
export default {
  async scheduled(controller, env, _ctx) {
    const tasks = tasksFor(controller?.cron);
    if (!tasks.length) {
      log('schedule_ignored', { cron: controller?.cron || null });
      return;
    }
    await learning.scheduled(env, { tasks });
  },
  async queue(batch, env) {
    await learning.queue(batch, env);
  },
  async fetch(request, env, ctx) {
    const learningResponse = await learning.fetch(request, env, ctx);
    if (learningResponse) return learningResponse;
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET')
      return Response.json({ ok: true, service: 'developer-digest-cloud' });
    return new Response('Not found', { status: 404 });
  },
};
