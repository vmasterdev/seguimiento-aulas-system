#!/usr/bin/env python3
import csv
import os
import queue
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk


class CategorizacionGUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Categorizacion de Aulas Moodle")
        self.root.geometry("1040x700")
        self.root.minsize(900, 560)

        self.base_dir = Path(__file__).resolve().parent
        self.script_path = self.base_dir / "moodle_categorizacion_aulas.py"

        default_input = self.base_dir / "1.2 CATEGORIZACION" / "2026 S1"
        default_output = default_input / "RESULTADO_TIPOS_AULA_DESDE_MOODLE.xlsx"

        self.input_dir_var = tk.StringVar(value=str(default_input))
        self.output_file_var = tk.StringVar(value=str(default_output))
        self.browser_var = tk.StringVar(value="edge")
        self.periodos_var = tk.StringVar(value="202615")
        self.workers_var = tk.StringVar(value="2")
        self.resume_var = tk.BooleanVar(value=True)
        self.headless_var = tk.BooleanVar(value=True)
        self.review_mode_var = tk.StringVar(value="Todo")
        self.status_var = tk.StringVar(value="Listo para iniciar")
        self.review_modes = {
            "Todo": "todo",
            "Solo SIN_MATRICULA": "sin_matricula",
            "Solo AULAS_VACIAS": "aulas_vacias",
            "SIN_MATRICULA + AULAS_VACIAS": "sinm_y_vacias",
        }

        self.process: subprocess.Popen | None = None
        self.log_queue: queue.Queue = queue.Queue()
        self.reader_thread: threading.Thread | None = None

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self) -> None:
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        config_frame = ttk.LabelFrame(self.root, text="Configuracion")
        config_frame.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 8))
        config_frame.columnconfigure(1, weight=1)
        config_frame.columnconfigure(3, weight=1)

        ttk.Label(config_frame, text="Directorio CSV").grid(row=0, column=0, sticky="w", padx=8, pady=8)
        ttk.Entry(config_frame, textvariable=self.input_dir_var).grid(
            row=0, column=1, columnspan=2, sticky="ew", padx=8, pady=8
        )
        ttk.Button(config_frame, text="Examinar", command=self._browse_input_dir).grid(
            row=0, column=3, sticky="ew", padx=8, pady=8
        )

        ttk.Label(config_frame, text="Excel salida").grid(row=1, column=0, sticky="w", padx=8, pady=8)
        ttk.Entry(config_frame, textvariable=self.output_file_var).grid(
            row=1, column=1, columnspan=2, sticky="ew", padx=8, pady=8
        )
        ttk.Button(config_frame, text="Examinar", command=self._browse_output_file).grid(
            row=1, column=3, sticky="ew", padx=8, pady=8
        )

        ttk.Label(config_frame, text="Navegador").grid(row=2, column=0, sticky="w", padx=8, pady=8)
        browser_combo = ttk.Combobox(
            config_frame,
            textvariable=self.browser_var,
            values=["edge", "chrome"],
            state="readonly",
            width=14,
        )
        browser_combo.grid(row=2, column=1, sticky="w", padx=8, pady=8)

        ttk.Label(config_frame, text="Prioridad periodos").grid(row=2, column=2, sticky="e", padx=8, pady=8)
        ttk.Entry(config_frame, textvariable=self.periodos_var).grid(row=2, column=3, sticky="ew", padx=8, pady=8)

        ttk.Label(config_frame, text="Workers").grid(row=3, column=0, sticky="w", padx=8, pady=8)
        ttk.Spinbox(
            config_frame,
            from_=1,
            to=8,
            textvariable=self.workers_var,
            width=8,
        ).grid(row=3, column=1, sticky="w", padx=8, pady=8)

        ttk.Checkbutton(
            config_frame,
            text="Ejecutar oculto (headless, sin ventana de navegador)",
            variable=self.headless_var,
        ).grid(row=3, column=2, columnspan=2, sticky="w", padx=8, pady=(0, 8))

        ttk.Checkbutton(
            config_frame,
            text="Reanudar desde checkpoint (resume)",
            variable=self.resume_var,
        ).grid(row=4, column=1, columnspan=3, sticky="w", padx=8, pady=(0, 8))

        ttk.Label(config_frame, text="Modo revision").grid(row=5, column=0, sticky="w", padx=8, pady=8)
        ttk.Combobox(
            config_frame,
            textvariable=self.review_mode_var,
            values=list(self.review_modes.keys()),
            state="readonly",
        ).grid(row=5, column=1, columnspan=3, sticky="ew", padx=8, pady=8)

        actions_frame = ttk.Frame(self.root)
        actions_frame.grid(row=2, column=0, sticky="ew", padx=12, pady=6)
        actions_frame.columnconfigure(4, weight=1)

        self.start_button = ttk.Button(actions_frame, text="Iniciar", command=self._start_process)
        self.start_button.grid(row=0, column=0, padx=(0, 8))

        self.stop_button = ttk.Button(actions_frame, text="Detener", command=self._stop_process, state="disabled")
        self.stop_button.grid(row=0, column=1, padx=(0, 8))

        ttk.Button(actions_frame, text="Abrir carpeta salida", command=self._open_output_folder).grid(
            row=0, column=2, padx=(0, 8)
        )

        ttk.Button(actions_frame, text="Limpiar log", command=self._clear_log).grid(row=0, column=3, padx=(0, 8))

        ttk.Label(actions_frame, textvariable=self.status_var).grid(row=0, column=4, sticky="e")

        log_frame = ttk.LabelFrame(self.root, text="Log de ejecucion")
        log_frame.grid(row=1, column=0, sticky="nsew", padx=12, pady=8)
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)

        self.log_text = tk.Text(log_frame, wrap="word", state="disabled")
        self.log_text.grid(row=0, column=0, sticky="nsew")

        log_scroll = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_text.yview)
        log_scroll.grid(row=0, column=1, sticky="ns")
        self.log_text.configure(yscrollcommand=log_scroll.set)

    def _browse_input_dir(self) -> None:
        selected = filedialog.askdirectory(
            title="Selecciona directorio con CSV",
            initialdir=self.input_dir_var.get() or str(self.base_dir),
            mustexist=True,
        )
        if not selected:
            return
        self.input_dir_var.set(selected)
        default_output = Path(selected) / "RESULTADO_TIPOS_AULA_DESDE_MOODLE.xlsx"
        self.output_file_var.set(str(default_output))

    def _browse_output_file(self) -> None:
        selected = filedialog.asksaveasfilename(
            title="Guardar Excel de salida",
            initialdir=str(Path(self.output_file_var.get()).parent),
            initialfile=Path(self.output_file_var.get()).name,
            defaultextension=".xlsx",
            filetypes=[("Excel", "*.xlsx")],
        )
        if selected:
            self.output_file_var.set(selected)

    def _append_log(self, text: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", text)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _clear_log(self) -> None:
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")

    def _validate_inputs(self) -> tuple[bool, str]:
        if not self.script_path.exists():
            return False, f"No se encontro el script: {self.script_path}"

        input_dir = Path(self.input_dir_var.get().strip())
        if not input_dir.exists():
            return False, f"El directorio de entrada no existe: {input_dir}"
        if not input_dir.is_dir():
            return False, f"La ruta de entrada no es un directorio: {input_dir}"

        output_file = Path(self.output_file_var.get().strip())
        if output_file.suffix.lower() != ".xlsx":
            return False, "El archivo de salida debe terminar en .xlsx"
        if not output_file.parent.exists():
            return False, f"La carpeta de salida no existe: {output_file.parent}"

        workers_txt = self.workers_var.get().strip()
        if not workers_txt.isdigit():
            return False, "Workers debe ser un numero entero entre 1 y 8."
        workers = int(workers_txt)
        if workers < 1 or workers > 8:
            return False, "Workers debe estar entre 1 y 8."

        mode = self._selected_review_mode()
        if mode != "todo":
            output_file = Path(self.output_file_var.get().strip())
            report_paths = self._derive_report_paths(output_file)
            if mode in ("sin_matricula", "sinm_y_vacias") and not report_paths["sin_matricula_csv"].exists():
                return (
                    False,
                    "No existe el archivo de SIN_MATRICULA para revalidar:\n"
                    f"{report_paths['sin_matricula_csv']}",
                )
            if mode in ("aulas_vacias", "sinm_y_vacias") and not report_paths["aulas_vacias_csv"].exists():
                return (
                    False,
                    "No existe el archivo de AULAS_VACIAS para revalidar:\n"
                    f"{report_paths['aulas_vacias_csv']}",
                )

        return True, ""

    def _build_command(
        self,
        input_dir_override: str | None = None,
        output_override: str | None = None,
        force_no_resume: bool = False,
    ) -> list[str]:
        input_dir = input_dir_override or self.input_dir_var.get().strip()
        output_file = output_override or self.output_file_var.get().strip()
        cmd = [
            sys.executable,
            "-u",
            str(self.script_path),
            "--browser",
            self.browser_var.get().strip(),
            "--input-dir",
            input_dir,
            "--output",
            output_file,
            "--prioridad-periodos",
            self.periodos_var.get().strip(),
            "--workers",
            self.workers_var.get().strip(),
        ]

        if self.headless_var.get():
            cmd.append("--headless")

        if force_no_resume:
            cmd.append("--no-resume")
        elif self.resume_var.get():
            cmd.append("--resume")
        else:
            cmd.append("--no-resume")
        return cmd

    def _set_running_ui(self, running: bool) -> None:
        self.start_button.configure(state="disabled" if running else "normal")
        self.stop_button.configure(state="normal" if running else "disabled")

    def _start_process(self) -> None:
        if self.process and self.process.poll() is None:
            messagebox.showwarning("Proceso en curso", "Ya hay una ejecucion activa.")
            return

        valid, error = self._validate_inputs()
        if not valid:
            messagebox.showerror("Validacion", error)
            return

        mode = self._selected_review_mode()
        cmd: list[str]
        if mode == "todo":
            cmd = self._build_command()
        else:
            out_file = Path(self.output_file_var.get().strip())
            try:
                temp_input_dir, nrc_count, row_count = self._build_review_input(mode, out_file)
            except Exception as exc:
                messagebox.showerror("Error preparando revalidacion", str(exc))
                return

            if nrc_count == 0:
                messagebox.showwarning(
                    "Sin NRC",
                    "No se encontraron NRC para el modo seleccionado.\n"
                    "Revisa los archivos de SIN_MATRICULA/AULAS_VACIAS.",
                )
                return

            ts = time.strftime("%Y%m%d_%H%M%S")
            mode_tag = mode.upper()
            review_output = out_file.with_name(f"{out_file.stem}_REVALIDACION_{mode_tag}_{ts}.xlsx")
            cmd = self._build_command(
                input_dir_override=str(temp_input_dir),
                output_override=str(review_output),
                force_no_resume=True,
            )
            self._append_log(
                "[GUI] Modo revalidacion activado:\n"
                f"      - Modo: {mode_tag}\n"
                f"      - NRC unicos: {nrc_count}\n"
                f"      - Filas base: {row_count}\n"
                f"      - Input temporal: {temp_input_dir}\n"
                f"      - Salida: {review_output}\n\n"
            )

        try:
            self.process = subprocess.Popen(
                cmd,
                cwd=str(self.base_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
        except Exception as exc:
            messagebox.showerror("Error al iniciar", str(exc))
            return

        self._set_running_ui(True)
        self.status_var.set("Ejecutando...")
        self._append_log("\n[GUI] Ejecutando comando:\n")
        self._append_log("      " + " ".join(shlex.quote(part) for part in cmd) + "\n\n")

        self.reader_thread = threading.Thread(target=self._reader_worker, daemon=True)
        self.reader_thread.start()
        self.root.after(100, self._poll_output)

    def _selected_review_mode(self) -> str:
        return self.review_modes.get(self.review_mode_var.get(), "todo")

    def _derive_report_paths(self, output_xlsx: Path) -> dict[str, Path]:
        return {
            "output_csv": output_xlsx.with_suffix(".csv"),
            "sin_matricula_csv": output_xlsx.with_name(f"{output_xlsx.stem}_SIN_MATRICULA.csv"),
            "aulas_vacias_csv": output_xlsx.with_name(f"{output_xlsx.stem}_AULAS_VACIAS.csv"),
        }

    def _split_values(self, raw: str) -> list[str]:
        return [part.strip() for part in (raw or "").split(",") if part and part.strip()]

    def _build_review_input(self, mode: str, output_xlsx: Path) -> tuple[Path, int, int]:
        report_paths = self._derive_report_paths(output_xlsx)

        selected_reports: list[Path] = []
        if mode in ("sin_matricula", "sinm_y_vacias"):
            selected_reports.append(report_paths["sin_matricula_csv"])
        if mode in ("aulas_vacias", "sinm_y_vacias"):
            selected_reports.append(report_paths["aulas_vacias_csv"])

        temp_dir = self.base_dir / "_GUI_REVALIDACION_TMP"
        if temp_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)

        rows: list[dict[str, str]] = []
        unique_nrc = set()

        for source_csv in selected_reports:
            with source_csv.open("r", encoding="utf-8-sig", newline="") as fh:
                reader = csv.DictReader(fh, delimiter=";")
                for row in reader:
                    nrc = (row.get("NRC") or "").strip()
                    if not nrc:
                        continue
                    titulo = (row.get("TITULO_FUENTE") or "").strip() or (row.get("NOMBRE_CURSO_MOODLE") or "").strip()
                    metodos = self._split_values(row.get("METODOS", ""))
                    metodo = metodos[0] if metodos else ""
                    periodos = self._split_values(row.get("PERIODOS", ""))
                    if not periodos:
                        periodos = [""]
                    for periodo in periodos:
                        rows.append(
                            {
                                "PERIODO": periodo,
                                "NRC": nrc,
                                "TITULO": titulo,
                                "METODO_EDUCATIVO": metodo,
                            }
                        )
                    unique_nrc.add(nrc)

        # Dedup para evitar filas repetidas al combinar SIN_MATRICULA + AULAS_VACIAS.
        dedup = []
        seen = set()
        for row in rows:
            key = (row["PERIODO"], row["NRC"], row["TITULO"], row["METODO_EDUCATIVO"])
            if key in seen:
                continue
            seen.add(key)
            dedup.append(row)

        input_csv = temp_dir / "revalidacion_gui.csv"
        with input_csv.open("w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.DictWriter(
                fh,
                fieldnames=["PERIODO", "NRC", "TITULO", "METODO_EDUCATIVO"],
                delimiter=";",
            )
            writer.writeheader()
            writer.writerows(dedup)

        return temp_dir, len(unique_nrc), len(dedup)

    def _reader_worker(self) -> None:
        if not self.process or self.process.stdout is None:
            self.log_queue.put(("done", -1))
            return

        for line in self.process.stdout:
            self.log_queue.put(("line", line))

        returncode = self.process.wait()
        self.log_queue.put(("done", returncode))

    def _poll_output(self) -> None:
        done = False
        returncode = None

        while True:
            try:
                kind, payload = self.log_queue.get_nowait()
            except queue.Empty:
                break

            if kind == "line":
                self._append_log(str(payload))
            elif kind == "done":
                done = True
                returncode = int(payload)

        if done:
            code = returncode if returncode is not None else -1
            self._append_log(f"\n[GUI] Proceso finalizado con codigo {code}\n")
            self.status_var.set("Finalizado" if code == 0 else f"Finalizado con error ({code})")
            self._set_running_ui(False)
            self.process = None
            self.reader_thread = None
            return

        self.root.after(200, self._poll_output)

    def _stop_process(self) -> None:
        if not self.process or self.process.poll() is not None:
            self.status_var.set("No hay proceso en ejecucion")
            self._set_running_ui(False)
            self.process = None
            return

        if not messagebox.askyesno("Detener proceso", "Quieres detener la ejecucion actual?"):
            return

        self.status_var.set("Deteniendo...")
        self._append_log("\n[GUI] Solicitando detencion...\n")

        try:
            if os.name != "nt":
                self.process.send_signal(signal.SIGINT)
            else:
                self.process.terminate()
        except Exception:
            pass

        self.root.after(4000, self._force_kill_if_needed)

    def _force_kill_if_needed(self) -> None:
        if not self.process or self.process.poll() is not None:
            return
        self._append_log("[GUI] Forzando cierre del proceso...\n")
        try:
            self.process.kill()
        except Exception:
            pass

    def _open_output_folder(self) -> None:
        folder = Path(self.output_file_var.get().strip()).parent
        if not folder.exists():
            messagebox.showerror("Carpeta no encontrada", f"No existe la carpeta: {folder}")
            return

        try:
            if os.name == "nt":
                os.startfile(str(folder))  # type: ignore[attr-defined]
            else:
                subprocess.Popen(["xdg-open", str(folder)])
        except Exception as exc:
            messagebox.showerror("No se pudo abrir carpeta", str(exc))

    def _on_close(self) -> None:
        if self.process and self.process.poll() is None:
            close_now = messagebox.askyesno(
                "Cerrar aplicacion",
                "Hay un proceso en ejecucion. Deseas detenerlo y cerrar?",
            )
            if not close_now:
                return
            try:
                if os.name != "nt":
                    self.process.send_signal(signal.SIGINT)
                else:
                    self.process.terminate()
            except Exception:
                pass
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    app = CategorizacionGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
