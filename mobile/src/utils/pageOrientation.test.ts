import { parsePageCheck, turnInCountLabel } from "./pageOrientation";

// The rest of this module is tested on web (web/src/lib/page-orientation.test.ts),
// which it mirrors.
describe("turnInCountLabel", () => {
  const img = { pdf: false, totalPages: 1, checked: true };
  const pdf6 = { pdf: true, totalPages: 6, checked: true };

  it("counts pages across files, not files", () => {
    expect(turnInCountLabel([pdf6])).toBe("6 pages");
    expect(turnInCountLabel([img])).toBe("1 page");
    expect(turnInCountLabel([img, pdf6, img])).toBe("8 pages");
    expect(turnInCountLabel([{ ...img, checked: false }, img])).toBe("2 pages");
    // Past the check's page cap: every page the teacher gets.
    expect(turnInCountLabel([{ ...pdf6, totalPages: 40 }])).toBe("40 pages");
  });

  it("never guesses a PDF's pages before the check knows them", () => {
    const unknownPdf = { pdf: true, totalPages: 1, checked: false };
    expect(turnInCountLabel([unknownPdf])).toBe("1 file");
    expect(turnInCountLabel([unknownPdf, img])).toBe("2 files");
    // The check answered 0 pages: it couldn't open the PDF.
    expect(turnInCountLabel([{ ...unknownPdf, checked: true, totalPages: 0 }])).toBe("1 file");
  });
});

describe("parsePageCheck totalPages", () => {
  it("reads every page, falling back to the checked pages on an older API", () => {
    expect(parsePageCheck({ page_count: 30, total_pages: 40 })).toMatchObject({ pageCount: 30, totalPages: 40 });
    expect(parsePageCheck({ page_count: 4 }).totalPages).toBe(4);
    expect(parsePageCheck({ sideways: false }).totalPages).toBe(1);
  });
});
