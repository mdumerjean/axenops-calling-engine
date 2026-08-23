import Fastify from "fastify";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import { TwilioRealtimeTransportLayer } from "@openai/agents-extensions";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import twilio from "twilio";

type RequiredEnv = {
  OPENAI_API_KEY: string;
  PUBLIC_BASE_URL: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
};

type OutboundCallBody = {
  to?: unknown;
};

type TwilioWebhookParams = {
  CallSid?: unknown;
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

function publicWebSocketUrl(baseUrl: string, path: string) {
  const url = new URL(path, baseUrl);
  url.protocol = "wss:";
  return url.toString();
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
const agent = new RealtimeAgent({
  name: "Test Voice Assistant",
  instructions:
    "You are a friendly, natural-sounding voice assistant conducting a brief test phone call. Keep responses short. If the person starts talking while you're speaking, stop immediately and listen. This is a technical test call, not a sales call."
});

const server = Fastify({ logger: true });

await server.register(websocket);
await server.register(formbody);

server.get("/health", async () => ({ ok: true }));

server.post<{ Body: OutboundCallBody }>("/calls/outbound", async (request, reply) => {
  const { to } = request.body ?? {};

  if (typeof to !== "string" || !e164Pattern.test(to)) {
    return reply.code(400).send({
      error: "Invalid 'to' phone number. Expected E.164 format."
    });
  }

  const call = await twilioClient.calls.create({
    from: env.TWILIO_PHONE_NUMBER,
    to,
    url: publicHttpUrl(env.PUBLIC_BASE_URL, "/twiml"),
    method: "POST"
  });

  logCall("outbound_call_initiated", call.sid, { to });

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
    const callSid = typeof body?.CallSid === "string"
      ? body.CallSid
      : typeof query?.CallSid === "string"
        ? query.CallSid
      : undefined;
    const streamUrl = publicWebSocketUrl(env.PUBLIC_BASE_URL, "/media-stream");
    const response = new twilio.twiml.VoiceResponse();
    const connect = response.connect();

    connect.stream({ url: streamUrl });

    logCall("twilio_webhook_hit", callSid, { streamUrl });

    return reply
      .type("text/xml")
      .send(response.toString());
  }
});

server.get("/media-stream", { websocket: true }, async (connection) => {
  let callSid: string | undefined;

  logCall("media_stream_connected", callSid);

  const transport = new TwilioRealtimeTransportLayer({
    twilioWebSocket: connection
  });

  const session = new RealtimeSession(agent, {
    transport,
    model: "gpt-realtime-2.1",
    config: {
      audio: {
        output: {
          voice: "verse"
        }
      }
    }
  });

  session.on("transport_event", (event) => {
    if (
      event.type === "twilio_message" &&
      typeof event.data === "object" &&
      event.data !== null
    ) {
      const message = event.data as {
        event?: string;
        start?: { callSid?: string };
      };

      if (message.event === "start" && message.start?.callSid) {
        callSid = message.start.callSid;
        logCall("media_stream_start_received", callSid);
      }
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
