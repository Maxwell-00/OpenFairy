import { sensitivityRank, stricterResidency, type RequestLabels } from "@fairy/model-gateway";

export interface LabelEscalation {
  readonly category: "credentials" | "personal";
  readonly from: RequestLabels;
  readonly reason: string;
  readonly to: RequestLabels;
}

export interface EscalationResult {
  readonly labels: RequestLabels;
  readonly escalations: readonly LabelEscalation[];
}

const credentialPatterns: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\b[A-Z][A-Z0-9_]{2,}\s*=\s*["']?[^"'\s]{12,}/,
  /\b(?:sk|pk|ghp|gho|glpat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/i,
  /\bapi[_-]?key\b\s*[:=]\s*["']?[^"'\s]{12,}/i
];

const personalPatterns: readonly RegExp[] = [
  /\bmy (?:phone|address|birthday|passport|id number)\b/i,
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
  /(?:\u6211\u7684)?(?:\u751f\u65e5|\u4f4f\u5740|\u8eab\u4efd\u8bc1|\u62a4\u7167|\u7535\u8bdd|\u624b\u673a\u53f7|\u79c1\u4eba\u7b14\u8bb0)/
];

const raiseTo = (
  current: RequestLabels,
  target: RequestLabels,
  category: LabelEscalation["category"],
  reason: string
): { labels: RequestLabels; escalation?: LabelEscalation } => {
  const raised: RequestLabels = {
    residency: stricterResidency(current.residency, target.residency),
    sensitivity: sensitivityRank[target.sensitivity] > sensitivityRank[current.sensitivity]
      ? target.sensitivity
      : current.sensitivity
  };

  if (raised.residency === current.residency && raised.sensitivity === current.sensitivity) {
    return { labels: current };
  }

  return {
    escalation: { category, from: current, reason, to: raised },
    labels: raised
  };
};

export const escalateLabelsForContent = (content: string, labels: RequestLabels): EscalationResult => {
  let current = labels;
  const escalations: LabelEscalation[] = [];

  if (credentialPatterns.some((pattern) => pattern.test(content))) {
    const raised = raiseTo(current, { residency: "local-only", sensitivity: "secret" }, "credentials", "credential_pattern");
    current = raised.labels;
    if (raised.escalation) {
      escalations.push(raised.escalation);
    }
  }

  if (personalPatterns.some((pattern) => pattern.test(content))) {
    const raised = raiseTo(current, { residency: current.residency, sensitivity: "personal" }, "personal", "personal_identifier_pattern");
    current = raised.labels;
    if (raised.escalation) {
      escalations.push(raised.escalation);
    }
  }

  return { escalations, labels: current };
};
