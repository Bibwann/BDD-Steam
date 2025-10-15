// === helpers DOM ===
function j(v){ return JSON.stringify(v); }
function el(id){ return document.getElementById(id); }
function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }

// === helpers backend ===
async function apiSearch(payload){
  const res = await fetch("/api/games/search", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  if(!res.ok) throw new Error("http "+res.status);
  return res.json(); // { ok, total, items }
}

async function getDistinct(kind){
  const res = await fetch(`/api/games/distinct/${kind}`);
  if(!res.ok) throw new Error("http "+res.status);
  return res.json(); // { ok, items }
}

// === UI: états ===
function setLoading(on){
  const l = el("loading"); if(!l) return;
  l.style.display = on ? "flex" : "none";
}
function showNoResults(on){
  const n = el("no-results"); if(!n) return;
  n.style.display = on ? "block" : "none";
}
function renderCount(n){
  const r = el("results-count");
  if(r) r.textContent = `${n} games found`;
}
function renderGames(items){
  const grid = el("games-grid");
  if(!grid) return;
  if(!items || !items.length){
    grid.innerHTML = "";
    showNoResults(true);
    return;
  }
  showNoResults(false);
  grid.innerHTML = items.map(g => `
    <div class="game-card">
      <div class="thumb">
        <img src="${g.header_image || ""}" alt="${(g.name || "").replace(/"/g,"&quot;")}">
      </div>
      <div class="meta">
        <h4 class="title">${g.name || ""}</h4>
        <div class="sub">${Array.isArray(g.genres) ? g.genres.join(", ") : ""}</div>
        <div class="price">${g.price != null ? (g.price + " $") : ""}</div>
      </div>
    </div>
  `).join("");
}

// === read UI values ===
function getActiveCategory(){
  const btn = qs(".main-nav .nav-btn.active");
  return btn ? btn.getAttribute("data-category") : "all";
}
function getSearchText(){ return (el("search-input")?.value || "").trim(); }
function getActivePlatforms(){
  const active = qsa(".platform-btn.active").map(b => b.getAttribute("data-platform"));
  return {
    windows: active.includes("windows"),
    mac: active.includes("mac"),
    linux: active.includes("linux")
  };
}
function getSortValue(){ return el("sort-select")?.value || "name-asc"; }
function getGenre(){ return el("genre-select")?.value || ""; }
function getLanguage(){ return el("language-select")?.value || ""; }
function getMultiplayer(){ return el("multiplayer-select")?.value || ""; } // "", single, multi
function getDeveloper(){ return el("developer-select")?.value || ""; }
function getPriceMin(){ return Number(el("price-min")?.value || 0); }
function getPriceMax(){ return Number(el("price-max")?.value || 50); }
function getGOTYYear(){ return el("goty-year")?.value || ""; }




function updatePriceLabel(){
  const span = el("price-value");
  if(!span) return;
  span.textContent = `${getPriceMin()}-${getPriceMax()}`;
}
function togglePlatform(btn){
  btn.classList.toggle("active");
  runSearch();
}
function setCategoryActive(targetBtn){
  qsa(".main-nav .nav-btn").forEach(b => b.classList.remove("active"));
  targetBtn.classList.add("active");

  const cat = getActiveCategory();
  const gotyBlock = qs(".goty-filter");
  const addBtn = el("add-goty-btn");
  if(gotyBlock) gotyBlock.style.display = (cat === "goty") ? "block" : "none";
  if(addBtn) addBtn.style.display = (cat === "goty") ? "inline-flex" : "none";

  runSearch();
}


async function loadDistincts(){
  // genres
  try{
    const gRes = await getDistinct("genres");
    const sel = el("genre-select");
    if(sel){
      const vals = (gRes.items || []).filter(Boolean).sort((a,b)=>String(a).localeCompare(String(b)));
      sel.innerHTML = '<option value="">All Genres</option>' + vals.map(v=>`<option>${String(v)}</option>`).join("");
    }
  }catch{}
  // languages
  try{
    const lRes = await getDistinct("languages");
    const sel = el("language-select");
    if(sel){
      const vals = (lRes.items || []).filter(Boolean).sort((a,b)=>String(a).localeCompare(String(b)));
      sel.innerHTML = '<option value="">All Languages</option>' + vals.map(v=>`<option>${String(v)}</option>`).join("");
    }
  }catch{}
  // developers
  try{
    const dRes = await getDistinct("developers");
    const sel = el("developer-select");
    if(sel){
      const vals = (dRes.items || []).filter(Boolean).sort((a,b)=>String(a).localeCompare(String(b)));
      sel.innerHTML = '<option value="">All Developers</option>' + vals.map(v=>`<option>${String(v)}</option>`).join("");
    }
  }catch{}
}


let searchTimer = null;

async function runSearch(){
  try{
    setLoading(true);
    showNoResults(false);

    const payload = {
      filters: {
        category: getActiveCategory(),
        search: getSearchText(),
        platforms: getActivePlatforms(),
        genre: getGenre(),
        language: getLanguage(),
        multiplayer: getMultiplayer(),
        developer: getDeveloper(),
        priceMin: getPriceMin(),
        priceMax: getPriceMax(),
        gotyYear: getGOTYYear()
      },
      sort: getSortValue(),
      page: 1,
      limit: 40,
      projection: { name: 1, header_image: 1, genres: 1, price: 1 }
    };

    const data = await apiSearch(payload);
    renderCount(data.total || 0);
    renderGames(data.items || []);
    if(!data.items?.length) showNoResults(true);

  }catch(e){
    console.error(e);
    renderCount(0);
    renderGames([]);
    showNoResults(true);
  }finally{
    setLoading(false);
  }
}


document.addEventListener("DOMContentLoaded", () => {
  
  qsa(".main-nav .nav-btn").forEach(btn => {
    btn.addEventListener("click", () => setCategoryActive(btn));
  });

  // search 
  el("search-input")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 300);
  });

  // platforms
  qsa(".platform-btn").forEach(btn => {
    btn.addEventListener("click", () => togglePlatform(btn));
  });

  // sort & selects
  el("sort-select")?.addEventListener("change", runSearch);
  el("genre-select")?.addEventListener("change", runSearch);
  el("language-select")?.addEventListener("change", runSearch);
  el("multiplayer-select")?.addEventListener("change", runSearch);
  el("developer-select")?.addEventListener("change", runSearch);

  // price sliders + label
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

  // goty 
  el("goty-year")?.addEventListener("change", runSearch);

  // preload
  Promise.resolve()
    .then(loadDistincts)
    .then(() => {
      updatePriceLabel();
      runSearch();
    });

    
});
