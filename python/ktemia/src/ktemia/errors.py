"""Errors raised by the Ktemia client.

Every failure is a :class:`KtemiaError` with a stable ``code``, so callers (and
agents reading a tool result) branch on the code instead of parsing the
message. Mirrors ``packages/ktemia/src/errors.ts``.
"""

from __future__ import annotations

from typing import Any

#: Codes that mean "the search found nothing", not "the request was wrong".
EMPTY_RESULT_CODES = frozenset({"NO_RESULTS", "NO_MORE_RESULTS"})


class KtemiaError(Exception):
    """A failed Ktemia call.

    ``status`` is the HTTP status, or 0 when the request never reached the API.
    ``retryable`` is True when the same call can succeed later without
    changing anything; a spent monthly quota is never retryable.
    """

    def __init__(
        self,
        *,
        code: str,
        message: str,
        status: int,
        param: str | None = None,
        retryable: bool = False,
        retry_after: int | None = None,
        body: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.param = param
        self.retryable = retryable
        self.retry_after = retry_after
        self.body = body

    def to_dict(self) -> dict[str, Any]:
        """A plain dict safe to hand to a model or a log line. Never holds the key."""
        out: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.param:
            out["param"] = self.param
        if self.retry_after is not None:
            out["retryAfter"] = self.retry_after
        return out

    def __repr__(self) -> str:
        return f"{type(self).__name__}(code={self.code!r}, status={self.status}, message={self.message!r})"


class KtemiaValidationError(KtemiaError):
    """Raised before any request is sent, when the input cannot be valid.

    Nothing reached the API, so no quota was spent.
    """

    def __init__(self, param: str, message: str) -> None:
        super().__init__(
            code="INVALID_INPUT",
            status=400,
            param=param,
            message=f"{message} Nothing was sent to Ktemia, so no quota was used.",
        )
