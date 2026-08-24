export const conversationStates = [
  "PRE_CALL",
  "GATEKEEPER",
  "TRANSFER_IN_PROGRESS",
  "SAFETY_MANAGER_CONVERSATION",
  "MEETING_REQUESTED",
  "OBJECTION_HANDLING",
  "DNC",
  "VOICEMAIL",
  "COMPLETED",
  "FAILED"
] as const;

export type ConversationState = typeof conversationStates[number];

export const callDispositions = [
  "MEETING_REQUESTED",
  "INTERESTED_CALLBACK",
  "CALLBACK_REQUESTED",
  "NOT_INTERESTED",
  "DO_NOT_CALL",
  "GATEKEEPER_BLOCKED",
  "TRANSFERRED",
  "WRONG_PERSON",
  "WRONG_NUMBER",
  "VOICEMAIL",
  "NO_ANSWER",
  "FAILED"
] as const;

export type CallDisposition = typeof callDispositions[number];

export const defaultStartState = "SAFETY_MANAGER_CONVERSATION" satisfies ConversationState;

export function isConversationState(value: unknown): value is ConversationState {
  return typeof value === "string" && conversationStates.includes(value as ConversationState);
}

export function isCallDisposition(value: unknown): value is CallDisposition {
  return typeof value === "string" && callDispositions.includes(value as CallDisposition);
}
