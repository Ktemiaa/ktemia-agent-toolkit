"""The shared Ktemia tool contract (``tools.json``).

The same file ships with the Ktemia MCP server and the JavaScript packages,
so tool names, descriptions and enums are identical in every language. Kept in
sync by ``npm run sync-spec`` at the repository root.
"""

from __future__ import annotations

import json
from functools import lru_cache
from importlib.resources import files
from typing import Any

SPEC_VERSION = 1

TOOL_NAMES = (
    "ktemia_key_status",
    "ktemia_lookup",
    "ktemia_search_flights",
    "ktemia_search_hotels",
    "ktemia_search_cars",
    "ktemia_get_details",
    "ktemia_get_hotel_reviews",
)


@lru_cache(maxsize=1)
def _load() -> dict[str, Any]:
    raw = files("ktemia").joinpath("tools.json").read_text(encoding="utf-8")
    parsed = json.loads(raw)
    if parsed.get("specVersion") != SPEC_VERSION:
        raise RuntimeError(
            f"Unsupported Ktemia tool spec version {parsed.get('specVersion')}; "
            f"this build expects {SPEC_VERSION}."
        )
    return parsed


def tool_spec(name: str) -> dict[str, Any]:
    """One tool's spec. Raises on an unknown name so a typo cannot ship a blank description."""
    for candidate in _load()["tools"]:
        if candidate["name"] == name:
            return candidate
    raise KeyError(f'No Ktemia tool named "{name}" in the tool spec.')


def shared_note(name: str) -> str:
    found = _load()["shared"].get(name)
    if not found:
        raise KeyError(f'No shared note named "{name}" in the Ktemia tool spec.')
    return found


def tool_description(name: str, notes: list[str] | None = None) -> str:
    """A tool's full description: spec prose plus shared notes, joined like the other languages."""
    return " ".join([tool_spec(name)["description"], *[shared_note(n) for n in (notes or [])]])


def param_description(name: str, param: str) -> str:
    params = tool_spec(name).get("params", {})
    if param not in params:
        raise KeyError(f'Ktemia tool "{name}" has no parameter "{param}".')
    return params[param]["description"]


def enum_values(name: str) -> list[str]:
    found = _load()["enums"].get(name)
    if not found:
        raise KeyError(f'No enum named "{name}" in the Ktemia tool spec.')
    return list(found)
