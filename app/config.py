"""Provider registry. Every provider speaks the OpenAI chat-completions protocol."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATA_DIR = Path(os.environ.get("XRAY_DATA_DIR") or ROOT / "data")
WORKSPACES_DIR = DATA_DIR / "workspaces"
DB_PATH = DATA_DIR / "xray.db"


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    base_url: str
    api_key: str | None
    needs_key: bool = True

    @property
    def enabled(self) -> bool:
        return bool(self.base_url) and (bool(self.api_key) or not self.needs_key)


def load_providers() -> dict[str, Provider]:
    env = os.environ.get
    providers = [
        Provider("openai", "OpenAI", "https://api.openai.com/v1", env("OPENAI_API_KEY")),
        Provider("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", env("OPENROUTER_API_KEY")),
        Provider("groq", "Groq", "https://api.groq.com/openai/v1", env("GROQ_API_KEY")),
        Provider("ollama", "Ollama (local)", env("OLLAMA_BASE_URL", ""), None, needs_key=False),
    ]
    # Test hook: point at a fake OpenAI-compatible server.
    if fake_url := env("XRAY_FAKE_BASE_URL"):
        providers.append(Provider("fake", "Fake (test)", fake_url, None, needs_key=False))
    return {p.id: p for p in providers}
