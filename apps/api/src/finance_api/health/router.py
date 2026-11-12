from importlib.metadata import PackageNotFoundError, version

from fastapi import APIRouter

router = APIRouter(tags=["health"])


def _package_version() -> str:
    try:
        return version("finance-api")
    except PackageNotFoundError:  # pragma: no cover - pacote não instalado
        return "0.0.0"


@router.get("/health")
def health() -> dict[str, str]:
    """Liveness. Não toca no banco (checagem de banco fica em /api/admin/system)."""
    return {"status": "ok", "version": _package_version()}
