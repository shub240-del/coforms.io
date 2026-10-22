import { describe, expect, it } from "vitest";
import { decodeSarvamAudio, MAX_SARVAM_AUDIO_BYTES } from "./audio";

describe("Sarvam audio input limits", () => {
  it("decodes valid base64 audio", () => {
    expect(decodeSarvamAudio(Buffer.from("audio").toString("base64"))).toEqual(Buffer.from("audio"));
  });

  it("rejects malformed and empty audio", () => {
    expect(() => decodeSarvamAudio("!!!")).toThrow(/valid base64/i);
    expect(() => decodeSarvamAudio("")).toThrow(/valid base64/i);
  });

  it("rejects decoded audio larger than 20 MB", () => {
    const oversized = Buffer.alloc(MAX_SARVAM_AUDIO_BYTES + 1).toString("base64");
    expect(() => decodeSarvamAudio(oversized)).toThrow(/20 MB or smaller/i);
  });
});
