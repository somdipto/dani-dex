import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/solid-router";
import { createOpenAiRealtimeClientSecret, OpenAiRealtimeError } from "../../../server/openai-realtime";
import { apiError, authErrorResponse, bearerToken, json, requestAuthService } from "../../../server/request-auth";
import { requireWorkerBindings } from "../../../server/types";

export const Route = createFileRoute("/v1/realtime/client-secret")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const token = bearerToken(request);
          if (!token) return apiError(401, "unauthorized", "Sign in is required.");
          const user = await requestAuthService().authenticate(token);
          if (!user) return apiError(401, "unauthorized", "The session is invalid.");
          return json(await createOpenAiRealtimeClientSecret(requireWorkerBindings(env), user.id));
        } catch (error) {
          if (error instanceof OpenAiRealtimeError) return apiError(error.status, error.code, error.message);
          return authErrorResponse(error);
        }
      },
    },
  },
});
