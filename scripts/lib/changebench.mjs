function includesText(value, expected) {
  return typeof value === "string" && value.includes(expected);
}

function matchChange(matcher, item) {
  return (matcher.kind === undefined || matcher.kind === item.kind)
    && (matcher.compatibility === undefined || matcher.compatibility === item.compatibility)
    && (matcher.componentKind === undefined || matcher.componentKind === item.component?.kind)
    && (matcher.componentName === undefined || matcher.componentName === item.component?.name)
    && (matcher.summaryContains === undefined || includesText(item.summary, matcher.summaryContains));
}

function matchImpact(matcher, item) {
  return (matcher.ruleId === undefined || matcher.ruleId === item.ruleId)
    && (matcher.category === undefined || matcher.category === item.category)
    && (matcher.severity === undefined || matcher.severity === item.severity)
    && (matcher.confidence === undefined || matcher.confidence === item.confidence)
    && (matcher.affectedComponentKind === undefined || item.affectedComponents?.some((component) => component.kind === matcher.affectedComponentKind))
    && (matcher.affectedComponentName === undefined || item.affectedComponents?.some((component) => component.name === matcher.affectedComponentName))
    && (matcher.summaryContains === undefined || includesText(item.summary, matcher.summaryContains));
}

function matchTest(matcher, item) {
  return (matcher.testName === undefined || matcher.testName === item.test?.name)
    && (matcher.commandContains === undefined || includesText(item.command, matcher.commandContains))
    && (matcher.reasonContains === undefined || includesText(item.reason, matcher.reasonContains));
}

function matchUnknown(matcher, item) {
  return (matcher.type === undefined || matcher.type === item.type)
    && (matcher.path === undefined || item.locations?.some((location) => location.path === matcher.path))
    && (matcher.summaryContains === undefined || includesText(item.summary, matcher.summaryContains))
    && (matcher.blockingRelevance === undefined || matcher.blockingRelevance === item.blockingRelevance);
}

function matchPolicy(matcher, item) {
  return (matcher.ruleId === undefined || matcher.ruleId === item.ruleId)
    && (matcher.ruleState === undefined || matcher.ruleState === item.ruleState)
    && (matcher.result === undefined || matcher.result === item.result)
    && (matcher.required === undefined || matcher.required === item.required)
    && (matcher.suspensionScope === undefined || matcher.suspensionScope === item.suspensionScope)
    && (matcher.findingId === undefined || item.findingIds?.includes(matcher.findingId))
    && (matcher.analysisGapId === undefined || item.analysisGapIds?.includes(matcher.analysisGapId));
}

function matchWaiver(matcher, item) {
  return (matcher.findingId === undefined || matcher.findingId === item.findingId)
    && (matcher.scope === undefined || matcher.scope === item.scope)
    && (matcher.status === undefined || matcher.status === item.status);
}

const groups = [
  ["Changes", "changes", matchChange],
  ["Impacts", "impacts", matchImpact],
  ["Tests", "tests", matchTest],
  ["Unknowns", "unknowns", matchUnknown],
  ["Policies", "policies", matchPolicy],
  ["Waivers", "waivers", matchWaiver]
];

export function evaluateChangeBenchCase(caseDefinition, actual) {
  const errors = [];
  let falsePositiveCount = 0;

  if (caseDefinition.expected.conclusion !== actual.conclusion) {
    errors.push(`Expected conclusion ${caseDefinition.expected.conclusion}, received ${actual.conclusion}.`);
  }
  if (JSON.stringify(caseDefinition.expected.coverage) !== JSON.stringify(actual.coverage)) {
    errors.push("Coverage did not match the exact expectation.");
  }

  for (const [suffix, actualKey, matcher] of groups) {
    const required = caseDefinition.expected[`required${suffix}`] ?? [];
    const forbidden = caseDefinition.expected[`forbidden${suffix}`] ?? [];
    const values = actual[actualKey] ?? [];

    for (const expected of required) {
      if (!values.some((item) => matcher(expected, item))) {
        errors.push(`Required ${actualKey} matcher did not match: ${JSON.stringify(expected)}`);
      }
    }
    for (const prohibited of forbidden) {
      if (values.some((item) => matcher(prohibited, item))) {
        errors.push(`Forbidden ${actualKey} matcher matched: ${JSON.stringify(prohibited)}`);
      }
    }

    if (!caseDefinition.expected.allowUnexpected) {
      for (const value of values) {
        if (!required.some((expected) => matcher(expected, value))) {
          falsePositiveCount += 1;
          errors.push(`Unexpected ${actualKey} result: ${JSON.stringify(value)}`);
        }
      }
    }
  }

  return { passed: errors.length === 0, errors, falsePositiveCount };
}
