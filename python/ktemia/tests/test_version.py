"""The version is written in two places; a release must bump both."""

import re
from pathlib import Path

from ktemia import VERSION


def test_version_matches_pyproject():
    root = next(p for p in Path(__file__).resolve().parents if (p / "pyproject.toml").exists())
    declared = re.search(r'(?m)^version = "([^"]+)"', (root / "pyproject.toml").read_text()).group(1)
    assert VERSION == declared, f"_version.py says {VERSION}, pyproject.toml says {declared}"
