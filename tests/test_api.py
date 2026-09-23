from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.core.database import get_session
from app.main import app
from app.rag.service import RAGResponse, SourceCitation
import app.api.rag as rag_api


def test_ask_route_returns_answer_and_citation(monkeypatch):
    async def fake_answer(question):
        assert question == "What changed?"
        return RAGResponse("A new workflow [1].", [SourceCitation("Post", "https://developers.openai.com/blog/post", None, 0, 0.9)])

    monkeypatch.setattr(rag_api, "answer", fake_answer)
    monkeypatch.setattr(rag_api, "get_settings", lambda: type("Settings", (), {"openai_api_key": "test"})())
    response = TestClient(app).post("/ask", json={"question": " What changed? "})
    assert response.status_code == 200
    assert response.json()["sources"][0]["score"] == 0.9


def test_articles_route_lists_metadata():
    class FakeArticle:
        id = 1
        source = "openai_developer_blog"
        source_url = "https://developers.openai.com/blog/post"
        title = "Post"
        author = None
        published_at = None
        content_hash = "a" * 64
        created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        updated_at = created_at

    class FakeSession:
        async def scalars(self, statement):
            return [FakeArticle()]

    async def fake_session():
        yield FakeSession()

    app.dependency_overrides[get_session] = fake_session
    try:
        response = TestClient(app).get("/articles")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()[0]["title"] == "Post"
    assert "content" not in response.json()[0]
