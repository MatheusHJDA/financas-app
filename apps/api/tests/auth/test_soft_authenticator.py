"""O autenticador de teste produz respostas que a própria biblioteca aceita."""

import json

from webauthn import (
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

from .soft_authenticator import SoftAuthenticator, b64url

RP_ID = "testserver"
ORIGIN = "https://testserver"


def test_soft_authenticator_roundtrip() -> None:
    device = SoftAuthenticator(RP_ID, ORIGIN)
    reg = generate_registration_options(
        rp_id=RP_ID,
        rp_name="Finanças",
        user_name="Matheus",
        user_id=b"u" * 16,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    created = verify_registration_response(
        credential=device.register(json.loads(options_to_json(reg))),
        expected_challenge=reg.challenge,
        expected_rp_id=RP_ID,
        expected_origin=ORIGIN,
        require_user_verification=True,
    )
    assert created.credential_id == device.credential_id
    assert created.user_verified

    sign_count = created.sign_count
    for _ in range(2):
        auth = generate_authentication_options(
            rp_id=RP_ID, user_verification=UserVerificationRequirement.REQUIRED
        )
        assertion = device.authenticate(json.loads(options_to_json(auth)))
        assert assertion["response"]["userHandle"] == b64url(b"u" * 16)
        verified = verify_authentication_response(
            credential=assertion,
            expected_challenge=auth.challenge,
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
            credential_public_key=created.credential_public_key,
            credential_current_sign_count=sign_count,
            require_user_verification=True,
        )
        assert verified.new_sign_count == sign_count + 1
        sign_count = verified.new_sign_count
