"""Dependency-wiring. Sinds het verwijderen van de analyse-pijplijn (`/v1/projects`) bedient de
API nog het annotatie-domein van de werkplek, het LLM-beheer en de wet-keuzelijst — de wettenbank-
client (catalog/structuur) en de annotatie-store zijn de enige gewirede afhankelijkheden."""

from __future__ import annotations

import logging
from functools import lru_cache

from .config import get_settings
from .wettenbank import WettenbankClient

logger = logging.getLogger(__name__)


@lru_cache
def get_annotatie_store() -> "AnnotatieStore":
    from .annotatie_store import AnnotatieStore

    return AnnotatieStore()


@lru_cache
def get_wettenbank() -> WettenbankClient:
    return WettenbankClient(get_settings())
