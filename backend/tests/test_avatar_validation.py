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
    """A row older or stranger than the grammar must still serialise.

    Narrowing UserResponse would turn one odd row into a 500 for GET /users,
    taking down the whole household's profile list instead of degrading that
    one profile to a monogram in the client.
    """
    from app.models import UserResponse, UserSettingsResponse

    weird = "https://legacy.example/old-avatar.png"

    # The request models refuse it...
    with pytest.raises(ValidationError):
        UserCreate(display_name="Ben", avatar=weird)

    # ...but the response model must carry it through untouched.
    resp = UserResponse(
        id="1",
        username="ben",
        display_name="Ben",
        avatar=weird,
        settings=UserSettingsResponse(id="s1", user_id="1"),
    )
    assert resp.avatar == weird
