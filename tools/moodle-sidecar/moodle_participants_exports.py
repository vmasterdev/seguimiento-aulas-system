import argparse
import csv
import json
import re
import time
from pathlib import Path
from typing import Dict, List, Optional
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
    prelogin_all_modalidades,
    sanitize_file_token,
    to_relative_path,
    write_summary,
)


def parse_args():
    parser = argparse.ArgumentParser(description="Extrae participantes y roles visibles del curso Moodle.")
    parser.add_argument("--input-json", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--browser", default="chrome")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--login-wait-seconds", type=int, default=300)
    parser.add_argument("--keep-open", action="store_true")
    return parser.parse_args()


def build_participants_url(base_url: str, course_id: str) -> str:
    query = urlencode({"id": course_id, "perpage": 5000})
    return f"{base_url}/user/index.php?{query}"


def normalize_header(value: str) -> str:
    text = (value or "").strip().lower()
    text = re.sub(r"\s+", " ", text)
    return text


def find_column_index(headers: List[str], patterns: List[str]) -> Optional[int]:
    normalized = [normalize_header(item) for item in headers]
    for idx, header in enumerate(normalized):
        if any(pattern in header for pattern in patterns):
            return idx
    return None


def parse_user_id(value: Optional[str]) -> Optional[str]:
    href = str(value or "").strip()
    match = re.search(r"[?&]id=(\d+)", href)
    return match.group(1) if match else None


def maybe_expand_per_page(driver) -> None:
    selectors = [
        (By.NAME, "perpage"),
        (By.ID, "id_perpage"),
        (By.CSS_SELECTOR, "select[name*='perpage']"),
    ]
    for by, selector in selectors:
        try:
            select = Select(driver.find_element(by, selector))
            best_value = None
            best_score = -1
            for option in select.options:
                text = (option.text or "").strip()
                value = (option.get_attribute("value") or "").strip()
                score_candidates = [int(token) for token in re.findall(r"\d+", f"{text} {value}")]
                score = max(score_candidates) if score_candidates else -1
                if score > best_score:
                    best_score = score
                    best_value = option.get_attribute("value")
            if best_value and best_score > 0:
                current = select.first_selected_option.get_attribute("value")
                if current != best_value:
                    select.select_by_value(best_value)
                    time.sleep(2)
            return
        except Exception:
            continue


def extract_table_payload(driver) -> Dict[str, object]:
    script = """
const tableToPayload = (table) => {
  const headers = Array.from(table.querySelectorAll('thead th, thead td'))
    .map((cell) => (cell.innerText || '').trim())
    .filter((value) => value);
  const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) => {
    const cells = Array.from(tr.querySelectorAll('th, td'));
    return {
      cells: cells.map((cell) => (cell.innerText || '').replace(/\\s+/g, ' ').trim()),
      links: cells.map((cell) => {
        const anchor = cell.querySelector('a[href]');
        return anchor ? anchor.href : '';
      }),
    };
  }).filter((row) => row.cells.some((value) => value));
  return { headers, rows };
};

const tables = Array.from(document.querySelectorAll('table'))
  .map(tableToPayload)
  .filter((item) => item.rows.length);

if (!tables.length) {
  return { headers: [], rows: [] };
}

tables.sort((left, right) => right.rows.length - left.rows.length);
return tables[0];
"""
    payload = driver.execute_script(script)
    if not isinstance(payload, dict):
        return {"headers": [], "rows": []}
    return payload


def scrape_participants(driver, base_url: str, course_id: str) -> Dict[str, object]:
    target_url = build_participants_url(base_url, course_id)
    driver.get(target_url)
    WebDriverWait(driver, 30).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
    maybe_expand_per_page(driver)
    time.sleep(2)

    payload = extract_table_payload(driver)
    headers = [str(item).strip() for item in payload.get("headers", []) if str(item).strip()]
    rows = payload.get("rows", [])
    if not isinstance(rows, list):
        rows = []

    name_idx = find_column_index(headers, ["nombre", "fullname", "nombre completo", "participant", "usuario"])
    email_idx = find_column_index(headers, ["correo", "email"])
    roles_idx = find_column_index(headers, ["rol", "roles", "role"])
    groups_idx = find_column_index(headers, ["grupo", "groups", "cohort"])
    last_access_idx = find_column_index(headers, ["ultimo acceso", "last access", "último acceso"])
    status_idx = find_column_index(headers, ["estado", "status"])
    id_idx = find_column_index(headers, ["id de estudiante", "número de id", "numero de id", "student id", "id"])

    participants: List[Dict[str, object]] = []
    role_counts: Dict[str, int] = {}

    for raw_row in rows:
        if not isinstance(raw_row, dict):
            continue
        cells = [str(item).strip() for item in raw_row.get("cells", []) if item is not None]
        links = [str(item).strip() for item in raw_row.get("links", []) if item is not None]
        if not cells:
            continue

        full_name = cells[name_idx] if name_idx is not None and name_idx < len(cells) else cells[0]
        email = cells[email_idx] if email_idx is not None and email_idx < len(cells) else None
        roles_label = cells[roles_idx] if roles_idx is not None and roles_idx < len(cells) else None
        groups_label = cells[groups_idx] if groups_idx is not None and groups_idx < len(cells) else None
        last_access_label = cells[last_access_idx] if last_access_idx is not None and last_access_idx < len(cells) else None
        status_label = cells[status_idx] if status_idx is not None and status_idx < len(cells) else None
        institutional_id = cells[id_idx] if id_idx is not None and id_idx < len(cells) else None
        moodle_user_id = parse_user_id(links[name_idx] if name_idx is not None and name_idx < len(links) else (links[0] if links else ""))
        roles = [
            item.strip()
            for item in re.split(r"[\n,;/]+", roles_label or "")
            if item and item.strip()
        ]

        for role in roles:
            role_counts[role] = (role_counts.get(role) or 0) + 1

        participants.append(
            {
                "fullName": full_name,
                "email": email or None,
                "moodleUserId": moodle_user_id,
                "institutionalId": institutional_id or None,
                "rolesLabel": roles_label or None,
                "roles": roles,
                "groupsLabel": groups_label or None,
                "lastAccessLabel": last_access_label or None,
                "statusLabel": status_label or None,
                "rawCells": cells,
                "headers": headers,
            }
        )

    page_title = driver.title or ""
    return {
        "pageUrl": driver.current_url,
        "pageTitle": page_title.strip() or None,
        "headers": headers,
        "participants": participants,
        "totalParticipants": len(participants),
        "roleCounts": role_counts,
    }


def write_csv(path_value: Path, participants: List[Dict[str, object]]) -> None:
    path_value.parent.mkdir(parents=True, exist_ok=True)
    with path_value.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "fullName",
                "email",
                "moodleUserId",
                "institutionalId",
                "rolesLabel",
                "roles",
                "groupsLabel",
                "lastAccessLabel",
                "statusLabel",
            ],
        )
        writer.writeheader()
        for participant in participants:
            writer.writerow(
                {
                    "fullName": participant.get("fullName") or "",
                    "email": participant.get("email") or "",
                    "moodleUserId": participant.get("moodleUserId") or "",
                    "institutionalId": participant.get("institutionalId") or "",
                    "rolesLabel": participant.get("rolesLabel") or "",
                    "roles": " | ".join(participant.get("roles") or []),
                    "groupsLabel": participant.get("groupsLabel") or "",
                    "lastAccessLabel": participant.get("lastAccessLabel") or "",
                    "statusLabel": participant.get("statusLabel") or "",
                }
            )


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
            base_url = derive_base_url(row)
            course_id = derive_course_id(row)
            print(
                f"[INFO] Participantes: preparando NRC {nrc or 'SIN_NRC'} "
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
                print(f"[ERROR] Participantes: NRC {nrc or 'SIN_NRC'} sin base URL o course ID resuelto.")
                results.append(summary_row)
                continue

            try:
                ensure_login(driver, base_url, row, headless=args.headless, login_wait_seconds=args.login_wait_seconds)
                payload = scrape_participants(driver, base_url, course_id)
                participants = payload.get("participants") if isinstance(payload.get("participants"), list) else []

                base_name = f"{nrc}_{period_code}_participantes"
                target_dir = files_dir / sanitize_file_token(period_code or "sin_periodo") / sanitize_file_token(nrc or "sin_nrc")
                json_path = target_dir / f"{sanitize_file_token(base_name)}.json"
                csv_path = target_dir / f"{sanitize_file_token(base_name)}.csv"
                target_dir.mkdir(parents=True, exist_ok=True)

                export_payload = {
                    "kind": "participants",
                    "courseId": row.get("courseId"),
                    "nrc": nrc,
                    "periodCode": period_code,
                    "title": title,
                    **payload,
                }
                json_path.write_text(json.dumps(export_payload, ensure_ascii=False, indent=2), encoding="utf-8")
                write_csv(csv_path, participants)

                file_record = {
                    "kind": "participants",
                    "nrc": nrc,
                    "periodCode": period_code,
                    "title": title,
                    "fileName": json_path.name,
                    "relativePath": to_relative_path(json_path),
                    "csvRelativePath": to_relative_path(csv_path),
                    "participants": len(participants),
                }
                generated_files.append(file_record)
                downloads = summary_row["downloads"]
                if isinstance(downloads, list):
                    downloads.append(file_record)
                summary_row["status"] = "DOWNLOADED"
                summary_row["participants"] = len(participants)
                print(
                    f"[INFO] Participantes: NRC {nrc or 'SIN_NRC'} "
                    f"extraido con {len(participants)} registros en {file_record['relativePath']}"
                )
                results.append(summary_row)
            except Exception as exc:
                summary_row["status"] = "ERROR"
                summary_row["message"] = str(exc)
                print(
                    f"[ERROR] Participantes: NRC {nrc or 'SIN_NRC'} fallo: {summary_row['message']}"
                )
                results.append(summary_row)

        summary = {
            "kind": "participants",
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
        print(f"[INFO] Exportes de participantes generados en {output_dir}")
        print(f"[INFO] Cursos procesados: {summary['totalCourses']}")
        print(f"[INFO] Extracciones exitosas: {summary['completedCourses']}")
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
