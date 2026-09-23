import httpx


class ArticleFetcher:
    def __init__(self, client: httpx.AsyncClient):
        self.client = client

    async def fetch(self, url: str) -> str:
        response = await self.client.get(url)
        response.raise_for_status()
        return response.text
