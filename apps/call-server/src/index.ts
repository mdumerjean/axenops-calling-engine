import Fastify from "fastify";

const server = Fastify({ logger: true });

server.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";

await server.listen({ port, host });
