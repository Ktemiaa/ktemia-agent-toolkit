"""All Ktemia tools in one LangChain toolkit, sharing one client."""

from __future__ import annotations

from ktemia import AsyncKtemia, Ktemia
from langchain_core.tools import BaseTool, BaseToolkit
from pydantic import ConfigDict, Field, SecretStr

from ._version import VERSION
from .tools import ALL_TOOLS


class KtemiaToolkit(BaseToolkit):
    """Ktemia travel search: flights, hotels, and rental cars across airlines,
    booking sites and rental companies, each with the seller's price and a
    booking link. Search only; Ktemia does not book.

    Setup:
        ``pip install langchain-ktemia`` and set ``KTEMIA_API_KEY``
        (free key at https://app.ktemia.com/api-keys).

    Instantiate:
        .. code-block:: python

            from langchain_ktemia import KtemiaToolkit

            tools = KtemiaToolkit().get_tools()

    Use with an agent:
        .. code-block:: python

            from langchain.agents import create_agent

            agent = create_agent("openai:gpt-5-mini", tools=KtemiaToolkit().get_tools())
            agent.invoke({"messages": [("user", "Cheapest flight LAX to London on 2027-03-14?")]})
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    api_key: SecretStr | None = Field(default=None, exclude=True)
    """Ktemia API key. Defaults to the ``KTEMIA_API_KEY`` environment variable."""
    client: Ktemia | None = Field(default=None, exclude=True)
    async_client: AsyncKtemia | None = Field(default=None, exclude=True)

    def get_tools(self) -> list[BaseTool]:
        """The seven Ktemia tools, sharing one sync and one async client."""
        key = self.api_key.get_secret_value() if self.api_key else None
        client = self.client or Ktemia(key, user_agent=f"langchain-ktemia/{VERSION}")
        async_client = self.async_client or AsyncKtemia(key, user_agent=f"langchain-ktemia/{VERSION}")
        return [tool(client=client, async_client=async_client) for tool in ALL_TOOLS]
