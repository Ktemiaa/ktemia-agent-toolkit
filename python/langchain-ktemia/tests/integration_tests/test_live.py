"""Live tests against api.ktemia.com. Skipped unless KTEMIA_API_KEY is set; they spend a few requests."""

from __future__ import annotations

import json
import os

import pytest

from langchain_ktemia import KtemiaToolkit

pytestmark = pytest.mark.skipif(not os.environ.get("KTEMIA_API_KEY"), reason="KTEMIA_API_KEY not set")


def test_key_status_and_lookup_live():
    tools = {t.name: t for t in KtemiaToolkit().get_tools()}
    status = json.loads(tools["ktemia_key_status"].invoke({}))
    assert "plan" in status, status
    found = json.loads(tools["ktemia_lookup"].invoke({"kind": "airport", "query": "London"}))
    assert "error" not in found, found
