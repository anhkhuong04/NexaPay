import type { PayInput } from "./payment";
import type { FundingInput, Recovery } from "./funding";
import type { TransferInput } from "./transfer";
type MemoryIntent =
  | (Recovery & { operationType: "DEMO_FUNDING"; body: FundingInput })
  | (Recovery & { operationType: "TRANSFER"; body: TransferInput })
  | (Recovery & { operationType: "PAYMENT"; body: PayInput });
// Tab memory only. Full reload discards payload; sessionStorage holds a reference.
let pending: MemoryIntent | null = null;
export function rememberIntent(intent: MemoryIntent) {
  pending = structuredClone(intent);
}
export function readMemoryIntent(ref: Recovery): MemoryIntent | null {
  return pending &&
    pending.actorId === ref.actorId &&
    pending.environmentEpoch === ref.environmentEpoch &&
    pending.operationType === ref.operationType &&
    pending.key === ref.key
    ? structuredClone(pending)
    : null;
}
export function clearMemoryIntent(
  actorId: string,
  type: Recovery["operationType"],
  key: string,
) {
  if (
    pending?.actorId === actorId &&
    pending.operationType === type &&
    pending.key === key
  )
    pending = null;
}
export function retainActorDraft(actorId: string | null) {
  if (pending?.actorId !== actorId) pending = null;
}
