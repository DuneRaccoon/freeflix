import pytest
from pydantic import ValidationError

from app.models import UserCreate, UserUpdate, InviteAcceptRequest


@pytest.mark.parametrize("value", [
    "house:reel",
    "house:directors-chair",
    "cached:8f3a91c2",
    "/avatars/avatar1.svg",
    "",
    None,
])
def test_accepts_valid_avatars(value):
    assert UserCreate(display_name="Ben", avatar=value).avatar == value


@pytest.mark.parametrize("value", [
    "javascript:alert(1)",
    "https://evil.example/x.gif",
    "data:image/svg+xml;base64,AAAA",
    "house:UPPERCASE",
    "house:trailing\n",
    "cached:nothex",
    "/avatars/avatar9.svg",
    "../../etc/passwd",
    "house:" + "a" * 200,
])
def test_rejects_hostile_or_malformed_avatars(value):
    with pytest.raises(ValidationError):
        UserCreate(display_name="Ben", avatar=value)


def test_update_and_invite_share_the_rule():
    with pytest.raises(ValidationError):
        UserUpdate(avatar="javascript:alert(1)")
    with pytest.raises(ValidationError):
        InviteAcceptRequest(display_name="Ava", avatar="javascript:alert(1)")


def test_response_stays_permissive():
    """A row written before validation existed must still serialise.

    Narrowing UserResponse would turn one odd row into a 500 for GET /users,
    taking down the whole household's profile list instead of degrading that
    one profile to a monogram.
    """
    from app.models import UserResponse
    assert UserResponse.model_fields["avatar"].annotation is not None
