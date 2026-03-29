// Jest manual mock for pdf-parse to avoid loading native bindings in tests.
// Provides a minimal PDFParse class interface used by ResumeTextExtractor tests.

const mockGetText = jest.fn();
const mockDestroy = jest.fn();

class PDFParse {
  data: Buffer;
  progress = { loaded: 0, total: 0 };

  constructor({ data }: { data: Buffer }) {
    this.data = data;
  }

  getText = mockGetText;
  destroy = mockDestroy;
}

export { PDFParse, mockGetText, mockDestroy };

