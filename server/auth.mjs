import { betterAuth } from "better-auth";
export function authOptions(pool) {
  const baseURL = process.env.BETTER_AUTH_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!baseURL || !secret || secret.length < 32)
    throw Object.assign(
      new Error(
        "Configura BETTER_AUTH_URL y BETTER_AUTH_SECRET (32 caracteres o más).",
      ),
      { status: 503 },
    );
  return {
    database: pool,
    baseURL,
    secret,
    trustedOrigins: [new URL(baseURL).origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM)
          throw new Error("Recuperación por correo sin configurar.");
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.MAIL_FROM,
            to: user.email,
            subject: "Recupera tu acceso a VisitaFácil",
            text: `Para cambiar tu contraseña abre este enlace: ${url}`,
          }),
        });
        if (!response.ok)
          throw new Error("No se pudo enviar el correo de recuperación.");
      },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    advanced: {
      ...(process.env.VERCEL
        ? { ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for"] } }
        : {}),
      useSecureCookies: new URL(baseURL).protocol === "https:",
    },
  };
}
export const createAuth = (pool) => betterAuth(authOptions(pool));
