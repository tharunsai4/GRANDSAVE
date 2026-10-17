import { requireDeskUser } from "../../lib/auth";
import Desk from "../desk";

export const dynamic = "force-dynamic";

export default async function LegacyDesk() {
  const user = await requireDeskUser();
  return <Desk userName={user.displayName} />;
}
