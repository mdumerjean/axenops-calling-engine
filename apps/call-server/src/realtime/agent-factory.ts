import { RealtimeAgent, tool } from "@openai/agents/realtime";
import { z } from "zod";
import { gatekeeperScript } from "../playbooks/gatekeeper-script.js";
import { objectionLibrary } from "../playbooks/objections.js";
import { productKnowledge } from "../playbooks/product-knowledge.js";
import {
  safetyManagerBehavioralInstructions,
  safetyManagerScript
} from "../playbooks/safety-manager-script.js";
import type { CallStateMachine } from "../state-machine/call-state-machine.js";
import {
  callDispositions,
  conversationStates,
  type ConversationState
} from "../state-machine/states.js";

type AgentFactoryOptions = {
  stateMachine: CallStateMachine;
};

function formatList(items: readonly string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function commonInstructions() {
  return [
    "You are the AxenOps outbound voice assistant.",
    safetyManagerScript.identityGuardrail,
    "Do not disclose AI, automation, bot, or real-person status unless the prospect explicitly and directly asks about it.",
    "Never say 'this is Mathieu' and never claim to be Mathieu Dumerjean.",
    "If someone asks to stop calling, remove them, or take them off the list, stop selling immediately and call update_call_disposition with DO_NOT_CALL.",
    "Use only the approved product knowledge below. Do not invent capabilities, statistics, customer names, ROI claims, legal interpretations, or pricing.",
    `Approved fallback for unknown product questions: "${productKnowledge.fallbackLine}" Then redirect toward booking the meeting.`,
    "Approved product knowledge:",
    formatList(productKnowledge.approvedFacts),
    "Prohibited product claims:",
    formatList(productKnowledge.prohibitedClaims),
    "Behavior:",
    formatList(safetyManagerBehavioralInstructions.instructions),
    "Objection library:",
    objectionLibrary.objections
      .map((objection) => [
        `- ${objection.id} (${objection.category})`,
        `  Trigger examples: ${objection.triggerExamples.join("; ")}`,
        `  Approved response: ${objection.approvedResponse}`,
        `  Prohibited claims: ${objection.prohibitedClaims.join("; ")}`
      ].join("\n"))
      .join("\n")
  ].join("\n\n");
}

function instructionsForState(state: ConversationState) {
  const common = commonInstructions();

  switch (state) {
    case "GATEKEEPER":
      return [
        common,
        "ACTIVE STATE: GATEKEEPER",
        `Playbook version: ${gatekeeperScript.version}`,
        gatekeeperScript.identityGuardrail,
        `Opening: "${gatekeeperScript.opening}"`,
        `If the Safety Manager's name is known: "${gatekeeperScript.namedContactOpening}"`,
        `If asked who is calling: "${gatekeeperScript.ifAskedWho}"`,
        `If asked what this is regarding: "${gatekeeperScript.ifAskedRegarding}"`,
        gatekeeperScript.inspectionLineNote,
        `Objective: ${gatekeeperScript.objective}`,
        `Accept equivalent titles: ${gatekeeperScript.equivalentTitles.join(", ")}.`,
        `Style: ${gatekeeperScript.style}`,
        "Hard guardrails:",
        formatList(gatekeeperScript.hardGuardrails),
        "If the gatekeeper offers a name, direct line, or email for the Safety Manager, call log_discovered_contact."
      ].join("\n\n");
    case "TRANSFER_IN_PROGRESS":
      return [
        common,
        "ACTIVE STATE: TRANSFER_IN_PROGRESS",
        "Stay quiet unless spoken to. If a new person answers, politely restart with the Safety Manager opener and continue in SAFETY_MANAGER_CONVERSATION."
      ].join("\n\n");
    case "OBJECTION_HANDLING":
      return [
        common,
        "ACTIVE STATE: OBJECTION_HANDLING",
        "Use the objection library. Acknowledge first, answer briefly, do not argue, then return to the 10-minute feedback call CTA if appropriate."
      ].join("\n\n");
    case "DNC":
      return [
        common,
        "ACTIVE STATE: DNC",
        "Acknowledge briefly, apologize for the interruption, confirm they will not be called again, and end the conversation. Do not pitch further."
      ].join("\n\n");
    case "MEETING_REQUESTED":
      return [
        common,
        "ACTIVE STATE: MEETING_REQUESTED",
        "Confirm the proposed time in plain language and call request_meeting_booking. Do not pretend the calendar is booked yet."
      ].join("\n\n");
    case "VOICEMAIL":
      return [
        common,
        "ACTIVE STATE: VOICEMAIL",
        "If voicemail is detected, leave at most one short message and call update_call_disposition with VOICEMAIL."
      ].join("\n\n");
    case "COMPLETED":
    case "FAILED":
    case "PRE_CALL":
      return [
        common,
        `ACTIVE STATE: ${state}`,
        "Keep the response short and avoid starting a new pitch."
      ].join("\n\n");
    case "SAFETY_MANAGER_CONVERSATION":
    default:
      return [
        common,
        "ACTIVE STATE: SAFETY_MANAGER_CONVERSATION",
        `Script version: ${safetyManagerScript.version}`,
        `General opener: "${safetyManagerScript.variants.general.opener}"`,
        `Construction opener if first name is known: "${safetyManagerScript.variants.construction.opener}"`,
        `Permission: "${safetyManagerScript.permission}"`,
        "Why calling: pick whichever pain resonates; do not recite both mechanically.",
        formatList(safetyManagerScript.whyCallingOptions),
        `Meeting ask: "${safetyManagerScript.meetingAsk}"`,
        `Primary CTA: ${safetyManagerScript.primaryCta}`
      ].join("\n\n");
  }
}

export function createRealtimeAgentForState(
  state: ConversationState,
  { stateMachine }: AgentFactoryOptions
) {
  const updateCallDisposition = tool({
    name: "update_call_disposition",
    description:
      "Update the call disposition at a natural call-ending or status-changing moment. Console-only stub; future Notion write-back is Milestone 5.",
    parameters: z.object({
      disposition: z.enum(callDispositions),
      notes: z.string().optional()
    }),
    async execute({ disposition, notes }) {
      await stateMachine.updateDisposition(disposition, notes);
      return `Disposition logged: ${disposition}`;
    }
  });

  const requestMeetingBooking = tool({
    name: "request_meeting_booking",
    description:
      "Log a requested 10-minute meeting time. This is a console-only stub; actual calendar booking is Milestone 6.",
    parameters: z.object({
      proposedTime: z.string(),
      notes: z.string().optional()
    }),
    async execute({ proposedTime, notes }) {
      console.log(JSON.stringify({
        event: "meeting_booking_requested",
        callSid: stateMachine.currentCallSid,
        proposedTime,
        notes
      }));
      await stateMachine.updateDisposition("MEETING_REQUESTED", notes);
      return "Meeting request logged. Mathieu still needs to confirm the calendar.";
    }
  });

  const logDiscoveredContact = tool({
    name: "log_discovered_contact",
    description:
      "Log newly discovered Safety Manager contact details from a gatekeeper. Console-only stub; real Notion write-back is Milestone 5.",
    parameters: z.object({
      name: z.string().optional(),
      title: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional()
    }),
    async execute(contact) {
      console.log(JSON.stringify({
        event: "discovered_contact_logged",
        callSid: stateMachine.currentCallSid,
        contact
      }));
      return "Discovered contact logged for follow-up.";
    }
  });

  const transitionConversationState = tool({
    name: "transition_conversation_state",
    description:
      "Request a backend-owned conversation state transition when the call clearly moves to another state.",
    parameters: z.object({
      state: z.enum(conversationStates),
      reason: z.string()
    }),
    async execute({ state: nextState, reason }) {
      await stateMachine.transition(nextState, reason);
      return `State transition requested: ${nextState}`;
    }
  });

  return new RealtimeAgent({
    name: `AxenOps ${state.replaceAll("_", " ")} Agent`,
    instructions: instructionsForState(state),
    tools: [
      updateCallDisposition,
      requestMeetingBooking,
      transitionConversationState,
      ...(state === "GATEKEEPER" ? [logDiscoveredContact] : [])
    ]
  });
}
