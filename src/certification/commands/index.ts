export type {
  CertificationStatusResultV1,
  CertificationStatusFailureV1,
  CertificationStatusOutcomeV1,
  CertificationVerifyResultV1,
  CertificationVerifyFailureV1,
  CertificationVerifyOutcomeV1,
} from "./inspection.ts";

export {
  getCertificationStatus,
  verifyCertification,
} from "./inspection.ts";
