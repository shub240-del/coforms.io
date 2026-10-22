import { TRPCError } from "@trpc/server";

export const MAX_SARVAM_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_SARVAM_AUDIO_BASE64_LENGTH = Math.ceil(MAX_SARVAM_AUDIO_BYTES / 3) * 4;

export function decodeSarvamAudio(audioBase64: string): Buffer {
  if (audioBase64.length > MAX_SARVAM_AUDIO_BASE64_LENGTH) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Audio recordings must be 20 MB or smaller." });
  }
  if (!audioBase64 || audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Audio data must be valid base64." });
  }
  const audio = Buffer.from(audioBase64, "base64");
  if (!audio.length || audio.length > MAX_SARVAM_AUDIO_BYTES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Audio recordings must be 20 MB or smaller." });
  }
  return audio;
}
