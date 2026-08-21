export type IrErrorCode =
  | "ir_context_invalid"
  | "ir_record_invalid"
  | "ir_id_invalid"
  | "ir_duplicate_id"
  | "ir_reference_missing"
  | "ir_evidence_invalid";

export class IrError extends Error {
  readonly code: IrErrorCode;

  constructor(code: IrErrorCode, message: string) {
    super(message);
    this.name = "IrError";
    this.code = code;
  }
}
