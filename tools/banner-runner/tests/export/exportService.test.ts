import { describe, expect, it } from "vitest";

import { buildExportBaseName } from "../../src/export/exportService.js";

describe("buildExportBaseName", () => {
  it("uses a readable slug based on the query name", () => {
    const fileName = buildExportBaseName(
      "NRC globales S1 - Momento 1 y MD1",
      "cmm7tyq820000t2eo8tn50zll",
      "2026-03-01T14-39-33.355Z"
    );

    expect(fileName).toBe("nrc-globales-s1-momento-1-y-md1-2026-03-01T14-39-33.355Z");
  });

  it("falls back to query id when there is no query name", () => {
    const fileName = buildExportBaseName(
      "",
      "cmm7tyq820000t2eo8tn50zll",
      "2026-03-01T14-39-33.355Z"
    );

    expect(fileName).toBe("consulta-cmm7tyq820000t2eo8tn50zll-2026-03-01T14-39-33.355Z");
  });
});
