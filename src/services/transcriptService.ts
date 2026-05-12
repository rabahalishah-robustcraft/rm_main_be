/**
 * Compact transcript format for HITL editor and GPT ingestion.
 */
export interface CompactTranscriptLine {
  id: number;
  s: string;
  t: string;
  start: number;
  end: number;
}

export interface AssemblyUtterance {
  speaker?: string | null;
  text?: string | null;
  start: number;
  end: number;
}

/**
 * Transform AssemblyAI utterances into compact JSON for storage and the editor.
 */
export function toCompactJSON(utterances: AssemblyUtterance[] | null | undefined): CompactTranscriptLine[] {
  if (!utterances || utterances.length === 0) {
    throw new Error(
      'No utterances in transcript — verify speaker_labels is enabled in the AssemblyAI request'
    );
  }

  return utterances.map((u, index) => ({
    id: index,
    s: String(u.speaker ?? '?'),
    t: (u.text ?? '').trim(),
    start: u.start,
    end: u.end
  }));
}

/**
 * Convert compact/edited transcript lines to Markdown for the coaching model.
 */
export function toMarkdown(compactTranscript: CompactTranscriptLine[]): string {
  if (!compactTranscript || compactTranscript.length === 0) {
    throw new Error('Cannot convert empty transcript to Markdown');
  }

  return compactTranscript.map((line) => `**Speaker ${line.s}:** ${line.t}`).join('\n');
}
