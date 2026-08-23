import { TwilioRealtimeTransportLayer } from "@openai/agents-extensions";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";

const agent = new RealtimeAgent({
  name: "Smoke Test Agent"
});

new RealtimeSession(agent, {
  model: "gpt-realtime-2.1"
});

type TwilioTransportConstructor = typeof TwilioRealtimeTransportLayer;

export type { TwilioTransportConstructor };
