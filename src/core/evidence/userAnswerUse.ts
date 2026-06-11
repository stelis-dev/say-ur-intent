export type UserAnswerFollowUp = {
  tool: string;
  inputFields?: string[] | undefined;
  answerFields: string[];
  reason: string;
};

export type UserAnswerUse = {
  canAnswer: string[];
  cannotAnswer: string[];
  answerFields: string[];
  preconditionFields?: string[] | undefined;
  conclusionRuleFields?: string[] | undefined;
  diagnosticOnlyFields?: string[] | undefined;
  followUp?: UserAnswerFollowUp | undefined;
};
