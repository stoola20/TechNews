from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup


BLOG_URL = "https://developers.openai.com/blog"


def canonical_blog_url(href: str, base_url: str = BLOG_URL) -> str | None:
    parsed = urlsplit(urljoin(base_url, href))
    path = parsed.path.rstrip("/")
    if parsed.scheme != "https" or parsed.hostname != "developers.openai.com":
        return None
    if not path.startswith("/blog/") or path.count("/") != 2:
        return None
    return urlunsplit(("https", "developers.openai.com", path, "", ""))


def discover_article_urls(html: str, base_url: str = BLOG_URL) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    urls = {
        url
        for anchor in soup.select("a[href]")
        if (url := canonical_blog_url(anchor["href"], base_url)) is not None
    }
    return sorted(urls)


class BlogDiscovery:
    def __init__(self, client: httpx.AsyncClient, blog_url: str = BLOG_URL):
        self.client = client
        self.blog_url = blog_url

    async def discover(self) -> list[str]:
        response = await self.client.get(self.blog_url)
        response.raise_for_status()
        return discover_article_urls(response.text, self.blog_url)
