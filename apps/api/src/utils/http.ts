import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

export function sendZodError(reply: FastifyReply, error: ZodError) {
  return reply.code(400).send({
    error: "validation_error",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }))
  });
}

export function sendNotFound(reply: FastifyReply, resource: string) {
  return reply.code(404).send({
    error: "not_found",
    message: `${resource} was not found.`
  });
}
