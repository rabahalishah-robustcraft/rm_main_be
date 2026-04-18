import { AssemblyAI } from 'assemblyai';
import { config } from '../utils/config';

/** Header AssemblyAI sends when webhook_auth_* was set on the transcript job. */
export const ASSEMBLY_WEBHOOK_SECRET_HEADER = 'x-assemblyai-webhook-secret';

const ALLOWED_SPEECH_MODELS = new Set(['universal-3-pro', 'universal-2']);

/**
 * AssemblyAI now requires a non-empty `speech_models` list on transcript submit.
 * Defaults to universal-3-pro; override with ASSEMBLYAI_SPEECH_MODELS (comma-separated).
 */
export function resolveSpeechModelsForSubmit(): string[] {
  const raw = config.ASSEMBLYAI_SPEECH_MODELS;
  if (!raw) {
    return ['universal-3-pro'];
  }
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const filtered = parts.filter((m) => ALLOWED_SPEECH_MODELS.has(m));
  return filtered.length > 0 ? filtered : ['universal-3-pro'];
}

export interface SubmitTranscriptionParams {
  audioUrl: string;
  sessionId: string;
  webhookBaseUrl: string;
  webhookSecret?: string;
}

/**
 * Submit audio URL for async transcription with speaker labels; AssemblyAI POSTs to webhook when done.
 */
export async function submitTranscription(params: SubmitTranscriptionParams): Promise<string> {
  const apiKey = config.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is not configured');
  }

  const client = new AssemblyAI({ apiKey });
  const base = params.webhookBaseUrl.replace(/\/$/, '');
  const webhookUrl = `${base}/api/webhooks/assemblyai?sessionId=${encodeURIComponent(params.sessionId)}`;

  // Keep submit payload minimal: some speech models reject legacy flags like
  // `disfluencies` / `filter_profanity` when using default "best" model.
  const submitBody: Parameters<typeof client.transcripts.submit>[0] = {
    audio: params.audioUrl,
    speech_models: resolveSpeechModelsForSubmit(),
    speaker_labels: true,
    punctuate: true,
    webhook_url: webhookUrl
  };

  if (params.webhookSecret) {
    submitBody.webhook_auth_header_name = ASSEMBLY_WEBHOOK_SECRET_HEADER;
    submitBody.webhook_auth_header_value = params.webhookSecret;
  }

  const transcript = await client.transcripts.submit(submitBody);
  return transcript.id;
}

export async function fetchTranscript(assemblyJobId: string): Promise<{
  text?: string | null;
  utterances?: import('./transcriptService').AssemblyUtterance[] | null;
  error?: string | null;
  status?: string;
}> {
  const apiKey = config.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is not configured');
  }

  const client = new AssemblyAI({ apiKey });
  return client.transcripts.get(assemblyJobId);
}
