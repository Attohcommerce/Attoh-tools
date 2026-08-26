// REGISTER — nieuwe taak toevoegen = één bestand in lib/jobs/ + één import + één regel in JOBS.
// De /taken-pagina en de API lezen alles hieruit; verder hoeft er niets aangepast.

import bestsellingCheck from "./bestselling-check";
import genderMix from "./gender-mix";
import storeInfo from "./store-info";

const JOBS = [bestsellingCheck, genderMix, storeInfo];

// Metadata voor de client (zonder de run-functie).
export function listJobs() {
  return JOBS.map(({ run, ...meta }) => meta);
}

// Array-find, bewust geen object-indexing met rauwe input (constructor-valkuil).
export function getJob(id) {
  return JOBS.find((j) => j.id === id) || null;
}
