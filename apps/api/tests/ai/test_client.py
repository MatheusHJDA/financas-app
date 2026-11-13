"""`OpenAIClient` com o SDK simulado (sem rede): limites, novas tentativas e saída inválida."""

import datetime as dt
from types import SimpleNamespace

import httpx2
import openai
import pytest
from pydantic import ValidationError

from finance_api.ai.client import (
    AiInvalidOutput,
    AiLimitReached,
    AiUnavailable,
    OpenAIClient,
    build_input,
    get_ai_client,
)
from finance_api.ai.context import AiContext
from finance_api.ai.schemas import ExtractionResult
from finance_api.core.config import Settings

REQUEST = httpx2.Request("POST", "https://api.openai.invalid/v1/responses")
RESULT = ExtractionResult(transactions=[], document_type="other", warnings=["nada"])
CONTEXT = AiContext(
    today=dt.date(2026, 11, 12), sender="Ruth", accounts=[], categories=[], rules=[]
)


def _settings(**changes) -> Settings:
    values = {"openai_api_key": "chave-falsa-de-teste", "openai_model": "modelo-de-teste"}
    values.update(changes)
    return Settings(_env_file=None, **values)


def _ok(parsed=RESULT):
    return SimpleNamespace(
        id="resp_teste",
        model="modelo-de-teste-2026",
        output_parsed=parsed,
        usage=SimpleNamespace(total_tokens=321),
    )


def _status(cls, code: int, body: dict | None = None):
    return cls("erro simulado", response=httpx2.Response(code, request=REQUEST), body=body)


def _validation_error() -> ValidationError:
    try:
        ExtractionResult.model_validate_json('{"transactions": [], "x": 1}')
    except ValidationError as error:
        return error
    raise AssertionError("deveria falhar")


class FakeResponses:
    def __init__(self, outcomes) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[dict] = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class FakeSdk:
    def __init__(self, *outcomes) -> None:
        self.responses = FakeResponses(outcomes)


def _client(sdk: FakeSdk, **settings) -> tuple[OpenAIClient, list[float]]:
    sleeps: list[float] = []
    return OpenAIClient(_settings(**settings), sdk=sdk, sleep=sleeps.append), sleeps


def _extract(client: OpenAIClient):
    return client.extract(context=CONTEXT, text="gastei 10 no mercado", images=[b"\xff\xd8\xff"])


def test_success_returns_parsed_result_and_metadata() -> None:
    sdk = FakeSdk(_ok())
    client, sleeps = _client(sdk)
    call = _extract(client)

    assert call.result == RESULT
    assert call.model == "modelo-de-teste-2026"
    assert call.usage_tokens == 321
    assert call.raw["output"]["warnings"] == ["nada"]
    assert sleeps == []
    (request,) = sdk.responses.calls
    assert request["model"] == "modelo-de-teste"  # só de settings.openai_model
    assert request["text_format"] is ExtractionResult
    assert request["store"] is False


@pytest.mark.parametrize(
    "code",
    ["project_spend_limit_exceeded", "organization_spend_limit_exceeded", "insufficient_quota"],
)
def test_spend_limit_is_not_retried(code: str) -> None:
    error = _status(openai.RateLimitError, 429, {"code": code, "message": "limite"})
    sdk = FakeSdk(error, _ok(), _ok())
    client, sleeps = _client(sdk)

    with pytest.raises(AiLimitReached):
        _extract(client)
    assert len(sdk.responses.calls) == 1
    assert sleeps == []


def test_other_429_is_retried_twice_with_growing_wait() -> None:
    errors = [_status(openai.RateLimitError, 429, {"code": "rate_limit_exceeded"})] * 3
    sdk = FakeSdk(*errors)
    client, sleeps = _client(sdk)

    with pytest.raises(AiUnavailable):
        _extract(client)
    assert len(sdk.responses.calls) == 3
    assert len(sleeps) == 2 and sleeps[0] < sleeps[1]


def test_5xx_is_retried_twice_then_gives_up() -> None:
    sdk = FakeSdk(*[_status(openai.InternalServerError, 500)] * 3, _ok())
    client, sleeps = _client(sdk)

    with pytest.raises(AiUnavailable) as caught:
        _extract(client)
    assert caught.value.code == "ai_unavailable"
    assert len(sdk.responses.calls) == 3
    assert len(sleeps) == 2


def test_5xx_then_timeout_then_success() -> None:
    sdk = FakeSdk(
        _status(openai.InternalServerError, 503), openai.APITimeoutError(request=REQUEST), _ok()
    )
    client, sleeps = _client(sdk)

    assert _extract(client).result == RESULT
    assert len(sdk.responses.calls) == 3
    assert len(sleeps) == 2


def test_invalid_output_is_retried_once_then_fails() -> None:
    sdk = FakeSdk(_validation_error(), _ok(parsed=None), _ok())
    client, sleeps = _client(sdk)

    with pytest.raises(AiInvalidOutput) as caught:
        _extract(client)
    assert caught.value.code == "ai_invalid_output"
    assert len(sdk.responses.calls) == 2
    assert sleeps == []


def test_invalid_output_then_valid() -> None:
    sdk = FakeSdk(_validation_error(), _ok())
    client, _ = _client(sdk)
    assert _extract(client).result == RESULT
    assert len(sdk.responses.calls) == 2


def test_client_error_is_not_retried() -> None:
    sdk = FakeSdk(_status(openai.AuthenticationError, 401, {"code": "invalid_api_key"}), _ok())
    client, sleeps = _client(sdk)
    with pytest.raises(AiUnavailable):
        _extract(client)
    assert len(sdk.responses.calls) == 1
    assert sleeps == []


@pytest.mark.parametrize("changes", [{"openai_api_key": ""}, {"openai_model": "  "}])
def test_missing_key_or_model_is_unavailable_without_calling(changes: dict) -> None:
    sdk = FakeSdk()
    client, _ = _client(sdk, **changes)
    with pytest.raises(AiUnavailable):
        _extract(client)
    assert sdk.responses.calls == []


def test_real_sdk_is_built_without_its_own_retries() -> None:
    client = get_ai_client(_settings(openai_timeout_seconds=12.5))
    assert isinstance(client, OpenAIClient)
    sdk = client._client()
    assert sdk.max_retries == 0
    assert sdk.timeout == 12.5


def test_build_input_sends_text_and_images() -> None:
    (message,) = build_input(CONTEXT, "gastei 10", [b"abc"])
    kinds = [part["type"] for part in message["content"]]
    assert kinds == ["input_text", "input_text", "input_image"]
    assert message["content"][0]["text"].startswith("CONTEXTO:")
    assert message["content"][2]["image_url"] == "data:image/jpeg;base64,YWJj"
