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
