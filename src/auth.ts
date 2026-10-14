import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import authConfig from "./auth.config";
import { SignInInputSchema } from "./lib/contracts/auth";
import { db } from "./lib/db";
import { ensurePersonalWorkspace } from "./server/services/workspaces";

// OAuth providers are enabled only when their credentials are configured.
const oauthConfigured = [
  ...(process.env.AUTH_GITHUB_ID ? [{ id: "github", provider: GitHub }] : []),
  ...(process.env.AUTH_GOOGLE_ID ? [{ id: "google", provider: Google }] : []),
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = SignInInputSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await db.user.findUnique({ where: { email: parsed.data.email } });
        // Compare against a dummy hash when the user is missing so response
        // time does not reveal whether an email is registered.
        const hash = user?.passwordHash ?? "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5sEkV9QKuDXbYZaFuxnOpg9gQuUJBUq";
        const valid = await bcrypt.compare(parsed.data.password, hash);
        if (!user || !user.passwordHash || !valid) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
    ...oauthConfigured.map((o) => o.provider),
  ],
  events: {
    // OAuth sign-ups go through the adapter, not our register route.
    async createUser({ user }) {
      if (user.id) await ensurePersonalWorkspace(user.id, user.name);
    },
  },
});

export const oauthProviderIds = oauthConfigured.map((o) => o.id);
