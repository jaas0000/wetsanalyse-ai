// Sleutels + opruiming voor de lokale chat-opslag van "Lex". Gedeeld door ChatAssistent (schrijft de
// sessie-id + geschiedenis) en SiteNav (wist ze bij uitloggen), zodat de sleutelnamen op één plek
// staan. De gespreksinhoud staat ongecodeerd in localStorage; op een gedeelde machine moet uitloggen
// die dus opruimen.

export const CHAT_SESSIE_KEY = "kg-chat-sessie";
export const CHAT_HIST_PREFIX = "kg-chat-historie";

/** Wis alle lokale chatgeschiedenis + de sessie-id (o.a. bij uitloggen). Best-effort: faalt stil als
 *  localStorage niet beschikbaar is. */
export function wisChatOpslag(): void {
  try {
    localStorage.removeItem(CHAT_SESSIE_KEY);
    for (const key of Object.keys(localStorage)) {
      if (key === CHAT_HIST_PREFIX || key.startsWith(`${CHAT_HIST_PREFIX}:`)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* opslag ontoegankelijk — niet fataal */
  }
}
