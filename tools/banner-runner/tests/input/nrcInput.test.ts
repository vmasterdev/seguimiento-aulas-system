import { describe, expect, it } from "vitest";

import { inputParsers } from "../../src/input/nrcInput.js";

describe("inputParsers", () => {
  it("parsea CSV con encabezado y elimina duplicados", () => {
    const results = inputParsers.parseCsv(`nrc,period\n12345,202610\n12345,202610\n98765,202620`);

    expect(results).toEqual([
      { nrc: "12345", period: "202610", lineNumber: 2 },
      { nrc: "98765", period: "202620", lineNumber: 4 }
    ]);
  });

  it("parsea TXT simple con comentarios", () => {
    const results = inputParsers.parseTxt(`# lote\n12345\n98765,202610\n`);

    expect(results).toEqual([
      { nrc: "12345", period: undefined, lineNumber: 2 },
      { nrc: "98765", period: "202610", lineNumber: 3 }
    ]);
  });

  it("parsea CSV con punto y coma", () => {
    const results = inputParsers.parseCsv(`nrc;period\n11111;202610`);

    expect(results).toEqual([{ nrc: "11111", period: "202610", lineNumber: 2 }]);
  });

  it("parsea encabezado periodo y normaliza nrc con prefijo", () => {
    const results = inputParsers.parseCsv(`periodo,nrc\n202615,15-72830`);

    expect(results).toEqual([{ nrc: "72830", period: "202615", lineNumber: 2 }]);
  });
});
