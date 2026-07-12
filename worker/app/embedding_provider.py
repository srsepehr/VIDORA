"""Replaceable local multilingual embedding provider (lazy heavy imports)."""

from __future__ import annotations

from typing import Protocol

from .chat_config import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EMBEDDING_PROVIDER
from .errors import WorkerError


class VideoEmbeddingProvider(Protocol):
    name: str
    model_id: str
    dimensions: int
    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...
    def embed_query(self, text: str) -> list[float]: ...


class LocalE5EmbeddingProvider:
    name = EMBEDDING_PROVIDER
    dimensions = EMBEDDING_DIMENSIONS

    def __init__(self, model_id: str = EMBEDDING_MODEL, cache_dir: str = "/models"):
        self.model_id, self.cache_dir = model_id, cache_dir
        self._tokenizer = self._model = None

    def _load(self):
        if self._model is not None:
            return
        try:
            from transformers import AutoModel, AutoTokenizer
            self._tokenizer = AutoTokenizer.from_pretrained(self.model_id, cache_dir=self.cache_dir)
            self._model = AutoModel.from_pretrained(self.model_id, cache_dir=self.cache_dir)
            self._model.eval()
        except Exception as exc:
            raise WorkerError("CHAT_PROVIDER_UNAVAILABLE", dev_detail=f"embedding load: {exc}")

    def _embed(self, texts: list[str]) -> list[list[float]]:
        self._load()
        try:
            import torch
            encoded = self._tokenizer(texts, padding=True, truncation=True, max_length=512, return_tensors="pt")
            with torch.no_grad():
                output = self._model(**encoded).last_hidden_state
            mask = encoded["attention_mask"].unsqueeze(-1).expand(output.size()).float()
            pooled = (output * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
            pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
            vectors = pooled.cpu().tolist()
            if any(len(vector) != self.dimensions for vector in vectors):
                raise ValueError("embedding dimension mismatch")
            return vectors
        except WorkerError:
            raise
        except Exception as exc:
            raise WorkerError("CHAT_PROVIDER_UNAVAILABLE", dev_detail=f"embedding: {exc}")

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embed(["passage: " + text for text in texts])

    def embed_query(self, text: str) -> list[float]:
        return self._embed(["query: " + text])[0]
