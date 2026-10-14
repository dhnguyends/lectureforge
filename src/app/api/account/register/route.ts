import { clientIp, json, parseBody, route } from "@/lib/api";
import { RegisterInputSchema } from "@/lib/contracts/auth";
import { registerUser } from "@/server/services/users";

export const POST = route(async (req) => {
  const input = await parseBody(req, RegisterInputSchema);
  return json(await registerUser(input, clientIp(req)), 201);
});
