import json
import shutil
import time
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence
from urllib.parse import parse_qs, urlparse

from moodle_categorizacion_aulas import (
    ChromeOptions,
    EdgeOptions,
    LEGACY_PROFILE_DIR_CHROME,
    LEGACY_PROFILE_DIR_EDGE,
    LOGIN_WAIT_SECONDS,
    PROFILE_COPY_IGNORE,
    PROFILE_DIR_CHROME,
    PROFILE_DIR_EDGE,
    SELENIUM_IMPORT_ERROR,
    WebDriver,
    login_manual_microsoft,
    webdriver,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DOWNLOAD_WAIT_SECONDS = 180


def project_root() -> Path:
    return PROJECT_ROOT


def load_input_rows(input_json: str) -> List[Dict[str, object]]:
    path = Path(input_json)
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("El archivo de entrada debe ser un arreglo JSON.")
    return [row for row in data if isinstance(row, dict)]


def sanitize_file_token(value: str) -> str:
    text = str(value or "").strip()
    cleaned = "".join(ch if ch.isalnum() or ch in ("-", "_", ".", " ") else "_" for ch in text)
    cleaned = " ".join(cleaned.split()).strip(" ._")
    return cleaned or "sin_nombre"


def to_relative_path(path_value: Path) -> str:
    try:
        return str(path_value.resolve().relative_to(project_root().resolve())).replace("\\", "/")
    except Exception:
        return str(path_value.resolve())


def derive_base_url(row: Dict[str, object]) -> Optional[str]:
    explicit = str(row.get("resolvedBaseUrl") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    course_url = str(row.get("moodleCourseUrl") or "").strip()
    if not course_url:
        return None
    parsed = urlparse(course_url)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def derive_course_url(row: Dict[str, object]) -> Optional[str]:
    course_url = str(row.get("moodleCourseUrl") or "").strip()
    if course_url:
        return course_url
    base_url = derive_base_url(row)
    course_id = derive_course_id(row)
    if base_url and course_id:
        return f"{base_url}/course/view.php?id={course_id}"
    return None


def derive_course_id(row: Dict[str, object]) -> Optional[str]:
    course_id = str(row.get("moodleCourseId") or "").strip()
    if course_id:
        return course_id
    course_url = str(row.get("moodleCourseUrl") or "").strip()
    if not course_url:
        return None
    parsed = urlparse(course_url)
    return parse_qs(parsed.query).get("id", [None])[0]


def modality_label(row: Dict[str, object], base_url: Optional[str]) -> str:
    explicit = str(row.get("resolvedModality") or "").strip()
    if explicit:
        return explicit
    host = urlparse(base_url or "").hostname or ""
    return host.split(".")[0].upper() or "MOODLE"


def copy_legacy_profile_if_needed(target: Path, legacy: Path) -> None:
    if target.exists() or not legacy.exists():
        return
    try:
        shutil.copytree(
            legacy,
            target,
            ignore=shutil.ignore_patterns(*PROFILE_COPY_IGNORE),
            dirs_exist_ok=True,
        )
    except Exception as exc:
        print(f"[WARN] No se pudo migrar perfil desde {legacy}: {exc}")


def create_download_driver(browser: str, download_dir: Path, headless: bool = False) -> WebDriver:
    if SELENIUM_IMPORT_ERROR is not None:
        raise RuntimeError("No se pudo importar selenium.") from SELENIUM_IMPORT_ERROR

    browser_key = (browser or "edge").strip().lower()
    if browser_key == "edge":
        profile_dir = Path(PROFILE_DIR_EDGE)
        legacy_profile = LEGACY_PROFILE_DIR_EDGE
        options = EdgeOptions()
    elif browser_key == "chrome":
        profile_dir = Path(PROFILE_DIR_CHROME)
        legacy_profile = LEGACY_PROFILE_DIR_CHROME
        options = ChromeOptions()
    else:
        raise ValueError("Navegador no soportado. Usa edge o chrome.")

    profile_dir.parent.mkdir(parents=True, exist_ok=True)
    copy_legacy_profile_if_needed(profile_dir, legacy_profile)
    download_dir.mkdir(parents=True, exist_ok=True)

    options.add_argument(f"--user-data-dir={profile_dir}")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    if headless:
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--disable-dev-shm-usage")

    prefs = {
        "download.default_directory": str(download_dir),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
    }
    options.add_experimental_option("prefs", prefs)

    driver = webdriver.Edge(options=options) if browser_key == "edge" else webdriver.Chrome(options=options)
    if headless:
        try:
            driver.set_window_size(1920, 1080)
        except Exception:
            pass
    else:
        try:
            driver.maximize_window()
        except Exception:
            try:
                driver.set_window_size(1920, 1080)
            except Exception:
                pass
    return driver


def ensure_login(driver: WebDriver, base_url: str, row: Dict[str, object], headless: bool, login_wait_seconds: Optional[int]) -> None:
    original_wait = LOGIN_WAIT_SECONDS
    if login_wait_seconds and login_wait_seconds > 0:
        import moodle_categorizacion_aulas as sidecar_module

        sidecar_module.LOGIN_WAIT_SECONDS = max(30, int(login_wait_seconds))
    try:
        login_manual_microsoft(driver, base_url, modality_label(row, base_url), headless=headless)
    finally:
        if login_wait_seconds and login_wait_seconds > 0:
            import moodle_categorizacion_aulas as sidecar_module

            sidecar_module.LOGIN_WAIT_SECONDS = original_wait


def wait_for_new_download(
    download_dir: Path,
    before_names: Iterable[str],
    suffixes: Sequence[str],
    timeout_seconds: int = DEFAULT_DOWNLOAD_WAIT_SECONDS,
) -> Optional[Path]:
    before = set(before_names)
    deadline = time.time() + max(10, int(timeout_seconds))
    lowered_suffixes = tuple(s.lower() for s in suffixes)
    while time.time() < deadline:
        partials = list(download_dir.glob("*.crdownload")) + list(download_dir.glob("*.tmp")) + list(download_dir.glob("*.part"))
        if partials:
            time.sleep(1.0)
            continue

        for candidate in sorted(download_dir.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True):
            if candidate.name in before:
                continue
            if candidate.is_file() and candidate.suffix.lower() in lowered_suffixes:
                return candidate
        time.sleep(1.0)
    return None


def move_download(candidate: Path, destination_dir: Path, base_name: str) -> Path:
    destination_dir.mkdir(parents=True, exist_ok=True)
    stem = sanitize_file_token(base_name)
    suffix = candidate.suffix.lower() or ".bin"
    target = destination_dir / f"{stem}{suffix}"
    counter = 2
    while target.exists():
        target = destination_dir / f"{stem}_{counter}{suffix}"
        counter += 1
    candidate.replace(target)
    return target


def write_summary(output_dir: Path, payload: Dict[str, object]) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = output_dir / "summary.json"
    summary_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary_path
