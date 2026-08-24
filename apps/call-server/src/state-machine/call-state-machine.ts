import type { RealtimeSession } from "@openai/agents/realtime";
import { isConversationState, type ConversationState, type CallDisposition } from "./states.js";

export const TRANSFER_SILENCE_MS = 3_500;

const dncPhrases = [
  "stop calling",
  "don't call again",
  "do not call again",
  "remove me",
  "take me off your list",
  "take us off your list",
  "put me on your do not call",
  "never call"
];

type StateChangeListener = (state: ConversationState) => void | Promise<void>;

export class CallStateMachine {
  #state: ConversationState;
  #lastGatekeeperSpeechAt: number | undefined;
  #listeners = new Set<StateChangeListener>();

  constructor(
    private callSid: string | undefined,
    initialState: ConversationState
  ) {
    this.#state = initialState;
  }

  get state() {
    return this.#state;
  }

  get currentCallSid() {
    return this.callSid;
  }

  setCallSid(callSid: string) {
    this.callSid = callSid;
  }

  onStateChange(listener: StateChangeListener) {
    this.#listeners.add(listener);
  }

  async transition(to: ConversationState, reason: string) {
    if (!isConversationState(to) || to === this.#state) {
      return;
    }

    const from = this.#state;
    this.#state = to;

    console.log(JSON.stringify({
      event: "state_transition",
      callSid: this.callSid,
      from,
      to,
      reason
    }));

    for (const listener of this.#listeners) {
      await listener(to);
    }
  }

  async updateDisposition(disposition: CallDisposition, notes?: string) {
    // Future: this writes to Notion in Milestone 5. For now it is console-only by design.
    console.log(JSON.stringify({
      event: "call_disposition_updated",
      callSid: this.callSid,
      disposition,
      notes
    }));

    if (disposition === "DO_NOT_CALL") {
      console.log(JSON.stringify({
        event: "do_not_call_requested",
        callSid: this.callSid,
        notes
      }));
      await this.transition("DNC", "prospect_requested_do_not_call");
      return;
    }

    if (disposition === "MEETING_REQUESTED") {
      await this.transition("MEETING_REQUESTED", "meeting_requested");
    } else if (disposition === "VOICEMAIL") {
      await this.transition("VOICEMAIL", "voicemail_detected");
    } else if (disposition === "FAILED") {
      await this.transition("FAILED", "disposition_failed");
    }
  }

  async handleTranscript(transcript: string) {
    const normalized = transcript.toLowerCase();

    if (dncPhrases.some((phrase) => normalized.includes(phrase))) {
      await this.updateDisposition("DO_NOT_CALL", "DNC phrase detected in transcript.");
      return;
    }

    // Placeholder transfer heuristic for Milestone 2 only: if we were speaking with
    // a gatekeeper, then observe a named silence gap before new speech, treat the next
    // utterance as evidence that a transfer probably completed. Real hold music,
    // ringing, and silence-pattern detection belongs to a later milestone.
    if (this.#state === "GATEKEEPER") {
      const now = Date.now();
      if (
        this.#lastGatekeeperSpeechAt &&
        now - this.#lastGatekeeperSpeechAt >= TRANSFER_SILENCE_MS
      ) {
        await this.transition("TRANSFER_IN_PROGRESS", "placeholder_silence_gap_after_gatekeeper");
        await this.transition("SAFETY_MANAGER_CONVERSATION", "new_speech_after_placeholder_transfer_gap");
      }
      this.#lastGatekeeperSpeechAt = now;
    }
  }
}

export async function updateRealtimeAgentForState(
  session: RealtimeSession,
  state: ConversationState,
  createAgent: (state: ConversationState) => ReturnType<RealtimeSession["currentAgent"]["clone"]>
) {
  await session.updateAgent(createAgent(state));
}
