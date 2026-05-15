import { useState } from "react";
import UserScopePanel from "../components/UserScopePanel";
import { InviteAdminForm } from "../components/InviteAdminForm";

/**
 * Dedicated Admins view. Lists every admin account and surfaces
 * the invite-admin form so operators can grow the team without
 * jumping over to the (hidden) cross-cutting Users page.
 */
export default function Admins() {
  // Bumping this forces UserScopePanel to reload after a new
  // invite lands. Cheaper than wiring a callback through the
  // panel's internal state.
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <UserScopePanel
      key={reloadKey}
      eyebrow="Internal"
      title="Admins"
      subtitle="Operators with access to this dashboard. Invite teammates here — they'll get an email to set their password."
      role="admin"
      emptyMessage="No admin accounts in this window."
      headerSlot={<InviteAdminForm onInvited={() => setReloadKey((k) => k + 1)} />}
    />
  );
}
