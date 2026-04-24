"""
Config status endpoint — expose active LLM/embedding provider info to frontend.
"""
from fastapi import APIRouter
import httpx

from app.core.config import settings

router = APIRouter(prefix="/config", tags=["config"])


async def _probe_ollama_status() -> dict[str, str | bool]:
    host = settings.OLLAMA_HOST.rstrip("/")
    url = f"{host}/api/tags"

    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            response = await client.get(url)
            response.raise_for_status()
        return {
            "available": True,
            "status": "online",
            "message": f"Ollama is reachable at {settings.OLLAMA_HOST}.",
        }
    except Exception as exc:
        return {
            "available": False,
            "status": "offline",
            "message": f"Ollama is not reachable at {settings.OLLAMA_HOST}: {exc}",
        }


@router.get("/status")
async def get_config_status():
    """Return active provider and model names for UI display."""
    llm_provider = settings.LLM_PROVIDER.lower()

    if llm_provider == "ollama":
        llm_model = settings.OLLAMA_MODEL
    else:
        llm_model = settings.LLM_MODEL_FAST

    kg_provider = settings.KG_EMBEDDING_PROVIDER.lower()
    kg_model = settings.KG_EMBEDDING_MODEL

    ollama_status = {
        "available": False,
        "status": "not_used",
        "message": "Ollama is not the active LLM provider.",
    }
    if llm_provider == "ollama":
        ollama_status = await _probe_ollama_status()

    return {
        "llm_provider": llm_provider,
        "llm_model": llm_model,
        "ollama_status": ollama_status,
        "kg_embedding_provider": kg_provider,
        "kg_embedding_model": kg_model,
        "kg_embedding_dimension": settings.KG_EMBEDDING_DIMENSION,
        "nexusrag_embedding_model": settings.NEXUSRAG_EMBEDDING_MODEL,
        "nexusrag_reranker_model": settings.NEXUSRAG_RERANKER_MODEL,
    }
