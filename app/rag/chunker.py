import re
from dataclasses import dataclass

import tiktoken


@dataclass(frozen=True)
class TextChunk:
    content: str
    token_count: int


class TokenChunker:
    def __init__(self, chunk_size: int = 800, chunk_overlap: int = 120):
        if chunk_size < 1 or not 0 <= chunk_overlap < chunk_size:
            raise ValueError("Require 0 <= chunk_overlap < chunk_size")
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.encoding = tiktoken.get_encoding("cl100k_base")

    def _count(self, text: str) -> int:
        return len(self.encoding.encode(text))

    @staticmethod
    def _render(units: list[tuple[str, int]], start: int, end: int) -> str:
        pieces = [units[start][0]]
        for index in range(start + 1, end):
            pieces.append("\n\n" if units[index][1] != units[index - 1][1] else " ")
            pieces.append(units[index][0])
        return "".join(pieces)

    def chunk(self, content: str) -> list[TextChunk]:
        units = [
            (word, paragraph_index)
            for paragraph_index, paragraph in enumerate(re.split(r"\n\s*\n", content.strip()))
            for word in paragraph.split()
        ]
        if not units:
            return []
        chunks: list[TextChunk] = []
        start = 0
        previous_end = 0
        while start < len(units):
            end = start
            while end < len(units) and self._count(self._render(units, start, end + 1)) <= self.chunk_size:
                end += 1
            if end == start:
                raise ValueError("A single word exceeds CHUNK_SIZE; increase the setting")
            if end < len(units):
                boundaries = [i for i in range(start + 1, end + 1) if i < len(units) and units[i][1] != units[i - 1][1]]
                if boundaries and boundaries[-1] >= start + max(1, (end - start) // 2):
                    end = boundaries[-1]
            if end <= previous_end:
                start = previous_end
                continue
            text = self._render(units, start, end)
            chunks.append(TextChunk(text, self._count(text)))
            previous_end = end
            if end == len(units):
                break
            next_start = end
            while next_start > start + 1 and self._count(self._render(units, next_start - 1, end)) <= self.chunk_overlap:
                next_start -= 1
            start = next_start
        return chunks
