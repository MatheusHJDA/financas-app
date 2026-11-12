"""Mapeamento único usuário → Owner (D10/D12), sem dependências pesadas."""

from finance_api.core.permissions import Owner

# Nome do usuário (como gravado em `users.name`) → dono dos registros.
OWNER_BY_USER_NAME: dict[str, Owner] = {
    "Matheus": Owner.MATHEUS,
    "Ruth": Owner.RUTH,
}

# Papel de cada usuário criado na carga inicial.
INITIAL_USERS: tuple[tuple[str, str], ...] = (("Matheus", "admin"), ("Ruth", "member"))

PIN_LENGTH = 6
