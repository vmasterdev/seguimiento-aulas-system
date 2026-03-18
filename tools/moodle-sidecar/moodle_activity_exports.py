import argparse
import time
from pathlib import Path
from typing import Dict, List
from urllib.parse import urlencode

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

from moodle_export_common import (
    create_download_driver,
    derive_base_url,
    derive_course_id,
    ensure_login,
    load_input_rows,
    move_download,
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
        element = WebDriverWait(driver, 8).until(EC.element_to_be_clickable((By.XPATH, xpath)))
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
        time.sleep(2)
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
        for row in input_rows:
            nrc = str(row.get("nrc") or "").strip()
            period_code = str(row.get("periodCode") or "").strip()
            title = str(row.get("title") or "").strip() or "SIN_TITULO"
            base_url = derive_base_url(row)
            course_id = derive_course_id(row)
            print(
                f"[INFO] Actividad: preparando NRC {nrc or 'SIN_NRC'} "
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
                print(
                    f"[ERROR] Actividad: NRC {nrc or 'SIN_NRC'} sin base URL o course ID resuelto."
                )
                results.append(summary_row)
                continue

            try:
                ensure_login(driver, base_url, row, headless=args.headless, login_wait_seconds=args.login_wait_seconds)
                driver.get(build_log_url(base_url, course_id))
                WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
                before_names = [item.name for item in download_dir.iterdir()] if download_dir.exists() else []
                click_download(driver)
                downloaded = wait_for_new_download(download_dir, before_names, (".csv", ".txt"), 180)
                if not downloaded:
                    raise RuntimeError("No se detecto descarga del reporte de actividad.")
                final_file = move_download(
                    downloaded,
                    files_dir / sanitize_file_token(period_code or "sin_periodo"),
                    f"{nrc}_{period_code}_actividad",
                )
                file_record = {
                    "kind": "activity",
                    "nrc": nrc,
                    "periodCode": period_code,
                    "title": title,
                    "fileName": final_file.name,
                    "relativePath": to_relative_path(final_file),
                }
                generated_files.append(file_record)
                cast_downloads = summary_row["downloads"]
                if isinstance(cast_downloads, list):
                    cast_downloads.append(file_record)
                summary_row["status"] = "DOWNLOADED"
                print(
                    f"[INFO] Actividad: NRC {nrc or 'SIN_NRC'} descargado en "
                    f"{file_record['relativePath']}"
                )
                results.append(summary_row)
            except Exception as exc:
                summary_row["status"] = "ERROR"
                summary_row["message"] = str(exc)
                print(
                    f"[ERROR] Actividad: NRC {nrc or 'SIN_NRC'} fallo: {summary_row['message']}"
                )
                results.append(summary_row)

        summary = {
            "kind": "activity",
            "startedAt": started_at,
            "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "outputDir": to_relative_path(output_dir),
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
    finally:
        if args.keep_open:
            print("[INFO] Navegador mantenido abierto por solicitud del usuario.")
        else:
            driver.quit()
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
