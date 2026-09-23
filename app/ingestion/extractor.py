import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from bs4 import BeautifulSoup, Tag

from app.ingestion.discovery import canonical_blog_url


@dataclass(frozen=True)
class ExtractedArticle:
    source_url: str
    title: str
    author: str | None
    published_at: datetime | None
    content: str
    content_hash: str


def normalize_content(text: str) -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    return "\n\n".join(line for line in lines if line)


def extract_article(html: str, source_url: str) -> ExtractedArticle:
    soup = BeautifulSoup(html, "html.parser")
    article = soup.select_one("article") or soup.select_one("main")
    if article is None:
        raise ValueError(f"No article content found: {source_url}")

    title_node = article.select_one("h1") or soup.select_one("h1")
    title_meta = soup.select_one('meta[property="og:title"]')
    title = title_node.get_text(" ", strip=True) if title_node else (title_meta.get("content", "").strip() if title_meta else "")
    if not title:
        raise ValueError(f"No article title found: {source_url}")

    header = title_node.find_parent("header") if title_node else None
    author_meta = soup.select_one('meta[name="author"]') or soup.select_one('meta[property="article:author"]')
    author = author_meta.get("content", "").strip() if author_meta else None
    if not author and header:
        author_label = header.find(string=lambda value: value and value.strip() == "Author:")
        if author_label:
            author = author_label.parent.parent.get_text(" ", strip=True).removeprefix("Author:").strip() or None
    published_meta = soup.select_one('meta[property="article:published_time"]')
    time_node = article.select_one("time[datetime]")
    date_text = (published_meta.get("content") if published_meta else None) or (time_node.get("datetime") if time_node else None)
    try:
        published_at = datetime.fromisoformat(date_text.replace("Z", "+00:00")) if date_text else None
    except ValueError:
        published_at = None
    if published_at is None and header:
        date_node = header.find(string=lambda value: value and re.fullmatch(r"[A-Z][a-z]{2} \d{1,2}, \d{4}", value.strip()))
        if date_node:
            published_at = datetime.strptime(date_node.strip(), "%b %d, %Y").replace(tzinfo=timezone.utc)

    for unwanted in article.select("nav, aside, footer, script, style, form, button"):
        unwanted.decompose()
    blocks = []
    block_names = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "pre", "li", "blockquote"}
    for block in article.find_all(block_names):
        if any(parent.name in block_names for parent in block.parents if isinstance(parent, Tag) and parent is not article):
            continue
        text = block.get_text(" ", strip=True)
        if text:
            blocks.append(text)
    content = normalize_content("\n".join(blocks))
    if not content:
        raise ValueError(f"No article text found: {source_url}")

    canonical = soup.select_one('link[rel="canonical"][href]')
    url = canonical_blog_url(canonical["href"]) if canonical else None
    url = url or canonical_blog_url(source_url)
    if url is None:
        raise ValueError(f"Not a Developer Blog article: {source_url}")
    return ExtractedArticle(url, title, author or None, published_at, content, hashlib.sha256(content.encode("utf-8")).hexdigest())
