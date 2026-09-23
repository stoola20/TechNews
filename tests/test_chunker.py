from app.rag.chunker import TokenChunker


def test_chunks_are_bounded_and_overlap():
    content = "\n\n".join(" ".join(f"word{i}_{j}" for j in range(20)) for i in range(8))
    chunker = TokenChunker(chunk_size=45, chunk_overlap=8)
    chunks = chunker.chunk(content)
    assert len(chunks) > 1
    assert all(chunk.token_count <= 45 for chunk in chunks)
    assert all(chunk.token_count == chunker._count(chunk.content) for chunk in chunks)
    assert any(set(chunks[i].content.split()) & set(chunks[i + 1].content.split()) for i in range(len(chunks) - 1))


def test_empty_content_has_no_chunks():
    assert TokenChunker().chunk("  \n\n  ") == []


def test_large_paragraph_after_overlap_makes_progress():
    content = "\n\n".join(" ".join(f"different{i}_{j}" for j in range(25)) for i in range(3))
    chunks = TokenChunker(chunk_size=55, chunk_overlap=12).chunk(content)
    assert len(chunks) >= 3
    assert "different2_24" in chunks[-1].content
