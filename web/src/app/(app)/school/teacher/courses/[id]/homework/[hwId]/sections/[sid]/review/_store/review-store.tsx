"use client";

import { createContext, useContext, useState, type ReactNode, type SetStateAction } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { RosterFilter } from "../_lib/types";

// The review page's session-only UI state: preferences that outlive a
// student switch (the detail panel remounts on every switch) but not a
// reload. One store per page mount — the provider creates it on mount
// and it is dropped on unmount — so nothing leaks between homeworks or
// sections. Each setter takes a value or an updater, like useState's.
type Fields = {
  rubricOpen: boolean;
  rosterFilter: RosterFilter;
  confirmedBySubmission: ReadonlyMap<string, ReadonlySet<string>>;
  gradeAnnouncement: string;
  photoPinned: boolean;
  integrityDetailsOpen: boolean;
  publishConfirmOpen: boolean;
  regradeConfirmOpenFor: string | null;
};

type Setters = {
  [K in keyof Fields as `set${Capitalize<K & string>}`]: (v: SetStateAction<Fields[K]>) => void;
};

export type ReviewState = Fields & Setters;

function apply<T>(v: SetStateAction<T>, prev: T): T {
  return typeof v === "function" ? (v as (p: T) => T)(prev) : v;
}

function createReviewStore(): StoreApi<ReviewState> {
  return createStore<ReviewState>()((set) => {
    const setter =
      <K extends keyof Fields>(key: K) =>
      (v: SetStateAction<Fields[K]>) =>
        set((s) => ({ [key]: apply(v, s[key]) }) as Pick<Fields, K>);
    return {
      rubricOpen: false,
      rosterFilter: "all",
      confirmedBySubmission: new Map(),
      gradeAnnouncement: "",
      photoPinned: true,
      integrityDetailsOpen: false,
      publishConfirmOpen: false,
      regradeConfirmOpenFor: null,
      setRubricOpen: setter("rubricOpen"),
      setRosterFilter: setter("rosterFilter"),
      setConfirmedBySubmission: setter("confirmedBySubmission"),
      setGradeAnnouncement: setter("gradeAnnouncement"),
      setPhotoPinned: setter("photoPinned"),
      setIntegrityDetailsOpen: setter("integrityDetailsOpen"),
      setPublishConfirmOpen: setter("publishConfirmOpen"),
      setRegradeConfirmOpenFor: setter("regradeConfirmOpenFor"),
    };
  });
}

const ReviewStoreContext = createContext<StoreApi<ReviewState> | null>(null);

export function ReviewStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createReviewStore);
  return <ReviewStoreContext.Provider value={store}>{children}</ReviewStoreContext.Provider>;
}

export function useReviewStore<T>(selector: (s: ReviewState) => T): T {
  const store = useContext(ReviewStoreContext);
  if (!store) throw new Error("useReviewStore must be used inside ReviewStoreProvider");
  return useStore(store, selector);
}
