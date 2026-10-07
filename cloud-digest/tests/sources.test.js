import test from "node:test";
import assert from "node:assert/strict";
import { SOURCES, discoverBlogLinks, parseAppleFeed, extractArticle, htmlToText } from "../src/sources.js";

test("discovers only canonical blog article URLs", () => {
  const html = '<a href="/blog/one">One</a><a href="/blog/one?x=1">Again</a><a href="/blog/topic/codex">Topic</a><a href="https://other.test/blog/x">Wrong</a>';
  assert.deepEqual(discoverBlogLinks(html, SOURCES[0]).map((entry) => entry.url), ["https://developers.openai.com/blog/one"]);
});

test("parses Apple RSS content and preserves its article ID", () => {
  const rss = '<rss><channel><item><title>New &amp; useful</title><link>https://developer.apple.com/news/?id=abc123</link><pubDate>Fri, 18 Sep 2026 10:00:57 PDT</pubDate><description>&lt;p&gt;Build for iPhone.&lt;/p&gt;</description></item></channel></rss>';
  assert.deepEqual(parseAppleFeed(rss), [{ url: "https://developer.apple.com/news/?id=abc123", title: "New & useful", publishedAt: "Fri, 18 Sep 2026 10:00:57 PDT", content: "Build for iPhone." }]);
});

test("extracts Claude body without related posts", () => {
  const html = '<main><h1>New Claude article</h1><section class="blog_post_section_wrap"><p>' + "Article body sentence. ".repeat(10) + '</p></section><section class="blog_related_section_wrap">Related posts</section></main>';
  const entry = extractArticle(html, SOURCES[2], { url: "https://claude.com/blog/new", title: "", publishedAt: null, content: null });
  assert.equal(entry.title, "New Claude article");
  assert.match(entry.content, /Article body sentence/);
  assert.doesNotMatch(entry.content, /Related posts/);
});

test("fetches the article even when RSS has a long description", async () => {
  const { loadArticle } = await import('../src/sources.js');
  let fetched = 0;
  const html = '<main><h1>Apple news</h1><p>' + 'Complete article. '.repeat(50) + '</p><p>Final paragraph.</p></main>';
  const article = await loadArticle(SOURCES[1], { url: 'https://developer.apple.com/news/?id=abc', title: 'RSS', content: 'RSS excerpt. '.repeat(50) }, async () => { fetched++; return new Response(html); });
  assert.equal(fetched, 1);
  assert.match(article.content, /Final paragraph/);
  assert.doesNotMatch(article.content, /RSS excerpt/);
});

test("retains article tails beyond the old 20000-character cutoff", () => {
  const article = extractArticle('<article><h1>Long post</h1><p>' + 'x'.repeat(25000) + '</p><p>TAIL LIMITATION</p></article>', SOURCES[0], { url: 'https://developers.openai.com/blog/long' });
  assert.match(article.content, /TAIL LIMITATION$/);
});

test("fails rather than generating partial text or using RSS after a blocked fetch", async () => {
  const { loadArticle } = await import('../src/sources.js');
  const entry = { url: 'https://openai.com/index/test', content: 'Long RSS excerpt. '.repeat(50) };
  await assert.rejects(loadArticle(SOURCES[3], entry, async () => new Response('Blocked', { status: 403 })), /403/);
  await assert.rejects(loadArticle(SOURCES[0], { url: 'https://developers.openai.com/blog/long' }, async () => new Response('<article><h1>Long</h1>'+'x'.repeat(1000)+'</article>'), { MAX_ARTICLE_CHARS: '500' }), /no partial/);
});

test("uses official claude.dev Markdown instead of its RSS excerpt", async () => {
  const { loadArticle } = await import('../src/sources.js');
  let requested;
  const content = '# Complete tutorial\n\n' + 'Paragraph. '.repeat(60) + '\nFINAL SECTION';
  const article = await loadArticle(SOURCES[4], { url: 'https://claude.dev/blog/tutorial', content: 'RSS teaser' }, async url => { requested = url; return new Response(content); });
  assert.equal(requested, 'https://claude.dev/blog/tutorial.md');
  assert.equal(article.content, content);
  assert.equal(article.contentMethod, 'official_markdown');
});

test("canonicalizes legacy Claude URLs and discovers official additional sources", async () => {
  const { canonicalArticleUrl, parseFeed, getSources } = await import('../src/sources.js');
  assert.equal(canonicalArticleUrl('https://claude.com/blog/claude-code-mods', SOURCES[2]), 'https://claude.com/resources/articles/claude-code-mods');
  assert.equal(canonicalArticleUrl('https://evil.test/index/x', SOURCES[3]), null);
  assert.equal(parseFeed('<item><link>https://openai.com/index/devday-2026-recap</link><title>DevDay</title><category>Company</category><description>Teaser</description></item>', SOURCES[3])[0].title, 'DevDay');
  assert.equal(getSources().length, 7);
});
