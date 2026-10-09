import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUserKeyInfo } from "@/lib/api-key";
import { AuthPanel } from "@/components/auth-panel";
import { Companion } from "@/components/companion";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <AuthPanel />;
  const keyInfo = await getUserKeyInfo(session.user.id);
  return (
    <Companion
      user={{ name: session.user.name, email: session.user.email }}
      initialKeyLast4={keyInfo?.last4 ?? null}
    />
  );
}
