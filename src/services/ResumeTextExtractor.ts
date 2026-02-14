import mammoth from 'mammoth';
const { PDFParse } = require('pdf-parse');

/**
 * Interface for text extraction from different file formats
 * Requirements: 3.1, 3.2, 3.3
 */
export interface TextExtractor {
  /**
   * Check if this extractor can handle the given filename
   * @param filename - The name of the file to check
   * @returns true if this extractor can handle the file type
   */
  canHandle(filename: string): boolean;

  /**
   * Extract text content from the file buffer
   * @param buffer - The file content as a Buffer
   * @returns Promise resolving to the extracted text
   * @throws Error if extraction fails
   */
  extract(buffer: Buffer): Promise<string>;
}

/**
 * PDF text extractor using pdf-parse library
 * Requirements: 3.2
 */
export class PDFTextExtractor implements TextExtractor {
  canHandle(filename: string): boolean {
    return filename.toLowerCase().endsWith('.pdf');
  }

  async extract(buffer: Buffer): Promise<string> {
    try {
      // pdf-parse v2 requires creating a PDFParse instance
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy(); // Clean up resources
      return result.text;
    } catch (error) {
      throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * DOCX text extractor using mammoth library
 * Requirements: 3.3
 */
export class DOCXTextExtractor implements TextExtractor {
  canHandle(filename: string): boolean {
    const lower = filename.toLowerCase();
    return lower.endsWith('.doc') || lower.endsWith('.docx');
  }

  async extract(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      throw new Error(`Failed to extract text from DOCX: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Main resume text extraction service
 * Coordinates multiple text extractors for different file formats
 * Requirements: 3.1, 3.2, 3.3
 */
export class ResumeTextExtractor {
  private extractors: TextExtractor[];

  constructor() {
    this.extractors = [
      new PDFTextExtractor(),
      new DOCXTextExtractor()
    ];
  }

  /**
   * Extract text from a resume file buffer
   * @param buffer - The file content as a Buffer
   * @param filename - The name of the file (used to determine file type)
   * @returns Promise resolving to the extracted text
   * @throws ValidationError if file type is not supported
   * @throws Error if extraction fails
   */
  async extractText(buffer: Buffer, filename: string): Promise<string> {
    // Find an extractor that can handle this file type
    const extractor = this.extractors.find(e => e.canHandle(filename));

    if (!extractor) {
      throw new Error(`Unsupported file type: ${filename}`);
    }

    // Extract text using the appropriate extractor
    const text = await extractor.extract(buffer);

    // Validate that we got some text
    if (!text || text.trim().length === 0) {
      throw new Error(`No text content extracted from file: ${filename}`);
    }

    return text;
  }

  /**
   * Check if a file type is supported
   * @param filename - The name of the file to check
   * @returns true if the file type is supported
   */
  isSupported(filename: string): boolean {
    return this.extractors.some(e => e.canHandle(filename));
  }

  /**
   * Get list of supported file extensions
   * @returns Array of supported file extensions (e.g., ['.pdf', '.doc', '.docx'])
   */
  getSupportedExtensions(): string[] {
    return ['.pdf', '.doc', '.docx'];
  }
}
