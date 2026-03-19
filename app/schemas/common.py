"""
Shared Pydantic schemas used across multiple resources.

PaginatedResponse[T] is the standard envelope for all list endpoints.
The frontend should read `.items` for the data and `.total` for counts.
"""
import math
from typing import Generic, List, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    size: int
    pages: int

    @classmethod
    def build(
        cls,
        items: list,
        total: int,
        skip: int,
        limit: int,
    ) -> "PaginatedResponse[T]":
        """Factory — construct from skip/limit instead of page/size."""
        page = (skip // limit) + 1 if limit > 0 else 1
        pages = math.ceil(total / limit) if total > 0 and limit > 0 else 1
        return cls(items=items, total=total, page=page, size=limit, pages=pages)
