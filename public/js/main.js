const API = "/api/items";

async function fetchJSON(url, opts) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) throw new Error("http " + res.status);
  return res.status === 204 ? null : res.json();
}

async function load() {
  const ul = document.getElementById("items");
  ul.innerHTML = "";
  const items = await fetchJSON(API);
  items.forEach(it => {
    const li = document.createElement("li");
    li.textContent = it.name + " - " + (it.description || "");
    ul.appendChild(li);
  });
}

document.getElementById("form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = document.getElementById("name").value.trim();
  const description = document.getElementById("description").value.trim();
  if (!name) return;
  await fetchJSON(API, { method: "POST", body: JSON.stringify({ name, description }) });
  e.target.reset();
  load();
});

load();
