import { containsSecretLikeSemanticValue } from "../domain/semanticLiteralSafety.js";

const PATH_BOUNDARY = String.raw`(?:^|[\s"'([{:=])`;
const WINDOWS_DRIVE = new RegExp(`${PATH_BOUNDARY}[a-z]:[\\\\/]`, "iu");
const UNC_PATH = new RegExp(`${PATH_BOUNDARY}\\\\{2,4}[^\\\\/\\s"']+[\\\\/][^\\\\/\\s"']+`, "u");
const UNIX_PATH = new RegExp(
  `${PATH_BOUNDARY}/(?!/)[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*`,
  "u",
);
const FILE_URI = /file:\/\//iu;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export function containsAbsoluteShadowPath(value: string): boolean {
  return WINDOWS_DRIVE.test(value) || UNC_PATH.test(value) || UNIX_PATH.test(value) || FILE_URI.test(value);
}

export function containsSecretLikeShadowText(value: string): boolean {
  return containsSecretLikeSemanticValue(value);
}

export function containsPrivateShadowText(value: string): boolean {
  return (
    containsAbsoluteShadowPath(value) ||
    containsSecretLikeShadowText(value) ||
    CONTROL.test(value)
  );
}

export function assertPrivacySafeShadowArtifact(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (serialized.length > 1_000_000 || containsPrivateShadowText(serialized)) {
    throw new Error("Context Engine shadow diagnostic failed privacy validation.");
  }
}

export function safeShadowErrorCode(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_.:-]{0,80}$/u.test(value) &&
      !containsPrivateShadowText(value)
    ? value
    : "shadow_execution_error";
}
