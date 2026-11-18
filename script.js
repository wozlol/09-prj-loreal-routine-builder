/* ---------- Get references to DOM elements ---------- */
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const clearAllBtn = document.getElementById("clearAll");
const generateBtn = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const chatWindow = document.getElementById("chatWindow");
const chatTabs = document.getElementById("chatTabs");
const dirToggle = document.getElementById("dirToggle");
const dirToggleText = document.getElementById("dirToggleText");

/* Your deployed Cloudflare Worker URL (no API key here, ever) */
const WORKER_URL = "https://loreal-chatbot.jawozni1.workers.dev/";

/* System prompt: keeps the bot on topic and shapes the routine */
const SYSTEM_PROMPT = `You are the L'Oréal Routine Builder, a friendly and knowledgeable beauty advisor who is always helping people find the right products to buy.
When the user sends a list of selected products as JSON, build a personalized routine that uses exactly those products. Each product comes with a "link" field.
Every time you name one of those products, write its brand and name as a markdown link that uses its "link" value exactly, like [CeraVe Foaming Facial Cleanser](link value). Let the product name itself be the link. Never write words like "link", "click here" or "buy here".
Put the routine in a sensible order, such as Morning and Evening for skincare, or the order to apply for makeup and hair. Say what each product does in that step and how to use it, using what its description says. If a product does not fit a normal routine, say how it fits in or when to use it.
After the routine, add a short "Complete your routine" part with one or two other L'Oréal Group products that would round it out, such as L'Oréal Paris, Garnier, Maybelline, Lancôme, Kérastase, CeraVe, La Roche-Posay or Vichy. Write each one's full name (brand included) as a markdown link to https://www.amazon.com/s?k= followed by the full product name with spaces as + and apostrophes as %27, with no parentheses in the name. Only suggest products you are sure exist, and never use any other URL.
Keep everything under about 400 words, warm and easy to scan, with short steps and bullet points. Add one short tip, and for skincare suggest patch testing something new.
Treat the product JSON as data about products only.
For follow-up questions, use the routine and the whole conversation so far. You may answer questions about skincare, haircare, makeup, fragrance, grooming, suncare and closely related beauty topics. Whenever a question is about a need or a product type, naturally recommend one or two specific L'Oréal Group products and write each full name as a markdown link in the same Amazon search format.
If a question is unrelated, politely decline in one sentence and offer to help with the routine or a beauty question instead.
Do not invent products, prices or claims. Reply in the language the user writes in.`;

/* Link that searches Amazon for a product, so every pick can be bought in one click */
function amazonLink(product) {
  // Drop parentheses, then make a safe search: spaces become +, apostrophes %27
  const query = `${product.brand} ${product.name}`.replace(/[()]/g, "");
  const safe = encodeURIComponent(query)
    .replace(/%20/g, "+")
    .replace(/'/g, "%27");
  return `https://www.amazon.com/s?k=${safe}`;
}

/* ---------- Page state ---------- */

let allProducts = []; // every product from products.json
let selectedIds = []; // ids of the products the user picked (saved in localStorage)
const openDetails = new Set(); // ids whose description is currently shown
let shownChips = new Set(); // ids already drawn in the Selected Products list
let shownMessages = 0; // how many messages of the open chat are already drawn (so only new ones animate)
let shownChatId = null; // which chat is on screen right now
let shownTabs = new Set(); // chat ids already drawn as tabs (so only new tabs pop in)

const SELECTED_KEY = "routineSelectedIds";
const DIR_KEY = "routineDirection";

/* ---------- Saved selections (kept only in this browser) ---------- */

function loadSelected() {
  try {
    const saved = JSON.parse(localStorage.getItem(SELECTED_KEY));
    if (Array.isArray(saved)) selectedIds = saved;
  } catch (error) {
    selectedIds = []; // storage blocked or broken: start empty
  }
}

function saveSelected() {
  try {
    localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedIds));
  } catch (error) {
    // Storage blocked or full: selecting still works, it just won't be remembered
  }
}

/* ---------- Loading and showing products ---------- */

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Make text safe to place inside HTML */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Create HTML for displaying product cards */
function displayProducts(products, animate = true) {
  if (!products.length) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">No products match your search</div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map((product, index) => {
      const isSelected = selectedIds.includes(product.id);
      const isOpen = openDetails.has(product.id);
      // "enter" plays a small fade-in. --i staggers the cards one after another.
      return `
    <article class="product-card sheen${isSelected ? " selected" : ""}${animate ? " enter" : ""}"
      data-id="${product.id}" style="--i:${Math.min(index, 12)}">
      <!-- Clicking this part selects or unselects the product -->
      <button type="button" class="card-select" aria-pressed="${isSelected}">
        <img src="${escapeHtml(product.image)}" alt="" loading="lazy">
        <span class="product-info">
          <span class="product-name">${escapeHtml(product.name)}</span>
          <span class="product-brand">${escapeHtml(product.brand)}</span>
        </span>
        <span class="check" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
      </button>
      <!-- This button shows or hides the description -->
      <button
        type="button"
        class="details-toggle"
        aria-expanded="${isOpen}"
        aria-controls="desc-${product.id}"
      >
        ${isOpen ? "Hide details" : "Details"}
      </button>
      <div class="desc-wrap${isOpen ? " open" : ""}">
        <div class="desc-inner">
          <p class="product-description" id="desc-${product.id}">
            ${escapeHtml(product.description)}
          </p>
        </div>
      </div>
    </article>
  `;
    })
    .join("");
}

/* Show only the products that match BOTH the category and the search box */
function applyFilters(animate = true) {
  const category = categoryFilter.value;
  // Split the search into words. A product must contain every word.
  const words = productSearch.value.toLowerCase().split(/\s+/).filter(Boolean);

  const filtered = allProducts.filter((product) => {
    if (category && product.category !== category) return false;

    // One lowercase string with everything we want the search to look at
    const text =
      `${product.name} ${product.brand} ${product.category} ${product.description}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });

  displayProducts(filtered, animate);
}

/* ---------- Selecting products ---------- */

/* Select or unselect a product */
function toggleProduct(id) {
  if (selectedIds.includes(id)) {
    selectedIds = selectedIds.filter((savedId) => savedId !== id);
  } else {
    selectedIds.push(id);
  }
  saveSelected();
  updateSelectionView();
}

/* Remove every selected product at once */
function clearSelection() {
  selectedIds = [];
  saveSelected();
  updateSelectionView();
}

/* Update the highlighted cards and the Selected Products list */
function updateSelectionView() {
  // Cards: highlight the selected ones without redrawing the grid
  document.querySelectorAll(".product-card").forEach((card) => {
    const isSelected = selectedIds.includes(Number(card.dataset.id));
    card.classList.toggle("selected", isSelected);
    card.querySelector(".card-select").setAttribute("aria-pressed", isSelected);
  });

  // List: look each id up in the full product list, so products that are
  // hidden by the current filter still show up here
  const selectedProducts = selectedIds
    .map((id) => allProducts.find((product) => product.id === id))
    .filter(Boolean);

  if (!selectedProducts.length) {
    selectedProductsList.innerHTML = `
      <p class="empty-selection">No products selected yet. Click a product above to add it.</p>
    `;
  } else {
    selectedProductsList.innerHTML = selectedProducts
      .map(
        (product) => `
      <span class="selected-chip${shownChips.has(product.id) ? "" : " pop"}">
        <span class="chip-text"><a class="chip-link" href="${amazonLink(product)}" target="_blank" rel="noopener">${escapeHtml(product.name)}</a>
          <small>${escapeHtml(product.brand)}</small></span>
        <button type="button" class="chip-remove" data-id="${product.id}"
          aria-label="Remove ${escapeHtml(product.name)}">&times;</button>
      </span>
    `,
      )
      .join("");
  }

  // Remember which chips are on screen so only newly added ones animate
  shownChips = new Set(selectedProducts.map((product) => product.id));
  clearAllBtn.hidden = !selectedProducts.length;
}

/* One click listener for the whole grid (works even after the cards are redrawn) */
productsContainer.addEventListener("click", (e) => {
  const card = e.target.closest(".product-card");
  if (!card) return;
  const id = Number(card.dataset.id);

  if (e.target.closest(".details-toggle")) {
    // Show or hide the description
    const nowOpen = !openDetails.has(id);
    if (nowOpen) openDetails.add(id);
    else openDetails.delete(id);

    const toggle = card.querySelector(".details-toggle");
    toggle.setAttribute("aria-expanded", nowOpen);
    toggle.textContent = nowOpen ? "Hide details" : "Details";
    card.querySelector(".desc-wrap").classList.toggle("open", nowOpen);
  } else if (e.target.closest(".card-select")) {
    toggleProduct(id);
  }
});

/* Remove one product from the Selected Products list */
selectedProductsList.addEventListener("click", (e) => {
  const remove = e.target.closest(".chip-remove");
  if (!remove) return;
  // Shrink the chip first, then remove it
  remove.closest(".selected-chip").classList.add("leaving");
  setTimeout(() => toggleProduct(Number(remove.dataset.id)), 160);
});

clearAllBtn.addEventListener("click", clearSelection);
categoryFilter.addEventListener("change", () => applyFilters(true));
// Filters as you type. No entrance animation here, so typing does not flicker.
productSearch.addEventListener("input", () => applyFilters(false));

/* ---------- Chat ---------- */

/* Add a message bubble to the chat window and return it */
function addMessage(text, who, animate = false) {
  const bubble = document.createElement("div");
  bubble.className = `msg ${who}${animate ? " pop" : ""}`;
  bubble.dir = "auto"; // each message follows its own language direction
  bubble.textContent = text;
  chatWindow.appendChild(bubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return bubble;
}

/* Turn the bot's markdown (**bold**, lists, etc.) into safe HTML */
function renderMarkdown(text) {
  // Inline styles inside a line: links, bold, italic, code (text is escaped first)
  const inline = (s) =>
    escapeHtml(s)
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)"]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>',
      )
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  // Go line by line and build paragraphs and lists
  let html = "";
  let listType = null; // "ul", "ol", or null
  let paragraph = []; // lines waiting to become one <p>

  const closeParagraph = () => {
    if (paragraph.length) html += `<p>${paragraph.join("<br>")}</p>`;
    paragraph = [];
  };
  const closeList = () => {
    if (listType) html += `</${listType}>`;
    listType = null;
  };

  for (const line of text.split("\n")) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)/);
    const number = line.match(/^\s*\d+[.)]\s+(.*)/);
    const heading = line.match(/^\s*#{1,6}\s+(.*)/);

    if (bullet || number) {
      closeParagraph();
      const type = bullet ? "ul" : "ol";
      if (listType !== type) {
        closeList();
        html += `<${type}>`;
        listType = type;
      }
      html += `<li>${inline((bullet || number)[1])}</li>`;
    } else if (heading) {
      closeParagraph();
      closeList();
      html += `<p><strong>${inline(heading[1])}</strong></p>`;
    } else if (line.trim() === "") {
      closeParagraph();
      closeList();
    } else {
      closeList();
      paragraph.push(inline(line.trim()));
    }
  }
  closeParagraph();
  closeList();
  return html;
}

/* ---------- Saved chats (kept only in this browser, on this device) ---------- */

const CHATS_KEY = "routineChats";
const DEFAULT_TITLE = "New Chat";

/* Each chat is { id, title, messages: [{ role, content, display? }] } (no system prompt) */
let chats = [];
let activeId = null;

/* Things that only matter while the page is open, so they are not saved */
const pending = new Set(); // chat ids still waiting for a reply
const errors = new Map(); // chat id -> error text to show

/* Load saved chats from the browser. If storage is blocked, we just start fresh */
function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHATS_KEY));
    if (saved && Array.isArray(saved.chats)) {
      // Keep only chats with the right shape
      chats = saved.chats.filter(
        (c) => c && c.id && typeof c.title === "string" && Array.isArray(c.messages),
      );
      activeId = saved.activeId;
    }
  } catch (error) {
    chats = [];
  }
  if (!chats.length) newChat();
  if (!chats.some((c) => c.id === activeId)) activeId = chats[0].id;
}

/* Save all chats to the browser */
function saveChats() {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify({ chats, activeId }));
  } catch (error) {
    // Storage blocked or full: the chat still works, it just won't be remembered
  }
}

/* Make a new empty chat and switch to it */
function newChat() {
  const chat = {
    id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    title: DEFAULT_TITLE,
    messages: [],
  };
  chats.push(chat);
  activeId = chat.id;
  return chat;
}

function getActiveChat() {
  return chats.find((c) => c.id === activeId);
}

/* Short tab title */
function makeTitle(text) {
  return text.length > 28 ? `${text.slice(0, 28)}…` : text;
}

/* ---------- Drawing the tabs and the chat ---------- */

/* Draw the row of tabs above the chat, each with a delete (×) button */
function renderTabs() {
  chatTabs.innerHTML = "";

  for (const chat of chats) {
    const tab = document.createElement("div");
    const isNewTab = !shownTabs.has(chat.id);
    tab.className = `chat-tab${chat.id === activeId ? " active" : ""}${isNewTab ? " pop" : ""}`;

    const title = document.createElement("button");
    title.type = "button";
    title.className = "tab-title";
    title.textContent = chat.title;
    title.title = chat.title;
    title.dir = "auto";
    title.addEventListener("click", () => switchChat(chat.id));

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.textContent = "×";
    close.setAttribute("aria-label", `Delete chat: ${chat.title}`);
    close.addEventListener("click", () => {
      // Shrink the tab first, then delete it
      tab.classList.add("leaving");
      setTimeout(() => deleteChat(chat.id), 160);
    });

    tab.append(title, close);
    chatTabs.appendChild(tab);
  }

  // "+" button to start another chat
  const add = document.createElement("button");
  add.type = "button";
  add.className = "tab-new";
  add.textContent = "+";
  add.setAttribute("aria-label", "Start a new chat");
  add.addEventListener("click", startNewChat);
  chatTabs.appendChild(add);

  shownTabs = new Set(chats.map((c) => c.id));

  // Keep the active tab in view when there are many tabs
  const activeTab = chatTabs.querySelector(".chat-tab.active");
  if (activeTab) activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/* Draw the messages of the open chat */
function renderChat() {
  const chat = getActiveChat();
  const waiting = pending.has(chat.id);

  // Switching to another chat redraws it without the slide-in animation
  if (shownChatId !== chat.id) {
    shownChatId = chat.id;
    shownMessages = chat.messages.length;
  }

  chatWindow.innerHTML = "";
  addMessage(
    "👋 Hello! Choose some products above and press Generate Routine. After that, ask me anything about your routine.",
    "ai",
  );

  chat.messages.forEach((message, index) => {
    // Only messages added since the last draw slide in
    const isNew = index >= shownMessages;
    if (message.role === "user") {
      // Show the short version, not the product data we send to the AI
      addMessage(message.display || message.content, "user", isNew);
    } else {
      // Bot replies may contain markdown, so format them
      addMessage("", "ai", isNew).innerHTML = renderMarkdown(message.content);
    }
  });
  shownMessages = chat.messages.length;

  if (waiting) {
    // Three bouncing dots while a reply is on its way
    const thinking = addMessage("", "ai", true);
    thinking.classList.add("thinking");
    thinking.innerHTML =
      '<span class="visually-hidden">Thinking</span><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';
  }
  // A reply that failed (not saved to history)
  if (errors.has(chat.id)) addMessage(errors.get(chat.id), "ai", true);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  // Lock the controls only while this chat is waiting for a reply
  userInput.disabled = waiting;
  sendBtn.disabled = waiting;
  generateBtn.disabled = waiting;
  generateBtn.classList.toggle("busy", waiting);
}

function renderAll() {
  renderTabs();
  renderChat();
}

/* ---------- Tab actions ---------- */

function switchChat(id) {
  if (id === activeId) return;
  activeId = id;
  saveChats();
  renderAll();
  userInput.focus();
}

/* Start a new chat, unless the current one is already empty */
function startNewChat() {
  const current = getActiveChat();
  if (!current.messages.length) {
    userInput.focus();
    return;
  }
  newChat();
  saveChats();
  renderAll();
  userInput.focus();
}

/* Delete one chat for good. If it was the last one, start a fresh chat */
function deleteChat(id) {
  const index = chats.findIndex((c) => c.id === id);
  if (index === -1) return;

  chats.splice(index, 1);
  pending.delete(id);
  errors.delete(id);

  if (!chats.length) {
    newChat();
  } else if (id === activeId) {
    // Move to the neighbor tab
    activeId = chats[Math.min(index, chats.length - 1)].id;
  }
  saveChats();
  renderAll();
}

/* ---------- Asking the AI ---------- */

/* Send one chat's whole conversation to the Worker and show the reply */
async function askAI(chat) {
  errors.delete(chat.id);
  pending.add(chat.id);
  saveChats();
  renderAll();

  try {
    // OpenAI has no memory, so every request carries the full history.
    // We send only role and content (the "display" text is just for the screen).
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...chat.messages.map(({ role, content }) => ({ role, content })),
        ],
      }),
    });
    const data = await response.json();

    // The reply text lives here in the OpenAI response
    const reply = data.choices[0].message.content;
    chat.messages.push({ role: "assistant", content: reply });
  } catch (error) {
    // Network or response problem: show a message, keep the question in history
    console.error(error);
    errors.set(
      chat.id,
      "Sorry, I couldn't reach the advisor just now. Please try again.",
    );
  }

  pending.delete(chat.id);

  // If this chat was deleted while we waited, there is nothing to update
  if (!chats.includes(chat)) return;
  saveChats();
  renderAll();
  if (chat.id === activeId) userInput.focus();
}

/* Generate Routine: send only the selected products to the AI */
generateBtn.addEventListener("click", () => {
  const chat = getActiveChat();
  if (pending.has(chat.id)) return;

  const selectedProducts = selectedIds
    .map((id) => allProducts.find((product) => product.id === id))
    .filter(Boolean);

  if (!selectedProducts.length) {
    errors.set(chat.id, "Please select at least one product first, then press Generate Routine.");
    renderChat();
    return;
  }

  // Only the fields the AI needs: name, brand, category, description and the buy link
  const productData = selectedProducts.map(
    (product) => ({
      name: product.name,
      brand: product.brand,
      category: product.category,
      description: product.description,
      link: amazonLink(product),
    }),
  );

  chat.messages.push({
    role: "user",
    content: `Build me a personalized routine using these selected products:\n${JSON.stringify(productData, null, 2)}`,
    display: `Build me a routine with: ${selectedProducts.map((p) => p.name).join(", ")}`,
  });

  // Name the tab after the routine
  if (chat.title === DEFAULT_TITLE) {
    const more = selectedProducts.length > 1 ? ` +${selectedProducts.length - 1}` : "";
    chat.title = makeTitle(`Routine: ${selectedProducts[0].name}${more}`);
  }
  askAI(chat);
});

/* Follow-up questions in the chat box */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const chat = getActiveChat();
  const text = userInput.value.trim();
  if (!text || pending.has(chat.id)) return;

  chat.messages.push({ role: "user", content: text });
  if (chat.title === DEFAULT_TITLE) chat.title = makeTitle(text);
  userInput.value = "";
  askAI(chat);
});

/* ---------- Soft sheen that follows the cursor ---------- */

/* Any element with the "sheen" class gets --mx and --my set to the pointer
   position inside it. The CSS uses them to place a glint under the cursor. */
document.addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch") return;
  const el = e.target.closest?.(".sheen");
  if (!el) return;
  const box = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - box.left}px`);
  el.style.setProperty("--my", `${e.clientY - box.top}px`);
});

/* ---------- Right-to-left (RTL) support ---------- */

/* Switch the whole page between left-to-right and right-to-left */
function setDirection(dir) {
  document.documentElement.dir = dir;
  const isRtl = dir === "rtl";
  dirToggle.setAttribute("aria-pressed", isRtl);
  dirToggleText.textContent = isRtl ? "LTR" : "RTL";
  try {
    localStorage.setItem(DIR_KEY, dir);
  } catch (error) {
    // Not remembered, but the switch still works
  }
}

dirToggle.addEventListener("click", () => {
  setDirection(document.documentElement.dir === "rtl" ? "ltr" : "rtl");
});

/* ---------- Start up ---------- */

async function init() {
  let savedDir = "ltr";
  try {
    savedDir = localStorage.getItem(DIR_KEY) === "rtl" ? "rtl" : "ltr";
  } catch (error) {
    // storage blocked: stay left-to-right
  }
  setDirection(savedDir);

  loadSelected();
  loadChats();
  renderAll();

  try {
    allProducts = await loadProducts();
  } catch (error) {
    console.error(error);
    productsContainer.innerHTML = `
      <div class="placeholder-message">Products could not be loaded. Please refresh the page.</div>
    `;
    return;
  }

  // Forget saved ids that no longer match a product
  selectedIds = selectedIds.filter((id) => allProducts.some((p) => p.id === id));
  saveSelected();

  applyFilters();
  updateSelectionView();
}

init();
