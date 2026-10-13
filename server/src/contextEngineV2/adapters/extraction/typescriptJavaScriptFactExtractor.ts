import type { ClockPort, FactExtractorPort } from "../../ports/index.js";
import { createGenuineTypeScriptParserCustodian } from "./genuineTypeScriptParserAdmission.js";

export function createTypeScriptJavaScriptFactExtractor(
  clock: ClockPort,
): FactExtractorPort {
  const custodian = createGenuineTypeScriptParserCustodian();
  const grant = custodian.admit();
  return custodian.createExtractor(grant.session, grant.custody, clock);
}
