from types import SimpleNamespace

import pytest

from app.rag.service import RAGService, UNKNOWN_ANSWER
from app.repositories.chunks import RetrievedChunk


CHUNKS = [
    RetrievedChunk(1, "Codex added a new workflow.", 0.91, "First post", "https://developers.openai.com/blog/first", None, 0),
    RetrievedChunk(2, "Another unrelated note.", 0.72, "Second post", "https://developers.openai.com/blog/second", None, 1),
]


class FakeRetriever:
    def __init__(self, chunks):
        self.chunks = chunks

    async def retrieve(self, query, top_k):
        assert query == "What changed?"
        assert top_k == 2
        return self.chunks


class FakeResponses:
    def __init__(self, answer):
        self.answer = answer
        self.calls = 0

    async def create(self, **kwargs):
        self.calls += 1
        assert "[1]" in kwargs["input"]
        return SimpleNamespace(output_text=self.answer)


@pytest.mark.asyncio
async def test_citations_include_only_referenced_chunks():
    responses = FakeResponses("Codex added a workflow [1].")
    result = await RAGService(FakeRetriever(CHUNKS), SimpleNamespace(responses=responses), "test-model", 2).answer("What changed?")
    assert result.answer == "Codex added a workflow [1]."
    assert [(source.url, source.chunk_index, source.score) for source in result.sources] == [
        ("https://developers.openai.com/blog/first", 0, 0.91)
    ]
    assert responses.calls == 1


@pytest.mark.asyncio
async def test_no_context_does_not_call_model():
    responses = FakeResponses("unused")
    result = await RAGService(FakeRetriever([]), SimpleNamespace(responses=responses), "test-model", 2).answer("What changed?")
    assert result.answer == UNKNOWN_ANSWER
    assert result.sources == []
    assert responses.calls == 0


@pytest.mark.asyncio
async def test_invalid_citation_is_rejected():
    responses = FakeResponses("Invented claim [99].")
    result = await RAGService(FakeRetriever(CHUNKS), SimpleNamespace(responses=responses), "test-model", 2).answer("What changed?")
    assert result.answer == UNKNOWN_ANSWER
    assert result.sources == []
