// Magyar fordítás. Szerkezete megegyezik az en.ts-sel (a TypeScript ellenőrzi).
// Az új (v2) felület szövegei egyelőre angolul maradnak: a magyar fordítás külön feladat.
import { en, type Messages } from "./en";

export const hu: Messages = {
  ...en,
  languageName: "Magyar",
  languageLabel: "Nyelv",
  appTitle: "Leltáregyeztetés",
  apiDown: "A szerver nem érhető el. Indítsa el a `make dev` paranccsal.",
  loading: "Betöltés…",
  close: "Bezárás",
  cancel: "Mégse",
  // Szervertől érkező üzenetek kód szerint (backend/recon/messages.py).
  messages: {
    ...en.messages,
    unknown_city: (p) => `A(z) '${p.city}' város nem szerepel a helyszínek között.`,
    site_city_conflict: (p) => `A(z) ${p.site_code} telephelykód nem a(z) '${p.city}' városhoz tartozik.`,
    bad_activation_date: (p) => `Az aktiválás dátuma ('${p.value}') nem olvasható.`,
    missing_asset_id: () => "Az eszközazonosító üres.",
    unknown_building: (p) => `A(z) '${p.building}' épület nem szerepel a helyszínek között.`,
    bad_serial: (p) => `A(z) '${p.serial}' sorozatszámban nincs SN-ÉÉÉÉ- évszám.`,
    bad_width: (p) => `A szélesség ('${p.value}') nem egész szám.`,
    files_swapped: (p) =>
      `A(z) ${p.sheet} munkalap a(z) '${p.file}' fájlban található, amelyet ${p.role === "sap" ? "SAP-" : "leltár"}fájlként töltött fel. Lehet, hogy a fájlokat felcserélte.`,
    asset_id_conflict: (p) =>
      `A(z) ${p.value} eszközazonosító a(z) ${p.rows}. sorokban szerepel, de a sorok többi adata eltér (nem egyszerű duplikátum).`,
    qr_code_conflict: (p) =>
      `A(z) ${p.value} QR-kód a(z) ${p.rows}. sorokban szerepel, de a sorok többi adata eltér (nem egyszerű duplikátum).`,
    sap_duplicate: (p) => `Megegyezik a(z) ${p.first}. SAP-sorral (kétszeres adatrögzítés).`,
    physical_duplicate: (p) => `Megegyezik a(z) ${p.first}. leltársorral (kétszeres adatrögzítés).`,
    defective_excluded: () => "Hibás – kizárva (várhatóan nem szerepel az SAP-ban).",
    unclassified_note: () => "Egyetlen típusszabály sem illik erre a megnevezésre és leírásra.",
    unclassified: (p) => `'${p.item}: ${p.description}' – egyetlen típusszabály sem illik rá.`,
    sap_only: (p) => `Ehhez a tételhez (${p.item}) nem található fizikai egység (hiányzó / elveszett eszköz).`,
    physical_only: (p) => `Ehhez a tételhez (${p.sap_type}, eszköz: ${p.asset_id}) nem található SAP-sor.`,
    tie_pick: (p) =>
      `${p.group} csoport: válassza ki a fizikai egységet (javaslat: ${p.suggested ?? "párosítatlan marad"}).`,
    tie_unresolved: (p) =>
      `${p.sap_type} (${p.year ?? "?"}), ${p.group} csoport: az adatok alapján ezek az egységek nem különböztethetők meg, döntés szükséges (javaslat: ${p.suggested ?? "párosítatlan marad"}).`,
    tie_candidate: (p) => `Jelölt a(z) ${p.group} csoportban.`,
    manual_unmatched: () => "Kézzel párosítatlanul hagyva.",
    manual_left_physical: () => "A kézi döntések után párosítatlan maradt.",
    decision_invalid: (p) =>
      `A(z) ${p.sap_row}. SAP-sorra hozott kézi döntés (eszköz: ${p.asset_id}) már nem illik a csoportjába, ezért elvetettük.`,
    decision_stale: (p) =>
      `A(z) ${p.sap_row}. SAP-sorra hozott kézi döntést elvetettük: ez a sor már nem igényel döntést.`,
    location_mismatch: (p) => `A leltár szerint ${p.city}, a bejövő lista szerint ${p.building}.`,
    deactivated: () => "Az egységnek van deaktiválási dátuma.",
    year_gap: (p) => `Az aktiválás éve és a sorozatszám éve ${p.gap} évvel eltér.`,
  },
};
