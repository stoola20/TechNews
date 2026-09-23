from fastapi import FastAPI

from app.api.articles import router as articles_router
from app.api.rag import router as rag_router
from app.core.logging import configure_logging

configure_logging()
app = FastAPI(title="Developer Knowledge Base", version="0.1.0")
app.include_router(articles_router)
app.include_router(rag_router)
