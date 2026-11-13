from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from finance_api.core.audit import record_audit
from finance_api.core.config import get_settings
from finance_api.core.deps import DbSession, get_current_user, require_admin
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import PushSubscription
from finance_api.notifications.channels import NotificationChannel, get_channel
from finance_api.notifications.service import deliver

# /push/*, /admin/notifications/test e /admin/push-subscriptions.
router = APIRouter(tags=["push"])

User = Annotated[CurrentUser, Depends(get_current_user)]
Admin = Annotated[CurrentUser, Depends(require_admin)]
Channel = Annotated[NotificationChannel, Depends(get_channel)]


class VapidKeyOut(BaseModel):
    public_key: str


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1)
    auth: str = Field(min_length=1)


class PushSubscriptionCreate(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)
    keys: PushKeys
    device_label: str | None = Field(default=None, max_length=120)

    @field_validator("endpoint")
    @classmethod
    def _https_only(cls, value: str) -> str:
        # O servidor faz POST neste endereço: só serviços de push (sempre https).
        if not value.startswith("https://"):
            raise ValueError("O endpoint de push precisa usar https.")
        return value


class PushSubscriptionOut(BaseModel):
    id: int
    user_id: int
    endpoint: str
    device_label: str | None = None
    created_at: datetime
    last_ok_at: datetime | None = None


class NotificationTestIn(BaseModel):
    user_id: int


class NotificationTestOut(BaseModel):
    sent: int


def _out(subscription: PushSubscription) -> PushSubscriptionOut:
    return PushSubscriptionOut(
        id=subscription.id,
        user_id=subscription.user_id,
        endpoint=subscription.endpoint,
        device_label=subscription.device_label,
        created_at=subscription.created_at,
        last_ok_at=subscription.last_ok_at,
    )


def _audit_state(subscription: PushSubscription) -> dict[str, object]:
    # Sem endpoint nem chaves: são credenciais de envio.
    return {"user_id": subscription.user_id, "device_label": subscription.device_label}


@router.get("/push/vapid-public-key", response_model=VapidKeyOut)
def get_vapid_public_key(_: User) -> VapidKeyOut:
    settings = get_settings()
    configured = bool(settings.vapid_public_key and settings.vapid_private_key)
    return VapidKeyOut(public_key=settings.vapid_public_key if configured else "")


@router.get("/push/subscriptions", response_model=list[PushSubscriptionOut])
def list_subscriptions(db: DbSession, user: User) -> list[PushSubscriptionOut]:
    rows = db.scalars(
        select(PushSubscription)
        .where(PushSubscription.user_id == user.id)
        .order_by(PushSubscription.id)
    )
    return [_out(row) for row in rows]


@router.post(
    "/push/subscriptions", response_model=PushSubscriptionOut, status_code=status.HTTP_201_CREATED
)
def create_subscription(
    body: PushSubscriptionCreate, db: DbSession, user: User
) -> PushSubscriptionOut:
    # O endpoint é único na tabela: reinscrever o mesmo aparelho atualiza em vez de duplicar.
    keys = body.keys.model_dump()
    existing = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if existing is None:
        subscription = PushSubscription(
            user_id=user.id,
            endpoint=body.endpoint,
            keys_json=keys,
            device_label=body.device_label,
        )
        db.add(subscription)
        db.flush()
        record_audit(
            db,
            user_id=user.id,
            entity="push_subscriptions",
            entity_id=subscription.id,
            action="create",
            after=_audit_state(subscription),
        )
    else:
        subscription = existing
        before = _audit_state(subscription)
        subscription.user_id = user.id
        subscription.keys_json = keys
        subscription.device_label = body.device_label
        record_audit(
            db,
            user_id=user.id,
            entity="push_subscriptions",
            entity_id=subscription.id,
            action="update",
            before=before,
            after=_audit_state(subscription),
        )
    db.commit()
    db.refresh(subscription)
    return _out(subscription)


@router.delete("/push/subscriptions/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subscription(id: int, db: DbSession, user: User) -> Response:
    subscription = db.get(PushSubscription, id)
    # Alheia → 404 igual a inexistente (não revela que existe). Admin remove qualquer uma.
    if subscription is None or (subscription.user_id != user.id and user.role != "admin"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inscrição não encontrada."
        )
    record_audit(
        db,
        user_id=user.id,
        entity="push_subscriptions",
        entity_id=subscription.id,
        action="delete",
        before=_audit_state(subscription),
    )
    db.delete(subscription)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/admin/notifications/test", response_model=NotificationTestOut)
def send_test_notification(
    body: NotificationTestIn, db: DbSession, _: Admin, channel: Channel
) -> NotificationTestOut:
    payload = {
        "title": "Notificação de teste",
        "body": "Os avisos estão funcionando neste aparelho.",
        "url": "/",
    }
    sent = deliver(db, channel, body.user_id, "test", payload, datetime.now(UTC))
    return NotificationTestOut(sent=sent)


@router.get("/admin/push-subscriptions", response_model=list[PushSubscriptionOut])
def admin_list_subscriptions(db: DbSession, _: Admin) -> list[PushSubscriptionOut]:
    return [_out(row) for row in db.scalars(select(PushSubscription).order_by(PushSubscription.id))]
