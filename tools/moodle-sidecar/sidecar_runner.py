#!/usr/bin/env python3
import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_config(root: Path) -> Dict:
    config_path = root / "storage" / "archive" / "system" / "moodle_sidecar.config.json"
    if not config_path.exists():
        raise SystemExit(f"No existe config sidecar: {config_path}")
    return json.loads(config_path.read_text(encoding="utf-8"))


def resolve(root: Path, rel: str) -> Path:
    return (root / rel).resolve()


def run_cmd(cmd: List[str], cwd: Path) -> int:
    print("[CMD]", " ".join(cmd))
    proc = subprocess.run(cmd, cwd=str(cwd))
    return proc.returncode


def classify(args, cfg: Dict, root: Path) -> int:
    runtime = cfg.get("runtime", {})
    paths = cfg.get("paths", {})
    sidecar_root = resolve(root, paths["sidecarRoot"])
    script = sidecar_root / "moodle_categorizacion_aulas.py"

    input_dir = resolve(root, args.input_dir or paths["rpacaInputDir"])
    output_xlsx = resolve(root, args.output or paths["classificationOutputXlsx"])

    output_xlsx.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        args.python or runtime.get("pythonCommand", "python3"),
        str(script),
        "--browser",
        args.browser or runtime.get("browser", "edge"),
        "--input-dir",
        str(input_dir),
        "--output",
        str(output_xlsx),
        "--workers",
        str(args.workers or runtime.get("workers", 3)),
    ]

    if args.headless or runtime.get("headless", False):
        cmd.append("--headless")

    use_resume = runtime.get("resume", True)
    if args.no_resume:
        use_resume = False
    if use_resume:
        cmd.append("--resume")
    else:
        cmd.append("--no-resume")

    if runtime.get("strictMode", True):
        cmd.append("--modo-estricto-modalidad")
    if getattr(args, "modalidades_permitidas", ""):
        cmd.extend(["--modalidades-permitidas", args.modalidades_permitidas])
    if runtime.get("nrc5SegunArchivo", True):
        cmd.append("--nrc-5-segun-archivo")
    if getattr(args, "prelogin_all_modalidades", False):
        cmd.append("--prelogin-all-modalidades")
    if getattr(args, "prelogin_modalidades", ""):
        cmd.extend(["--prelogin-modalidades", args.prelogin_modalidades])

    return run_cmd(cmd, sidecar_root)


def _read_rows(path: Path) -> List[Dict[str, str]]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    delimiter = ";" if text.splitlines() and text.splitlines()[0].count(";") >= text.splitlines()[0].count(",") else ","
    rows: List[Dict[str, str]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh, delimiter=delimiter)
        for row in reader:
            rows.append({k: ("" if v is None else str(v).strip()) for k, v in row.items()})
    return rows


def _resolve_latest_revalidate_csv(root: Path, paths: Dict, suffix: str) -> Path | None:
    configured_xlsx = resolve(root, paths["classificationOutputXlsx"])
    configured_csv = configured_xlsx.with_name(f"{configured_xlsx.stem}{suffix}")
    if configured_csv.exists():
        return configured_csv

    validation_dir = resolve(root, "storage/outputs/validation")
    if not validation_dir.exists():
        return None

    matches = sorted(
        (
            item
            for item in validation_dir.glob(f"*{suffix}")
            if "smoke" not in item.name.lower()
        ),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    return matches[0] if matches else None


def revalidate(args, cfg: Dict, root: Path) -> int:
    runtime = cfg.get("runtime", {})
    paths = cfg.get("paths", {})
    sidecar_root = resolve(root, paths["sidecarRoot"])

    if args.input_dir:
        tmp_dir = resolve(root, args.input_dir)
        if not tmp_dir.exists():
            raise SystemExit(f"No existe directorio para revalidar: {tmp_dir}")
        csv_files = list(tmp_dir.glob("*.csv"))
        if not csv_files:
            raise SystemExit(f"No se encontraron CSV para revalidar en {tmp_dir}")
        out_xlsx = resolve(root, args.output) if args.output else tmp_dir / "REVALIDACION_PENDIENTES_RESULTADO.xlsx"
        print(f"[INFO] Revalidacion desde lote BD: {tmp_dir}")
        print(f"[INFO] Revalidacion output: {out_xlsx}")
    else:
        sinm_csv = _resolve_latest_revalidate_csv(root, paths, "_SIN_MATRICULA.csv")
        vacias_csv = _resolve_latest_revalidate_csv(root, paths, "_AULAS_VACIAS.csv")

        if not sinm_csv and not vacias_csv:
            raise SystemExit("No existen archivos para revalidar: SIN_MATRICULA / AULAS_VACIAS")

        mode = args.mode
        sources: List[Path] = []
        if mode in ("sin_matricula", "ambos") and sinm_csv:
            sources.append(sinm_csv)
        if mode in ("aulas_vacias", "ambos") and vacias_csv:
            sources.append(vacias_csv)

        if not sources:
            raise SystemExit(f"Modo {mode} sin fuentes disponibles")

        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        tmp_dir = resolve(root, "storage/outputs/validation") / f"_sidecar_revalidate_{stamp}"
        tmp_dir.mkdir(parents=True, exist_ok=True)

        out_input = tmp_dir / "input_revalidate.csv"
        written = 0
        seen = set()
        with out_input.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=["PERIODO", "NRC", "TITULO", "METODO_EDUCATIVO"], delimiter=";")
            writer.writeheader()
            for src in sources:
                for row in _read_rows(src):
                    nrc = str(row.get("NRC", "")).strip()
                    periodos = str(row.get("PERIODOS", "") or row.get("PERIODO", "")).strip()
                    titulo = str(row.get("TITULO_FUENTE", "") or row.get("TITULO", "")).strip()
                    metodo = str(row.get("METODOS", "") or row.get("METODO_EDUCATIVO", "")).strip()
                    if not nrc:
                        continue
                    periods = [p.strip() for p in periodos.replace("|", ",").split(",") if p.strip()] or [""]
                    for per in periods:
                        key = (per, nrc)
                        if key in seen:
                            continue
                        seen.add(key)
                        writer.writerow({"PERIODO": per, "NRC": nrc, "TITULO": titulo, "METODO_EDUCATIVO": metodo})
                        written += 1

        if written == 0:
            raise SystemExit("No se generaron filas para revalidacion")

        out_xlsx = resolve(root, args.output) if args.output else tmp_dir / "REVALIDACION_PENDIENTES_RESULTADO.xlsx"
        if sinm_csv:
            print(f"[INFO] Fuente SIN_MATRICULA: {sinm_csv}")
        if vacias_csv:
            print(f"[INFO] Fuente AULAS_VACIAS: {vacias_csv}")
        print(f"[INFO] Revalidacion input: {out_input}")
        print(f"[INFO] Revalidacion output: {out_xlsx}")

    cmd = [
        args.python or runtime.get("pythonCommand", "python3"),
        str(sidecar_root / "moodle_categorizacion_aulas.py"),
        "--browser",
        args.browser or runtime.get("browser", "edge"),
        "--input-dir",
        str(tmp_dir),
        "--output",
        str(out_xlsx),
        "--workers",
        str(args.workers or runtime.get("workers", 3)),
        "--no-resume",
        "--modo-estricto-modalidad",
        "--nrc-5-segun-archivo",
    ]
    if args.headless or runtime.get("headless", False):
        cmd.append("--headless")
    return run_cmd(cmd, sidecar_root)


def backups(args, cfg: Dict, root: Path) -> int:
    runtime = cfg.get("runtime", {})
    paths = cfg.get("paths", {})
    sidecar_root = resolve(root, paths["sidecarRoot"])
    nrc_csv = resolve(root, args.nrc_csv or paths["nrcsBackupCsv"])
    target = sidecar_root / "nrcs.csv"

    if not nrc_csv.exists():
        raise SystemExit(f"No existe CSV NRC backups: {nrc_csv}")

    if nrc_csv.resolve() != target.resolve():
        target.write_text(nrc_csv.read_text(encoding="utf-8"), encoding="utf-8")

    cmd = [args.python or runtime.get("pythonCommand", "python3"), str(sidecar_root / "moodle_backups.py")]
    if args.nrc_csv:
        cmd.extend(["--nrc-csv", str(nrc_csv)])
    if args.login_wait_seconds:
        cmd.extend(["--login-wait-seconds", str(args.login_wait_seconds)])
    elif runtime.get("backupLoginWaitSeconds"):
        cmd.extend(["--login-wait-seconds", str(runtime.get("backupLoginWaitSeconds"))])
    if args.backup_timeout:
        cmd.extend(["--backup-timeout", str(args.backup_timeout)])
    elif runtime.get("backupTimeoutSeconds"):
        cmd.extend(["--backup-timeout", str(runtime.get("backupTimeoutSeconds"))])
    if args.keep_open:
        cmd.append("--keep-open")
    return run_cmd(cmd, sidecar_root)


def gui(args, cfg: Dict, root: Path) -> int:
    runtime = cfg.get("runtime", {})
    paths = cfg.get("paths", {})
    sidecar_root = resolve(root, paths["sidecarRoot"])
    cmd = [args.python or runtime.get("pythonCommand", "python3"), str(sidecar_root / "moodle_categorizacion_gui.py")]
    return run_cmd(cmd, sidecar_root)


def attendance(args, cfg: Dict, root: Path) -> int:
    runtime = cfg.get("runtime", {})
    paths = cfg.get("paths", {})
    sidecar_root = resolve(root, paths["sidecarRoot"])
    output_dir = resolve(root, args.output_dir or "storage/outputs/validation/moodle-attendance")

    cmd = [
        args.python or runtime.get("pythonCommand", "python3"),
        str(sidecar_root / "moodle_attendance_exports.py"),
        "--input-json",
        str(resolve(root, args.input_json)),
        "--output-dir",
        str(output_dir),
        "--browser",
        args.browser or runtime.get("browser", "edge"),
    ]
    if args.headless or runtime.get("headless", False):
        cmd.append("--headless")
    if args.login_wait_seconds:
        cmd.extend(["--login-wait-seconds", str(args.login_wait_seconds)])
    if args.keep_open:
        cmd.append("--keep-open")
    return run_cmd(cmd, sidecar_root)


def activity(args, cfg: Dict, root: Path) -> int:
    runtime = cfg.get("runtime", {})
    paths = cfg.get("paths", {})
    sidecar_root = resolve(root, paths["sidecarRoot"])
    output_dir = resolve(root, args.output_dir or "storage/outputs/validation/moodle-activity")

    cmd = [
        args.python or runtime.get("pythonCommand", "python3"),
        str(sidecar_root / "moodle_activity_exports.py"),
        "--input-json",
        str(resolve(root, args.input_json)),
        "--output-dir",
        str(output_dir),
        "--browser",
        args.browser or runtime.get("browser", "edge"),
    ]
    if args.headless or runtime.get("headless", False):
        cmd.append("--headless")
    if args.login_wait_seconds:
        cmd.extend(["--login-wait-seconds", str(args.login_wait_seconds)])
    if args.keep_open:
        cmd.append("--keep-open")
    if getattr(args, "workers", None) and args.workers > 1:
        cmd.extend(["--workers", str(args.workers)])
    return run_cmd(cmd, sidecar_root)


def participants(args, cfg: Dict, root: Path) -> int:
    runtime = cfg.get("runtime", {})
    paths = cfg.get("paths", {})
    sidecar_root = resolve(root, paths["sidecarRoot"])
    output_dir = resolve(root, args.output_dir or "storage/outputs/validation/moodle-participants")

    cmd = [
        args.python or runtime.get("pythonCommand", "python3"),
        str(sidecar_root / "moodle_participants_exports.py"),
        "--input-json",
        str(resolve(root, args.input_json)),
        "--output-dir",
        str(output_dir),
        "--browser",
        args.browser or runtime.get("browser", "edge"),
    ]
    if args.headless or runtime.get("headless", False):
        cmd.append("--headless")
    if args.login_wait_seconds:
        cmd.extend(["--login-wait-seconds", str(args.login_wait_seconds)])
    if args.keep_open:
        cmd.append("--keep-open")
    return run_cmd(cmd, sidecar_root)


def main() -> int:
    root = project_root()
    cfg = load_config(root)

    parser = argparse.ArgumentParser(description="Runner sidecar Moodle para seguimiento-aulas-system")
    sub = parser.add_subparsers(dest="command", required=True)

    p_classify = sub.add_parser("classify", help="Ejecuta categorizacion visual")
    p_classify.add_argument("--input-dir", dest="input_dir")
    p_classify.add_argument("--output")
    p_classify.add_argument("--workers", type=int)
    p_classify.add_argument("--browser")
    p_classify.add_argument("--python")
    p_classify.add_argument("--headless", action="store_true")
    p_classify.add_argument("--no-resume", action="store_true")
    p_classify.add_argument("--prelogin-all-modalidades", action="store_true")
    p_classify.add_argument("--prelogin-modalidades", default="")
    p_classify.add_argument("--modalidades-permitidas", default="")

    p_revalidate = sub.add_parser("revalidate", help="Revalida pendientes SIN_MATRICULA/AULAS_VACIAS")
    p_revalidate.add_argument("--mode", choices=["sin_matricula", "aulas_vacias", "ambos"], default="ambos")
    p_revalidate.add_argument("--input-dir", dest="input_dir")
    p_revalidate.add_argument("--output")
    p_revalidate.add_argument("--workers", type=int)
    p_revalidate.add_argument("--browser")
    p_revalidate.add_argument("--python")
    p_revalidate.add_argument("--headless", action="store_true")

    p_backup = sub.add_parser("backup", help="Ejecuta flujo de backups .mbz")
    p_backup.add_argument("--nrc-csv")
    p_backup.add_argument("--python")
    p_backup.add_argument("--login-wait-seconds", type=int)
    p_backup.add_argument("--backup-timeout", type=int)
    p_backup.add_argument("--keep-open", action="store_true")

    p_gui = sub.add_parser("gui", help="Abre GUI sidecar")
    p_gui.add_argument("--python")

    p_attendance = sub.add_parser("attendance", help="Descarga exportes del modulo Asistencia")
    p_attendance.add_argument("--input-json", required=True)
    p_attendance.add_argument("--output-dir")
    p_attendance.add_argument("--browser")
    p_attendance.add_argument("--python")
    p_attendance.add_argument("--headless", action="store_true")
    p_attendance.add_argument("--login-wait-seconds", type=int)
    p_attendance.add_argument("--keep-open", action="store_true")

    p_activity = sub.add_parser("activity", help="Descarga exportes del reporte de actividad/logs")
    p_activity.add_argument("--input-json", required=True)
    p_activity.add_argument("--output-dir")
    p_activity.add_argument("--browser")
    p_activity.add_argument("--python")
    p_activity.add_argument("--headless", action="store_true")
    p_activity.add_argument("--login-wait-seconds", type=int)
    p_activity.add_argument("--keep-open", action="store_true")
    p_activity.add_argument("--workers", type=int)

    p_participants = sub.add_parser("participants", help="Extrae participantes y roles visibles del curso")
    p_participants.add_argument("--input-json", required=True)
    p_participants.add_argument("--output-dir")
    p_participants.add_argument("--browser")
    p_participants.add_argument("--python")
    p_participants.add_argument("--headless", action="store_true")
    p_participants.add_argument("--login-wait-seconds", type=int)
    p_participants.add_argument("--keep-open", action="store_true")

    args = parser.parse_args()

    if args.command == "classify":
        return classify(args, cfg, root)
    if args.command == "revalidate":
        return revalidate(args, cfg, root)
    if args.command == "backup":
        return backups(args, cfg, root)
    if args.command == "attendance":
        return attendance(args, cfg, root)
    if args.command == "activity":
        return activity(args, cfg, root)
    if args.command == "participants":
        return participants(args, cfg, root)
    if args.command == "gui":
        return gui(args, cfg, root)

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
