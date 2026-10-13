import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import type { ClockPort, FactExtractorPort } from "../../ports/index.js";
import { createTypeScriptJavaScriptFactExtractorCore } from "./typescriptJavaScriptFactExtractorCore.js";
import { TYPESCRIPT_PARSER_FUNCTIONS, type TypeScriptParserCapabilities } from "./typescriptParserCapabilities.js";

const APPROVED_VERSION = "6.0.3";
const APPROVED_RUNTIME_SHA256 = "569177652966bd528c319171c7dd22860dbf72bde116cbc4f644f1d02bb12e39";
const APPROVED_ENUM_SHA256 = {
  ScriptTarget: "53c24387074fdc4428d62877b33fe43e121feb2162f70661cb3768e6d6e27f35",
  ScriptKind: "fe9bf8803d6d60c5a57b6ae09c885af133b2cfa08bb558d032417e668cc8e9b5",
  SyntaxKind: "61b92da4fdc018224a04cfb11ee5b8828185877f139350c069bcdf503f6188c6",
} as const;

declare const sessionHandleBrand: unique symbol;
declare const custodyHandleBrand: unique symbol;
export interface GenuineParserSessionHandle { readonly [sessionHandleBrand]: true }
export interface GenuineParserCustodyHandle { readonly [custodyHandleBrand]: true }
export type GenuineParserSessionState = "active" | "revoked" | "expired";
export interface GenuineParserIdentity {
  readonly package: "typescript";
  readonly version: "6.0.3";
  readonly runtimeSha256: string;
  readonly runtimeBytes: number;
}
export interface GenuineParserGrant {
  readonly session: GenuineParserSessionHandle;
  readonly custody: GenuineParserCustodyHandle;
  readonly identity: GenuineParserIdentity;
}
export interface GenuineTypeScriptParserCustodian {
  admit(): GenuineParserGrant;
  capabilities(session: GenuineParserSessionHandle, custody: GenuineParserCustodyHandle): TypeScriptParserCapabilities;
  createExtractor(session: GenuineParserSessionHandle, custody: GenuineParserCustodyHandle, clock: ClockPort): FactExtractorPort;
  state(session: GenuineParserSessionHandle, custody: GenuineParserCustodyHandle): GenuineParserSessionState;
  revoke(session: GenuineParserSessionHandle, custody: GenuineParserCustodyHandle): void;
  expire(session: GenuineParserSessionHandle, custody: GenuineParserCustodyHandle): void;
}
type FailureCode = "parser_admission_evidence_invalid" | "parser_session_custody_invalid" | "parser_session_revoked" | "parser_session_expired";
export class GenuineParserAdmissionError extends Error {
  constructor(readonly code: FailureCode) { super(code); this.name = "GenuineParserAdmissionError"; }
}
function fail(code: FailureCode): never { throw new GenuineParserAdmissionError(code); }
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

// Static import is deliberate: no caller-selected loader or parser. Node's loader,
// intrinsics, bootstrap and same-realm code are trusted. Verification occurs AFTER
// TS import initialization; hashes do not sandbox or attest all mutable TS state.
function verifyInstalledParser(): GenuineParserIdentity {
  try {
    const require = createRequire(import.meta.url);
    const runtimePath = require.resolve("typescript");
    const metadata = JSON.parse(readFileSync(path.join(path.dirname(runtimePath), "../package.json"), "utf8"));
    const runtimeBytes = readFileSync(runtimePath);
    if (metadata.name !== "typescript" || metadata.version !== APPROVED_VERSION ||
        metadata.main !== "./lib/typescript.js" || ts.version !== APPROVED_VERSION ||
        require.cache[runtimePath]?.exports !== ts || sha256(runtimeBytes) !== APPROVED_RUNTIME_SHA256) {
      fail("parser_admission_evidence_invalid");
    }
    return Object.freeze({ package: "typescript", version: APPROVED_VERSION, runtimeSha256: APPROVED_RUNTIME_SHA256, runtimeBytes: runtimeBytes.length });
  } catch { fail("parser_admission_evidence_invalid"); }
}

function captureEnum<T extends typeof ts.ScriptTarget | typeof ts.ScriptKind | typeof ts.SyntaxKind>(value: T, expectedHash: string): T {
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value)).map(([key, descriptor]) => {
    if (!("value" in descriptor) || !descriptor.enumerable ||
        (typeof descriptor.value !== "string" && typeof descriptor.value !== "number")) fail("parser_admission_evidence_invalid");
    return [key, descriptor.value] as [string, string | number];
  }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  if (sha256(JSON.stringify(entries)) !== expectedHash) fail("parser_admission_evidence_invalid");
  return Object.freeze(Object.assign(Object.create(null), Object.fromEntries(entries))) as T;
}

/**
 * Explicit per-owner admission/custody. No parser/root/loader/evidence callback is
 * accepted. Private issuance identity, not public brands/shape/freezing, admits
 * handles. Holding handles/API is bearer authority within this trusted realm.
 * Revocation is cooperative; escaped AST methods and raw TS remain outside it.
 */
export function createGenuineTypeScriptParserCustodian(): GenuineTypeScriptParserCustodian {
  if (arguments.length !== 0) fail("parser_admission_evidence_invalid");
  const identity = verifyInstalledParser();
  const functions = TYPESCRIPT_PARSER_FUNCTIONS.map((name) => {
    const implementation = ts[name]; // Trusted genuine export getters only.
    if (typeof implementation !== "function") fail("parser_admission_evidence_invalid");
    return [name, implementation] as const;
  });
  const enums = {
    ScriptTarget: captureEnum(ts.ScriptTarget, APPROVED_ENUM_SHA256.ScriptTarget),
    ScriptKind: captureEnum(ts.ScriptKind, APPROVED_ENUM_SHA256.ScriptKind),
    SyntaxKind: captureEnum(ts.SyntaxKind, APPROVED_ENUM_SHA256.SyntaxKind),
  };
  interface Record { custody: GenuineParserCustodyHandle; state: GenuineParserSessionState; capabilities: TypeScriptParserCapabilities }
  const sessions = new WeakMap<object, Record>(); // Request-local; never module-global.
  function record(session: GenuineParserSessionHandle, custody: GenuineParserCustodyHandle): Record {
    // No reflection/property access on untrusted handles, including Proxies.
    if (!session || typeof session !== "object") fail("parser_session_custody_invalid");
    const admitted = sessions.get(session);
    if (!admitted || admitted.custody !== custody) fail("parser_session_custody_invalid");
    return admitted;
  }
  function active(admitted: Record): void {
    if (admitted.state === "revoked") fail("parser_session_revoked");
    if (admitted.state === "expired") fail("parser_session_expired");
  }
  return Object.freeze({
    admit() {
      const session = Object.freeze(Object.create(null)) as GenuineParserSessionHandle;
      const custody = Object.freeze(Object.create(null)) as GenuineParserCustodyHandle;
      const guarded = functions.map(([name, implementation]) => [name, (...args: unknown[]) => {
        active(admitted);
        return Reflect.apply(implementation, ts, args); // Original implementation/receiver.
      }]);
      const capabilities = Object.freeze(Object.assign(Object.create(null), enums, Object.fromEntries(guarded))) as TypeScriptParserCapabilities;
      const admitted: Record = { custody, state: "active", capabilities };
      sessions.set(session, admitted);
      return Object.freeze({ session, custody, identity });
    },
    capabilities(session: GenuineParserSessionHandle, custody: GenuineParserCustodyHandle) {
      const admitted = record(session, custody); active(admitted); return admitted.capabilities;
    },
    createExtractor(session: GenuineParserSessionHandle, custody: GenuineParserCustodyHandle, clock: ClockPort) {
      const admitted = record(session, custody); active(admitted);
      const core = createTypeScriptJavaScriptFactExtractorCore(clock, admitted.capabilities);
      return Object.freeze({
        id: core.id, version: core.version,
        supports(input) { active(admitted); return core.supports(input); },
        async extract(input) { active(admitted); return core.extract(input); },
      } satisfies FactExtractorPort);
    },
    state(session: GenuineParserSessionHandle, custody: GenuineParserCustodyHandle) { return record(session, custody).state; },
    revoke(session: GenuineParserSessionHandle, custody: GenuineParserCustodyHandle) {
      const admitted = record(session, custody); if (admitted.state === "active") admitted.state = "revoked";
    },
    expire(session: GenuineParserSessionHandle, custody: GenuineParserCustodyHandle) {
      const admitted = record(session, custody); if (admitted.state === "active") admitted.state = "expired";
    },
  });
}
