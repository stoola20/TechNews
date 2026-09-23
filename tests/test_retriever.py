import pytest
from sqlalchemy.dialects import postgresql

from app.rag.retriever import SemanticRetriever
from app.repositories.chunks import ChunkRepository, RetrievedChunk
from app.models.article import Article
from app.models.chunk import ArticleChunk


class FakeEmbeddings:
    async def embed(self, texts):
        assert texts == ["What changed?"]
        return [[0.1, 0.2]]


class FakeChunks:
    async def search(self, vector, top_k):
        assert vector == [0.1, 0.2]
        assert top_k == 3
        return [RetrievedChunk(7, "A change", 0.87, "Post", "https://developers.openai.com/blog/post", None, 2)]


@pytest.mark.asyncio
async def test_retrieval_preserves_score_and_metadata():
    result = await SemanticRetriever(FakeEmbeddings(), FakeChunks()).retrieve("What changed?", top_k=3)
    assert result[0].chunk_id == 7
    assert result[0].score == 0.87
    assert result[0].chunk_index == 2


@pytest.mark.asyncio
async def test_chunk_repository_uses_pgvector_cosine_distance():
    class Result:
        def all(self):
            return [(ArticleChunk(id=7, content="Evidence", chunk_index=2), Article(title="Post", source_url="https://developers.openai.com/blog/post", published_at=None), 0.87)]

    class Session:
        async def execute(self, statement):
            sql = str(statement.compile(dialect=postgresql.dialect()))
            assert "<=>" in sql
            assert "LIMIT" in sql
            return Result()

    result = await ChunkRepository(Session()).search([0.1, 0.2], 5)
    assert result[0].score == 0.87
    assert result[0].article_title == "Post"
