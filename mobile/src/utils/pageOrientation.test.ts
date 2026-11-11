import { turnInCountLabel } from "./pageOrientation";

// The rest of this module is tested on web (web/src/lib/page-orientation.test.ts),
// which it mirrors.
describe("turnInCountLabel", () => {
  const img = { pdf: false, pageCount: 1, checked: true };
  const pdf6 = { pdf: true, pageCount: 6, checked: true };

  it("counts pages across files, not files", () => {
    expect(turnInCountLabel([pdf6])).toBe("6 pages");
    expect(turnInCountLabel([img])).toBe("1 page");
    expect(turnInCountLabel([img, pdf6, img])).toBe("8 pages");
    expect(turnInCountLabel([{ ...img, checked: false }, img])).toBe("2 pages");
  });

  it("never guesses a PDF's pages before the check knows them", () => {
    const unknownPdf = { pdf: true, pageCount: 1, checked: false };
    expect(turnInCountLabel([unknownPdf])).toBe("1 file");
    expect(turnInCountLabel([unknownPdf, img])).toBe("2 files");
    // The check answered 0 pages: it couldn't open the PDF.
    expect(turnInCountLabel([{ ...unknownPdf, checked: true, pageCount: 0 }])).toBe("1 file");
  });
});
