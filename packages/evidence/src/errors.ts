export type EvidenceErrorCode =
  | "evidence_binding_invalid"
  | "evidence_input_invalid"
  | "evidence_revision_mismatch"
  | "evidence_id_invalid"
  | "evidence_duplicate_id";

export class EvidenceError extends Error {
  readonly code: EvidenceErrorCode;

  constructor(code: EvidenceErrorCode, message: string) {
    super(message);
    this.name = "EvidenceError";
    this.code = code;
  }
}
