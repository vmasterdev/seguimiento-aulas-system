# Modelo de Datos (Postgres)

Entidades principales:

## Period
- id
- code (ej: 202610, 202615)
- label (ej: "PREGRADO PRESENCIAL")
- semester (1/2)
- modality (PP/PD/POSG/etc)
- execution_policy (APPLIES / AUTO_PASS)

## Teacher
- id (id_docente)
- full_name
- email
- cost_center
- campus
- region
- extra_json

## Course
- id
- nrc (ej "65-12345")
- period_id
- campus_code (S)
- program_code (PRG)
- program_name
- subject_name (Asignatura)
- moment (MD1/MD2/1/INTER/RM1/RM2)
- salon, salon1
- teacher_id (FK)
- template_declared (CRIBA/INNOVAME/VACIO/D4)  # valor final del sistema
- d4_flag_legacy (bool)  # si viene de CT (migración)
- raw_json (fila completa CSV)

## MoodleCheck
- id
- course_id
- status (PENDIENTE/EN_PROCESO/OK/ERROR_REINTENTABLE/DESCARTADO_NO_EXISTE/REVISAR_MANUAL)
- detected_template (VACIO/CRIBA/INNOVAME/D4/UNKNOWN)
- error_code (NO_EXISTE/SIN_ACCESO/TIMEOUT/OTRO)
- attempts
- last_attempt_at
- evidence_screenshot_path
- evidence_html_path
- notes

## SampleGroup
- id
- teacher_id
- period_id
- program_code
- moment
- modality
- template
- selected_course_id
- selection_seed
- created_at

## Evaluation (Alistamiento/Ejecucion)
- id
- course_id
- phase (ALISTAMIENTO/EJECUCION)
- checklist_json (items y SI/NO)
- score (0..50)
- observations (texto)
- computed_at
- replicated_from_course_id (si fue replicado por muestreo)

## OutboxMessage
- id
- audience (DOCENTE/COORDINADOR/GLOBAL)
- teacher_id nullable
- program_code nullable
- period_id
- phase
- moment
- subject
- html_body
- eml_path
- status (DRAFT/EXPORTED/SENT_MANUAL)
- created_at

## AuditLog
- id
- actor (user/system)
- action
- entity_type/entity_id
- details_json
- created_at
