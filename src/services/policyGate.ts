export interface PolicyDecision {
  allowed: boolean;
  needsApproval: boolean;
  reason?: string;
  evidence: string[];
}

const APPROVAL_PATTERNS = [
  /purchase|buy now|place order|checkout|payment|pay\b/i,
  /book now|confirm booking|reserve now|complete booking/i,
  /submit application|final submit|delete|cancel subscription/i,
  /otp|one[- ]time password|verification code|account change/i,
];

export function evaluatePolicy(input: {
  taskType: string;
  action?: string;
  text?: string;
}): PolicyDecision {
  const haystack = `${input.taskType} ${input.action ?? ''} ${input.text ?? ''}`;
  const match = APPROVAL_PATTERNS.find((pattern) => pattern.test(haystack));
  if (!match) {
    return { allowed: true, needsApproval: false, evidence: [] };
  }

  return {
    allowed: true,
    needsApproval: true,
    reason: 'approval_required',
    evidence: [`Matched approval gate: ${match.source}`],
  };
}

