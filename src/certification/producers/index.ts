export type {
  ProducerKind,
  ProducerContextV1,
  ProducerResultV1,
  ApplicabilityResultV1,
  ProducerHandlerV1,
  RegisteredProducerV1,
  ProducerRegistryV1,
  ProducerRegisterResultV1,
  ProducerRegisterFailureV1,
  ProducerRegisterOutcomeV1,
  ProducerValidationResultV1,
  ProducerValidationFailureV1,
  ProducerValidationOutcomeV1,
  FalsePassCheckResultV1,
  FalsePassCheckFailureV1,
  FalsePassCheckOutcomeV1,
  RouteStateViewportPlanV1,
  ViewportSpecV1,
  RouteStateViewportCombinationV1,
  DiagnosticNormalizationResultV1,
  DiagnosticNormalizationFailureV1,
  DiagnosticNormalizationOutcomeV1,
  ProducerExecutionRequestV1,
  ProducerExecutionSuccessV1,
  ProducerExecutionErrorV1,
  ProducerExecutionResultOutcomeV1,
} from "./registry.ts";

export type { ProducerDeclarationV1 } from "../profile/schemas.ts";

export {
  createProducerRegistry,
  evaluateApplicability,
  checkFalsePass,
  planRouteStateViewportMatrix,
  normalizeDiagnostics,
  executeProducer,
} from "./registry.ts";
