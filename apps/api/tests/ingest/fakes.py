"""`FakeAiClient`: devolve respostas gravadas em `tests/fixtures/ai/*.json` (sem rede)."""

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

from finance_api.ai.client import AiCall, AiFailure
from finance_api.ai.context import AiContext
from finance_api.ai.schemas import ExtractionResult

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "ai"
FIXTURE_NAMES = sorted(p.stem for p in FIXTURES.glob("*.json"))


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


@dataclass
class Received:
    context: AiContext
    text: str | None
    images: list[bytes]


@dataclass
class FakeAiClient:
    fixture: str | None = None
    result: ExtractionResult | None = None
    failure: AiFailure | None = None
    calls: list[Received] = field(default_factory=list)

    def extract(self, *, context: AiContext, text: str | None, images: Sequence[bytes]) -> AiCall:
        self.calls.append(Received(context, text, list(images)))
        if self.failure is not None:
            raise self.failure
        if self.result is not None:
            raw = {"output": self.result.model_dump(mode="json")}
            return AiCall(result=self.result, raw=raw, model="fake", usage_tokens=10)
        assert self.fixture is not None
        data = load_fixture(self.fixture)
        return AiCall(
            result=ExtractionResult.model_validate(data["output"]),
            raw=data,
            model=data["model"],
            usage_tokens=data["usage_tokens"],
        )
