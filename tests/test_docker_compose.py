"""
Tests for docker-compose.yml (INFRA-026).

Verifies:
1. File parses as valid YAML without error.
2. No 'postgres' service key is present.
3. Required keys are present: single 'asp' service with the correct
   image, env_file, port, restart policy, and healthcheck.
"""
import yaml
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"


def _load_compose():
    with COMPOSE_FILE.open() as fh:
        return yaml.safe_load(fh)


def test_compose_parses_as_valid_yaml():
    """docker-compose.yml must be valid YAML."""
    doc = _load_compose()
    assert doc is not None, "YAML document must not be empty"
    assert isinstance(doc, dict), "Top-level document must be a mapping"


def test_no_postgres_service():
    """No 'postgres' service key may be present."""
    doc = _load_compose()
    services = doc.get("services", {})
    assert "postgres" not in services, (
        "A postgres service is explicitly prohibited per docs/brief.md and "
        "Phase 12 operator sign-off (2026-05-29)"
    )


def test_asp_service_exists():
    """A single 'asp' service must be defined."""
    doc = _load_compose()
    services = doc.get("services", {})
    assert "asp" in services, "services.asp must be defined"


def test_asp_service_image():
    """asp service must use image asp:local."""
    doc = _load_compose()
    asp = doc["services"]["asp"]
    assert asp.get("image") == "asp:local", (
        f"Expected image 'asp:local', got {asp.get('image')!r}"
    )


def test_asp_service_env_file():
    """asp service must reference .env.production via env_file."""
    doc = _load_compose()
    asp = doc["services"]["asp"]
    env_file = asp.get("env_file")
    # env_file may be a string or a list
    if isinstance(env_file, list):
        assert ".env.production" in env_file, (
            f"'.env.production' not found in env_file list: {env_file}"
        )
    else:
        assert env_file == ".env.production", (
            f"Expected env_file '.env.production', got {env_file!r}"
        )


def test_asp_service_port():
    """asp service must expose 6020:6020."""
    doc = _load_compose()
    asp = doc["services"]["asp"]
    ports = asp.get("ports", [])
    assert "6020:6020" in ports, (
        f"Expected '6020:6020' in ports, got {ports}"
    )


def test_asp_service_restart():
    """asp service restart policy must be unless-stopped."""
    doc = _load_compose()
    asp = doc["services"]["asp"]
    assert asp.get("restart") == "unless-stopped", (
        f"Expected restart 'unless-stopped', got {asp.get('restart')!r}"
    )


def test_asp_service_healthcheck():
    """asp service must define a healthcheck for /api/health."""
    doc = _load_compose()
    asp = doc["services"]["asp"]
    hc = asp.get("healthcheck")
    assert hc is not None, "healthcheck must be defined"
    test_cmd = hc.get("test")
    assert test_cmd is not None, "healthcheck.test must be defined"
    # test may be a list ["CMD", "curl", "-f", "..."] or a shell string
    cmd_str = " ".join(test_cmd) if isinstance(test_cmd, list) else test_cmd
    assert "http://localhost:6020/api/health" in cmd_str, (
        f"healthcheck must target /api/health, got: {cmd_str}"
    )
    assert hc.get("interval") is not None, "healthcheck.interval must be set"
    assert hc.get("timeout") is not None, "healthcheck.timeout must be set"
    assert hc.get("retries") is not None, "healthcheck.retries must be set"


def test_only_asp_service():
    """Only the 'asp' service should be defined (no extra services)."""
    doc = _load_compose()
    services = doc.get("services", {})
    assert set(services.keys()) == {"asp"}, (
        f"Expected only 'asp' service, found: {set(services.keys())}"
    )
