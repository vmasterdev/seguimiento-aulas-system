import { describe, expect, it } from "vitest";

import { bannerFieldNormalizers } from "../../src/banner/pages/NrcSearchPage.js";

describe("bannerFieldNormalizers.normalizeTeacherId", () => {
  it("quita ceros a la izquierda en ids numericos", () => {
    expect(bannerFieldNormalizers.normalizeTeacherId("000340923")).toBe("340923");
  });

  it("mantiene ids no numericos", () => {
    expect(bannerFieldNormalizers.normalizeTeacherId("AB0123")).toBe("AB0123");
  });

  it("retorna null en vacios", () => {
    expect(bannerFieldNormalizers.normalizeTeacherId("")).toBeNull();
    expect(bannerFieldNormalizers.normalizeTeacherId(null)).toBeNull();
  });
});

describe("bannerFieldNormalizers.buildInstructorAssignments", () => {
  it("agrupa multiples filas por rowid y normaliza ids", () => {
    const assignments = bannerFieldNormalizers.buildInstructorAssignments([
      {
        member: "SIRASGN_CATEGORY",
        row: "1",
        rowId: "row-b",
        text: "02"
      },
      {
        member: "SIRASGN_IDNO",
        row: "1",
        rowId: "row-b",
        text: "000120000"
      },
      {
        member: "SIRASGN_CATEGORY",
        row: "0",
        rowId: "row-a",
        text: "01"
      },
      {
        member: "NAME",
        row: "0",
        rowId: "row-a",
        text: "JOSE, PAVA IBANEZ O."
      },
      {
        member: "SIRASGN_IDNO",
        row: "0",
        rowId: "row-a",
        text: "000340923"
      },
      {
        member: "NAME",
        row: "1",
        rowId: "row-b",
        text: "MARIA, LOPEZ P."
      }
    ]);

    expect(assignments).toEqual([
      {
        rowIndex: 0,
        rowId: "row-a",
        category: "01",
        teacherIdRaw: "000340923",
        teacherId: "340923",
        teacherName: "JOSE, PAVA IBANEZ O."
      },
      {
        rowIndex: 1,
        rowId: "row-b",
        category: "02",
        teacherIdRaw: "000120000",
        teacherId: "120000",
        teacherName: "MARIA, LOPEZ P."
      }
    ]);
  });

  it("selecciona como principal la fila con categoria 01", () => {
    const primary = bannerFieldNormalizers.selectPrimaryInstructor([
      {
        rowIndex: 0,
        rowId: "row-a",
        category: "02",
        teacherIdRaw: "000120000",
        teacherId: "120000",
        teacherName: "MARIA, LOPEZ P."
      },
      {
        rowIndex: 1,
        rowId: "row-b",
        category: "01",
        teacherIdRaw: "000340923",
        teacherId: "340923",
        teacherName: "JOSE, PAVA IBANEZ O."
      }
    ]);

    expect(primary).toEqual({
      rowIndex: 1,
      rowId: "row-b",
      category: "01",
      teacherIdRaw: "000340923",
      teacherId: "340923",
      teacherName: "JOSE, PAVA IBANEZ O."
    });
  });

  it("conserva filas vacias de instructor para detectar sin docente", () => {
    const assignments = bannerFieldNormalizers.buildInstructorAssignments([
      {
        member: "SIRASGN_IDNO",
        row: "0",
        rowId: "row-empty",
        text: ""
      }
    ]);

    expect(assignments).toEqual([
      {
        rowIndex: 0,
        rowId: "row-empty",
        category: null,
        teacherIdRaw: null,
        teacherId: null,
        teacherName: null
      }
    ]);
  });
});
