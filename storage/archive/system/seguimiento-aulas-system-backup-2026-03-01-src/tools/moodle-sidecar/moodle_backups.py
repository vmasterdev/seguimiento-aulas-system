import argparse
import csv
import os
import sys
import time
import shutil
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.edge.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# =========================
# CONFIGURACIÓN GENERAL
# =========================
# Tiempo máximo esperando que termine una copia de seguridad (segundos)
BACKUP_WAIT_TIMEOUT = 240  # antes eran 600 (10 minutos)

# Tiempo máximo para detectar sesión iniciada en login manual (segundos)
LOGIN_WAIT_SECONDS = 300

# Archivo CSV con columnas: NRC;PERIODO;NOMBRE CURSO;PROGRAMA (separado por ;)
NRC_CSV = "nrcs.csv"

# Carpeta de perfil para NO perder la sesión (se reutiliza para todas las modalidades)
PROFILE_DIR = str(Path.cwd() / "edge_profile_aulas_uniminuto")

# Carpeta base de descargas
DOWNLOAD_DIR = Path.home() / "Downloads" / "moodle_backups"

# Modalidades configuradas
MODALIDADES = {
    "presencial": {
        "nombre": "PRESENCIAL",
        "base_url": "https://presencial.aulasuniminuto.edu.co",
        "prefixes": ("60-",),
    },
    "posgrados": {
        "nombre": "POSGRADOS",
        "base_url": "https://posgrados.aulasuniminuto.edu.co",
        "prefixes": ("61-", "71-"),
    },
    "moocs": {
        "nombre": "MOOCs",
        "base_url": "https://moocs.aulasuniminuto.edu.co",
        "prefixes": ("62-", "86-"),
    },
    "distancia": {
        "nombre": "DISTANCIA",
        "base_url": "https://distancia.aulasuniminuto.edu.co",
        "prefixes": ("65-",),
    },
}


# =========================
# NAVEGADOR
# =========================

def create_driver(clean_profile: bool = False):
    """
    Crea el driver de Edge.
    Si clean_profile=True, borra el perfil de Selenium antes de abrir Chrome
    (útil cuando el perfil quedó corrupto y Chrome no arranca).
    """
    if clean_profile:
        try:
            if Path(PROFILE_DIR).exists():
                print("[INFO] Borrando perfil de Edge corrupto...")
                shutil.rmtree(PROFILE_DIR, ignore_errors=True)
        except Exception as e:
            print(f"[WARN] No se pudo borrar el perfil de Edge: {e}")

    options = Options()

    # Perfil persistente (recuerda las sesiones de Microsoft en los distintos dominios)
    options.add_argument(f"--user-data-dir={PROFILE_DIR}")

    # Directorio de descargas (para las .mbz de TODAS las modalidades)
    prefs = {
        "download.default_directory": str(DOWNLOAD_DIR),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
    }
    options.add_experimental_option("prefs", prefs)

    driver = webdriver.Edge(options=options)
    driver.maximize_window()
    return driver


# =========================
# LOGIN MANUAL (MICROSOFT) POR MODALIDAD
# =========================

def _host(url: str):
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def _normalize_base_host(base_url: str) -> str:
    return _host(base_url)


def url_indica_login(url: str) -> bool:
    u = (url or "").lower()
    return "/login/" in u or "login.microsoftonline.com" in u


def sesion_activa_en_modalidad(current_url: str, base_url: str) -> bool:
    if not current_url:
        return False
    base_host = _normalize_base_host(base_url)
    current_host = _host(current_url)
    if not base_host or current_host != base_host:
        return False
    return not url_indica_login(current_url)


def login_manual_microsoft(
    driver,
    base_url: str,
    nombre_modalidad: str,
    login_wait_seconds: int = LOGIN_WAIT_SECONDS,
):
    """
    Abre la página de login de la modalidad dada.
    El usuario hace todo el proceso de 'Iniciar sesión con Microsoft'
    (correo, contraseña, autenticador) y el script detecta automáticamente
    cuando la sesión quedó iniciada.
    """
    dashboard_url = f"{base_url}/my/"
    login_url = f"{base_url}/login/index.php"

    # Si ya hay sesión activa en esta modalidad, no pedir login.
    try:
        driver.get(dashboard_url)
        WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        current_url = driver.current_url or ""
        if sesion_activa_en_modalidad(current_url, base_url):
            print(f"[INFO] Sesión activa detectada en {nombre_modalidad}.")
            return
    except Exception:
        pass

    driver.get(login_url)
    time.sleep(1.0)

    # Algunos sitios redirigen automático si ya hay cookie válida
    current_url = driver.current_url or ""
    if sesion_activa_en_modalidad(current_url, base_url):
        print(f"[INFO] Sesión activa detectada en {nombre_modalidad} (redirigida).")
        return

    print(
        f"\n[LOGIN {nombre_modalidad}] Se abrió la página de inicio de sesión de {nombre_modalidad}.\n"
        "1) En la ventana del navegador, haz clic en 'Iniciar sesión con Microsoft' (o similar).\n"
        "2) Ingresa tu CORREO y CONTRASEÑA institucional.\n"
        "3) Completa el AUTENTICADOR (Microsoft Authenticator).\n"
        "4) Marca 'mantener la sesión iniciada' si aparece.\n"
        "5) Cuando ya estés en la página principal de esta modalidad "
        "(por ejemplo .../my/), el proceso continuará automáticamente.\n"
    )

    # Espera activa, sin depender de input() de consola.
    deadline = time.time() + max(30, int(login_wait_seconds))
    while time.time() < deadline:
        time.sleep(2.0)
        try:
            current_url = driver.current_url or ""
            if sesion_activa_en_modalidad(current_url, base_url):
                print(f"[INFO] Sesión iniciada en {nombre_modalidad}.")
                return
        except Exception:
            continue

    # Verificación final forzando dashboard
    try:
        driver.get(dashboard_url)
        time.sleep(1.0)
        current_url = driver.current_url or ""
        if sesion_activa_en_modalidad(current_url, base_url):
            print(f"[INFO] Sesión iniciada en {nombre_modalidad} (verificación final).")
            return
    except Exception:
        pass

    raise RuntimeError(
        f"No se detectó login completado en {nombre_modalidad} "
        f"después de {max(30, int(login_wait_seconds))} segundos."
    )


# =========================
# LECTURA DE CSV
# =========================

def leer_filas_desde_csv(ruta_csv: str):
    """
    Lee el archivo nrcs.csv (separado por ';') y devuelve una lista de dicts:
    Mantiene el ORDEN original del archivo.
    {
        "nrc": ...,
        "periodo": ...,
        "programa": ...,
        "nombre_curso_excel": ...
    }
    """
    filas = []
    with open(ruta_csv, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            nrc = (row.get("nrc") or row.get("NRC") or "").strip()
            if not nrc:
                continue
            periodo = (row.get("PERIODO") or row.get("Periodo") or "").strip()
            programa = (row.get("PROGRAMA") or row.get("Programa") or "").strip()
            nombre_curso_excel = (
                row.get("NOMBRE CURSO") or row.get("Nombre Curso") or ""
            ).strip()
            filas.append(
                {
                    "nrc": nrc,
                    "periodo": periodo,
                    "programa": programa,
                    "nombre_curso_excel": nombre_curso_excel,
                }
            )
    return filas


def detectar_modalidad_por_nrc(nrc: str):
    """
    Devuelve la clave de modalidad ('presencial', 'posgrados', etc.)
    según el prefijo del NRC. Si no coincide, devuelve None.
    """
    for clave_mod, cfg in MODALIDADES.items():
        if any(nrc.startswith(pref) for pref in cfg["prefixes"]):
            return clave_mod
    return None


def modalidades_presentes_en_csv(filas):
    """
    Devuelve un set con las modalidades que aparecen en el CSV.
    """
    presentes = set()
    for fila in filas:
        mod = detectar_modalidad_por_nrc(fila["nrc"])
        if mod:
            presentes.add(mod)
        else:
            print(f"[SKIP] NRC {fila['nrc']} no coincide con ninguna modalidad configurada.")
    return presentes


# =========================
# BÚSQUEDA E INGRESO AL CURSO
# =========================

def obtener_id_desde_href(href: str):
    """
    A partir de un href como:
      https://.../course/view.php?id=5217&section=0
    devuelve '5217'.
    """
    parsed = urlparse(href)
    qs = parse_qs(parsed.query)
    course_id = qs.get("id", [None])[0]
    return course_id


def ir_a_curso_por_nrc(driver, base_url: str, nrc: str):
    """
    Usa la URL:
      {base_url}/course/search.php?areaids=core_course-course&q=NRC
    hace clic en el nombre del curso y devuelve (course_id, nombre_curso_moodle).
    Si no encuentra nada, devuelve (None, None).
    """
    wait = WebDriverWait(driver, 20)

    search_url = f"{base_url}/course/search.php?areaids=core_course-course&q={nrc}"
    print(f"[INFO] Buscando curso para NRC {nrc}: {search_url}")
    driver.get(search_url)

    try:
        course_link = wait.until(
            EC.element_to_be_clickable(
                (By.XPATH, "//a[contains(@href, '/course/view.php?id=')]")
            )
        )
        href = course_link.get_attribute("href")
        course_id = obtener_id_desde_href(href)
        nombre_curso_moodle = course_link.text.strip()
        print(
            f"[OK] Resultado encontrado: '{nombre_curso_moodle}' (id={course_id}). Entrando al curso..."
        )
        course_link.click()
        return course_id, nombre_curso_moodle
    except Exception as e:
        print(f"[WARN] No se encontró curso para el NRC {nrc}. Detalle: {e}")
        return None, None


# =========================
# IR A LA PÁGINA DE BACKUP
# =========================

def ir_a_pagina_backup(driver, base_url: str, course_id: str):
    """
    Abre directamente la página de creación de copia de seguridad:
      {base_url}/backup/backup.php?id=COURSE_ID
    """
    if not course_id:
        print("[ERROR] No se recibió course_id para ir a la página de backup.")
        return

    backup_url = f"{base_url}/backup/backup.php?id={course_id}"
    print(f"[INFO] Abriendo página de copia de seguridad: {backup_url}")
    driver.get(backup_url)
    time.sleep(2)


# =========================
# SALTAR AL ÚLTIMO PASO
# =========================

def saltar_al_ultimo_paso(driver):
    """
    En la página de copia de seguridad, hace clic en el botón azul
    'Saltar al último paso'.
    """
    wait = WebDriverWait(driver, 30)
    try:
        boton_saltar = wait.until(
            EC.element_to_be_clickable(
                (
                    By.XPATH,
                    "//button[contains(., 'Saltar al último paso')]"
                    " | //input[@value='Saltar al último paso']",
                )
            )
        )
        print("[INFO] Haciendo clic en 'Saltar al último paso'...")
        boton_saltar.click()
        time.sleep(3)
        print("[OK] Se hizo clic en 'Saltar al último paso'.")
    except Exception as e:
        print(
            "[WARN] No se pudo hacer clic en 'Saltar al último paso'. "
            "Revisa el texto del botón o el XPATH si es necesario."
        )
        print(e)


# =========================
# ESPERAR COPIA + CLIC EN CONTINUAR
# =========================

def esperar_copia_y_continuar(driver) -> bool:
    """
    Espera a que la copia termine.
    Devuelve:
      True  -> si aparece el mensaje de éxito.
      False -> si aparece mensaje de error o si hay timeout.
    Siempre intenta hacer clic en 'Continuar' (éxito o error).
    """
    # Usamos la constante configurable; si no existe, usamos 240 por defecto
    timeout = globals().get("BACKUP_WAIT_TIMEOUT", 240)
    fin = time.time() + timeout
    success = None

    print(f"[INFO] Esperando resultado de la copia de seguridad (timeout {timeout} s)...")

    while time.time() < fin:
        try:
            # Mensaje de éxito
            elems_ok = driver.find_elements(
                By.XPATH,
                "//*[contains(., 'El archivo de copia de seguridad se creó con éxito')]",
            )
            if elems_ok:
                success = True
                print("[OK] Se detectó mensaje de copia de seguridad exitosa.")
                break

            # Mensajes de error típicos
            elems_err = driver.find_elements(
                By.XPATH,
                "//*[contains(., 'Error escribiendo a la base de datos') "
                "or contains(., 'Error al leer la base de datos')]",
            )
            if elems_err:
                success = False
                print("[WARN] Se detectó mensaje de error en la base de datos.")
                break
        except Exception:
            # Si falla algo al leer momentáneamente el DOM, seguimos intentando
            pass

        time.sleep(2)

    if success is None:
        print(
            "[WARN] No se detectó ni mensaje de éxito ni de error antes del timeout.\n"
            "Es posible que la copia no haya terminado correctamente."
        )

    # Intentar hacer clic en Continuar (en éxito o error)
    wait = WebDriverWait(driver, 30)
    try:
        continuar_btn = wait.until(
            EC.element_to_be_clickable(
                (
                    By.XPATH,
                    "//button[contains(., 'Continuar')]"
                    " | //a[contains(., 'Continuar')]"
                    " | //input[@value='Continuar']",
                )
            )
        )
        print("[INFO] Haciendo clic en 'Continuar'...")
        continuar_btn.click()
        time.sleep(3)
        print("[OK] Se hizo clic en 'Continuar' y se abrió la página de copias de seguridad.")
    except Exception as e:
        print(
            "[WARN] No se pudo hacer clic en 'Continuar'. "
            "Revisa el texto del botón o el XPATH si es necesario."
        )
        print(e)

    # Solo devolvemos True si hubo mensaje explícito de éxito
    return success is True

# =========================
# RENOMBRAR Y MOVER ARCHIVO
# =========================

def _sanitizar_nombre(nombre: str) -> str:
    """
    Quita caracteres no válidos para nombres de archivo/carpeta en Windows.
    """
    invalidos = '<>:"/\\|?*'
    limpio = "".join("_" if c in invalidos else c for c in nombre)
    return limpio.strip()


def descargar_ultima_copia(driver, nrc: str, nombre_curso: str, programa: str, nombre_modalidad: str):
    """
    En la página de listado de copias de seguridad del curso,
    intenta descargar el archivo .mbz más reciente y renombrarlo
    a 'NRC NombreCurso.mbz' dentro de una carpeta:
      {DOWNLOAD_DIR}/{MODALIDAD}/{PROGRAMA}/
    """
    wait = WebDriverWait(driver, 30)

    # Estado de la carpeta base antes de descargar
    antes = {p.name for p in DOWNLOAD_DIR.glob("*.mbz")}

    try:
        enlace_mbz = wait.until(
            EC.element_to_be_clickable(
                (By.XPATH, "//a[contains(@href, '.mbz')][1]")
            )
        )
        nombre_enlace = enlace_mbz.text.strip()
        print(f"[INFO] Descargando archivo de copia: {nombre_enlace or '(sin nombre en el enlace)'}")
        enlace_mbz.click()
    except Exception as e:
        print(
            "[WARN] No se encontró ningún enlace .mbz para descargar automáticamente.\n"
            "Puedes descargarlo manualmente si lo ves en la página."
        )
        print(e)
        return

    # Esperar a que termine la descarga y detectar el nuevo archivo
    print("[INFO] Esperando a que se complete la descarga de la copia...")
    timeout = 300  # hasta 5 minutos
    inicio = time.time()
    archivo_descargado = None

    while time.time() - inicio < timeout:
        # Mientras haya .crdownload, seguimos esperando
        if any(DOWNLOAD_DIR.glob("*.crdownload")):
            time.sleep(1)
            continue

        despues = {p.name for p in DOWNLOAD_DIR.glob("*.mbz")}
        nuevos = despues - antes
        if nuevos:
            nombre_nuevo = nuevos.pop()
            archivo_descargado = DOWNLOAD_DIR / nombre_nuevo
            break

        time.sleep(1)

    if not archivo_descargado:
        print("[WARN] No se pudo detectar el archivo descargado para renombrar.")
        return

    # Carpeta por modalidad y programa
    modalidad_limpia = _sanitizar_nombre(nombre_modalidad)
    programa_limpio = _sanitizar_nombre(programa) or "SIN_PROGRAMA"
    carpeta_destino = DOWNLOAD_DIR / modalidad_limpia / programa_limpio
    carpeta_destino.mkdir(parents=True, exist_ok=True)

    # Nuevo nombre: "NRC NombreCurso.mbz"
    nombre_objetivo = _sanitizar_nombre(f"{nrc} {nombre_curso}.mbz")
    destino = carpeta_destino / nombre_objetivo

    try:
        archivo_descargado.rename(destino)
        print(f"[OK] Copia renombrada y movida a: {destino}")
    except Exception as e:
        print(f"[WARN] No se pudo renombrar o mover el archivo {archivo_descargado.name}: {e}")


# =========================
# CLI / FLUJO PRINCIPAL
# =========================

def parse_args():
    parser = argparse.ArgumentParser(
        description="Descarga copias de seguridad Moodle (.mbz) por NRC."
    )
    parser.add_argument(
        "--nrc-csv",
        default=NRC_CSV,
        help=f"CSV de entrada con NRC (default: {NRC_CSV})",
    )
    parser.add_argument(
        "--backup-timeout",
        type=int,
        default=BACKUP_WAIT_TIMEOUT,
        help=f"Timeout de espera de backup en segundos (default: {BACKUP_WAIT_TIMEOUT})",
    )
    parser.add_argument(
        "--login-wait-seconds",
        type=int,
        default=LOGIN_WAIT_SECONDS,
        help=f"Timeout de espera de login manual en segundos (default: {LOGIN_WAIT_SECONDS})",
    )
    parser.add_argument(
        "--keep-open",
        action="store_true",
        help="Mantiene navegador abierto al final (solo recomendado en modo manual).",
    )
    return parser.parse_args()


def main():
    global BACKUP_WAIT_TIMEOUT
    args = parse_args()
    BACKUP_WAIT_TIMEOUT = max(30, int(args.backup_timeout))

    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # Intento 1: usar el perfil existente
    try:
        driver = create_driver()
    except Exception as e:
        print(
            "\n[WARN] Chrome no pudo iniciar con el perfil actual "
            "(posiblemente quedó corrupto). Detalle:"
        )
        print(e)
        print("[INFO] Reintentando con un perfil LIMPIO...\n")
        # Intento 2: borrar perfil y crear uno nuevo
        driver = create_driver(clean_profile=True)

    try:
        # 1) Leer filas del CSV (en el orden original)
        filas = leer_filas_desde_csv(args.nrc_csv)
        print(f"[INFO] Se encontraron {len(filas)} filas con NRC en el archivo.")

        # 2) Detectar qué modalidades se usan en el CSV
        mods_usadas = modalidades_presentes_en_csv(filas)
        print(f"[INFO] Modalidades detectadas en el CSV: {', '.join(mods_usadas) or 'ninguna'}")

        # 3) Hacer login una sola vez por cada modalidad usada
        for clave_mod in mods_usadas:
            cfg = MODALIDADES[clave_mod]
            login_manual_microsoft(
                driver,
                cfg["base_url"],
                cfg["nombre"],
                login_wait_seconds=max(30, int(args.login_wait_seconds)),
            )

        # 4) Recorrer las filas en el orden del CSV (sin pedir ENTER entre cursos)
        for fila in filas:
            nrc = fila["nrc"]
            periodo = fila["periodo"]
            programa = fila["programa"]

            clave_mod = detectar_modalidad_por_nrc(nrc)
            if not clave_mod:
                print(f"[SKIP] NRC {nrc} no coincide con ninguna modalidad configurada.")
                continue

            cfg = MODALIDADES[clave_mod]
            nombre_modalidad = cfg["nombre"]
            base_url = cfg["base_url"]

            print("\n" + "=" * 60)
            print(
                f"[CURSO] {nombre_modalidad} | NRC: {nrc} | PERIODO: {periodo} | PROGRAMA: {programa}"
            )

            course_id, nombre_curso_moodle = ir_a_curso_por_nrc(driver, base_url, nrc)
            if not course_id:
                continue

            # Hasta 3 intentos por curso si da error de base de datos
            max_intentos = 3
            intento = 1
            exito_final = False

            while intento <= max_intentos:
                print(f"[INTENTO] Curso {nrc} ({nombre_modalidad}) - intento {intento}/{max_intentos}")

                # 1) Ir a la página de creación de copia de seguridad
                ir_a_pagina_backup(driver, base_url, course_id)

                # 2) Hacer clic en "Saltar al último paso"
                saltar_al_ultimo_paso(driver)

                # 3) Esperar resultado (éxito / error) y hacer clic en "Continuar"
                exito = esperar_copia_y_continuar(driver)

                if exito:
                    # 4) Descargar y renombrar/mover la copia SOLO si hubo éxito
                    descargar_ultima_copia(
                        driver,
                        nrc=nrc,
                        nombre_curso=nombre_curso_moodle,
                        programa=programa,
                        nombre_modalidad=nombre_modalidad,
                    )
                    exito_final = True
                    break
                else:
                    print(
                        "[WARN] La copia de seguridad NO fue exitosa en este intento.\n"
                        "Se volverá a intentar el proceso de copia de seguridad."
                    )
                    intento += 1
                    time.sleep(5)  # pequeña pausa antes de reintentar

            if not exito_final:
                print(
                    f"[ERROR] No se logró crear una copia exitosa para el NRC {nrc} "
                    f"después de {max_intentos} intentos. Se continúa con el siguiente curso."
                )

        print("\n[FIN] Se procesaron todas las filas del CSV (todas las modalidades mezcladas).")
        if args.keep_open and sys.stdin.isatty() and not os.environ.get("SIDECAR_NON_INTERACTIVE"):
            input("\nCuando quieras CERRAR el navegador, presiona ENTER aquí...\n")

    finally:
        try:
            driver.quit()
        except Exception:
            pass


if __name__ == "__main__":
    main()
