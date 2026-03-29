import argparse
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

from moodle_export_common import (
    create_download_driver,
    derive_base_url,
    derive_course_url,
    ensure_login,
    load_input_rows,
    move_download,
    prelogin_all_modalidades,
    sanitize_file_token,
    to_relative_path,
    wait_for_new_download,
    write_summary,
)


def parse_args():
    parser = argparse.ArgumentParser(description="Descarga exportes del modulo Asistencia desde Moodle.")
    parser.add_argument("--input-json", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--browser", default="chrome")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--login-wait-seconds", type=int, default=300)
    parser.add_argument("--keep-open", action="store_true")
    return parser.parse_args()


def normalize_attendance_export_url(href: str) -> Optional[str]:
    if not href:
        return None
    parsed = urlparse(href)
    module_id = parse_qs(parsed.query).get("id", [None])[0]
    if not module_id:
        return None
    if parsed.path.endswith("/export.php"):
        return href
    if parsed.path.endswith("/view.php"):
        return f"{parsed.scheme}://{parsed.netloc}/mod/attendance/export.php?id={module_id}"
    return None


def find_attendance_links(driver) -> List[Tuple[str, str]]:
    links = []
    seen = set()
    for anchor in driver.find_elements(By.XPATH, "//a[contains(@href, '/mod/attendance/')]"):
        href = (anchor.get_attribute("href") or "").strip()
        export_url = normalize_attendance_export_url(href)
        if not export_url or export_url in seen:
            continue
        seen.add(export_url)
        label = (anchor.text or anchor.get_attribute("title") or "").strip() or f"asistencia_{len(seen)}"
        links.append((label, export_url))
    return links


def maybe_choose_xlsx(driver) -> None:
    for selector in ("id_format", "id_export", "id_exporttype"):
        try:
            select = Select(driver.find_element(By.ID, selector))
            for option in select.options:
                text = (option.text or "").strip().lower()
                value = (option.get_attribute("value") or "").strip().lower()
                if "xlsx" in text or "excel" in text or "xlsx" in value:
                    select.select_by_value(option.get_attribute("value"))
                    return
            for option in select.options:
                text = (option.text or "").strip().lower()
                if "csv" in text:
                    select.select_by_value(option.get_attribute("value"))
                    return
        except Exception:
            continue


def click_export_ok(driver) -> None:
    wait = WebDriverWait(driver, 20)
    button = wait.until(
        EC.element_to_be_clickable(
            (
                By.XPATH,
                "//input[@id='id_submitbutton']"
                " | //input[@value='OK']"
                " | //button[normalize-space()='OK']"
                " | //button[contains(., 'Exportar')]"
                " | //button[contains(., 'Descargar')]",
            )
        )
    )
    button.click()


def main() -> int:
    args = parse_args()
    input_rows = load_input_rows(args.input_json)
    output_dir = Path(args.output_dir)
    download_dir = output_dir / "_downloads"
    files_dir = output_dir / "files"

    driver = create_download_driver(args.browser, download_dir, headless=args.headless)
    results: List[Dict[str, object]] = []
    generated_files: List[Dict[str, object]] = []
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    exit_code = 0
    try:
        prelogin_all_modalidades(driver, input_rows, headless=args.headless, login_wait_seconds=args.login_wait_seconds)

        for row in input_rows:
            nrc = str(row.get("nrc") or "").strip()
            period_code = str(row.get("periodCode") or "").strip()
            title = str(row.get("title") or "").strip() or "SIN_TITULO"
            course_url = derive_course_url(row)
            base_url = derive_base_url(row)
            print(
                f"[INFO] Asistencia: preparando NRC {nrc or 'SIN_NRC'} "
                f"periodo {period_code or 'SIN_PERIODO'}"
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

            if not base_url or not course_url:
                summary_row["status"] = "ERROR"
                summary_row["message"] = "El curso no tiene URL Moodle final resuelta."
                print(
                    f"[ERROR] Asistencia: NRC {nrc or 'SIN_NRC'} sin URL Moodle final resuelta."
                )
                results.append(summary_row)
                continue

            try:
                ensure_login(driver, base_url, row, headless=args.headless, login_wait_seconds=args.login_wait_seconds)
                driver.get(course_url)
                WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
                attendance_links = find_attendance_links(driver)
                if not attendance_links:
                    summary_row["status"] = "NO_ATTENDANCE"
                    summary_row["message"] = "No se encontraron actividades de asistencia en el aula."
                    print(
                        f"[INFO] Asistencia: NRC {nrc or 'SIN_NRC'} sin actividades de asistencia."
                    )
                    results.append(summary_row)
                    continue

                for label, export_url in attendance_links:
                    before_names = [item.name for item in download_dir.iterdir()] if download_dir.exists() else []
                    driver.get(export_url)
                    WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
                    maybe_choose_xlsx(driver)
                    click_export_ok(driver)
                    downloaded = wait_for_new_download(download_dir, before_names, (".xlsx", ".xls", ".csv"), 180)
                    if not downloaded:
                        raise RuntimeError(f"No se detecto descarga para la asistencia '{label}'.")
                    final_file = move_download(
                        downloaded,
                        files_dir / sanitize_file_token(period_code or "sin_periodo") / sanitize_file_token(nrc or "sin_nrc"),
                        f"{nrc}_{period_code}_{label}",
                    )
                    file_record = {
                        "kind": "attendance",
                        "nrc": nrc,
                        "periodCode": period_code,
                        "title": title,
                        "label": label,
                        "fileName": final_file.name,
                        "relativePath": to_relative_path(final_file),
                    }
                    generated_files.append(file_record)
                    cast_downloads = summary_row["downloads"]
                    if isinstance(cast_downloads, list):
                        cast_downloads.append(file_record)
                    print(
                        f"[INFO] Asistencia: NRC {nrc or 'SIN_NRC'} "
                        f"actividad '{label}' descargada en {file_record['relativePath']}"
                    )

                summary_row["status"] = "DOWNLOADED"
                results.append(summary_row)
            except Exception as exc:
                summary_row["status"] = "ERROR"
                summary_row["message"] = str(exc)
                print(
                    f"[ERROR] Asistencia: NRC {nrc or 'SIN_NRC'} fallo: {summary_row['message']}"
                )
                results.append(summary_row)

        summary = {
            "kind": "attendance",
            "startedAt": started_at,
            "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "outputDir": to_relative_path(output_dir),
            "totalCourses": len(input_rows),
            "completedCourses": sum(1 for item in results if item.get("status") == "DOWNLOADED"),
            "failedCourses": sum(1 for item in results if item.get("status") == "ERROR"),
            "skippedCourses": sum(1 for item in results if item.get("status") == "NO_ATTENDANCE"),
            "files": generated_files,
            "items": results,
        }
        write_summary(output_dir, summary)
        print(f"[INFO] Exportes de asistencia generados en {output_dir}")
        print(f"[INFO] Cursos procesados: {summary['totalCourses']}")
        print(f"[INFO] Descargas exitosas: {summary['completedCourses']}")
        print(f"[INFO] Errores: {summary['failedCourses']}")
        exit_code = 0 if summary["failedCourses"] == 0 else 1
    finally:
        if args.keep_open:
            print("[INFO] Navegador mantenido abierto por solicitud del usuario.")
        else:
            driver.quit()
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
