"""The device-pairing endpoints.

The flow is an RFC 8628-shaped device authorization grant: a device with no keyboard
gets a long secret and a short human code, and a signed-in phone approves it.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.services import device_pairing as dp

client = TestClient(app)


def test_start_is_public_and_returns_both_codes():
    r = client.post("/api/v1/auth/device/start")
    assert r.status_code == 200
    body = r.json()
    assert len(body["device_code"]) > 30
    assert len(dp.normalize_user_code(body["user_code"])) == dp.USER_CODE_LENGTH
    assert body["expires_in"] == 600
    assert body["interval"] >= 1
    assert body["verification_uri"].endswith("/link")


def test_start_returns_the_user_code_already_formatted():
    body = client.post("/api/v1/auth/device/start").json()
    assert "-" in body["user_code"]


def test_two_starts_differ():
    a = client.post("/api/v1/auth/device/start").json()
    b = client.post("/api/v1/auth/device/start").json()
    assert a["device_code"] != b["device_code"]
    assert a["user_code"] != b["user_code"]


def test_start_never_puts_the_device_code_in_the_path():
    # middleware/error_handler.py logs request.url.path to stdout and to a retained
    # file. A secret in a path is a secret in the logs.
    r = client.post("/api/v1/auth/device/start")
    assert r.request.url.path == "/api/v1/auth/device/start"
