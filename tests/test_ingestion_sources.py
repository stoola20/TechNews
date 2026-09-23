from app.ingestion.discovery import discover_article_urls
from app.ingestion.extractor import extract_article


def test_discovers_unique_article_urls_only():
    html = '''<a href="/blog/first">One</a><a href="https://developers.openai.com/blog/first?utm_source=x">One again</a>
    <a href="/blog/second/">Two</a><a href="/blog">Index</a><a href="/docs/x">Docs</a>
    <a href="https://evil.example/blog/fake">Fake</a>'''
    assert discover_article_urls(html) == [
        "https://developers.openai.com/blog/first",
        "https://developers.openai.com/blog/second",
    ]


def test_extracts_main_article_and_normalizes_content():
    html = '''<html><head><meta name="author" content="Ada"><meta property="article:published_time" content="2026-09-11T10:00:00Z">
    <link rel="canonical" href="https://developers.openai.com/blog/a"></head><body>
    <nav>Ignore me</nav><article><h1>Useful Article</h1><p>First   paragraph.</p><h2>Details</h2>
    <p>Second paragraph.</p><aside>Ignore related posts</aside></article></body></html>'''
    article = extract_article(html, "https://developers.openai.com/blog/a?ref=x")
    assert article.title == "Useful Article"
    assert article.author == "Ada"
    assert article.published_at.year == 2026
    assert article.content == "Useful Article\n\nFirst paragraph.\n\nDetails\n\nSecond paragraph."
    assert len(article.content_hash) == 64


def test_extracts_blog_header_metadata_outside_article():
    html = '''<header><div><span>Sep 11, 2026</span></div><h1>New Post</h1>
    <p><span>Author:</span> Eric Provencher</p></header><article><p>Article body.</p></article>'''
    article = extract_article(html, "https://developers.openai.com/blog/new-post")
    assert article.author == "Eric Provencher"
    assert article.published_at.isoformat() == "2026-09-11T00:00:00+00:00"
    assert article.content == "Article body."
