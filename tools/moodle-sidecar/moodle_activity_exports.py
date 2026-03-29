import argparse
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlencode

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

from moodle_export_common import (
    create_download_driver,
    create_download_driver_with_profile,
    derive_base_url,
    derive_course_id,
    ensure_login,
    load_input_rows,
    move_download,
    prepare_worker_profiles,
    prelogin_all_modalidades,
    sanitize_file_token,
    to_relative_path,
    wait_for_new_download,
    write_summary,
)


def parse_args():
    parser = argparse.ArgumentParser(description="Descarga exportes CSV del reporte de actividad Moodle.")
    parser.add_argument("--input-json", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--browser", default="chrome")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--login-wait-seconds", type=int, default=300)
    parser.add_argument("--keep-open", action="store_true")
    parser.add_argument("--workers", type=int, default=1, help="Numero de navegadores en paralelo (default: 1)")
    return parser.parse_args()


def build_log_url(base_url: str, course_id: str) -> str:
    query = urlencode(
        {
            "chooselog": 1,
            "showusers": 0,
            "showcourses": 0,
            "id": course_id,
            "group": "",
            "user": "",
            "date": "",
            "modid": "",
            "modaction": "",
            "origin": "",
            "edulevel": -1,
            "logreader": "logstore_standard",
        }
    )
    return f"{base_url}/report/log/index.php?{query}"


def click_if_present(driver, xpath: str) -> bool:
    try:
        element = WebDriverWait(driver, 2).until(EC.element_to_be_clickable((By.XPATH, xpath)))
        element.click()
        return True
    except Exception:
        return False


def maybe_choose_csv(driver) -> None:
    for selector in ("download", "id_download", "menu_download", "id_exportformat"):
        try:
            select = Select(driver.find_element(By.ID, selector))
            for option in select.options:
                text = (option.text or "").strip().lower()
                value = (option.get_attribute("value") or "").strip().lower()
                if "csv" in text or "csv" in value:
                    select.select_by_value(option.get_attribute("value"))
                    return
        except Exception:
            continue


def click_download(driver) -> None:
    if click_if_present(
        driver,
        "//button[contains(., 'Obtener estos registros')] | //button[contains(., 'Get these logs')] | //input[contains(@value, 'Obtener estos registros')] | //input[contains(@value, 'Get these logs')]",
    ):
        time.sleep(1)
    maybe_choose_csv(driver)
    wait = WebDriverWait(driver, 20)
    button = wait.until(
        EC.element_to_be_clickable(
            (
                By.XPATH,
                "//button[contains(., 'Descargar')]"
                " | //button[contains(., 'Download')]"
                " | //input[@value='Descargar']"
                " | //input[@value='Download']",
            )
        )
    )
    button.click()


def process_row(
    driver,
    row: Dict[str, object],
    download_dir: Path,
    files_dir: Path,
    headless: bool,
    login_wait_seconds: int,
    print_lock: threading.Lock,
    worker_id: int = 0,
) -> Tuple[Dict[str, object], Optional[Dict[str, object]]]:
    nrc = str(row.get("nrc") or "").strip()
    period_code = str(row.get("periodCode") or "").strip()
    title = str(row.get("title") or "").strip() or "SIN_TITULO"
    base_url = derive_base_url(row)
    course_id = derive_course_id(row)

    prefix = f"[W{worker_id}]" if worker_id > 0 else ""
    with print_lock:
        print(
            f"[INFO]{prefix} Actividad: preparando NRC {nrc or 'SIN_NRC'} "
            f"periodo {period_code or 'SIN_PERIODO'} "
            f"curso {course_id or 'SIN_COURSE_ID'}"
        )

    summary_row: Dict[str, object] = {
        "courseId": row.get("courseId"),
        "nrc": nrc,
        "periodCode": period_code,
        "title": title,
        "status": "PENDING",
        "message": None,
        "downloads": [],
    }

    if not base_url or not course_id:
        summary_row["status"] = "ERROR"
        summary_row["message"] = "El curso no tiene base URL o course ID resuelto."
        with print_lock:
            print(f"[ERROR]{prefix} Actividad: NRC {nrc or 'SIN_NRC'} sin base URL o course ID resuelto.")
        return summary_row, None

    try:
        ensure_login(driver, base_url, row, headless=headless, login_wait_seconds=login_wait_seconds)
        driver.get(build_log_url(base_url, course_id))
        WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        before_names = [item.name for item in download_dir.iterdir()] if download_dir.exists() else []
        click_download(driver)
        downloaded = wait_for_new_download(download_dir, before_names, (".csv", ".txt"), 600)
        if not downloaded:
            raise RuntimeError("No se detecto descarga del reporte de actividad.")
        final_file = move_download(
            downloaded,
            files_dir / sanitize_file_token(period_code or "sin_periodo"),
            f"{nrc}_{period_code}_actividad",
        )
        file_record: Dict[str, object] = {
            "kind": "activity",
            "nrc": nrc,
            "periodCode": period_code,
            "title": title,
            "fileName": final_file.name,
            "relativePath": to_relative_path(final_file),
        }
        cast_downloads = summary_row["downloads"]
        if isinstance(cast_downloads, list):
            cast_downloads.append(file_record)
        summary_row["status"] = "DOWNLOADED"
        with print_lock:
            print(f"[INFO]{prefix} Actividad: NRC {nrc or 'SIN_NRC'} descargado en {file_record['relativePath']}")
        return summary_row, file_record
    except Exception as exc:
        summary_row["status"] = "ERROR"
        summary_row["message"] = str(exc)
        with print_lock:
            print(f"[ERROR]{prefix} Actividad: NRC {nrc or 'SIN_NRC'} fallo: {summary_row['message']}")
        return summary_row, None


def run_worker_chunk(
    worker_id: int,
    chunk: List[Dict[str, object]],
    browser: str,
    profile_dir: str,
    output_dir: Path,
    headless: bool,
    login_wait_seconds: int,
    print_lock: threading.Lock,
) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    download_dir = output_dir / f"_downloads_w{worker_id}"
    files_dir = output_dir / "files"

    driver = create_download_driver_with_profile(browser, download_dir, profile_dir, headless=headless)
    results: List[Dict[str, object]] = []
    generated_files: List[Dict[str, object]] = []

    try:
        for row in chunk:
            summary_row, file_record = process_row(
                driver, row, download_dir, files_dir,
                headless, login_wait_seconds, print_lock, worker_id,
            )
            results.append(summary_row)
            if file_record:
                generated_files.append(file_record)
    finally:
        driver.quit()

    return results, generated_files


def split_chunks(items: List, n: int) -> List[List]:
    k, rem = divmod(len(items), n)
    chunks = []
    start = 0
    for i in range(n):
        end = start + k + (1 if i < rem else 0)
        if end > start:
            chunks.append(items[start:end])
        start = end
    return chunks


def main() -> int:
    args = parse_args()
    input_rows = load_input_rows(args.input_json)
    output_dir = Path(args.output_dir)
    files_dir = output_dir / "files"
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    num_workers = max(1, min(args.workers, len(input_rows)))

    if num_workers == 1:
        # ── Modo single worker (comportamiento original) ──────────────────────
        download_dir = output_dir / "_downloads"
        driver = create_download_driver(args.browser, download_dir, headless=args.headless)
        results: List[Dict[str, object]] = []
        generated_files: List[Dict[str, object]] = []
        print_lock = threading.Lock()
        exit_code = 0
        try:
            prelogin_all_modalidades(driver, input_rows, headless=args.headless, login_wait_seconds=args.login_wait_seconds)
            for row in input_rows:
                summary_row, file_record = process_row(
                    driver, row, download_dir, files_dir,
                    args.headless, args.login_wait_seconds, print_lock,
                )
                results.append(summary_row)
                if file_record:
                    generated_files.append(file_record)
        finally:
            if args.keep_open:
                print("[INFO] Navegador mantenido abierto por solicitud del usuario.")
            else:
                driver.quit()
    else:
        # ── Modo multi-worker ─────────────────────────────────────────────────
        import shutil as _shutil
        print(f"[INFO] Modo multi-worker: {num_workers} workers en paralelo.")
        print_lock = threading.Lock()

        worker_profiles = prepare_worker_profiles(args.browser, num_workers)

        # Determina el perfil principal (sin sufijo _wN) para copiar sesion existente
        browser_key = (args.browser or "edge").strip().lower()
        from moodle_categorizacion_aulas import PROFILE_DIR_CHROME, PROFILE_DIR_EDGE
        main_profile = Path(PROFILE_DIR_CHROME if browser_key == "chrome" else PROFILE_DIR_EDGE)

        # Si el perfil principal existe y tiene sesion, copiarlo al worker 0 para heredar la sesion
        w0_profile = Path(worker_profiles[0])
        if main_profile.exists() and not w0_profile.exists():
            print(f"[INFO] Copiando sesion del perfil principal -> worker 0...")
            try:
                _shutil.copytree(main_profile, w0_profile, ignore=_shutil.ignore_patterns(
                    "Crashpad", "Singleton*", "LOCK", "lockfile", "*.log", "*.ldb",
                    "*Cache*", "GPUCache", "Code Cache", "ShaderCache",
                ))
                print(f"[INFO] Perfil principal copiado a worker 0.")
            except Exception as exc:
                print(f"[WARN] No se pudo copiar perfil principal: {exc}. Worker 0 hara login desde cero.")

        # 1) Pre-login: abre UNA ventana con el perfil del worker 0
        prelogin_download_dir = output_dir / "_prelogin"
        prelogin_driver = create_download_driver_with_profile(
            args.browser, prelogin_download_dir, str(w0_profile), headless=args.headless
        )
        print(f"[INFO] Pre-login: autenticando todas las modalidades con worker 0...")
        try:
            prelogin_all_modalidades(
                prelogin_driver, input_rows,
                headless=args.headless, login_wait_seconds=args.login_wait_seconds,
            )
        finally:
            prelogin_driver.quit()
        print(f"[INFO] Pre-login completado. Copiando sesion a {num_workers - 1} worker(s) adicional(es)...")

        # 2) Copiar el perfil del worker 0 a los demás workers
        for i in range(1, num_workers):
            src = w0_profile
            dst = Path(worker_profiles[i])
            if dst.exists():
                _shutil.rmtree(dst, ignore_errors=True)
            try:
                _shutil.copytree(src, dst, ignore=_shutil.ignore_patterns(
                    "Crashpad", "Singleton*", "LOCK", "lockfile", "*.log", "*.ldb",
                    "*Cache*", "GPUCache", "Code Cache", "ShaderCache",
                ))
                print(f"[INFO] Perfil copiado: worker 0 -> worker {i}")
            except Exception as exc:
                print(f"[WARN] No se pudo copiar perfil a worker {i}: {exc}. El worker pedira login propio.")

        # 3) Dividir los NRCs en chunks y lanzar workers en paralelo
        chunks = split_chunks(input_rows, num_workers)
        print(f"[INFO] Distribucion de NRCs: {[len(c) for c in chunks]}")

        all_results: List[Dict[str, object]] = []
        all_files: List[Dict[str, object]] = []
        exit_code = 0

        with ThreadPoolExecutor(max_workers=num_workers) as executor:
            futures = {
                executor.submit(
                    run_worker_chunk,
                    i, chunks[i], args.browser, worker_profiles[i],
                    output_dir, args.headless, args.login_wait_seconds, print_lock,
                ): i
                for i in range(num_workers)
            }
            for future in as_completed(futures):
                wid = futures[future]
                try:
                    w_results, w_files = future.result()
                    all_results.extend(w_results)
                    all_files.extend(w_files)
                    print(f"[INFO] Worker {wid} finalizo: {len(w_results)} NRCs procesados.")
                except Exception as exc:
                    print(f"[ERROR] Worker {wid} fallo: {exc}")

        results = all_results
        generated_files = all_files

    summary = {
        "kind": "activity",
        "startedAt": started_at,
        "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "outputDir": to_relative_path(output_dir),
        "workers": num_workers,
        "totalCourses": len(input_rows),
        "completedCourses": sum(1 for item in results if item.get("status") == "DOWNLOADED"),
        "failedCourses": sum(1 for item in results if item.get("status") == "ERROR"),
        "skippedCourses": sum(1 for item in results if item.get("status") not in {"DOWNLOADED", "ERROR"}),
        "files": generated_files,
        "items": results,
    }
    write_summary(output_dir, summary)
    print(f"[INFO] Exportes de actividad generados en {output_dir}")
    print(f"[INFO] Cursos procesados: {summary['totalCourses']}")
    print(f"[INFO] Descargas exitosas: {summary['completedCourses']}")
    print(f"[INFO] Errores: {summary['failedCourses']}")
    exit_code = 0 if summary["failedCourses"] == 0 else 1
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
