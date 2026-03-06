export function normalizeProgramValue(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

export function resolveProgramValue(input: {
  teacherCostCenter?: string | null;
  teacherLinked?: boolean;
  courseProgramCode?: string | null;
  courseProgramName?: string | null;
}) {
  const teacherProgram = normalizeProgramValue(input.teacherCostCenter);
  if (teacherProgram) {
    return {
      programCode: teacherProgram,
      programName: teacherProgram,
    };
  }

  if (input.teacherLinked) {
    return {
      programCode: null,
      programName: null,
    };
  }

  const programName = normalizeProgramValue(input.courseProgramName);
  const programCode = normalizeProgramValue(input.courseProgramCode) ?? programName;

  return {
    programCode,
    programName: programName ?? programCode,
  };
}
