export type InventoryErrorCode =
  | "inventory_diff_invalid"
  | "inventory_policy_invalid"
  | "inventory_rule_ambiguous";

export class InventoryError extends Error {
  readonly code: InventoryErrorCode;

  constructor(code: InventoryErrorCode, message: string) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
  }
}
