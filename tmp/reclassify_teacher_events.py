#!/usr/bin/env python3
"""
Reclasifica eventos actorCategory=NO_CLASIFICADO -> DOCENTE cuando el actor
comparte al menos 2 tokens significativos con el nombre del docente del curso.
Trabaja directamente contra PostgreSQL via docker exec.
"""

import subprocess
import json
import unicodedata
import re
import sys


DOCKER_CONTAINER = "infra-postgres-1"
PSQL_CMD = ["docker", "exec", "-i", DOCKER_CONTAINER, "psql", "-U", "seguimiento", "-d", "seguimiento", "-A", "-F", "\t", "-t"]


def run_query(sql: str) -> str:
    result = subprocess.run(
        PSQL_CMD,
        input=sql,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql error: {result.stderr}")
    return result.stdout.strip()


def normalize(text: str) -> str:
    if not text:
        return ""
    # Eliminar diacriticos
    nfd = unicodedata.normalize("NFD", text)
    nfd = "".join(c for c in nfd if not unicodedata.combining(c))
    # Reemplazar no-alfanumerico con espacio
    nfd = re.sub(r"[^a-zA-Z0-9]+", " ", nfd)
    return nfd.strip().upper()


STOP_WORDS = {"DE", "DEL", "LA", "LAS", "LOS", "Y", "E", "EL"}


def significant_tokens(name: str) -> list[str]:
    return [t for t in normalize(name).split() if len(t) >= 3 and t not in STOP_WORDS]


def is_teacher_match(actor_name: str, teacher_name: str) -> bool:
    actor_tokens = set(significant_tokens(actor_name))
    teacher_tokens = significant_tokens(teacher_name)
    shared = sum(1 for t in teacher_tokens if t in actor_tokens)
    return shared >= 2


def escape_sql_string(s: str) -> str:
    return s.replace("'", "''")


def main():
    print("=== Reclasificacion de eventos DOCENTE ===\n")

    # 1. Traer cursos con docente y su reporte de actividad mas reciente
    query_courses = """
SELECT
    c.id AS course_id,
    c.nrc,
    t."fullName" AS teacher_name,
    (
        SELECT r.id FROM "MoodleActivityReport" r
        WHERE r."courseId" = c.id
        ORDER BY r."importedAt" DESC
        LIMIT 1
    ) AS latest_report_id
FROM "Course" c
JOIN "Teacher" t ON t.id = c."teacherId"
WHERE c."teacherId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "MoodleActivityReport" r WHERE r."courseId" = c.id);
"""
    raw = run_query(query_courses)
    if not raw:
        print("Sin cursos con docente y reporte de actividad.")
        return

    courses = []
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        courses.append({
            "course_id": parts[0],
            "nrc": parts[1],
            "teacher_name": parts[2],
            "report_id": parts[3],
        })

    print(f"Cursos con docente y reporte: {len(courses)}")

    total_updated = 0
    courses_fixed = 0

    for course in courses:
        nrc = course["nrc"]
        teacher_name = course["teacher_name"]
        report_id = course["report_id"]

        if not report_id or report_id == "":
            continue

        # 2. Traer actores NO_CLASIFICADO de este reporte
        q_actors = f"""
SELECT DISTINCT "actorName"
FROM "MoodleActivityEvent"
WHERE "reportId" = '{escape_sql_string(report_id)}'
  AND "actorCategory" = 'NO_CLASIFICADO'
  AND "actorName" IS NOT NULL
  AND "actorName" != '';
"""
        raw_actors = run_query(q_actors)
        if not raw_actors:
            continue

        actors = [line.strip() for line in raw_actors.splitlines() if line.strip()]

        # 3. Filtrar por matching de tokens
        matching = [a for a in actors if is_teacher_match(a, teacher_name)]
        if not matching:
            continue

        # 4. Construir UPDATE
        in_clause = ", ".join(f"'{escape_sql_string(a)}'" for a in matching)
        q_update = f"""
UPDATE "MoodleActivityEvent"
SET "actorCategory" = 'DOCENTE'
WHERE "reportId" = '{escape_sql_string(report_id)}'
  AND "actorCategory" = 'NO_CLASIFICADO'
  AND "actorName" IN ({in_clause});
"""
        result_raw = run_query(q_update)
        # psql devuelve "UPDATE N"
        try:
            updated = int(result_raw.split()[-1])
        except Exception:
            updated = 0

        if updated > 0:
            courses_fixed += 1
            total_updated += updated
            print(f"  NRC {nrc} | docente: \"{teacher_name}\" | actores: {matching} | eventos: {updated}")

    print(f"\n=== RESUMEN ===")
    print(f"Cursos reclasificados: {courses_fixed}")
    print(f"Eventos actualizados a DOCENTE: {total_updated}")


if __name__ == "__main__":
    main()
