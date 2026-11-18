"""Autenticador de teste (chave de acesso em software): EC P-256, atestação `none`, UP+UV.

Recebe as opções em JSON (como o `@simplewebauthn/browser` recebe) e devolve o JSON que o
navegador mandaria ao servidor. Cada instância é um aparelho com uma única credencial.
"""

import base64
import hashlib
import json
import secrets
import struct
from typing import Any

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

_FLAG_UP = 0x01
_FLAG_UV = 0x04
_FLAG_AT = 0x40


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class SoftAuthenticator:
    def __init__(self, rp_id: str, origin: str) -> None:
        self.rp_id = rp_id
        self.origin = origin
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = secrets.token_bytes(32)
        self.sign_count = 0
        self.user_handle: str | None = None  # user.id (base64url) da opção de cadastro

    def _client_data(self, kind: str, challenge: str) -> bytes:
        data = {"type": kind, "challenge": challenge, "origin": self.origin, "crossOrigin": False}
        return json.dumps(data, separators=(",", ":")).encode()

    def _auth_data(self, flags: int, extra: bytes = b"") -> bytes:
        rp_hash = hashlib.sha256(self.rp_id.encode()).digest()
        return rp_hash + bytes([flags]) + struct.pack(">I", self.sign_count) + extra

    def _cose_key(self) -> bytes:
        numbers = self.private_key.public_key().public_numbers()
        return cbor2.dumps(
            {
                1: 2,  # kty: EC2
                3: -7,  # alg: ES256
                -1: 1,  # crv: P-256
                -2: numbers.x.to_bytes(32, "big"),
                -3: numbers.y.to_bytes(32, "big"),
            }
        )

    def register(self, options: dict[str, Any]) -> dict[str, Any]:
        self.user_handle = options["user"]["id"]
        attested = (
            bytes(16)  # aaguid
            + struct.pack(">H", len(self.credential_id))
            + self.credential_id
            + self._cose_key()
        )
        auth_data = self._auth_data(_FLAG_UP | _FLAG_UV | _FLAG_AT, attested)
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        client_data = self._client_data("webauthn.create", options["challenge"])
        return {
            "id": b64url(self.credential_id),
            "rawId": b64url(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64url(client_data),
                "attestationObject": b64url(attestation),
                "transports": ["internal"],
            },
            "clientExtensionResults": {},
        }

    def authenticate(self, options: dict[str, Any]) -> dict[str, Any]:
        self.sign_count += 1
        auth_data = self._auth_data(_FLAG_UP | _FLAG_UV)
        client_data = self._client_data("webauthn.get", options["challenge"])
        signature = self.private_key.sign(
            auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256())
        )
        return {
            "id": b64url(self.credential_id),
            "rawId": b64url(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64url(client_data),
                "authenticatorData": b64url(auth_data),
                "signature": b64url(signature),
                "userHandle": self.user_handle,
            },
            "clientExtensionResults": {},
        }
