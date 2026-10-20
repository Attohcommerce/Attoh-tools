// Organisatie aan de serverkant (route handlers): cookie `sa_org` lezen en
// Redis-keys prefixen. Buiten een request (scripts, tests, cron) is er geen
// cookie → attoh, zoals altijd.
import { cookies } from "next/headers";
import { ORG_COOKIE, normOrg, nsKey, orgOf } from "./org";

export function getOrg() {
  try {
    const c = cookies().get(ORG_COOKIE);
    return normOrg(c && c.value);
  } catch {
    return normOrg("");
  }
}

export function currentOrgDef() {
  return orgOf(getOrg());
}

/** Redis-key voor de organisatie van dit request. */
export function rkey(key) {
  return nsKey(getOrg(), key);
}
