export function isWaiverActive(waiver, at) {
  if (waiver.status !== "active") return false;
  const instant = new Date(at).valueOf();
  return instant >= new Date(waiver.startsAt).valueOf()
    && instant < new Date(waiver.expiresAt).valueOf();
}

export function deriveResult(manifest) {
  const reasons = [];
  const add = (code, summary) => reasons.push({ code, summary });

  if (manifest.analyzers.some((item) => item.required && item.status === "error")) {
    add("required-analyzer-error", "A required analyzer returned an error.");
    return { conclusion: "error", reasons };
  }

  const requiredIncomplete = manifest.analyzers.some(
    (item) => item.required && item.status === "incomplete"
  );
  const requiredNotEvaluated = manifest.policies.some(
    (item) => item.required && item.result === "not_evaluated"
  );
  if (requiredIncomplete || requiredNotEvaluated) {
    if (requiredIncomplete) {
      add("required-analyzer-incomplete", "A required analyzer did not complete.");
    }
    if (requiredNotEvaluated) {
      add("required-policy-not-evaluated", "A required policy was not evaluated.");
    }
    return { conclusion: "incomplete", reasons };
  }

  const activeWaivers = manifest.waivers.filter((item) => isWaiverActive(item, manifest.generatedAt));
  const waivedFindingIds = new Set(activeWaivers.map((item) => item.findingId));
  const failingPolicy = manifest.policies.find((policy) =>
    policy.enabled
    && policy.mode === "blocking"
    && policy.blockingEligible
    && policy.ruleState === "active"
    && policy.result === "fail"
    && policy.findingIds.some((id) => !waivedFindingIds.has(id))
  );

  if (failingPolicy) {
    add("blocking-policy-failed", `Blocking policy ${failingPolicy.id} failed.`);
    return { conclusion: "fail", reasons };
  }

  const warningConditions = [
    [manifest.policies.some((item) => item.result === "warn"), "policy-warning", "A policy returned a warning."],
    [manifest.policies.some((item) => item.ruleState === "suspended"), "suspended-rule", "A rule is suspended."],
    [manifest.policies.some((item) => !item.required && item.result === "not_evaluated"), "policy-not-evaluated", "A non-required policy was not evaluated."],
    [activeWaivers.length > 0, "active-waiver", "A finding has an active waiver."],
    [manifest.analyzers.some((item) => !item.required && ["incomplete", "error"].includes(item.status)), "optional-analyzer-gap", "A non-required analyzer did not complete successfully."],
    [manifest.unknowns.length > 0, "analysis-unknown", "Analysis contains an explicit unknown or gap."],
    [manifest.impacts.length > 0 || manifest.tests.gaps.length > 0, "advisory-finding", "Analysis contains an advisory finding."],
    [manifest.suspensions.some((item) => item.status === "active"), "active-suspension", "A rule suspension is active."]
  ];

  for (const [condition, code, summary] of warningConditions) {
    if (condition) add(code, summary);
  }

  return reasons.length > 0
    ? { conclusion: "warn", reasons }
    : { conclusion: "pass", reasons: [] };
}
