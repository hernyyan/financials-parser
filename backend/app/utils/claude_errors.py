"""
Context manager for translating Anthropic SDK exceptions to FastAPI HTTPExceptions.

Usage:
    with claude_api_errors():
        result = claude_client.messages.create(...)

Any of the four known Anthropic error classes are caught and re-raised as the
correct HTTP status. Unknown exceptions propagate unmodified so callers can
handle route-specific failures (e.g. ValueError from JSON parsing) after the
with-block.

All three Layer 1 / Layer 2 routes previously duplicated this mapping inline,
and layer1.py had AuthenticationError mapped to 500 instead of 401.
"""
from __future__ import annotations

from contextlib import contextmanager

import anthropic
from fastapi import HTTPException


@contextmanager
def claude_api_errors():
    """Translate Anthropic SDK errors to HTTPExceptions; propagate everything else."""
    try:
        yield
    except anthropic.AuthenticationError:
        raise HTTPException(
            status_code=401,
            detail="Invalid Anthropic API key. Check ANTHROPIC_API_KEY in your environment.",
        )
    except anthropic.RateLimitError:
        raise HTTPException(
            status_code=429,
            detail="Anthropic API rate limit reached. Please wait a moment and retry.",
        )
    except anthropic.APITimeoutError:
        raise HTTPException(
            status_code=504,
            detail="Claude API request timed out. Please try again.",
        )
    except anthropic.APIError as exc:
        raise HTTPException(status_code=502, detail=f"Claude API error: {exc}")
