export const quoteDetourGoldenAnswer = {
  scenarioId: "quote_detour_shortfall_guard",
  nextScenarioId: "explicit_usdc_shortfall",
  expectedAmountFields: [
    'responseSummary.currentDisplayAmount: "278.890119"',
    'responseSummary.shortfallDisplayAmount: "721.109881"'
  ],
  requiredEvidenceFields: [
    "responseSummary.answerCompleteness.requiredAnswerFields",
    "responseSummary.doNotCallQuoteToolsForThisQuestion",
    "responseSummary.separateQuoteOutputs",
    "quantitySemantics.doNotCombineWithPaymentAnswer",
    'userAnswerUse.followUp.answerFields: ["responseSummary"]'
  ],
  allowedConclusionFragments: [
    "current settlement-asset amount `278.890119`",
    "required amount `1000`",
    "settlement-asset shortfall `721.109881`"
  ],
  forbiddenConclusionFragments: [
    "other assets were considered",
    "everything can be converted",
    "quote outputs can be combined",
    "still short after adding quote outputs"
  ],
  forbiddenCombinedAmountFragments: ["569.01226"]
} as const;
