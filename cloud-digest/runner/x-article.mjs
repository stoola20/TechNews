// X 長文代抓：用 Mac 上專用、已登入 X 的 Chrome profile 開啟長文頁並擷取正文。
// 登入狀態只留在這台 Mac 的 profile 資料夾，不會上傳到文章庫。
import { RunnerError } from './lib.js';

async function browserLibrary() {
  try {
    return (await import('playwright-core')).chromium;
  } catch {
    return null;
  }
}

// 有設定 profile 資料夾且已安裝 playwright-core，才向文章庫宣告可處理代抓工作。
export async function xFetchAvailable(config) {
  return !!config.xProfileDir && !!(await browserLibrary());
}

async function openContext(config, headless) {
  const chromium = await browserLibrary();
  if (!chromium) throw new RunnerError('未安裝 playwright-core，無法代抓 X 長文', { retryable: false });
  try {
    return await chromium.launchPersistentContext(config.xProfileDir, {
      channel: 'chrome',
      headless,
      viewport: { width: 1280, height: 900 },
    });
  } catch (error) {
    throw new RunnerError('無法啟動 Chrome：' + error.message.slice(0, 200), { local: true });
  }
}

// 頁面內執行：取最長的 article 區塊（長文正文），找不到時退到 main。
function extractArticle() {
  const blocks = [...document.querySelectorAll('article,[data-testid="twitterArticleRichTextView"],main')];
  const best = blocks
    .map((node) => ({ node, text: node.innerText.trim() }))
    .sort((a, b) => b.text.length - a.text.length)[0];
  const title =
    document.querySelector('[data-testid="twitter-article-title"]')?.innerText ||
    document.querySelector('h1')?.innerText ||
    document.title;
  return { title: (title || '').trim(), content: best?.text || '', url: location.href };
}

export async function fetchXArticle(config, url) {
  const target = new URL(url);
  if (target.hostname !== 'x.com' || !/^\/i\/article\/\d+$/.test(target.pathname))
    throw new RunnerError('只代抓 X 長文網址', { retryable: false });
  const context = await openContext(config, true);
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('article,main', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const result = await page.evaluate(extractArticle);
    if (/\/(i\/flow\/login|login)/.test(new URL(result.url).pathname))
      throw new RunnerError('X 登入已失效，請在 Mac 上重新執行 --x-login', { retryable: false });
    if (result.content.length < 200) throw new RunnerError('頁面沒有取得長文正文，可能需要重新登入或長文已刪除');
    return { title: result.title, content: result.content };
  } finally {
    await context.close().catch(() => {});
  }
}

// 首次設定：開啟有畫面的 Chrome，讓使用者在專用 profile 登入 X；關閉視窗即完成。
export async function loginX(config, log) {
  if (!config.xProfileDir) throw new Error('請先設定 RUNNER_X_PROFILE_DIR');
  const context = await openContext(config, false);
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://x.com/login');
  log({ event: 'x_login_opened', profile: config.xProfileDir, next: '在開啟的 Chrome 視窗登入 X，完成後關閉視窗' });
  await new Promise((resolve) => context.on('close', resolve));
  log({ event: 'x_login_closed' });
}
