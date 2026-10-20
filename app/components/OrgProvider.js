"use client";

// Organisatie-context (20-10-2026): de root layout leest de cookie `sa_org`
// op de server en geeft hem hier door, zodat elke pagina al bij de eerste
// render de juiste organisatie kent (geen flits van de verkeerde nav of
// kleur, geen hydration-verschil). Niet-React code (orgLS) leest dezelfde
// waarde via lib/org-client.js.
import { createContext, useContext } from "react";
import { DEFAULT_ORG, normOrg, orgOf } from "@/lib/org";

const OrgContext = createContext(DEFAULT_ORG);

export function OrgProvider({ org, children }) {
  return <OrgContext.Provider value={normOrg(org)}>{children}</OrgContext.Provider>;
}

/** "attoh" | "sacollective" */
export function useOrg() {
  return useContext(OrgContext);
}

/** Volledige definitie (naam, tools, doctor-instellingen) van de actieve organisatie. */
export function useOrgDef() {
  return orgOf(useContext(OrgContext));
}
