"""
Tests for docker/entrypoint.sh (INFRA-025).

Verifies:
1. Script passes POSIX sh syntax check (`sh -n`).
2. Each dispatch arm maps to the correct compiled script path given the
   TypeScript compiler config (rootDir: src, outDir: dist).
"""
import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
ENTRYPOINT = REPO_ROOT / "docker" / "entrypoint.sh"
TSCONFIG_BUILD = REPO_ROOT / "api" / "tsconfig.build.json"
TSCONFIG_BASE = REPO_ROOT / "api" / "tsconfig.json"


def test_entrypoint_posix_syntax():
    """sh -n must exit 0 (no syntax errors)."""
    result = subprocess.run(
        ["sh", "-n", str(ENTRYPOINT)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"sh -n failed:\nstdout: {result.stdout}\nstderr: {result.stderr}"
    )


def test_entrypoint_exists_and_is_executable():
    """Script file must exist and be executable."""
    assert ENTRYPOINT.exists(), f"{ENTRYPOINT} does not exist"
    assert ENTRYPOINT.stat().st_mode & 0o111, f"{ENTRYPOINT} is not executable"


def test_tsconfig_outdir_is_dist():
    """api/tsconfig.json must declare outDir: dist so compiled paths are correct."""
    config = json.loads(TSCONFIG_BASE.read_text())
    out_dir = config.get("compilerOptions", {}).get("outDir")
    assert out_dir == "dist", f"Expected outDir 'dist', got {out_dir!r}"


def test_tsconfig_build_rootdir_is_src():
    """api/tsconfig.build.json must declare rootDir: src."""
    config = json.loads(TSCONFIG_BUILD.read_text())
    root_dir = config.get("compilerOptions", {}).get("rootDir")
    assert root_dir == "src", f"Expected rootDir 'src', got {root_dir!r}"


def test_dispatch_arm_paths_present_in_script():
    """
    Each arm's compiled target path must appear verbatim in entrypoint.sh,
    confirming the dispatch table matches the TypeScript output layout.
    """
    content = ENTRYPOINT.read_text()
    expected_paths = [
        "api/dist/scripts/migrate.js",
        "api/dist/index.js",
        "api/dist/scripts/seed.prod.js",
        "api/dist/scripts/adminPromote.js",
    ]
    for path in expected_paths:
        assert path in content, (
            f"Expected compiled path '{path}' not found in entrypoint.sh"
        )


def test_no_crlf_line_endings():
    """Script must use LF line endings (no CRLF)."""
    raw = ENTRYPOINT.read_bytes()
    assert b"\r\n" not in raw, "entrypoint.sh contains CRLF line endings"


def test_shebang_is_posix_sh():
    """Script must start with #!/bin/sh (POSIX, not bash)."""
    first_line = ENTRYPOINT.read_text().splitlines()[0]
    assert first_line == "#!/bin/sh", (
        f"Expected shebang '#!/bin/sh', got {first_line!r}"
    )
