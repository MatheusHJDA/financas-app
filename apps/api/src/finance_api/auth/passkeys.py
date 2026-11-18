"""Entrada em duas etapas: nome + PIN (`start`), depois a chave de acesso do aparelho (`finish`).

O `start` nunca dá veredito: sempre devolve um desafio do mesmo formato e guarda o resultado da
etapa 1 numa tentativa pendente (2 min, uso único, só o hash do identificador no banco). Também não
conta falhas — se contasse, o bloqueio da origem (429) revelaria se o PIN estava certo. O `finish`
é o único veredito: qualquer falha conta exatamente uma vez e responde igual.

Toda falha conta para a origem; para a CONTA só quando o segundo fator foi provado (chave
verificada da própria pessoa, ou código de liberação/emergência válido dela) e o PIN estava errado.
Assim, quem só sabe o nome não consegue travar a conta de ninguém.
"""

import hashlib
import hmac
import json
import logging
import math
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, NoReturn

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from webauthn import (
    base64url_to_bytes,
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from finance_api.auth import codes, limits, service
from finance_api.core.audit import record_audit
from finance_api.core.config import Settings
from finance_api.db.models import AccessCode, LoginAttempt, Passkey, User
from finance_api.notifications.channels import NotificationChannel
from finance_api.notifications.service import deliver

logger = logging.getLogger(__name__)

ATTEMPT_TTL = timedelta(minutes=2)
RP_NAME = "Finanças"
NEW_DEVICE_TYPE = "new_device"

# Chave do processo para o user.id de nomes que não existem: estável por nome (como o de um usuário
# real), então repetir o início não mostra que o nome é inventado.
_UNKNOWN_USER_KEY = secrets.token_bytes(32)


@dataclass(frozen=True)
class FinishResult:
    token: str  # texto puro: só vai para o cookie
    user: User
    recovery_codes: list[str] | None


def _webauthn_user_id(user: User | None, typed_name: str) -> bytes:
    if user is None:
        digest = hmac.new(_UNKNOWN_USER_KEY, typed_name.lower().encode(), hashlib.sha256)
        return digest.digest()[:16]
    if user.webauthn_user_id is None:
        user.webauthn_user_id = secrets.token_bytes(16)
    return user.webauthn_user_id


def _starts_retry_after(db: Session, source: str, now: datetime) -> int | None:
    """Segundos até a origem poder iniciar de novo (20 inícios em 15 min), ou `None`.

    O início de cada tentativa é `expires_at - ATTEMPT_TTL` (o relógio é o da autenticação).
    """
    window_start = now - limits.SOURCE_WINDOW + ATTEMPT_TTL  # em termos de expires_at
    recent = db.scalars(
        select(LoginAttempt.expires_at)
        .where(LoginAttempt.source == source, LoginAttempt.expires_at > window_start)
        .order_by(LoginAttempt.expires_at.desc())
        .limit(limits.SOURCE_MAX_STARTS)
    ).all()
    if len(recent) < limits.SOURCE_MAX_STARTS:
        return None
    release_at = recent[-1] - ATTEMPT_TTL + limits.SOURCE_WINDOW
    return max(1, math.ceil((release_at - now).total_seconds()))


def start(
    db: Session,
    *,
    name: str,
    pin: str,
    release_code: str | None,
    device_label: str,
    source: str,
    settings: Settings,
) -> tuple[str, dict[str, Any]]:
    now = service.utcnow()
    limits.lock_source(db, source)
    retry = limits.source_retry_after(db, source, now) or _starts_retry_after(db, source, now)
    if retry is not None:
        db.rollback()
        raise service.SourceBlocked(retry)

    user = service.find_user_by_name(db, name, for_update=True)
    if user is None:
        service._burn_time(pin)
        pin_ok = False
    else:
        # argon2 sempre roda uma vez (mesmo com PIN malformado): o tempo não revela nada.
        pin_ok = service._verify_pin(user.pin_hash, pin) and service.is_valid_pin(pin)

    typed_name = name.strip()
    if release_code:
        options: Any = generate_registration_options(
            rp_id=settings.passkey_rp_id,
            rp_name=RP_NAME,
            user_name=typed_name,
            user_display_name=typed_name,
            user_id=_webauthn_user_id(user, typed_name),
            exclude_credentials=[],
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
        )
    else:
        options = generate_authentication_options(
            rp_id=settings.passkey_rp_id,
            allow_credentials=[],
            user_verification=UserVerificationRequirement.REQUIRED,
        )

    attempt_id = secrets.token_urlsafe(32)
    # Guarda as tentativas pela janela da origem: elas contam no limite de inícios.
    db.execute(delete(LoginAttempt).where(LoginAttempt.expires_at < now - limits.SOURCE_WINDOW))
    db.add(
        LoginAttempt(
            token_hash=service.hash_token(attempt_id),
            purpose="register" if release_code else "login",
            user_id=user.id if user else None,
            pin_ok=pin_ok,
            challenge=options.challenge,
            code_hash=codes.hash_code(release_code) if release_code else None,
            device_label=device_label,
            source=source,
            expires_at=now + ATTEMPT_TTL,
        )
    )
    db.commit()
    return attempt_id, json.loads(options_to_json(options))


# As verificações rodam sempre que a tentativa existe, com PIN certo ou não: o tempo de resposta
# não pode revelar a etapa 1. Só gravam algo (contador, código) quando `apply` (tudo certo).
# Devolvem também se o segundo fator foi provado (decide se a falha conta para a conta).


def _check_login(
    db: Session, attempt: LoginAttempt, credential: dict[str, Any], settings: Settings, apply: bool
) -> tuple[bool, bool]:
    raw_id = base64url_to_bytes(str(credential.get("rawId", "")))
    passkey = db.scalars(
        select(Passkey).where(Passkey.credential_id == raw_id).with_for_update()
    ).one_or_none()
    if passkey is None:
        return False, False
    verified = verify_authentication_response(
        credential=credential,
        expected_challenge=attempt.challenge,
        expected_rp_id=settings.passkey_rp_id,
        expected_origin=settings.passkey_origin,
        credential_public_key=passkey.public_key,
        credential_current_sign_count=passkey.sign_count,
        require_user_verification=True,
    )
    if attempt.user_id is None or passkey.user_id != attempt.user_id:
        return False, False  # a chave tem de ser da pessoa do nome digitado
    if apply:
        passkey.sign_count = verified.new_sign_count
        passkey.last_used_at = service.utcnow()
    return True, True


def _check_register(
    db: Session,
    attempt: LoginAttempt,
    user: User | None,
    credential: dict[str, Any],
    settings: Settings,
    apply: bool,
) -> tuple[Passkey | None, bool]:
    verified = verify_registration_response(
        credential=credential,
        expected_challenge=attempt.challenge,
        expected_rp_id=settings.passkey_rp_id,
        expected_origin=settings.passkey_origin,
        require_user_verification=True,
    )
    taken = db.scalar(select(Passkey.id).where(Passkey.credential_id == verified.credential_id))
    code_hash = attempt.code_hash or ""
    now = service.utcnow()
    if not apply or user is None or taken is not None:
        # Mesma consulta, sem gastar o código: PIN errado não queima o código de ninguém.
        found = db.scalar(
            select(AccessCode.id).where(
                AccessCode.user_id == (user.id if user else 0),
                AccessCode.code_hash == code_hash,
                AccessCode.used_at.is_(None),
                (AccessCode.expires_at.is_(None)) | (AccessCode.expires_at > now),
            )
        )
        return None, user is not None and found is not None
    if codes.consume_code(db, user, code_hash, now) is None:
        return None, False
    return Passkey(
        user_id=user.id,
        credential_id=verified.credential_id,
        public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
        device_label=attempt.device_label,
    ), True


def _fail(
    db: Session, *, user: User | None, counts_for_account: bool, source: str, now: datetime
) -> NoReturn:
    """Conta exatamente uma falha, audita sem segredos e responde a falha genérica.

    A falha sempre conta para a origem; para a conta só com `counts_for_account`. Sem ela, a mesma
    contagem da conta roda só para leitura: o tempo de resposta fica equivalente.
    """
    if counts_for_account and user is not None:
        limits.record_failure(db, source=source, user=user, now=now)
    else:
        limits.record_failure(db, source=source, user=None, now=now)
        limits.account_failures(db, user.id if user else 0, now)
    record_audit(
        db,
        user_id=None,
        entity="sessions",
        entity_id=user.id if user else 0,
        action="create",
        after={"user_id": user.id if user else None, "ok": False, "source": source},
    )
    db.commit()
    raise service.InvalidCredentials


def _notify_new_device(
    db: Session, channel: NotificationChannel, user_id: int, device_label: str
) -> None:
    """Avisa os aparelhos já inscritos. Falha de envio nunca derruba a entrada."""
    payload = {
        "title": "Aparelho novo liberado",
        "body": f"Um aparelho novo foi liberado na sua conta: {device_label}",
        "url": "/preferencias",
    }
    try:
        deliver(db, channel, user_id, NEW_DEVICE_TYPE, payload, service.utcnow())
    except Exception as exc:
        db.rollback()
        logger.warning("Aviso de aparelho novo falhou: %s", type(exc).__name__)


def finish(
    db: Session,
    *,
    attempt_id: str,
    credential: dict[str, Any],
    source: str,
    settings: Settings,
    channel: NotificationChannel | None = None,
) -> FinishResult:
    now = service.utcnow()
    limits.lock_source(db, source)
    retry = limits.source_retry_after(db, source, now)
    if retry is not None:
        db.rollback()
        raise service.SourceBlocked(retry)

    attempt = db.scalars(
        select(LoginAttempt)
        .where(LoginAttempt.token_hash == service.hash_token(attempt_id))
        .with_for_update()
    ).one_or_none()
    user = (
        db.get(User, attempt.user_id, with_for_update=True)
        if attempt is not None and attempt.user_id is not None
        else None
    )
    usable = (
        attempt is not None
        and attempt.used_at is None
        and service._aware(attempt.expires_at) > now
        and attempt.pin_ok
        and user is not None
        and not limits.is_locked(user)
    )
    if attempt is not None:
        attempt.used_at = now  # uso único, dê certo ou não

    new_key: Passkey | None = None
    ok = proven = False
    if attempt is not None:
        try:
            with db.begin_nested():  # erro no meio: desfaz só a verificação, não o `used_at`
                if attempt.purpose == "register":
                    new_key, proven = _check_register(
                        db, attempt, user, credential, settings, usable
                    )
                    ok = new_key is not None
                else:
                    ok, proven = _check_login(db, attempt, credential, settings, usable)
        except Exception as exc:  # resposta forjada ou malformada: mesma falha genérica
            logger.info("Chave de acesso recusada: %s", type(exc).__name__)
            new_key, ok, proven = None, False, False
    ok = ok and usable

    if not ok or user is None or attempt is None:
        # Conta para a conta só quem provou o segundo fator dela e errou o PIN.
        wrong_pin_only = proven and attempt is not None and not attempt.pin_ok
        _fail(db, user=user, counts_for_account=wrong_pin_only, source=source, now=now)

    recovery: list[str] | None = None
    if new_key is not None:
        first_key = (
            db.scalar(select(func.count()).select_from(Passkey).where(Passkey.user_id == user.id))
            == 0
        )
        db.add(new_key)
        db.flush()
        record_audit(
            db,
            user_id=user.id,
            entity="passkeys",
            entity_id=new_key.id,
            action="create",
            after={"user_id": user.id, "device_label": new_key.device_label},
        )
        if first_key and user.role == "admin":
            recovery = codes.issue_recovery_codes(db, user, now=now)

    token, session = service.open_session(
        db, user, device_label=attempt.device_label, two_factor=True, settings=settings
    )
    record_audit(
        db,
        user_id=user.id,
        entity="sessions",
        entity_id=session.id,
        action="create",
        after={"user_id": user.id, "two_factor": True},
    )
    db.commit()

    if new_key is not None and channel is not None:
        _notify_new_device(db, channel, user.id, new_key.device_label)
    return FinishResult(token=token, user=user, recovery_codes=recovery)
