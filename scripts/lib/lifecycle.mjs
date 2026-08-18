import { isWaiverActive } from "./result-states.mjs";

const terminalOutcomes = new Set(["upheld", "rejected", "superseded"]);

function transitionEvent({ id, entityType, entityId, action, actor, occurredAt, fromStatus, toStatus, summary }) {
  return {
    id,
    entityType,
    entityId,
    action,
    actor,
    occurredAt,
    ...(fromStatus ? { fromStatus } : {}),
    ...(toStatus ? { toStatus } : {}),
    ...(summary ? { summary } : {})
  };
}

export function createAppeal({ id, findingId, actor, reason, occurredAt, eventId }) {
  const event = transitionEvent({
    id: eventId,
    entityType: "appeal",
    entityId: id,
    action: "appeal.created",
    actor,
    occurredAt,
    toStatus: "open"
  });
  return {
    appeal: {
      id,
      findingId,
      status: "open",
      actor,
      reason,
      createdAt: occurredAt,
      auditEventIds: [eventId]
    },
    auditEvent: event
  };
}

export function startAppealReview(appeal, { actor, occurredAt, eventId }) {
  if (appeal.status !== "open") throw new Error("Only an open appeal can enter review.");
  const event = transitionEvent({
    id: eventId,
    entityType: "appeal",
    entityId: appeal.id,
    action: "appeal.review-started",
    actor,
    occurredAt,
    fromStatus: "open",
    toStatus: "under_review"
  });
  return {
    appeal: {
      ...structuredClone(appeal),
      status: "under_review",
      auditEventIds: [...appeal.auditEventIds, eventId]
    },
    auditEvent: event
  };
}

export function adjudicateAppeal(appeal, { outcome, actor, rationale, occurredAt, eventId, supersedingFindingId }) {
  if (appeal.status !== "under_review") throw new Error("Only an appeal under review can be adjudicated.");
  if (!terminalOutcomes.has(outcome)) throw new Error(`Unsupported appeal outcome: ${outcome}`);
  if (outcome === "superseded" && !supersedingFindingId) {
    throw new Error("A superseded appeal requires supersedingFindingId.");
  }
  if (outcome !== "superseded" && supersedingFindingId) {
    throw new Error("Only a superseded appeal may reference supersedingFindingId.");
  }

  const event = transitionEvent({
    id: eventId,
    entityType: "appeal",
    entityId: appeal.id,
    action: "appeal.adjudicated",
    actor,
    occurredAt,
    fromStatus: "under_review",
    toStatus: "terminal",
    summary: rationale
  });
  return {
    appeal: {
      ...structuredClone(appeal),
      status: "terminal",
      outcome,
      adjudicatedBy: actor,
      adjudicatedAt: occurredAt,
      rationale,
      ...(supersedingFindingId ? { supersedingFindingId } : {}),
      auditEventIds: [...appeal.auditEventIds, eventId]
    },
    auditEvent: event
  };
}

export function createWaiver({ id, findingId, actor, reason, createdAt, startsAt, expiresAt, scope, eventId, ...scopeFields }) {
  const event = transitionEvent({
    id: eventId,
    entityType: "waiver",
    entityId: id,
    action: "waiver.created",
    actor,
    occurredAt: createdAt,
    toStatus: "pending"
  });
  return {
    waiver: {
      id,
      findingId,
      reason,
      actor,
      createdAt,
      startsAt,
      expiresAt,
      scope,
      status: "pending",
      ...structuredClone(scopeFields),
      auditEventIds: [eventId]
    },
    auditEvent: event
  };
}

function transitionWaiver(waiver, { toStatus, action, actor, occurredAt, eventId }) {
  const allowed = {
    pending: new Set(["active", "revoked"]),
    active: new Set(["expired", "revoked"]),
    expired: new Set(),
    revoked: new Set()
  };
  if (!allowed[waiver.status]?.has(toStatus)) {
    throw new Error(`Invalid waiver transition ${waiver.status} -> ${toStatus}`);
  }
  const event = transitionEvent({
    id: eventId,
    entityType: "waiver",
    entityId: waiver.id,
    action,
    actor,
    occurredAt,
    fromStatus: waiver.status,
    toStatus
  });
  return {
    waiver: {
      ...structuredClone(waiver),
      status: toStatus,
      auditEventIds: [...waiver.auditEventIds, eventId]
    },
    auditEvent: event
  };
}

export const activateWaiver = (waiver, details) => transitionWaiver(waiver, {
  ...details,
  toStatus: "active",
  action: "waiver.activated"
});

export const expireWaiver = (waiver, details) => transitionWaiver(waiver, {
  ...details,
  toStatus: "expired",
  action: "waiver.expired"
});

export const revokeWaiver = (waiver, details) => transitionWaiver(waiver, {
  ...details,
  toStatus: "revoked",
  action: "waiver.revoked"
});

export function evaluateFinding(findingId, waivers, at) {
  const waiver = waivers.find((item) => item.findingId === findingId && isWaiverActive(item, at));
  return {
    findingId,
    active: waiver === undefined,
    activeWaiverId: waiver?.id ?? null
  };
}
