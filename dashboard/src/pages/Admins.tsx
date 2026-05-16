import { useState } from "react";
import UserScopePanel from "../components/UserScopePanel";
import { InviteAdminForm } from "../components/InviteAdminForm";

/**
 * Dedicated Admins view. Lists every admin account and surfaces
 * the invite-admin form so operators can grow the team without
 * jumping over to the (hidden) cross-cutting Users page.
 */
export default function Admins() {
  // Bumping this signal forces UserScopePanel to refetch via its
  // useEffect dependency, WITHOUT remounting. An earlier version
  // used `key={n}` — that wiped the operator's search, sort,
  // hours, and pagination state on every invite.
  const [reloadSignal, setReloadSignal] = useState(0);

  return (
    <UserScopePanel
      eyebrow="Internal"
      title="Admins"
      subtitle="Operators with access to this dashboard. Invite teammates here — they'll get an email to set their password."
      role="admin"
      emptyMessage="No admin accounts in this window."
      headerSlot={<InviteAdminForm onInvited={() => setReloadSignal((n) => n + 1)} />}
      reloadSignal={reloadSignal}
    />
  );
}
