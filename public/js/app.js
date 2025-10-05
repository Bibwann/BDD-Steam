const API = "/api/items";

async function fetchJSON(url, opts) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) throw new Error("http " + res.status);
  return res.status === 204 ? null : res.json();
}

async function load() {
  const ul = document.getElementById("items");
  if (!ul) return; 
  ul.innerHTML = "";
  try {
    const items = await fetchJSON(API);
    items.forEach(it => {
      const li = document.createElement("li");
      li.textContent = it.name + " - " + (it.description || "");
      ul.appendChild(li);
    });
  } catch (error) {
    console.log("API items not available");
  }
}

const formEl = document.getElementById("form");
if (formEl) {
  formEl.addEventListener("submit", async e => {
    e.preventDefault();
    const name = document.getElementById("name").value.trim();
    const description = document.getElementById("description").value.trim();
    if (!name) return;
    try {
      await fetchJSON(API, { method: "POST", body: JSON.stringify({ name, description }) });
      e.target.reset();
      load();
    } catch (error) {
      console.log("API submission failed");
    }
  });
}

load();

// ---------------------------
// UI Games
// ---------------------------
class GameDatabase {
  constructor(databaseObject) {
    this.games = databaseObject || {};
    this.favorites = new Set();
    this.gotyGames = new Map(); 
    this.currentCategory = "all";
    this.currentFilters = {
      search: "",
      genre: "",
      language: "",
      multiplayer: "",
      developer: "",
      platforms: new Set(["windows", "mac", "linux"]),
      priceMin: 0,
      priceMax: 50,
      sort: "name-asc"
    };

    this.safeInit();
  }

  safeInit() {
    this.cacheDom();
    if (!this.domAvailable) return;
    this.setupEventListeners();
    this.populateFilterOptions();
    this.renderGames();
    this.updateResultsCount();
  }

  cacheDom() {
    this.$gamesGrid = document.getElementById("games-grid");
    this.$loading = document.getElementById("loading");
    this.$noResults = document.getElementById("no-results");
    this.$search = document.getElementById("search-input");
    this.$sort = document.getElementById("sort-select");
    this.$genre = document.getElementById("genre-select");
    this.$language = document.getElementById("language-select");
    this.$multi = document.getElementById("multiplayer-select");
    this.$developer = document.getElementById("developer-select");
    this.$priceMin = document.getElementById("price-min");
    this.$priceMax = document.getElementById("price-max");
    this.$priceValue = document.getElementById("price-value");
    this.$gotyModal = document.getElementById("goty-modal");
    this.$gotyGameSelect = document.getElementById("goty-game-select");
    this.$gotyYearSelect = document.getElementById("goty-year");
    this.$gotyYearInput = document.getElementById("goty-year-input");
    this.$resultsCount = document.getElementById("results-count");
    this.$addGotyBtn = document.getElementById("add-goty-btn");
    this.$gotyList = document.getElementById("goty-list");
    this.$gotyEntries = document.getElementById("goty-entries");

    this.domAvailable = !!this.$gamesGrid;
  }

  setupEventListeners() {
    // Navigation
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        this.switchCategory(e.currentTarget.dataset.category);
      });
    });

    // Search
    if (this.$search) {
      this.$search.addEventListener("input", (e) => {
        this.currentFilters.search = e.target.value.toLowerCase();
        this.renderGames();
      });
    }

    // Platform filters
    document.querySelectorAll(".platform-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const target = e.currentTarget;
        const platform = target.dataset.platform;
        if (this.currentFilters.platforms.has(platform)) {
          this.currentFilters.platforms.delete(platform);
          target.classList.remove("active");
        } else {
          this.currentFilters.platforms.add(platform);
          target.classList.add("active");
        }
        this.renderGames();
      });
    });

    // Filter selects
    if (this.$sort) this.$sort.addEventListener("change", (e) => { this.currentFilters.sort = e.target.value; this.renderGames(); });
    if (this.$genre) this.$genre.addEventListener("change", (e) => { this.currentFilters.genre = e.target.value; this.renderGames(); });
    if (this.$language) this.$language.addEventListener("change", (e) => { this.currentFilters.language = e.target.value; this.renderGames(); });
    if (this.$multi) this.$multi.addEventListener("change", (e) => { this.currentFilters.multiplayer = e.target.value; this.renderGames(); });
    if (this.$developer) this.$developer.addEventListener("change", (e) => { this.currentFilters.developer = e.target.value; this.renderGames(); });

    // Price range sliders
    const updatePriceRange = () => {
      if (!this.$priceMin || !this.$priceMax) return;
      let min = Math.min(parseInt(this.$priceMin.value || "0", 10), parseInt(this.$priceMax.value || "50", 10));
      let max = Math.max(parseInt(this.$priceMin.value || "0", 10), parseInt(this.$priceMax.value || "50", 10));
      this.currentFilters.priceMin = min;
      this.currentFilters.priceMax = max;
      if (this.$priceValue) this.$priceValue.textContent = `${min}-${max}`;
      this.renderGames();
    };
    if (this.$priceMin) this.$priceMin.addEventListener("input", updatePriceRange);
    if (this.$priceMax) this.$priceMax.addEventListener("input", updatePriceRange);

    // GOTY Modal
    const closeBtn = document.getElementById("close-goty-modal");
    const cancelBtn = document.getElementById("cancel-goty");
    const saveBtn = document.getElementById("save-goty");

    if (closeBtn) closeBtn.addEventListener("click", () => this.hideGotyModal());
    if (cancelBtn) cancelBtn.addEventListener("click", () => this.hideGotyModal());
    if (saveBtn) saveBtn.addEventListener("click", () => this.saveGoty());

    // Add GOTY Button
    if (this.$addGotyBtn) {
      this.$addGotyBtn.addEventListener("click", () => this.showGotyModal());
    }

    if (this.$gotyModal) {
      this.$gotyModal.addEventListener("click", (e) => {
        if (e.target.id === "goty-modal") this.hideGotyModal();
      });
    }
  
    // GOTY year filter
    if (this.$gotyYearSelect) {
      this.$gotyYearSelect.addEventListener("change", () => {
        this.renderGames();
      });
    }
}

  populateFilterOptions() {
    // Genres
    const genres = new Set();
    Object.values(this.games).forEach(game => game.genres?.forEach(g => genres.add(g)));
    if (this.$genre) {
      this.$genre.innerHTML = '<option value="">All Genres</option>';
      Array.from(genres).sort().forEach(g => this.$genre.appendChild(new Option(g, g)));
    }

    // Languages
    const languages = new Set();
    Object.values(this.games).forEach(game => game.supported_languages?.forEach(l => languages.add(l)));
    if (this.$language) {
      this.$language.innerHTML = '<option value="">All Languages</option>';
      Array.from(languages).sort().forEach(l => this.$language.appendChild(new Option(l, l)));
    }

    // Developers
    const developers = new Set();
    Object.values(this.games).forEach(game => game.developers?.forEach(d => developers.add(d)));
    if (this.$developer) {
      this.$developer.innerHTML = '<option value="">All Developers</option>';
      Array.from(developers).sort().forEach(d => this.$developer.appendChild(new Option(d, d)));
    }

    // GOTY game select
    if (this.$gotyGameSelect) {
      this.$gotyGameSelect.innerHTML = '<option value="">Choose a game...</option>';
      Object.entries(this.games).forEach(([id, game]) => {
        this.$gotyGameSelect.appendChild(new Option(game.name, id));
      });
    }

    // GOTY years
    if (this.$gotyYearSelect) {
      for (let year = 2025; year >= 2000; year--) {
        this.$gotyYearSelect.appendChild(new Option(String(year), String(year)));
      }
    }
  }

  switchCategory(category) {
    this.currentCategory = category;
    document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
    const active = document.querySelector(`[data-category="${category}"]`);
    if (active) active.classList.add("active");

    const titles = {
      "all": "All Games",
      "favorites": "Favorite Games",
      "best": "Best Games",
      "recommendations": "Recommendations For You",
      "goty": "Game of the Year"
    };
    const contentTitle = document.getElementById("content-title");
    if (contentTitle) contentTitle.textContent = titles[category] || "All Games";

    // Show/hide GOTY-specific elements
    const gotyFilter = document.querySelector(".goty-filter");
    if (gotyFilter) gotyFilter.style.display = (category === "goty") ? "flex" : "none";
    
    if (this.$addGotyBtn) this.$addGotyBtn.style.display = (category === "goty") ? "block" : "none";
    if (this.$gotyList) this.$gotyList.style.display = (category === "goty") ? "block" : "none";

    this.renderGames();
    if (category === "goty") {
      this.renderGotyList();
    }
  }

  getFilteredGames() {
    let games = Object.entries(this.games);

    // By category
    switch (this.currentCategory) {
      case "favorites":
        games = games.filter(([id]) => this.favorites.has(id));
        break;
      case "best":
        games = games.filter(([_, g]) => {
          const total = (g.positive || 0) + (g.negative || 0);
          return total > 0 && (g.positive / total) >= 0.7;
        });
        break;
      case "recommendations":
        games = this.getRecommendations();
        break;
      case "goty":
        const selectedYear = document.getElementById("goty-year")?.value || "";
        if (selectedYear) {
          games = games.filter(([id]) => 
            this.gotyGames.has(id) && String(this.gotyGames.get(id).year) === String(selectedYear)
          );
        } else {
          games = games.filter(([id]) => this.gotyGames.has(id));
        }
        break;
    }

    // Filters
    games = games.filter(([id, game]) => {
      const g = game;

      // Search
      if (this.currentFilters.search) {
        const s = this.currentFilters.search;
        const nameMatch = g.name?.toLowerCase().includes(s);
        const devMatch = (g.developers || []).some(d => d.toLowerCase().includes(s));
        if (!nameMatch && !devMatch) return false;
      }

      // Genre
      if (this.currentFilters.genre) {
        if (!(g.genres || []).includes(this.currentFilters.genre)) return false;
      }

      // Language
      if (this.currentFilters.language) {
        if (!(g.supported_languages || []).includes(this.currentFilters.language)) return false;
      }

      // Multiplayer / Single
      if (this.currentFilters.multiplayer) {
        const cats = (g.categories || []).map(c => c.toLowerCase());
        const hasMulti = cats.some(c => c.includes("multi"));
        const hasSingle = cats.some(c => c.includes("single"));
        if (this.currentFilters.multiplayer === "single" && !hasSingle) return false;
        if (this.currentFilters.multiplayer === "multi" && !hasMulti) return false;
      }

      // Developer
      if (this.currentFilters.developer) {
        if (!(g.developers || []).includes(this.currentFilters.developer)) return false;
      }

      // Platform
      if (this.currentFilters.platforms.size > 0) {
        const hasReq =
          (this.currentFilters.platforms.has("windows") && g.windows) ||
          (this.currentFilters.platforms.has("mac") && g.mac) ||
          (this.currentFilters.platforms.has("linux") && g.linux);
        if (!hasReq) return false;
      }

      // Price
      const price = typeof g.price === "number" ? g.price : 0;
      if (price < this.currentFilters.priceMin || price > this.currentFilters.priceMax) return false;

      return true;
    });

    // Sort
    games.sort(([idA, a], [idB, b]) => {
      
      /* GOTY: sort by award year */
      if (this.currentCategory === "goty") {
        const yearA = this.gotyGames.get(idA)?.year || 0;
        const yearB = this.gotyGames.get(idB)?.year || 0;
        if (this.currentFilters.sort === "date-desc") return yearB - yearA;
        if (this.currentFilters.sort === "date-asc") return yearA - yearB;
      }
switch (this.currentFilters.sort) {
        case "name-asc": return a.name.localeCompare(b.name);
        case "name-desc": return b.name.localeCompare(a.name);
        case "date-desc": return new Date(b.release_date) - new Date(a.release_date);
        case "date-asc": return new Date(a.release_date) - new Date(b.release_date);
        case "price-asc": return (a.price || 0) - (b.price || 0);
        case "price-desc": return (b.price || 0) - (a.price || 0);
        case "rating-desc": {
          const ra = (a.positive || 0) / ((a.positive || 0) + (a.negative || 0)) || 0;
          const rb = (b.positive || 0) / ((b.positive || 0) + (b.negative || 0)) || 0;
          return rb - ra;
        }
        default: return 0;
      }
    });

    return games;
  }

  getRecommendations() {
    if (this.favorites.size === 0) return Object.entries(this.games).slice(0, 4);
    const favoriteGenres = new Set();
    this.favorites.forEach(id => {
      const g = this.games[id];
      g?.genres?.forEach(genre => favoriteGenres.add(genre));
    });
    return Object.entries(this.games).filter(([id, g]) => {
      if (this.favorites.has(id)) return false;
      return (g.genres || []).some(genre => favoriteGenres.has(genre));
    });
  }

  renderGames() {
    if (!this.domAvailable) return;
    this.$loading && (this.$loading.style.display = "block");
    this.$gamesGrid.innerHTML = "";
    this.$noResults && (this.$noResults.style.display = "none");

    setTimeout(() => {
      const filtered = this.getFilteredGames();

      this.$loading && (this.$loading.style.display = "none");
      if (filtered.length === 0) {
        this.$noResults && (this.$noResults.style.display = "block");
      } else {
        this.$gamesGrid.innerHTML = filtered.map(([id, g]) => this.createGameCard(id, g)).join("");
        this.addGameCardListeners();
      }
      this.updateResultsCount(filtered.length);
    }, 150);
  }

  createGameCard(id, game) {
    const isFavorite = this.favorites.has(id);
    const isGoty = this.gotyGames.has(id);
    const gotyData = this.gotyGames.get(id);
    
    const platforms = [];
    if (game.windows) platforms.push("🪟");
    if (game.mac) platforms.push("🍎");
    if (game.linux) platforms.push("🐧");

    const genreTags = (game.genres || []).map(genre => 
      `<span class="genre-tag" data-genre="${genre}">${genre}</span>`
    ).join("");
    
    
    const developersLine = (Array.isArray(game.developers) && game.developers.length > 0)
      ? `<p class="game-developers">${game.developers.join(', ')}</p>`
      : "";
const priceDisplay = game.price === 0 ? "Free" : `$${(game.price || 0).toFixed(2)}`;
    const priceClass = game.price === 0 ? "free" : "";

    let gotyBadge = "";
    if (isGoty && gotyData) {
      const displayName = gotyData.customName || game.name;
      gotyBadge = `<div class="goty-badge">
        <span class="goty-icon">🏆</span>
        <span class="goty-text">GOTY ${gotyData.year}</span>
        ${this.currentCategory === "goty" ? `<button class="goty-remove" data-game-id="${id}" title="Remove GOTY">🗑️</button>` : ''}
      </div>`;
    }

    return `
      <div class="game-card" data-game-id="${id}">
        ${gotyBadge}
        <img src="${game.header_image}" alt="${game.name}" class="game-image"
          onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgwIiBoZWlnaHQ9IjE0MCIgdmlld0JveD0iMCAwIDI4MCAxNDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjI4MCIgaGVpZ2h0PSIxNDAiIGZpbGw9IiMyYTQ3NWUiLz48dGV4dCB4PSIxNDAiIHk9IjcwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjNjdjMGY0IiBmb250LXNpemU9IjE2Ij5ObyBJbWFnZTwvdGV4dD48L3N2Zz4='">
        <div class="game-info">
          <div class="game-header">
            <h3 class="game-title">${game.name}</h3>
            <button class="favorite-btn ${isFavorite ? "active" : ""}" data-game-id="${id}">
              ${isFavorite ? "❤️" : "🤍"}
            </button>
          </div>
          ${developersLine}
          <div class="game-meta">
            <span class="game-date">${game.release_date}</span>
            <span class="game-price ${priceClass}">${priceDisplay}</span>
          </div>
          <div class="game-genres">
            ${genreTags}
          </div>
          <div class="game-platforms">
            ${platforms.map(ic => `<span class="platform-icon-small">${ic}</span>`).join("")}
          </div>
          <div class="game-description">
            ${game.short_description || ""}
          </div>
          <div class="game-rating">
            <span class="rating-positive">👍 ${game.positive || 0}</span>
            <span class="rating-negative">👎 ${game.negative || 0}</span>
            <span class="achievements-count">🏆 ${game.achievements || 0}</span>
          </div>
        </div>
      </div>
    `;
  }

  addGameCardListeners() {
    // Favorite buttons
    document.querySelectorAll(".favorite-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const gameId = e.currentTarget.dataset.gameId;
        this.toggleFavorite(gameId);
      });
    });

    // Genre tags
    document.querySelectorAll(".genre-tag").forEach(tag => {
      tag.addEventListener("click", (e) => {
        e.stopPropagation();
        const genre = e.currentTarget.dataset.genre;
        const genreSelect = document.getElementById("genre-select");
        if (genreSelect) genreSelect.value = genre;
        this.currentFilters.genre = genre;
        this.renderGames();
      });
    });

    // GOTY remove buttons
    document.querySelectorAll(".goty-remove").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const gameId = e.currentTarget.dataset.gameId;
        this.removeGoty(gameId);
      });
    });
  }

  toggleFavorite(gameId) {
    if (this.favorites.has(gameId)) this.favorites.delete(gameId);
    else this.favorites.add(gameId);

    const btn = document.querySelector(`.favorite-btn[data-game-id="${gameId}"]`);
    if (btn) {
      btn.classList.toggle("active");
      btn.textContent = this.favorites.has(gameId) ? "❤️" : "🤍";
    }
    if (this.currentCategory === "favorites") this.renderGames();
  }

  showGotyModal(gameId = null) {
    if (!this.$gotyModal) return;
    if (this.$gotyGameSelect && gameId) this.$gotyGameSelect.value = gameId;
    this.$gotyModal.classList.remove("hidden");
  }

  hideGotyModal() {
    if (!this.$gotyModal) return;
    this.$gotyModal.classList.add("hidden");
  }

  saveGoty() {
    const gameId = this.$gotyGameSelect?.value;
    const year = this.$gotyYearInput?.value;
    
    if (gameId && year) {
      const game = this.games[gameId];
      this.gotyGames.set(gameId, {
        year: parseInt(year, 10),
        customName: game?.name || "Unknown Game"
      });
      
      this.hideGotyModal();
      
      if (this.currentCategory === "goty") {
        this.renderGames();
        this.renderGotyList();
      }
      
      // Reset form
      if (this.$gotyGameSelect) this.$gotyGameSelect.value = "";
      if (this.$gotyYearInput) this.$gotyYearInput.value = "2024";
    }
  }

  removeGoty(gameId) {
    if (this.gotyGames.has(gameId)) {
      this.gotyGames.delete(gameId);
      if (this.currentCategory === "goty") {
        this.renderGames();
        this.renderGotyList();
      }
    }
  }

  renderGotyList() {
    if (!this.$gotyEntries) return;
    
    const gotyArray = Array.from(this.gotyGames.entries()).map(([gameId, data]) => ({
      gameId,
      ...data,
      game: this.games[gameId]
    })).sort((a, b) => b.year - a.year);

    if (gotyArray.length === 0) {
      this.$gotyEntries.innerHTML = '<p class="no-goty">No GOTY awards added yet.</p>';
      return;
    }

    this.$gotyEntries.innerHTML = gotyArray.map(({ gameId, year, customName, game }) => `
      <div class="goty-entry" data-game-id="${gameId}">
        <div class="goty-entry-content">
          <img src="${game?.header_image || ''}" alt="${customName}" class="goty-entry-image" 
               onerror="this.style.display='none'">
          <div class="goty-entry-info">
            <h4 class="goty-entry-title">${customName}</h4>
            <p class="goty-entry-year">Game of the Year ${year}</p>
            <p class="goty-entry-dev">by ${(game?.developers || []).join(', ') || 'Unknown'}</p>
          </div>
        </div>
        <button class="goty-entry-remove" data-game-id="${gameId}" title="Remove GOTY">
          <span class="trash-icon">🗑️</span>
        </button>
      </div>
    `).join("");

    // Add listeners for remove buttons
    document.querySelectorAll(".goty-entry-remove").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const gameId = e.currentTarget.dataset.gameId;
        this.removeGoty(gameId);
      });
    });
  }

  updateResultsCount(count = null) {
    if (!this.$resultsCount) return;
    if (count === null) count = this.getFilteredGames().length;
    this.$resultsCount.textContent = `${count} game${count !== 1 ? "s" : ""} found`;
  }
}

// Bootstrap 
document.addEventListener("DOMContentLoaded", () => {
  if (typeof STEAM_GAMES_DATABASE !== "undefined") {
    new GameDatabase(STEAM_GAMES_DATABASE);
  } else {
    console.log("STEAM_GAMES_DATABASE not loaded!");
  }
});

// === UI polish helpers & wrappers ===
(function() {
  if (typeof GameDatabase !== 'function') return;
  const P = GameDatabase.prototype;

  // Helpers 
  if (!P.setupRipples) {
    P.setupRipples = function() {
      const selectors = ['.btn', '.nav-btn', '.platform-btn', '.favorite-btn', '.genre-tag', '.goty-entry-remove', '.goty-remove'];
      selectors.forEach(sel => this.addRippleToSelector(sel));
    };
  }
  if (!P.addRippleToSelector) {
    P.addRippleToSelector = function(sel) {
      document.querySelectorAll(sel).forEach(el => {
        if (el.dataset.rippleBound) return;
        el.dataset.rippleBound = "1";
        el.addEventListener('click', (e) => {
          const rect = el.getBoundingClientRect();
          const ripple = document.createElement('span');
          ripple.className = 'ripple';
          const size = Math.max(rect.width, rect.height);
          ripple.style.width = ripple.style.height = size + 'px';
          ripple.style.left = (e.clientX - rect.left - size/2) + 'px';
          ripple.style.top  = (e.clientY - rect.top  - size/2) + 'px';
          el.appendChild(ripple);
          ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
        });
      });
    };
  }
  if (!P.staggerCards) {
    P.staggerCards = function() {
      const grid = this.$gamesGrid;
      if (!grid) return;
      grid.querySelectorAll('.game-card').forEach((card, i) => {
        card.style.animationDelay = (i * 50) + 'ms';
        card.classList.add('reveal');
      });
    };
  }
  if (!P.toast) {
    P.toast = function(message, type='info') {
      const host = document.getElementById('toaster');
      if (!host) return;
      const t = document.createElement('div');
      t.className = 'toast toast--' + type;
      t.textContent = message;
      host.appendChild(t);
      requestAnimationFrame(() => t.classList.add('show'));
      const close = () => {
        t.classList.remove('show');
        t.addEventListener('transitionend', () => t.remove(), { once: true });
      };
      setTimeout(close, 2600);
    };
  }

  // Wrap methods to inject polish
  const wrap = (obj, key, after) => {
    if (!obj[key] || obj[key].__wrapped) return;
    const original = obj[key];
    const wrapped = function(...args) {
      const out = original.apply(this, args);
      try { after && after.apply(this, args); } catch(_) {}
      return out;
    };
    wrapped.__wrapped = true;
    obj[key] = wrapped;
  };

  // After render: fade, stagger, ripples
  wrap(P, 'renderGames', function() {
    const grid = this.$gamesGrid;
    if (grid) {
      grid.classList.add('fade');
      setTimeout(() => grid.classList.remove('fade'), 260);
    }
    this.staggerCards && this.staggerCards();
    this.setupRipples && this.setupRipples();
  });

  // On favorite toggle: toast feedback
  wrap(P, 'toggleFavorite', function(gameId) {
    const added = this.favorites && this.favorites.has(gameId);
    this.toast && this.toast(added ? "Añadido a Favoritos" : "Eliminado de Favoritos", added ? "success" : "warn");
  });

  // On GOTY changes: toast
  wrap(P, 'saveGoty', function() { this.toast && this.toast("GOTY guardado ✅", "success"); });
  wrap(P, 'removeGoty', function() { this.toast && this.toast("GOTY eliminado 🗑️", "warn"); });

  // On category change: title flip
  wrap(P, 'switchCategory', function() {
    const title = document.getElementById('content-title');
    if (title) { title.classList.add('flip'); setTimeout(() => title.classList.remove('flip'), 420); }
  });

  // Ensure we set up initial ripples after init
  wrap(P, 'safeInit', function() { this.setupRipples && this.setupRipples(); });
})();
