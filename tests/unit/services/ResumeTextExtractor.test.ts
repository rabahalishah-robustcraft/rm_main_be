import {
  ResumeTextExtractor,
  PDFTextExtractor,
  DOCXTextExtractor,
  TextExtractor
} from '../../../src/services/ResumeTextExtractor';

// Mock the external libraries
jest.mock('pdf-parse');
jest.mock('mammoth');

const { PDFParse, mockGetText, mockDestroy } = require('pdf-parse');
import mammoth from 'mammoth';

describe('ResumeTextExtractor', () => {
  let resumeTextExtractor: ResumeTextExtractor;

  beforeEach(() => {
    resumeTextExtractor = new ResumeTextExtractor();
    jest.clearAllMocks();
  });

  describe('PDFTextExtractor', () => {
    let pdfExtractor: PDFTextExtractor;

    beforeEach(() => {
      pdfExtractor = new PDFTextExtractor();
    });

    describe('canHandle', () => {
      it('should return true for .pdf files', () => {
        expect(pdfExtractor.canHandle('resume.pdf')).toBe(true);
        expect(pdfExtractor.canHandle('document.PDF')).toBe(true);
        expect(pdfExtractor.canHandle('file.Pdf')).toBe(true);
      });

      it('should return false for non-PDF files', () => {
        expect(pdfExtractor.canHandle('resume.docx')).toBe(false);
        expect(pdfExtractor.canHandle('resume.doc')).toBe(false);
        expect(pdfExtractor.canHandle('resume.txt')).toBe(false);
      });
    });

    describe('extract', () => {
      it('should successfully extract text from PDF buffer', async () => {
        const mockBuffer = Buffer.from('mock pdf content');
        const mockText = 'Extracted PDF text content';

        mockGetText.mockResolvedValue({
          text: mockText,
          pages: [],
          total: 1
        });

        const result = await pdfExtractor.extract(mockBuffer);

        expect(result).toBe(mockText);
        expect(mockGetText).toHaveBeenCalled();
      });

      it('should throw error when PDF extraction fails', async () => {
        const mockBuffer = Buffer.from('invalid pdf');
        const mockError = new Error('Invalid PDF format');

        mockGetText.mockRejectedValue(mockError);

        await expect(pdfExtractor.extract(mockBuffer)).rejects.toThrow(
          'Failed to extract text from PDF: Invalid PDF format'
        );
      });

      it('should handle unknown errors during extraction', async () => {
        const mockBuffer = Buffer.from('invalid pdf');

        mockGetText.mockRejectedValue('Unknown error');

        await expect(pdfExtractor.extract(mockBuffer)).rejects.toThrow(
          'Failed to extract text from PDF: Unknown error'
        );
      });
    });
  });

  describe('DOCXTextExtractor', () => {
    let docxExtractor: DOCXTextExtractor;

    beforeEach(() => {
      docxExtractor = new DOCXTextExtractor();
    });

    describe('canHandle', () => {
      it('should return true for .doc and .docx files', () => {
        expect(docxExtractor.canHandle('resume.docx')).toBe(true);
        expect(docxExtractor.canHandle('resume.doc')).toBe(true);
        expect(docxExtractor.canHandle('document.DOCX')).toBe(true);
        expect(docxExtractor.canHandle('file.Doc')).toBe(true);
      });

      it('should return false for non-DOC files', () => {
        expect(docxExtractor.canHandle('resume.pdf')).toBe(false);
        expect(docxExtractor.canHandle('resume.txt')).toBe(false);
        expect(docxExtractor.canHandle('resume.odt')).toBe(false);
      });
    });

    describe('extract', () => {
      it('should successfully extract text from DOCX buffer', async () => {
        const mockBuffer = Buffer.from('mock docx content');
        const mockText = 'Extracted DOCX text content';

        (mammoth.extractRawText as jest.Mock).mockResolvedValue({
          value: mockText,
          messages: []
        });

        const result = await docxExtractor.extract(mockBuffer);

        expect(result).toBe(mockText);
        expect(mammoth.extractRawText).toHaveBeenCalledWith({ buffer: mockBuffer });
      });

      it('should throw error when DOCX extraction fails', async () => {
        const mockBuffer = Buffer.from('invalid docx');
        const mockError = new Error('Invalid DOCX format');

        (mammoth.extractRawText as jest.Mock).mockRejectedValue(mockError);

        await expect(docxExtractor.extract(mockBuffer)).rejects.toThrow(
          'Failed to extract text from DOCX: Invalid DOCX format'
        );
      });

      it('should handle unknown errors during extraction', async () => {
        const mockBuffer = Buffer.from('invalid docx');

        (mammoth.extractRawText as jest.Mock).mockRejectedValue('Unknown error');

        await expect(docxExtractor.extract(mockBuffer)).rejects.toThrow(
          'Failed to extract text from DOCX: Unknown error'
        );
      });
    });
  });

  describe('ResumeTextExtractor', () => {
    describe('extractText', () => {
      it('should extract text from PDF file', async () => {
        const mockBuffer = Buffer.from('mock pdf content');
        const mockText = 'Extracted PDF text';

        mockGetText.mockResolvedValue({
          text: mockText,
          pages: [],
          total: 1
        });

        const result = await resumeTextExtractor.extractText(mockBuffer, 'resume.pdf');

        expect(result).toBe(mockText);
        expect(mockGetText).toHaveBeenCalled();
      });

      it('should extract text from DOCX file', async () => {
        const mockBuffer = Buffer.from('mock docx content');
        const mockText = 'Extracted DOCX text';

        (mammoth.extractRawText as jest.Mock).mockResolvedValue({
          value: mockText,
          messages: []
        });

        const result = await resumeTextExtractor.extractText(mockBuffer, 'resume.docx');

        expect(result).toBe(mockText);
        expect(mammoth.extractRawText).toHaveBeenCalledWith({ buffer: mockBuffer });
      });

      it('should extract text from DOC file', async () => {
        const mockBuffer = Buffer.from('mock doc content');
        const mockText = 'Extracted DOC text';

        (mammoth.extractRawText as jest.Mock).mockResolvedValue({
          value: mockText,
          messages: []
        });

        const result = await resumeTextExtractor.extractText(mockBuffer, 'resume.doc');

        expect(result).toBe(mockText);
        expect(mammoth.extractRawText).toHaveBeenCalledWith({ buffer: mockBuffer });
      });

      it('should throw error for unsupported file type', async () => {
        const mockBuffer = Buffer.from('mock content');

        await expect(
          resumeTextExtractor.extractText(mockBuffer, 'resume.txt')
        ).rejects.toThrow('Unsupported file type: resume.txt');
      });

      it('should throw error when extracted text is empty', async () => {
        const mockBuffer = Buffer.from('mock pdf content');

        mockGetText.mockResolvedValue({
          text: '',
          pages: [],
          total: 1
        });

        await expect(
          resumeTextExtractor.extractText(mockBuffer, 'resume.pdf')
        ).rejects.toThrow('No text content extracted from file: resume.pdf');
      });

      it('should throw error when extracted text is only whitespace', async () => {
        const mockBuffer = Buffer.from('mock pdf content');

        mockGetText.mockResolvedValue({
          text: '   \n\t  ',
          pages: [],
          total: 1
        });

        await expect(
          resumeTextExtractor.extractText(mockBuffer, 'resume.pdf')
        ).rejects.toThrow('No text content extracted from file: resume.pdf');
      });

      it('should handle case-insensitive file extensions', async () => {
        const mockBuffer = Buffer.from('mock content');
        const mockText = 'Extracted text';

        mockGetText.mockResolvedValue({
          text: mockText,
          pages: [],
          total: 1
        });

        const result = await resumeTextExtractor.extractText(mockBuffer, 'RESUME.PDF');

        expect(result).toBe(mockText);
      });
    });

    describe('isSupported', () => {
      it('should return true for supported file types', () => {
        expect(resumeTextExtractor.isSupported('resume.pdf')).toBe(true);
        expect(resumeTextExtractor.isSupported('resume.docx')).toBe(true);
        expect(resumeTextExtractor.isSupported('resume.doc')).toBe(true);
        expect(resumeTextExtractor.isSupported('RESUME.PDF')).toBe(true);
      });

      it('should return false for unsupported file types', () => {
        expect(resumeTextExtractor.isSupported('resume.txt')).toBe(false);
        expect(resumeTextExtractor.isSupported('resume.odt')).toBe(false);
        expect(resumeTextExtractor.isSupported('resume.rtf')).toBe(false);
      });
    });

    describe('getSupportedExtensions', () => {
      it('should return list of supported extensions', () => {
        const extensions = resumeTextExtractor.getSupportedExtensions();

        expect(extensions).toEqual(['.pdf', '.doc', '.docx']);
        expect(extensions).toHaveLength(3);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle filenames with multiple dots', async () => {
      const mockBuffer = Buffer.from('mock content');
      const mockText = 'Extracted text';

      mockGetText.mockResolvedValue({
        text: mockText,
        pages: [],
        total: 1
      });

      const result = await resumeTextExtractor.extractText(
        mockBuffer,
        'john.doe.resume.pdf'
      );

      expect(result).toBe(mockText);
    });

    it('should handle filenames with paths', async () => {
      const mockBuffer = Buffer.from('mock content');
      const mockText = 'Extracted text';

      mockGetText.mockResolvedValue({
        text: mockText,
        pages: [],
        total: 1
      });

      const result = await resumeTextExtractor.extractText(
        mockBuffer,
        '/path/to/resume.pdf'
      );

      expect(result).toBe(mockText);
    });

    it('should propagate extraction errors', async () => {
      const mockBuffer = Buffer.from('corrupt pdf');
      const mockError = new Error('Corrupted file');

      mockGetText.mockRejectedValue(mockError);

      await expect(
        resumeTextExtractor.extractText(mockBuffer, 'resume.pdf')
      ).rejects.toThrow('Failed to extract text from PDF');
    });
  });
});
