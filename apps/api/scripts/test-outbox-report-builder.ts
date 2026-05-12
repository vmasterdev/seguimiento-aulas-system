import assert from 'node:assert/strict';
import {
  buildCoordinatorHtml,
  buildGlobalHtml,
  buildTeacherHtml,
  summarizeGlobalRows,
} from '../src/modules/outbox/outbox.report-builder';
import type { CourseCoordinationRow } from '../src/modules/outbox/outbox.types';

function runTeacherReportSmokeTest() {
  const html = buildTeacherHtml({
    teacherName: 'Docente Prueba',
    phase: 'ALISTAMIENTO',
    moment: 'MD1',
    periodCode: '202615',
    rows: [
      {
        nrc: '15-84221',
        reviewedNrc: '15-84221',
        moment: 'MD1',
        resultType: 'REVISADO',
        subject: 'Practica Formativa I',
        program: 'LICENCIATURAS - CENTRO',
        template: 'INNOVAME',
        score: 50,
        observations: 'Felicitaciones, el aula cumple completamente con los items.',
      },
    ],
  });

  assert.match(html, /Detalle por NRC - M1 \(MD1\)/);
  assert.match(html, /NRC 15-84221/);
  assert.match(html, /Excelente/);
  assert.match(html, /Agendar llamada \/ videollamada/);
}

function runCoordinatorReportSmokeTest() {
  const html = buildCoordinatorHtml({
    coordinatorName: 'Coordinador Prueba',
    programId: 'TRABAJO SOCIAL - CENTRO',
    phase: 'ALISTAMIENTO',
    moments: ['MD1', '1'],
    periodCodes: ['202610', '202615'],
    uniqueTeachers: 2,
    rows: [
      {
        periodCode: '202610',
        teacherName: 'Docente Uno',
        nrc: '1001',
        subject: 'Asignatura Uno',
        moment: 'MD1',
        status: 'REVISADO',
        template: 'INNOVAME',
        score: 45,
      },
      {
        periodCode: '202615',
        teacherName: 'Docente Dos',
        nrc: '1002',
        subject: 'Asignatura Dos',
        moment: '1',
        status: 'REVISADO',
        template: 'CRIBA',
        score: 35,
      },
    ],
  });

  assert.match(html, /TRABAJO SOCIAL - CENTRO/);
  assert.match(html, /Corte por momento/);
  assert.match(html, /Corte por periodo/);
  assert.match(html, /Detalle por NRC - TRABAJO SOCIAL - CENTRO/);
}

function runExecutionPhaseSmokeTest() {
  const rows: CourseCoordinationRow[] = [
    {
      periodCode: '202610',
      periodLabel: 'Periodo 202610',
      teacherName: 'Docente Uno',
      teacherKey: 'tch-1',
      campus: 'CU CENTRO',
      nrc: '1001',
      subject: 'Asignatura Uno',
      moment: '1',
      status: 'REVISADO',
      template: 'INNOVAME',
      score: 50,
      replicated: false,
      coordinationKey: 'coord-a',
      coordinationName: 'COORD A',
    },
    {
      periodCode: '202610',
      periodLabel: 'Periodo 202610',
      teacherName: 'Docente Dos',
      teacherKey: 'tch-2',
      campus: 'CU CENTRO',
      nrc: '1002',
      subject: 'Asignatura Dos',
      moment: '1',
      status: 'REVISADO',
      template: 'INNOVAME',
      score: 40,
      replicated: false,
      coordinationKey: 'coord-a',
      coordinationName: 'COORD A',
    },
    {
      periodCode: '202615',
      periodLabel: 'Periodo 202615',
      teacherName: 'Docente Tres',
      teacherKey: 'tch-3',
      campus: 'CU SUR',
      nrc: '1003',
      subject: 'Asignatura Tres',
      moment: 'MD1',
      status: 'REVISADO',
      template: 'CRIBA',
      score: 35,
      replicated: false,
      coordinationKey: 'coord-b',
      coordinationName: 'COORD B',
    },
    {
      periodCode: '202615',
      periodLabel: 'Periodo 202615',
      teacherName: 'Docente Cuatro',
      teacherKey: 'tch-4',
      campus: 'CU SUR',
      nrc: '1004',
      subject: 'Asignatura Cuatro',
      moment: 'MD1',
      status: 'REVISADO',
      template: 'CRIBA',
      score: 25,
      replicated: true,
      coordinationKey: 'coord-b',
      coordinationName: 'COORD B',
    },
  ];

  const summary = summarizeGlobalRows(rows, 'EJECUCION', ['202610', '202615'], ['MD1', '1']);
  assert.equal(summary.totalCourses, 4);
  assert.equal(summary.excellent, 1);
  assert.equal(summary.good, 1);
  assert.equal(summary.acceptable, 1);
  assert.equal(summary.unsatisfactory, 1);

  const html = buildTeacherHtml({
    teacherName: 'Docente Ejecucion',
    phase: 'EJECUCION',
    moment: '1',
    periodCode: '202610',
    rows: [
      {
        nrc: '10-1001',
        reviewedNrc: '10-1001',
        moment: '1',
        resultType: 'REVISADO',
        subject: 'Asignatura Uno',
        program: 'COORD A',
        template: 'INNOVAME',
        score: 50,
        observations: 'Cumple completamente con ejecucion.',
      },
    ],
  });

  assert.match(html, /50\.0\/50/);
  assert.match(html, /Excelente/);
  assert.match(html, /\(0-50\)/);
}

function runGlobalReportSmokeTest() {
  const rows: CourseCoordinationRow[] = [
    {
      periodCode: '202610',
      periodLabel: 'Periodo 202610',
      teacherName: 'Docente Uno',
      teacherKey: 'tch-1',
      campus: 'CU CENTRO',
      nrc: '1001',
      subject: 'Asignatura Uno',
      moment: 'MD1',
      status: 'REVISADO',
      template: 'INNOVAME',
      score: 50,
      replicated: false,
      coordinationKey: 'coord-a',
      coordinationName: 'COORD A',
    },
    {
      periodCode: '202610',
      periodLabel: 'Periodo 202610',
      teacherName: 'Docente Dos',
      teacherKey: 'tch-2',
      campus: 'CU CENTRO',
      nrc: '1002',
      subject: 'Asignatura Dos',
      moment: '1',
      status: 'REVISADO',
      template: 'INNOVAME',
      score: 40,
      replicated: false,
      coordinationKey: 'coord-a',
      coordinationName: 'COORD A',
    },
    {
      periodCode: '202615',
      periodLabel: 'Periodo 202615',
      teacherName: 'Docente Tres',
      teacherKey: 'tch-3',
      campus: 'CU SUR',
      nrc: '1003',
      subject: 'Asignatura Tres',
      moment: 'MD1',
      status: 'REVISADO',
      template: 'CRIBA',
      score: 35,
      replicated: false,
      coordinationKey: 'coord-b',
      coordinationName: 'COORD B',
    },
    {
      periodCode: '202615',
      periodLabel: 'Periodo 202615',
      teacherName: 'Docente Cuatro',
      teacherKey: 'tch-4',
      campus: 'CU SUR',
      nrc: '1004',
      subject: 'Asignatura Cuatro',
      moment: '1',
      status: 'REVISADO',
      template: 'CRIBA',
      score: 25,
      replicated: true,
      coordinationKey: 'coord-b',
      coordinationName: 'COORD B',
    },
  ];

  const summary = summarizeGlobalRows(rows, 'ALISTAMIENTO', ['202610', '202615'], ['MD1', '1']);
  assert.equal(summary.totalCourses, 4);
  assert.equal(summary.excellent, 1);
  assert.equal(summary.good, 1);
  assert.equal(summary.acceptable, 1);
  assert.equal(summary.unsatisfactory, 1);
  assert.equal(summary.periodSummary.length, 2);
  assert.equal(summary.momentSummary.length, 2);

  const html = buildGlobalHtml({
    phase: 'ALISTAMIENTO',
    moments: ['MD1', '1'],
    periodCodes: ['202610', '202615'],
    totalCourses: summary.totalCourses,
    averageScore: summary.averageScore,
    excellent: summary.excellent,
    good: summary.good,
    acceptable: summary.acceptable,
    unsatisfactory: summary.unsatisfactory,
    rows: summary.rowsSummary,
    periodSummary: summary.periodSummary,
    momentSummary: summary.momentSummary,
    recipientsCount: 2,
  });

  assert.match(html, /Promedio global/);
  assert.match(html, /Excelente/);
  assert.match(html, /Bueno/);
  assert.match(html, /Aceptable/);
  assert.match(html, /Insatisfactorio/);
  assert.match(html, /202610/);
  assert.match(html, /202615/);
}

runTeacherReportSmokeTest();
runCoordinatorReportSmokeTest();
runExecutionPhaseSmokeTest();
runGlobalReportSmokeTest();

console.log('outbox report builder smoke tests: ok');
