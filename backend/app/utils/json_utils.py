"""
Helpers for deserializing JSON columns that arrive as strings (SQLite) or native
types (Postgres JSONB). All callers that previously inlined
`json.loads(x) if isinstance(x, str) else x` now use these instead.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List


def deserialize_dict(raw: Any) -> Dict[str, Any]:
    """Return a dict from a DB value that may be None, a dict, or a JSON string."""
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        result = json.loads(raw)
        return result if isinstance(result, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def deserialize_list(raw: Any) -> List[Any]:
    """Return a list from a DB value that may be None, a list, or a JSON string."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    try:
        result = json.loads(raw)
        return result if isinstance(result, list) else []
    except (json.JSONDecodeError, TypeError):
        return []
