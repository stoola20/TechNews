from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.ingestion.pipeline import IngestionResult, ingest_source
from app.rag.service import RAGResponse, answer

router = APIRouter()


class AskRequest(BaseModel):
    question: str = Field(min_length=1)


@router.post("/ingest", response_model=IngestionResult)
async def ingest_endpoint() -> IngestionResult:
    if not get_settings().openai_api_key:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is required for ingestion")
    return await ingest_source()


@router.post("/ask", response_model=RAGResponse)
async def ask_endpoint(request: AskRequest) -> RAGResponse:
    if not get_settings().openai_api_key:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is required for questions")
    if not request.question.strip():
        raise HTTPException(status_code=422, detail="Question must not be blank")
    return await answer(request.question.strip())
