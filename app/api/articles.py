from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.repositories.articles import ArticleRepository

router = APIRouter()


class ArticleSummary(BaseModel):
    id: int
    source: str
    source_url: str
    title: str
    author: str | None
    published_at: datetime | None
    content_hash: str
    created_at: datetime
    updated_at: datetime


@router.get("/articles", response_model=list[ArticleSummary])
async def list_articles(session: AsyncSession = Depends(get_session)) -> list[ArticleSummary]:
    articles = await ArticleRepository(session).list_articles()
    return [ArticleSummary.model_validate(article, from_attributes=True) for article in articles]
