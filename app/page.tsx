import { requirePortalUser } from "../lib/auth";
import Portal from "./portal";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requirePortalUser();
  return <Portal user={user} />;
}
