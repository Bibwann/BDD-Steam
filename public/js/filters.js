/**
 * ============================================================
 * Steam-like Games Browser (Frontend)
 * ------------------------------------------------------------
 * High-level overview
 * - Profiles: "kid" / "person1" / "person2". The active one is
 *   persisted in localStorage (PROFILE_KEY) and also sent to the backend
 *   so server-side filters can apply (e.g., kid-safe results).
 *
 * - Favorites: per-profile list saved in localStorage under key
 *   `${FAV_KEY_BASE}:${CURRENT_PROFILE}`. Used by the "favorites"
 *   and "recommendations" categories.
 *
 * - Backend endpoints this file talks to:
 *   • POST /api/games/search         -> search & pagination
 *   • GET  /api/games/distinct/:kind -> distinct values (genres/languages/developers)
 *   • POST /api/games/goty/set       -> set GOTY (Game of the Year)
 *   • POST /api/games/goty/unset     -> unset GOTY
 *
 * - UI structure (IDs/classes expected in HTML/CSS):
 *   #profile-select, #search-input, #sort-select, #genre-select,
 *   #language-select, #multiplayer-select, #developer-select,
 *   #price-min, #price-max, #price-value, #goty-year,
 *   .main-nav .nav-btn[data-category], .platform-btn[data-platform],
 *   #games-grid, #results-count, #loading, #no-results, #toaster,
 *   #pager (created dynamically), #add-goty-btn, #content-title
 *
 * - State & caching:
 *   • 'state' tracks pagination and the latest filters fingerprint (lastKey).
 *   • DISTINCT_CACHE memoizes results of /distinct per {kind, profile}.
 *   • CURRENT_SEARCH_CTRL (AbortController) ensures in-flight searches
 *     can be canceled when filters change quickly.
 *
 * Accessibility & UX:
 * - Buttons update aria-pressed, modal uses proper roles, typeahead
 *   lists use role="listbox"/"option".
 * ============================================================
 */


/* ========================== DOM helpers ========================== */

/**
 * JSON stringify helper.
 * @param {any} v - Any value.
 * @returns {string} JSON string or throws if circular.
 */
function j(v){ return JSON.stringify(v); }

/**
 * Shortcut for document.getElementById.
 * @param {string} id - Element id.
 * @returns {HTMLElement|null}
 */
function el(id){ return document.getElementById(id); }

/**
 * Shortcut for document.querySelector.
 * @param {string} sel - CSS selector.
 * @returns {Element|null}
 */
function qs(sel){ return document.querySelector(sel); }

/**
 * Shortcut for document.querySelectorAll that returns a real Array.
 * @param {string} sel - CSS selector.
 * @returns {Element[]} array of matched elements
 */
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }


/* ===================== "simulated users" state ==================== */

/** localStorage key for active profile. */
const PROFILE_KEY = "activeProfile";

/** Available profiles that the UI supports. */
const PROFILES = ["kid", "person1", "person2"];

/**
 * Current active profile.
 * - Loaded once from localStorage, defaults to "person1".
 * - Also sent to backend so server-side filters can apply.
 */
let CURRENT_PROFILE = localStorage.getItem(PROFILE_KEY) || "person1";


/**
 * Genres hidden for kid profile (client-side safety guard).
 * NOTE: The server should also apply safety rules; this is an extra guard.
 */
const BAD_GENRES = new Set(["Violent", "Sexual Content", "Nudity", "Gore"]);


/* ================== Favorites (per-profile) keys ================== */

/** Base key for favorites in localStorage (per profile). */
const FAV_KEY_BASE = "steamFavs";

/**
 * Compute the favorites key for the current profile.
 * @returns {string} e.g. "steamFavs:person1"
 */
const favKey = () => `${FAV_KEY_BASE}:${CURRENT_PROFILE}`;


/* =================== Distinct values cache layer ================== */

/**
 * In-memory cache for GET /api/games/distinct/:kind
 * Keyed by `${kind}:${profile}` to keep them profile-aware.
 * Value shape: { ok:boolean, items: string[] }
 */
const DISTINCT_CACHE = Object.create(null);


/* ========================== Backend helpers ======================= */

/**
 * POST /api/games/search
 * Performs a paginated search on the backend.
 *
 * @param {object} payload - Search body:
 *   {
 *     filters: {...}, sort: "name-asc" | ...,
 *     page:number, limit:number,
 *     projection?: object, withTotal?: boolean
 *   }
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal] - Optional abort signal to cancel the request.
 * @returns {Promise<{ok?:boolean,total?:number,items:any[],hasMore?:boolean}>}
 *          'ok' is backend-specific; 'total' appears when withTotal=true.
 */
async function apiSearch(payload, { signal } = {}){
  const res = await fetch("/api/games/search", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload),
    signal
  });
  if(!res.ok) throw new Error("http "+res.status);
  return res.json(); // { ok, total, items, hasMore? }
}

/**
 * GET /api/games/distinct/:kind?profile=...
 * Retrieves distinct lists for filters (genres/languages/developers) and caches them.
 * Cache is profile-aware to reflect kid-safe filtering server-side.
 *
 * @param {"genres"|"languages"|"developers"} kind
 * @returns {Promise<{ok?:boolean,items:string[]}>}
 */
async function getDistinct(kind){
  const cacheKey = `${kind}:${CURRENT_PROFILE}`;
  if (DISTINCT_CACHE[cacheKey]) return DISTINCT_CACHE[cacheKey];

  // Include current profile so backend applies kid filters server-side
  const res = await fetch(`/api/games/distinct/${kind}?profile=${encodeURIComponent(CURRENT_PROFILE)}`);
  if(!res.ok) throw new Error("http "+res.status);
  const json = await res.json(); // { ok, items }
  DISTINCT_CACHE[cacheKey] = { ok: json.ok, items: Array.isArray(json.items) ? [...json.items] : [] };
  return DISTINCT_CACHE[cacheKey];
}

/**
 * POST /api/games/goty/set
 * Marks a game as GOTY for a year on behalf of a profile.
 *
 * @param {string|number} appid
 * @param {number} year - e.g., 2024
 * @param {string} profile - which profile owns the GOTY
 * @returns {Promise<any>} backend JSON
 */
async function apiSetGoty(appid, year, profile){
  const res = await fetch("/api/games/goty/set", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ appid, year, profile })
  });
  if(!res.ok) throw new Error("http "+res.status);
  return res.json();
}

/**
 * POST /api/games/goty/unset
 * Clears a GOTY entry. You can specify by year+profile or appid+profile.
 *
 * @param {object} [params]
 * @param {number} [params.year] - If present, unsets the year's GOTY for the profile.
 * @param {string|number} [params.appid] - If present (and year absent), unsets GOTY for that game.
 * @param {string} [params.profile] - Which profile to affect.
 * @returns {Promise<any>} backend JSON
 */
async function apiUnsetGoty({ year, appid, profile } = {}){
  const res = await fetch("/api/games/goty/unset", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(
      year != null
        ? { year:Number(year), profile }
        : { appid:String(appid), profile }
    )
  });
  if(!res.ok) throw new Error("http "+res.status);
  return res.json();
}


/* -------------------------------------------------------------------------- */
/* favorites (localStorage) — per-profile                                     */
/* -------------------------------------------------------------------------- */

/**
 * Loads the favorites list for CURRENT_PROFILE from localStorage.
 * @returns {string[]} array of appids as strings
 */
function loadFavs(){
  try{ return JSON.parse(localStorage.getItem(favKey()) || "[]"); }catch{ return []; }
}

/**
 * Saves a favorites list for CURRENT_PROFILE in localStorage.
 * Ensures values are unique and stringified.
 * @param {Array<string|number>} list
 */
function saveFavs(list){
  localStorage.setItem(favKey(), JSON.stringify(Array.from(new Set(list.map(String)))));
}

/**
 * Tests whether a given appid is favorited for CURRENT_PROFILE.
 * @param {string|number} appid
 * @returns {boolean}
 */
function isFav(appid){
  return loadFavs().includes(String(appid));
}

/**
 * Toggles favorite state for a single appid:
 * - Updates localStorage per profile.
 * - Updates the UI button state/label.
 * - If current category is "favorites" or "recommendations", re-runs the search
 *   from page 1 to reflect the change (and clears the state cache key).
 *
 * @param {string|number} appid
 * @sideEffects localStorage write, DOM updates, schedules runSearch
 */
function toggleFav(appid){
  const id = String(appid);
  let list = loadFavs();
  if(list.includes(id)){
    list = list.filter(x => x !== id);
    toast("Removed from favorites");
  }else{
    list.push(id);
    toast("Added to favorites");
  }
  saveFavs(list);

  // Update any visible favorite button for this card
  const btn = document.querySelector(`.fav-btn[data-appid="${id}"]`);
  if(btn){
    const active = isFav(id);
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
    btn.innerHTML = active ? "★ Liked" : "☆ Like";
  }

  // Determine current category and refresh "favorites" / "recommendations" views
  const catBtn = document.querySelector(".main-nav .nav-btn.active");
  const cat = catBtn ? catBtn.getAttribute("data-category") : "all";
  
  // MODIFIED: Trigger search for both favorites AND recommendations
  if (cat === "favorites" || cat === "recommendations") {
    // Reset to page 1 and refresh
    state.page = 1;
    state.lastKey = ""; // Force refresh by clearing fingerprint cache
    setTimeout(runSearch, 60);
  }
}


/**
 * Displays a transient toast message in #toaster.
 * @param {string} msg
 */
function toast(msg){
  const t = el("toaster");
  if(!t) return;
  const item = document.createElement("div");
  item.className = "toast-item";
  item.textContent = msg;
  t.appendChild(item);
  setTimeout(()=>{ item.classList.add("show"); }, 20);
  setTimeout(()=>{ item.classList.remove("show"); item.remove(); }, 2000);
}


/* ============================== UI: states =============================== */

/**
 * Shows/hides a loading overlay (#loading).
 * @param {boolean} on
 */
function setLoading(on){
  const l = el("loading"); if(!l) return;
  l.style.display = on ? "flex" : "none";
}

/**
 * Shows/hides the "no results" block (#no-results).
 * @param {boolean} on
 */
function showNoResults(on){
  const n = el("no-results"); if(!n) return;
  n.style.display = on ? "block" : "none";
}

/**
 * Renders the total results count in #results-count.
 * @param {number} n
 */
function renderCount(n){
  const r = el("results-count");
  if(r) r.textContent = `${n} games found`;
}


/* ========================== Formatting helpers =========================== */

/**
 * Formats prices: 0 -> Free, number -> "$ 0.00", null/NaN -> "N/A".
 * @param {number|string|null|undefined} v
 * @returns {string}
 */
function formatPrice(v){
  if (v === 0) return "Free";
  if (v == null || v === "") return "N/A";
  const n = Number(v);
  return Number.isFinite(n) ? `$ ${n.toFixed(2)}` : "N/A";
}

/**
 * Parses a date-like value and returns a localized short date.
 * Falls back to the original string if parsing fails.
 * @param {string|number|Date} s
 * @returns {string}
 */
function formatDate(s){
  if (!s) return "";
  const d = new Date(s);
  if (!isNaN(d)) {
    return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
  }
  return String(s);
}

/**
 * Joins array items compactly, showing "+N more" for overflow.
 * @param {any[]} arr
 * @param {number} [max=3]
 * @returns {string}
 */
function listCompact(arr, max=3){
  if (!Array.isArray(arr) || arr.length===0) return "";
  const head = arr.slice(0, max).join(", ");
  const rest = arr.length - max;
  return rest > 0 ? `${head} +${rest} more` : head;
}

/**
 * If value is an array -> join by ", ", else return the value or "".
 * @param {any} v
 * @returns {string}
 */
function firstOrList(v){
  if (Array.isArray(v)) return v.join(", ");
  return v || "";
}

/**
 * Returns small platform badges based on boolean flags in game object.
 * @param {object} g - Game object with windows/mac/linux booleans.
 * @returns {string} HTML string
 */
function platformsIcons(g){
  const icons = [];
  if (g.windows) icons.push(`<span class="badge" title="Windows">🪟</span>`);
  if (g.mac)     icons.push(`<span class="badge" title="macOS">🍎</span>`);
  if (g.linux)   icons.push(`<span class="badge" title="Linux">🐧</span>`);
  return icons.join("");
}

/**
 * Build a score badge (user score preferred over metacritic).
 * @param {object} g - Game object possibly with user_score/metacritic_score.
 * @returns {string} HTML string
 */
function scoreBadge(g){
  if (g.user_score && Number(g.user_score) > 0) return `<span class="badge" title="User score">★ ${g.user_score}</span>`;
  if (g.metacritic_score && Number(g.metacritic_score) > 0) return `<span class="badge" title="Metacritic">MC ${g.metacritic_score}</span>`;
  return "";
}

/**
 * Safely lists tag keys from a tags object (up to max).
 * @param {object} tagsObj - Dictionary-like tags object.
 * @param {number} [max=6]
 * @returns {string}
 */
function safeTags(tagsObj, max=6){
  if (!tagsObj || typeof tagsObj !== "object") return "";
  return listCompact(Object.keys(tagsObj), max);
}

/**
 * Returns a header image URL or an inline SVG placeholder.
 * @param {object} g - Game object with header_image field.
 * @returns {string} URL or data URI
 */
function headerSrc(g){
  return g.header_image || "data:image/svg+xml;utf8," + encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' width='640' height='240'>
      <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='#0e8392'/><stop offset='100%' stop-color='#0b6471'/>
      </linearGradient></defs>
      <rect width='100%' height='100%' fill='url(#g)'/>
      <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='white' font-family='sans-serif' font-size='26'>No Image</text>
    </svg>
  `);
}

/**
 * Smoothly scrolls to top of results/grid area.
 */
function scrollToGridTop(){
  const anchor = el("content-title") || el("games-grid") || document.body;
  anchor.scrollIntoView({ behavior: "smooth", block: "start" });
}


/* ========================== Pagination state ============================ */

/** Default number of items per page. */
const PAGELIMIT_DEFAULT = 40;

/**
 * Global UI/search state.
 * - 'lastKey' is a fingerprint of (filters+sort) used to detect changes.
 */
const state = {
  page: 1,
  limit: PAGELIMIT_DEFAULT,
  total: 0,
  hasMore: false,
  lastKey: "",      // fingerprint of filters+sort
};

/**
 * Stable, order-insensitive fingerprint for filters+sort.
 * @param {object} filters
 * @param {string} sort
 * @returns {string}
 */
function buildKey(filters, sort){
  return JSON.stringify({ filters, sort });
}


/* ============================== Pager UI ================================ */

/**
 * Ensures a #pager container exists in the DOM after #games-grid.
 * Creates it if missing.
 */
function ensurePager() {
  let pager = el("pager");
  let grid = el("games-grid");
  if (!grid) return;
  if (!pager) {
    pager = document.createElement("div");
    pager.id = "pager";
    pager.className = "pager";
    grid.insertAdjacentElement("afterend", pager);
  }
}

/**
 * Renders pagination controls and wires up events.
 * - Uses 'state' to compute pages and range (from/to).
 * - Calls runSearch() when user navigates or changes page size.
 */
function renderPager() {
  ensurePager();
  const pager = el("pager");
  if (!pager) return;

  const { page, limit, total } = state;
  const pages = total ? Math.max(1, Math.ceil(total / Math.max(1, limit))) : 1;
  const from  = total ? ((page - 1) * limit + 1) : 0;
  const to    = total ? Math.min(page * limit, total) : 0;

  pager.innerHTML = `
    <div class="pager__row">
      <div class="pager__info">
        ${total ? `Showing ${from}–${to} of ${total}` : `No results`}
      </div>
      <div class="pager__controls">
        <button class="btn btn--secondary pager__btn" data-act="first" ${page <= 1 ? "disabled":""}>« First</button>
        <button class="btn btn--secondary pager__btn" data-act="prev"  ${page <= 1 ? "disabled":""}>‹ Prev</button>
        <span class="pager__page">Page ${Math.min(page, pages)} / ${pages}</span>
        <button class="btn btn--secondary pager__btn" data-act="next"  ${page >= pages ? "disabled":""}>Next ›</button>
        <button class="btn btn--secondary pager__btn" data-act="last"  ${page >= pages ? "disabled":""}>Last »</button>
        <select class="form-control pager__limit" title="Items per page" aria-label="Items per page">
          ${[20,40,60,100].map(v => `<option value="${v}" ${v===state.limit ? "selected":""}>${v}/page</option>`).join("")}
        </select>
      </div>
    </div>
  `;

  const go = (p) => {
    const target = Math.min(Math.max(1, p), pages);
    if (target !== state.page) {
      runSearch({ page: target });
      scrollToGridTop();
    }
  };
  pager.querySelector('[data-act="first"]')?.addEventListener("click", () => go(1));
  pager.querySelector('[data-act="prev"]') ?.addEventListener("click", () => go(state.page - 1));
  pager.querySelector('[data-act="next"]') ?.addEventListener("click", () => go(state.page + 1));
  pager.querySelector('[data-act="last"]') ?.addEventListener("click", () => go(pages));
  pager.querySelector(".pager__limit")?.addEventListener("change", (e) => {
    state.limit = Number(e.target.value) || PAGELIMIT_DEFAULT;
    runSearch({ page: 1 });
    scrollToGridTop();
  });
}


/* -------------------------------------------------------------------------- */
/* GOTY: Modal + typeahead suggestions                                        */
/* -------------------------------------------------------------------------- */

/**
 * In-memory selection from the GOTY typeahead.
 * Shape: { appid:string, name:string } or null
 */
let gotySelection = null;

/**
 * Creates (once) and initializes the GOTY modal DOM and behavior.
 * - Builds year list (from 1990..current).
 * - Wires up typeahead input, suggestions, keyboard navigation.
 * - Wires up "Save GOTY" to call apiSetGoty and refresh results.
 * @returns {HTMLElement} the modal root node (#goty-modal)
 */
function ensureGotyModal(){
  let m = el("goty-modal");
  const needsBuild = !m || !m.querySelector("#goty-typeahead");

  if (!m) {
    m = document.createElement("div");
    m.id = "goty-modal";
    m.className = "modal hidden";
    document.body.appendChild(m);
  }
  if (needsBuild) {
    m.innerHTML = `
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="goty-title">
        <div class="modal-header">
          <h3 id="goty-title">Add Game of the Year</h3>
          <button class="modal-close" aria-label="Close">×</button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label for="goty-typeahead">Search game</label>
            <div class="typeahead-wrap">
              <input id="goty-typeahead" class="form-control" type="text" autocomplete="off"
                     placeholder="Start typing a game name…" />
              <div id="goty-suggest" class="typeahead-list" role="listbox" aria-label="Suggestions"></div>
            </div>
          </div>

          <div class="form-group">
            <label for="goty-year-select">Year</label>
            <select id="goty-year-select" class="form-control"></select>
          </div>
        </div>

        <div class="modal-footer">
          <button id="goty-cancel" class="btn btn--secondary">Cancel</button>
          <button id="goty-save"   class="btn btn--primary" disabled>Save GOTY</button>
        </div>
      </div>
    `;

    const close = () => m.classList.add("hidden");
    m.querySelector(".modal-close").addEventListener("click", close);
    m.querySelector("#goty-cancel").addEventListener("click", close);
    m.addEventListener("click", (e)=>{ if(e.target === m) close(); });

    // Populate years from current year down to 1990
    const ySel = m.querySelector("#goty-year-select");
    const nowY = new Date().getFullYear();
    const years = Array.from({length: nowY - 1989}, (_,i)=> nowY - i);
    ySel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");

    const input = m.querySelector("#goty-typeahead");
    const list  = m.querySelector("#goty-suggest");
    const save  = m.querySelector("#goty-save");

    input.readOnly = false; input.disabled = false; input.style.pointerEvents = "auto";

    /**
     * Sets the current GOTY game selection.
     * @param {{appid:string,name:string}|null} game
     */
    const setSelection = (game) => {
      gotySelection = game ? { appid: String(game.appid), name: game.name } : null;
      input.value = game ? game.name : input.value;
      save.disabled = !gotySelection;
      qsa("#goty-suggest .item").forEach(li => li.classList.remove("active"));
      if (game) list.querySelector(`[data-appid="${game.appid}"]`)?.classList.add("active");
    };

    // Debounced typeahead
    let debounce = null;
    input.addEventListener("input", () => {
      setSelection(null);
      if (!input.value.trim()) {
        list.innerHTML = "";
        list.classList.remove("open");
        save.disabled = true;
        return;
      }
      clearTimeout(debounce);
      debounce = setTimeout(runGotyTypeahead, 220);
    });

    // Keyboard navigation within suggestions list
    input.addEventListener("keydown", (e) => {
      const items = qsa("#goty-suggest .item");
      if (!items.length) return;

      const current = list.querySelector(".item.focused");
      let idx = current ? items.indexOf(current) : -1;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        idx = (idx + 1) % items.length;
        items.forEach(li=>li.classList.remove("focused"));
        items[idx].classList.add("focused");
        items[idx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        idx = (idx - 1 + items.length) % items.length;
        items.forEach(li=>li.classList.remove("focused"));
        items[idx].classList.add("focused");
        items[idx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        const chosen = list.querySelector(".item.focused") || items[0];
        if (chosen) {
          e.preventDefault();
          setSelection({ appid: chosen.dataset.appid, name: chosen.dataset.name });
          list.classList.remove("open");
        }
      }
    });

    // Click to choose suggestion
    list.addEventListener("click", (e) => {
      const li = e.target.closest(".item");
      if (!li) return;
      setSelection({ appid: li.dataset.appid, name: li.dataset.name });
      list.classList.remove("open");
    });

    // Save GOTY -> backend + refresh current search
    save.addEventListener("click", async () => {
      if (!gotySelection) return;
      const year = Number(ySel.value);
      try {
        await apiSetGoty(gotySelection.appid, year, CURRENT_PROFILE);
        toast(`GOTY ${year} set to "${gotySelection.name}"`);
        m.classList.add("hidden");
        runSearch({ page: 1 });
      } catch (e) {
        console.error(e);
        toast("Error setting GOTY");
      }
    });
  }

  return m;
}

/**
 * Executes the typeahead query for the GOTY modal.
 * - Calls apiSearch with a narrow projection and limit=8.
 * - Renders a clickable suggestion list.
 */
async function runGotyTypeahead(){
  const m = el("goty-modal");
  if (!m) return;
  const input = m.querySelector("#goty-typeahead");
  const list  = m.querySelector("#goty-suggest");
  const q = (input.value || "").trim();

  list.innerHTML = "";
  list.classList.remove("open");
  if (!q) return;

  try{
    const payload = {
      filters: { search: q, profile: CURRENT_PROFILE },
      sort: "name-asc",
      page: 1, limit: 8,
      projection: { appid:1, name:1, header_image:1 }
    };
    const data = await apiSearch(payload);
    const items = data.items || [];

    if (!items.length) {
      list.innerHTML = `<div class="empty">No matches</div>`;
      list.classList.add("open");
      return;
    }

    list.innerHTML = items.map(g => `
      <div class="item" role="option" tabindex="-1"
           data-appid="${g.appid}" data-name="${(g.name||"").replace(/"/g,"&quot;")}">
        <img src="${g.header_image || ""}" alt="" />
        <span class="t">${g.name || ""}</span>
      </div>
    `).join("");
    list.classList.add("open");
  }catch(e){
    console.error(e);
    list.innerHTML = `<div class="empty">Error. Try again.</div>`;
    list.classList.add("open");
  }
}

/**
 * Opens the GOTY modal and resets its UI.
 * Focuses the input after opening.
 */
function openGotyModal(){
  gotySelection = null;
  const m = ensureGotyModal();
  m.classList.remove("hidden");

  const input = m.querySelector("#goty-typeahead");
  const list  = m.querySelector("#goty-suggest");
  const save  = m.querySelector("#goty-save");

  input.value = "";
  list.innerHTML = "";
  list.classList.remove("open");
  save.disabled = true;

  setTimeout(() => {
    input.readOnly = false;
    input.disabled = false;
    input.style.pointerEvents = "auto";
    input.focus();
  }, 0);
}


/* -------------------------------------------------------------------------- */
/* Card + favorites + GOTY badge                                              */
/* -------------------------------------------------------------------------- */

/**
 * Builds the card HTML for a single game, including:
 * - Header image (placeholder if missing)
 * - Favorite button (reflects current fav state)
 * - GOTY badge (if applies) with remove action
 * - Metadata (genres, platforms, scores, price, date, fine details)
 * - Expandable details (description + screenshots)
 *
 * @param {object} g - Game document from backend (projection-sensitive).
 * @returns {string} HTML string for insertion in the grid.
 */
function gameCardHTML(g){
  const appid  = g.appid || g._id || "";
  const fav    = isFav(appid);
  const isGoty = Number(g.goty_year) > 0;

  const priceStr  = formatPrice(g.price);
  const dateStr   = formatDate(g.release_date);
  const genresStr = Array.isArray(g.genres) ? g.genres.join(", ") : (g.genres || "");
  const langsStr  = Array.isArray(g.supported_languages) ? listCompact(g.supported_languages, 4) : (g.supported_languages || "");
  const devsStr   = Array.isArray(g.developers) ? listCompact(g.developers, 2) : (g.developers || "");
  const pubsStr   = Array.isArray(g.publishers) ? listCompact(g.publishers, 2) : (g.publishers || "");
  const tagsStr   = safeTags(g.tags, 6);
  const desc      = g.short_description || g.about_the_game || g.detailed_description || "";
  const shots     = Array.isArray(g.screenshots) ? g.screenshots.slice(0,4) : [];

  return `
    <div class="game-card ${isGoty ? "is-goty" : ""}" data-appid="${appid}">
      <div class="thumb">
        ${isGoty ? `
          <div class="goty-badge" title="Game of the Year">
            🏆 GOTY ${g.goty_year}
            <button class="goty-remove" data-appid="${appid}" data-year="${g.goty_year}" aria-label="Remove GOTY">✖</button>
          </div>
        ` : ``}
        <img src="${headerSrc(g)}" alt="${(g.name || "").replace(/"/g,"&quot;")}">
        <button class="fav-btn ${fav ? "active":""}" data-appid="${appid}" aria-pressed="${fav ? "true":"false"}">
          ${fav ? "★ Liked" : "☆ Like"}
        </button>
      </div>

      <div class="meta">
        <h4 class="title">${g.name || "Untitled"}</h4>
        ${genresStr ? `<div class="sub">${genresStr}</div>` : ""}

        <div class="badges">
          ${platformsIcons(g)}
          ${scoreBadge(g)}
          ${g.achievements ? `<span class="badge" title="Achievements">🏆 ${g.achievements}</span>` : ""}
          ${g.recommendations ? `<span class="badge" title="Recommendations">👍 ${g.recommendations}</span>` : ""}
        </div>

        <div class="row">
          <span class="price ${g.price === 0 ? "free":""}">${priceStr}</span>
          <span class="date">${dateStr}</span>
        </div>

        <div class="fine">
          ${langsStr ? `<div>Lang: ${langsStr}</div>` : ""}
          ${devsStr ? `<div>Dev: ${devsStr}</div>` : ""}
          ${pubsStr ? `<div>Pub: ${pubsStr}</div>` : ""}
          ${tagsStr ? `<div>Tags: ${tagsStr}</div>` : ""}
          ${g.website ? `<a href="${g.website}" target="_blank" rel="noopener">Website ↗</a>` : ""}
        </div>

        ${desc || (shots && shots.length)
          ? `<details>
               <summary>Details</summary>
               ${desc ? `<p>${desc}</p>` : ""}
               ${shots.length ? `<div class="shots">` + shots.map(s => `<img src="${s}" alt="screenshot">`).join("") + `</div>` : ""}
             </details>`
          : ""}
      </div>
    </div>
  `;
}

/**
 * Renders a list of games into #games-grid and wires up:
 * - Favorite toggle buttons
 * - GOTY remove buttons
 * Shows "no results" when list is empty.
 * @param {object[]} items - Game documents
 */
function renderGames(items){
  const grid = el("games-grid");
  if(!grid) return;

  if(!items || !items.length){
    grid.innerHTML = "";
    showNoResults(true);
    return;
  }
  showNoResults(false);
  grid.innerHTML = items.map(g => gameCardHTML(g)).join("");

  // favorites
  qsa(".fav-btn").forEach(btn => {
    btn.addEventListener("click", () => toggleFav(btn.dataset.appid));
  });

  // remove GOTY from badge
  qsa(".goty-remove").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const year = btn.dataset.year, appid = btn.dataset.appid;
      try{
        await apiUnsetGoty({ year, appid, profile: CURRENT_PROFILE });
        toast(`GOTY ${year} removed`);
        runSearch({ page: 1 });
      }catch(e){ console.error(e); toast("Error removing GOTY"); }
    });
  });
}


/* =========================== Read UI values ============================ */

/**
 * @returns {"all"|"favorites"|"recommendations"|"goty"|string}
 */
function getActiveCategory(){
  const btn = qs(".main-nav .nav-btn.active");
  return btn ? btn.getAttribute("data-category") : "all";
}

/** @returns {string} trimmed content of #search-input */
function getSearchText(){ return (el("search-input")?.value || "").trim(); }

/**
 * Reads active platform toggles and converts to booleans.
 * @returns {{windows:boolean,mac:boolean,linux:boolean}}
 */
function getActivePlatforms(){
  const active = qsa(".platform-btn.active").map(b => b.getAttribute("data-platform"));
  return {
    windows: active.includes("windows"),
    mac: active.includes("mac"),
    linux: active.includes("linux")
  };
}

/** @returns {string} sort value like "name-asc" */
function getSortValue(){ return el("sort-select")?.value || "name-asc"; }
/** @returns {string} selected genre or "" */
function getGenre(){ return el("genre-select")?.value || ""; }
/** @returns {string} selected language or "" */
function getLanguage(){ return el("language-select")?.value || ""; }
/** @returns {""|"single"|"multi"} multiplayer filter */
function getMultiplayer(){ return el("multiplayer-select")?.value || ""; } // "", single, multi
/** @returns {string} selected developer or "" */
function getDeveloper(){ return el("developer-select")?.value || ""; }
/** @returns {number} min price */
function getPriceMin(){ return Number(el("price-min")?.value || 0); }
/** @returns {number} max price */
function getPriceMax(){ return Number(el("price-max")?.value || 50); }
/** @returns {string} GOTY year or "" */
function getGOTYYear(){ return el("goty-year")?.value || ""; }

/**
 * Synchronizes the visual price range label (#price-value).
 */
function updatePriceLabel(){
  const span = el("price-value");
  if(!span) return;
  span.textContent = `${getPriceMin()}-${getPriceMax()}`;
}

/**
 * Toggles a platform filter button and re-runs the search.
 * @param {HTMLElement} btn - .platform-btn element
 */
function togglePlatform(btn){
  btn.classList.toggle("active");
  runSearch();
}

/**
 * Sets active category button, shows/hides GOTY filters, and re-runs search.
 * @param {HTMLElement} targetBtn - .main-nav .nav-btn
 */
function setCategoryActive(targetBtn){
  qsa(".main-nav .nav-btn").forEach(b => b.classList.remove("active"));
  targetBtn.classList.add("active");

  const cat = getActiveCategory();
  const show = (cat === "goty");
  qsa(".goty-filter").forEach(block => {
    block.style.display = show ? "block" : "none";
  });

  runSearch();
}

/**
 * Builds a safe <option> list with a placeholder.
 * Escapes < and > to avoid HTML injection in visible labels.
 * @param {string[]} values
 * @param {string} placeholder
 * @returns {string} HTML
 */
function buildOptionsHTML(values, placeholder){
  const opts = ['<option value="">' + placeholder + '</option>']
    .concat(values.map(v => `<option>${String(v).replace(/</g,"&lt;").replace(/>/g,"&gt;")}</option>`));
  return opts.join("");
}

/**
 * Loads distinct lists (genres/languages/developers) in parallel and
 * populates their <select> elements. Applies client-side kid filter to genres.
 * Uses DISTINCT_CACHE via getDistinct(kind).
 */
async function loadDistincts(){
  const selGenre = el("genre-select");
  const selLang  = el("language-select");
  const selDev   = el("developer-select");

  try{
    const [gRes, lRes, dRes] = await Promise.all([
      getDistinct("genres"),
      getDistinct("languages"),
      getDistinct("developers")
    ]);

    if (selGenre) {
      let vals = (gRes.items || []).filter(Boolean);

      // Client-side guard: hide adult genres for kid profile
      if (CURRENT_PROFILE === "kid") {
        vals = vals.filter(v => !BAD_GENRES.has(String(v)));
      }

      vals.sort((a,b)=>String(a).localeCompare(String(b)));
      selGenre.innerHTML = buildOptionsHTML(vals, "All Genres");
    }

    if (selLang) {
      const vals = (lRes.items || []).filter(Boolean)
        .sort((a,b)=>String(a).localeCompare(String(b)));
      selLang.innerHTML = buildOptionsHTML(vals, "All Languages");
    }

    if (selDev) {
      let vals = (dRes.items || []).filter(Boolean);
      // Normalize: trim and unique
      vals = Array.from(new Set(vals.map(v => String(v).trim())));
      vals.sort((a,b)=> a.localeCompare(b));
      const MAX = 500;
      if (vals.length > MAX) vals = vals.slice(0, MAX);
      selDev.innerHTML = buildOptionsHTML(vals, "All Developers");
    }
  }catch(e){
    // Non-blocking: if one fails, we still render the rest of the page.
    console.error("distinct load error", e);
  }
}


/* ========================= Search execution flow ========================= */

let searchTimer = null;              // debounce handle for text input
let CURRENT_SEARCH_CTRL = null;      // AbortController for in-flight searches

/**
 * Runs the main search flow:
 * - Aborts any in-flight search (prevents stale render).
 * - Reads all UI filters and builds a payload for apiSearch.
 * - Special handling:
 *    • favorites: inject current favorites as 'appids' filter, or render empty state.
 *    • recommendations: requires favorites; sends fresh list as 'appids' to backend
 *      which is expected to return recommendations for them.
 * - Updates state.total/hasMore, renders count, grid, and pager.
 *
 * @param {{page?:number}} [params]
 */
async function runSearch({ page } = {}){
  try{
    // Cancel any in-flight search (prevents stale results)
    if (CURRENT_SEARCH_CTRL) CURRENT_SEARCH_CTRL.abort();
    CURRENT_SEARCH_CTRL = new AbortController();

    setLoading(true);

    const filters = {
      category: getActiveCategory(),
      search: getSearchText(),
      platforms: getActivePlatforms(),
      genre: getGenre(),
      language: getLanguage(),
      multiplayer: getMultiplayer(),
      developer: getDeveloper(),
      priceMin: getPriceMin(),
      priceMax: getPriceMax(),
      gotyYear: getGOTYYear(),
      profile: CURRENT_PROFILE,           // send current profile to backend
    };
    const sort = getSortValue();

    // Detect filter changes to reset to page 1
    const key = buildKey(filters, sort);
    const filtersChanged = key !== state.lastKey;
    if (filtersChanged) {
      state.page = 1;
      state.lastKey = key;
    }
    if (typeof page === "number") state.page = Math.max(1, page);

    // Build the search request
    const payload = {
      filters,
      sort,
      page: state.page,
      limit: state.limit,
      projection: {
        appid: 1, name: 1, header_image: 1, genres: 1, price: 1,
        windows: 1, mac: 1, linux: 1,
        user_score: 1, metacritic_score: 1, release_date: 1,
        achievements: 1, recommendations: 1,
        supported_languages: 1, developers: 1, publishers: 1,
        tags: 1, website: 1, screenshots: 1,
        goty_year: 1
      },
      withTotal: true
    };

    // MODIFIED: Handle both favorites AND recommendations
    if (payload.filters && payload.filters.category === "favorites") {
      const favs = loadFavs();
      if (!favs.length) {
        // Empty favorites -> short-circuit with empty UI
        state.total = 0; state.hasMore = false;
        renderCount(0);
        renderGames([]);
        renderPager();
        return;
      }
      payload.filters.appids = favs;
    }

    // NEW: Handle recommendations - always send fresh favorites list
    if (payload.filters && payload.filters.category === "recommendations") {
      const favs = loadFavs();
      
      if (!favs.length) {
        // No favorites -> show special explanatory message
        state.total = 0; 
        state.hasMore = false;
        renderCount(0);
        renderGames([]);
        showNoResults(true);
        
        const noRes = el("no-results");
        if (noRes) {
          noRes.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
              <h3>No Favorites Yet</h3>
              <p>Add games to your favorites to get personalized recommendations!</p>
              <p style="font-size: 2rem; margin: 1rem 0;">⭐ 🎮 ⭐</p>
            </div>
          `;
        }
        
        renderPager();
        setLoading(false);
        return;
      }
      
      // CRITICAL: Always send fresh favorites list for recommendations
      payload.filters.appids = favs;
    }

    // Execute search request with abort support
    const data = await apiSearch(payload, { signal: CURRENT_SEARCH_CTRL.signal });
    const items = Array.isArray(data.items) ? data.items : [];
    state.total  = typeof data.total === "number" ? data.total : items.length;
    state.hasMore = !!data.hasMore;

    renderCount(state.total);
    renderGames(items);
    renderPager();

  }catch(e){
    if (e.name === "AbortError") {
      return; // aborted intentionally due to new search overriding old one
    }
    console.error(e);
    renderCount(0);
    renderGames([]);
    showNoResults(true);
    renderPager();
  }finally{
    setLoading(false);
  }
}


/* =========================== App bootstrap ============================ */

document.addEventListener("DOMContentLoaded", () => {
  // Initialize profile selector
  const sel = el("profile-select");
  if (sel) {
    if (!PROFILES.includes(CURRENT_PROFILE)) CURRENT_PROFILE = "person1";
    sel.value = CURRENT_PROFILE;

    sel.addEventListener("change", () => {
      const p = sel.value;
      if (!PROFILES.includes(p)) return;

      // Persist the chosen profile and refresh the entire app so all tabs
      // (including GOTY) rebuild with the new profile's server state.
      CURRENT_PROFILE = p;
      localStorage.setItem(PROFILE_KEY, CURRENT_PROFILE);
      toast(`Profile: ${p}`);

      // Hard reload to keep all views in sync with profile change.
      location.reload();
    });
  }

  // Main nav categories
  qsa(".main-nav .nav-btn").forEach(btn => {
    btn.addEventListener("click", () => setCategoryActive(btn));
  });

  // Debounced search input
  el("search-input")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 300);
  });

  // Platform toggles
  qsa(".platform-btn").forEach(btn => {
    btn.addEventListener("click", () => togglePlatform(btn));
  });

  // Select-based filters
  el("sort-select")?.addEventListener("change", runSearch);
  el("genre-select")?.addEventListener("change", runSearch);
  el("language-select")?.addEventListener("change", runSearch);
  el("multiplayer-select")?.addEventListener("change", runSearch);
  el("developer-select")?.addEventListener("change", runSearch);

  // Price range inputs (keep min <= max)
  const pmin = el("price-min");
  const pmax = el("price-max");
  pmin?.addEventListener("input", () => {
    if(getPriceMin() > getPriceMax()) pmin.value = String(getPriceMax());
    updatePriceLabel();
  });
  pmax?.addEventListener("input", () => {
    if(getPriceMax() < getPriceMin()) pmax.value = String(getPriceMin());
    updatePriceLabel();
  });
  pmin?.addEventListener("change", runSearch);
  pmax?.addEventListener("change", runSearch);

  // GOTY filter & modal
  el("goty-year")?.addEventListener("change", runSearch);
  el("add-goty-btn")?.addEventListener("click", openGotyModal);

  // Initial data load:
  // 1) Load distinct values for selects (non-blocking on errors)
  // 2) Update price label
  // 3) Kick off initial search
  Promise.resolve()
    .then(loadDistincts)
    .then(() => {
      updatePriceLabel();
      runSearch();
    });
});
