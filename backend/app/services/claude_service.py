"""
Claude API wrapper service.
Implemented as a class (ClaudeService) with a global singleton for use across the app.
Loads prompt templates from disk, fills in variables, calls the Claude API,
and parses the JSON response.
"""
import json
import re
from pathlib import Path
from typing import Any, Dict, Optional

import anthropic

from app.config import ANTHROPIC_API_KEY, PROMPTS_DIR


class ClaudeService:
    """
    Wrapper around the Anthropic Messages API.
    Prompts are loaded from .md files and cached in memory.
    """

    def __init__(self, api_key: str, prompts_dir: str) -> None:
        if not api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set. Add it to your .env file."
            )
        self.client = anthropic.Anthropic(api_key=api_key, timeout=120)
        self.prompts: Dict[str, str] = {}
        self._load_prompts(prompts_dir)

    def _load_prompts(self, prompts_dir: str) -> None:
        """Load all .md files from prompts_dir into memory, keyed by filename stem."""
        path = Path(prompts_dir)
        if not path.exists():
            return
        for prompt_file in path.glob("*.md"):
            self.prompts[prompt_file.stem] = prompt_file.read_text(encoding="utf-8")

    def reload_prompts(self, prompts_dir: Optional[str] = None) -> None:
        """Reload prompts from disk (useful if files changed at runtime)."""
        self._load_prompts(prompts_dir or str(PROMPTS_DIR))

    def call_claude(self, prompt_key: str, variables: Dict[str, str], model: str, max_tokens: int = 8192) -> str:
        """
        Load a prompt template by key, fill in variables, call Claude, return raw response text.

        Args:
            prompt_key: Stem of the prompt .md file (e.g. 'layer1_income_statement').
            variables: Dict of {placeholder: value} to substitute in the template.
            model: Claude model ID.

        Returns:
            Raw response text from Claude.

        Raises:
            KeyError: If prompt_key is not found in the loaded prompts.
            anthropic.APIError: On API call failures.
        """
        if prompt_key not in self.prompts:
            # Try loading from disk on-demand
            prompt_path = PROMPTS_DIR / f"{prompt_key}.md"
            if prompt_path.exists():
                self.prompts[prompt_key] = prompt_path.read_text(encoding="utf-8")
            else:
                raise FileNotFoundError(
                    f"Prompt '{prompt_key}.md' not found in {PROMPTS_DIR}. "
                    "Ensure the prompt files are in backend/prompts/."
                )

        prompt_template = self.prompts[prompt_key]

        # Fill in template variables
        filled_prompt = prompt_template
        for key, value in variables.items():
            filled_prompt = filled_prompt.replace(f"{{{key}}}", str(value))

        # Call Claude — synchronous (not streaming)
        print(f"Calling Claude model={model} max_tokens={max_tokens} prompt_key={prompt_key}")
        message = self.client.messages.create(
            model=model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": filled_prompt}],
        )

        response_text = message.content[0].text
        print(f"Claude responded: stop_reason={message.stop_reason} length={len(response_text)}")
        return response_text

    def parse_json_response(self, response_text: str) -> Any:
        """
        Parse JSON from Claude's response text.

        Attempts in order:
        1. Direct JSON parse of the full text
        2. Extract from ```json ... ``` code block
        3. Extract from ``` ... ``` code block
        4. Find the largest { ... } block in the text

        Args:
            response_text: Raw response string from Claude.

        Returns:
            Parsed Python object (dict or list).

        Raises:
            ValueError: If no valid JSON could be extracted.
        """
        text = response_text.strip()

        # 1. Direct parse
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # 2. ```json ... ``` code block
        match = re.search(r"```json\s*([\s\S]*?)```", text, re.IGNORECASE)
        if match:
            try:
                return json.loads(match.group(1).strip())
            except json.JSONDecodeError:
                pass

        # 3. ``` ... ``` code block (any language tag)
        match = re.search(r"```\w*\s*([\s\S]*?)```", text, re.IGNORECASE)
        if match:
            try:
                return json.loads(match.group(1).strip())
            except json.JSONDecodeError:
                pass

        # 4. Largest { ... } block
        match = re.search(r"\{[\s\S]+\}", text)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

        raise ValueError(
            f"Could not extract valid JSON from Claude response.\n"
            f"Response preview (first 500 chars):\n{response_text[:500]}"
        )


# ─── Global singleton ─────────────────────────────────────────────────────────

_service: Optional[ClaudeService] = None


def get_claude_service() -> ClaudeService:
    """Return the app-wide ClaudeService singleton, creating it if needed."""
    global _service
    if _service is None:
        _service = ClaudeService(
            api_key=ANTHROPIC_API_KEY,
            prompts_dir=str(PROMPTS_DIR),
        )
    return _service


def load_prompts() -> None:
    """
    Eagerly initialise the ClaudeService and load all prompts into cache.
    Called at app startup from main.py.
    """
    get_claude_service()
