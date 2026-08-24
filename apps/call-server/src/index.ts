import Fastify from "fastify";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import { TwilioRealtimeTransportLayer } from "@openai/agents-extensions";
import { RealtimeSession } from "@openai/agents/realtime";
import twilio from "twilio";
import { createRealtimeAgentForState } from "./realtime/agent-factory.js";
import { CallStateMachine } from "./state-machine/call-state-machine.js";
import {
  defaultStartState,
  isConversationState,
  type ConversationState
} from "./state-machine/states.js";

type RequiredEnv = {
  OPENAI_API_KEY: string;
  PUBLIC_BASE_URL: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
};

type OutboundCallBody = {
  to?: unknown;
  startState?: unknown;
};

type TwilioWebhookParams = {
  CallSid?: unknown;
  startState?: unknown;
  StartState?: unknown;
};

const requiredEnvNames = [
  "OPENAI_API_KEY",
  "PUBLIC_BASE_URL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER"
] as const;

const e164Pattern = /^\+[1-9]\d{1,14}$/;

function loadRequiredEnv(): RequiredEnv {
  const missing = requiredEnvNames.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL!,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID!,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN!,
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER!
  };
}

function publicHttpUrl(baseUrl: string, path: string) {
  return new URL(path, baseUrl).toString();
}

function publicHttpUrlWithStartState(
  baseUrl: string,
  path: string,
  startState: ConversationState
) {
  const url = new URL(path, baseUrl);
  url.searchParams.set("startState", startState);
  return url.toString();
}

function publicWebSocketUrl(
  baseUrl: string,
  path: string,
  startState: ConversationState
) {
  const url = new URL(path, baseUrl);
  url.protocol = "wss:";
  url.searchParams.set("startState", startState);
  return url.toString();
}

function readStartState(value: unknown): ConversationState | undefined {
  return isConversationState(value) ? value : undefined;
}

function getTwilioParamStartState(params: TwilioWebhookParams | undefined) {
  return readStartState(params?.startState) ?? readStartState(params?.StartState);
}

function logCall(event: string, callSid: string | undefined, data = {}) {
  console.log(
    JSON.stringify({
      event,
      callSid,
      ...data
    })
  );
}

const env = loadRequiredEnv();
const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

const server = Fastify({ logger: true });

await server.register(websocket);
await server.register(formbody);

server.get("/health", async () => ({ ok: true }));

server.post<{ Body: OutboundCallBody }>("/calls/outbound", async (request, reply) => {
  const { to, startState: rawStartState } = request.body ?? {};
  const startState = readStartState(rawStartState) ?? defaultStartState;

  if (typeof to !== "string" || !e164Pattern.test(to)) {
    return reply.code(400).send({
      error: "Invalid 'to' phone number. Expected E.164 format."
    });
  }

  const call = await twilioClient.calls.create({
    from: env.TWILIO_PHONE_NUMBER,
    to,
    url: publicHttpUrlWithStartState(env.PUBLIC_BASE_URL, "/twiml", startState),
    method: "POST"
  });

  logCall("outbound_call_initiated", call.sid, { to, startState });

  return reply.send({ callSid: call.sid });
});

server.route({
  method: ["GET", "POST"],
  url: "/twiml",
  handler: async (request, reply) => {
    const body = typeof request.body === "object" && request.body !== null
      ? request.body as TwilioWebhookParams
      : undefined;
    const query = typeof request.query === "object" && request.query !== null
      ? request.query as TwilioWebhookParams
      : undefined;
    const startState =
      getTwilioParamStartState(body) ??
      getTwilioParamStartState(query) ??
      defaultStartState;
    const callSid = typeof body?.CallSid === "string"
      ? body.CallSid
      : typeof query?.CallSid === "string"
        ? query.CallSid
      : undefined;
    const streamUrl = publicWebSocketUrl(env.PUBLIC_BASE_URL, "/media-stream", startState);
    const response = new twilio.twiml.VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({ url: streamUrl });

    stream.parameter({ name: "startState", value: startState });

    logCall("twilio_webhook_hit", callSid, { streamUrl, startState });

    return reply
      .type("text/xml")
      .send(response.toString());
  }
});

server.get("/media-stream", { websocket: true }, async (connection, request) => {
  let callSid: string | undefined;
  const query = typeof request.query === "object" && request.query !== null
    ? request.query as TwilioWebhookParams
    : undefined;
  let startState =
    getTwilioParamStartState(query) ??
    defaultStartState;
  const stateMachine = new CallStateMachine(callSid, startState);

  logCall("media_stream_connected", callSid, { startState });

  const transport = new TwilioRealtimeTransportLayer({
    twilioWebSocket: connection
  });

  const createAgent = (state: ConversationState) =>
    createRealtimeAgentForState(state, { stateMachine });
  const session = new RealtimeSession(createAgent(stateMachine.state), {
    transport,
    model: "gpt-realtime-2.1",
    config: {
      audio: {
        output: {
          voice: "cedar"
        }
      }
    }
  });

  stateMachine.onStateChange(async (state) => {
    await session.updateAgent(createAgent(state));
  });

  session.on("transport_event", async (event) => {
    if (
      event.type === "twilio_message" &&
      typeof event.data === "object" &&
      event.data !== null
    ) {
      const message = event.data as {
        event?: string;
        start?: {
          callSid?: string;
          customParameters?: Record<string, string>;
        };
      };

      if (message.event === "start" && message.start?.callSid) {
        callSid = message.start.callSid;
        stateMachine.setCallSid(callSid);
        startState =
          readStartState(message.start.customParameters?.startState) ??
          startState;
        if (startState !== stateMachine.state) {
          await stateMachine.transition(startState, "twilio_stream_start_custom_parameter");
        }
        logCall("media_stream_start_received", callSid);
      }
      return;
    }

    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      typeof event.transcript === "string"
    ) {
      await stateMachine.handleTranscript(event.transcript);
    }
  });

  session.on("audio_interrupted", () => {
    logCall("realtime_audio_interrupted", callSid);
  });

  session.on("error", (error) => {
    logCall("realtime_session_error", callSid, { error });
    connection.close();
  });

  connection.on("close", () => {
    logCall("realtime_session_disconnected", callSid);
  });

  try {
    await session.connect({ apiKey: env.OPENAI_API_KEY });
    logCall("realtime_session_connected", callSid);
  } catch (error) {
    logCall("realtime_session_connect_failed", callSid, { error });
    connection.close();
  }
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";

await server.listen({ port, host });
