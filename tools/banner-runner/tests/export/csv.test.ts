import { describe, expect, it } from "vitest";

import { stringifyCsv } from "../../src/export/csv.js";

describe("stringifyCsv", () => {
  it("escapa comas y comillas", () => {
    const csv = stringifyCsv([
      {
        nrc: "12345",
        teacher_name: "Perez, Ana",
        note: "docente \"titular\""
      }
    ]);

    expect(csv).toContain("\"Perez, Ana\"");
    expect(csv).toContain("\"docente \"\"titular\"\"\"");
  });
});
