"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth";
import { getManagementUrl } from "@/services/revenuecat";

export default function AccountPage() {
  const user = useAuthStore((s) => s.user);
  const [portalLoading, setPortalLoading] = useState(false);

  async function openPortal() {
    if (!user) return;
    setPortalLoading(true);
    try {
      const url = await getManagementUrl(user.id);
      if (url) {
        window.location.assign(url);
      }
    } catch {
      // Silently fail — button re-enables
    } finally {
      setPortalLoading(false);
    }
  }

  if (!user) return null;

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Account</h1>

      {/* User info */}
      <div className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-6">
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Name</span>
            <span className="font-medium text-text-primary">{user.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Email</span>
            <span className="font-medium text-text-primary">{user.email}</span>
          </div>
        </div>
      </div>

      {/* Subscription */}
      <div className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-6">
        <h2 className="text-base font-bold text-text-primary">Subscription</h2>
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Plan</span>
            <span className="font-medium capitalize text-text-primary">
              {user.is_pro ? "Pro" : "Free"}
            </span>
          </div>
          {user.is_pro && (
            <>
              <div className="flex justify-between">
                <span className="text-text-secondary">Status</span>
                <span className="font-medium capitalize text-text-primary">
                  {user.subscription_status}
                </span>
              </div>
              {user.subscription_expires_at && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Renews</span>
                  <span className="font-medium text-text-primary">
                    {new Date(user.subscription_expires_at).toLocaleDateString()}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-6">
          {user.is_pro ? (
            <button
              onClick={openPortal}
              disabled={portalLoading}
              className="w-full rounded-[--radius-pill] border border-border-light py-2.5 text-sm font-bold text-text-primary transition-colors hover:bg-primary-bg disabled:opacity-50"
            >
              {portalLoading ? "Loading..." : "Manage Subscription"}
            </button>
          ) : (
            <Link
              href="/pricing"
              className="block w-full rounded-[--radius-pill] bg-primary py-2.5 text-center text-sm font-bold text-white transition-colors hover:bg-primary-dark"
            >
              Upgrade to Pro
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
