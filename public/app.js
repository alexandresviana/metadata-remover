const GHOSTCHAT_URL = "https://ghosth.chat";
const CSRF_HEADER = "x-csrf-token";

const loginScreen = document.getElementById("loginScreen");
const loginForm = document.getElementById("loginForm");
const loginPassword = document.getElementById("loginPassword");
const loginError = document.getElementById("loginError");
const loginBtn = document.getElementById("loginBtn");
const appPage = document.getElementById("appPage");
const logoutBtn = document.getElementById("logoutBtn");

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const pickBtn = document.getElementById("pickBtn");
const changeFileBtn = document.getElementById("changeFileBtn");
const uploadPlaceholder = document.getElementById("uploadPlaceholder");
const previewArea = document.getElementById("previewArea");
const previewImg = document.getElementById("previewImg");
const fileNameEl = document.getElementById("fileName");
const fileSizeEl = document.getElementById("fileSize");
const statusBar = document.getElementById("statusBar");
const infoPanel = document.getElementById("infoPanel");
const infoGrid = document.getElementById("infoGrid");
const metadataPanel = document.getElementById("metadataPanel");
const metaBody = document.getElementById("metaBody");
const metaCount = document.getElementById("metaCount");
const metaSummary = document.getElementById("metaSummary");
const metaFooter = document.getElementById("metaFooter");
const metaSearchWrap = document.getElementById("metaSearchWrap");
const metaSearch = document.getElementById("metaSearch");
const noMetadata = document.getElementById("noMetadata");
const metaTable = document.getElementById("metaTable");
const tableWrap = document.getElementById("tableWrap");
const actionsPanel = document.getElementById("actionsPanel");
const stripBtn = document.getElementById("stripBtn");
const stripSpinner = document.getElementById("stripSpinner");
const resultPanel = document.getElementById("resultPanel");
const redownloadBtn = document.getElementById("redownloadBtn");
const ghostChatLink = document.getElementById("ghostChatLink");
const ghostChatShareBtn = document.getElementById("ghostChatShareBtn");
const ghostChatHint = document.getElementById("ghostChatHint");

const VALUE_COLLAPSE_LEN = 180;
let currentFile = null;
let allEntries = [];
let sectionLabels = {};
let csrfToken = null;
let lastCleanBlob = null;
let lastCleanFilename = "imagem_sem_metadados.jpg";
let lastCleanMime = "image/jpeg";

function showLogin(message = "") {
  loginScreen.classList.remove("hidden");
  appPage.classList.add("hidden");
  csrfToken = null;
  if (message) {
    loginError.textContent = message;
    loginError.classList.remove("hidden");
  } else {
    loginError.classList.add("hidden");
  }
}

function showApp() {
  loginScreen.classList.add("hidden");
  appPage.classList.remove("hidden");
  loginError.classList.add("hidden");
  loginPassword.value = "";
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (csrfToken && options.method && options.method !== "GET") {
    headers.set(CSRF_HEADER, csrfToken);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  if (res.status === 401) {
    showLogin("Sessão expirada. Entre novamente.");
    throw new Error("Não autenticado.");
  }

  if (res.status === 403) {
    showLogin("Sessão inválida. Entre novamente.");
    throw new Error("CSRF inválido.");
  }

  return res;
}

async function checkSession() {
  const res = await fetch("/api/session", { credentials: "same-origin" });
  if (!res.ok) {
    showLogin();
    return false;
  }
  const data = await res.json();
  if (!data.authenticated) {
    showLogin();
    return false;
  }
  csrfToken = data.csrfToken;
  showApp();
  return true;
}

async function login(password) {
  loginBtn.disabled = true;
  loginError.classList.add("hidden");

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) {
      loginError.textContent = data.error || "Falha no login.";
      loginError.classList.remove("hidden");
      return;
    }
    csrfToken = data.csrfToken;
    showApp();
  } catch {
    loginError.textContent = "Erro de conexão. Tente de novo.";
    loginError.classList.remove("hidden");
  } finally {
    loginBtn.disabled = false;
  }
}

async function logout() {
  try {
    await apiFetch("/api/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  showLogin();
}

function hideResultPanel() {
  resultPanel.classList.add("hidden");
  lastCleanBlob = null;
}

function showResultPanel(blob, filename, mime) {
  lastCleanBlob = blob;
  lastCleanFilename = filename;
  lastCleanMime = mime;
  resultPanel.classList.remove("hidden");

  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof File !== "undefined";

  if (canShare) {
    try {
      const file = new File([blob], filename, { type: mime });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        ghostChatShareBtn.classList.remove("hidden");
        ghostChatHint.textContent =
          "Use “Compartilhar imagem” para enviar direto (celular) ou abra o Ghost Chat e anexe o arquivo baixado.";
        return;
      }
    } catch {
      /* fall through */
    }
  }

  ghostChatShareBtn.classList.add("hidden");
  ghostChatHint.innerHTML =
    `Abra o <a href="${GHOSTCHAT_URL}" target="_blank" rel="noopener noreferrer">ghosth.chat</a>, entre na sala e anexe a imagem que acabou de baixar.`;
}

function downloadCleanImage() {
  if (!lastCleanBlob) return;
  const url = URL.createObjectURL(lastCleanBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = lastCleanFilename;
  a.click();
  URL.revokeObjectURL(url);
}

async function shareCleanImage() {
  if (!lastCleanBlob) return;

  const file = new File([lastCleanBlob], lastCleanFilename, { type: lastCleanMime });
  try {
    await navigator.share({
      files: [file],
      title: "Imagem sem metadados",
      text: "Enviar no Ghost Chat",
    });
  } catch (err) {
    if (err.name !== "AbortError") {
      window.open(GHOSTCHAT_URL, "_blank", "noopener,noreferrer");
    }
  }
}

function openGhostChat() {
  window.open(GHOSTCHAT_URL, "_blank", "noopener,noreferrer");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function setStatus(message, type = "loading") {
  statusBar.textContent = message;
  statusBar.className = `status-bar ${type}`;
  statusBar.classList.remove("hidden");
}

function showPreview(file) {
  uploadPlaceholder.classList.add("hidden");
  previewArea.classList.remove("hidden");
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  previewImg.src = URL.createObjectURL(file);
}

function resetPanels() {
  hideResultPanel();
  infoPanel.classList.add("hidden");
  metadataPanel.classList.add("hidden");
  actionsPanel.classList.add("hidden");
  stripBtn.disabled = true;
  metaBody.replaceChildren();
  infoGrid.innerHTML = "";
  metaSearch.value = "";
  metaSearchWrap.classList.add("hidden");
  metaSummary.classList.add("hidden");
  metaFooter.classList.add("hidden");
  tableWrap.classList.add("hidden");
  allEntries = [];
}

function sectionTitle(section) {
  return sectionLabels[section] || section.toUpperCase();
}

function createValueCell(text) {
  const td = document.createElement("td");
  const span = document.createElement("span");
  span.className = "meta-value-long";
  span.textContent = text;

  if (text.length > VALUE_COLLAPSE_LEN) {
    span.classList.add("is-collapsed");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "expand-value-btn";
    btn.textContent = "Ver valor completo";
    btn.addEventListener("click", () => {
      const collapsed = span.classList.toggle("is-collapsed");
      btn.textContent = collapsed ? "Ver valor completo" : "Recolher";
    });
    td.append(span, btn);
  } else {
    td.append(span);
  }

  return td;
}

function createMetadataRow(entry) {
  const tr = document.createElement("tr");
  tr.className = "meta-row";
  tr.dataset.section = entry.section || "other";
  tr.dataset.search = `${entry.key} ${entry.value}`.toLowerCase();

  const keyTd = document.createElement("td");
  keyTd.textContent = entry.key;
  keyTd.title = entry.key;

  tr.append(keyTd, createValueCell(entry.value));
  return tr;
}

function createSectionRow(section, count) {
  const tr = document.createElement("tr");
  tr.className = "section-row";
  tr.dataset.sectionHeader = section;
  const td = document.createElement("td");
  td.colSpan = 2;
  td.textContent = `${sectionTitle(section)} (${count})`;
  tr.append(td);
  return tr;
}

function renderMetadataTable(entries) {
  metaBody.replaceChildren();

  let lastSection = null;
  const sectionCounts = {};

  for (const entry of entries) {
    const section = entry.section || "other";
    sectionCounts[section] = (sectionCounts[section] || 0) + 1;
  }

  for (const entry of entries) {
    const section = entry.section || "other";
    if (section !== lastSection) {
      metaBody.append(createSectionRow(section, sectionCounts[section]));
      lastSection = section;
    }
    metaBody.append(createMetadataRow(entry));
  }
}

function updateMetaFooter(visibleCount, totalCount) {
  if (visibleCount === totalCount) {
    metaFooter.textContent = `Exibindo todos os ${totalCount} campos. Role a tabela se não estiver vendo tudo.`;
  } else {
    metaFooter.textContent = `Exibindo ${visibleCount} de ${totalCount} campos (filtro ativo).`;
  }
  metaFooter.classList.remove("hidden");
}

function applyMetadataFilter(query) {
  const q = query.trim().toLowerCase();
  let visible = 0;

  const rows = metaBody.querySelectorAll("tr");
  const visibleBySection = {};

  for (const row of rows) {
    if (row.classList.contains("section-row")) {
      row.classList.add("is-hidden");
      continue;
    }

    const matches = !q || row.dataset.search.includes(q);
    row.classList.toggle("is-hidden", !matches);

    if (matches) {
      visible += 1;
      const section = row.dataset.section;
      visibleBySection[section] = (visibleBySection[section] || 0) + 1;
    }
  }

  for (const row of rows) {
    if (!row.classList.contains("section-row")) continue;
    const section = row.dataset.sectionHeader;
    const count = visibleBySection[section] || 0;
    row.classList.toggle("is-hidden", count === 0);
    if (count > 0) {
      const td = row.querySelector("td");
      td.textContent = `${sectionTitle(section)} (${count})`;
    }
  }

  updateMetaFooter(visible, allEntries.length);
}

function renderMetadata(entries, sections, labels) {
  allEntries = entries;
  sectionLabels = labels || {};
  metaCount.textContent = String(entries.length);

  if (!entries.length) {
    noMetadata.classList.remove("hidden");
    metaTable.classList.add("hidden");
    tableWrap.classList.add("hidden");
    return;
  }

  noMetadata.classList.add("hidden");
  metaTable.classList.remove("hidden");
  tableWrap.classList.remove("hidden");
  metaSearchWrap.classList.remove("hidden");

  const sectionParts = Object.entries(sections || {})
    .map(([name, count]) => `${sectionTitle(name)}: ${count}`)
    .join(" · ");

  metaSummary.textContent = sectionParts
    ? `Distribuição: ${sectionParts}`
    : `${entries.length} campos no total.`;
  metaSummary.classList.remove("hidden");

  renderMetadataTable(entries);
  updateMetaFooter(entries.length, entries.length);
}

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("Selecione um arquivo de imagem válido.", "error");
    return;
  }

  currentFile = file;
  resetPanels();
  showPreview(file);
  setStatus("Analisando metadados…", "loading");
  stripBtn.disabled = true;

  const formData = new FormData();
  formData.append("image", file);

  try {
    const res = await apiFetch("/api/analyze", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Falha na análise.");
    }

    renderInfo(data.info);
    renderMetadata(data.entries, data.sections, data.sectionLabels);

    infoPanel.classList.remove("hidden");
    metadataPanel.classList.remove("hidden");
    actionsPanel.classList.remove("hidden");
    stripBtn.disabled = false;

    const total = data.totalCount ?? data.entries.length;
    if (data.hasMetadata && total > 0) {
      setStatus(`${total} campo(s) de metadados encontrados — todos listados na tabela abaixo.`, "success");
    } else {
      setStatus("Imagem carregada. Nenhum metadado legível detectado — ainda assim você pode gerar uma cópia limpa.", "success");
    }
  } catch (err) {
    setStatus(err.message || "Erro ao processar a imagem.", "error");
  }
}

function renderInfo(info) {
  const rows = [
    ["Arquivo", info.filename],
    ["Tipo", info.mimetype],
    ["Tamanho", formatBytes(info.size)],
    ["Dimensões", info.width && info.height ? `${info.width} × ${info.height}` : "—"],
    ["Formato", info.format || "—"],
    ["Orientação EXIF", info.orientation != null ? String(info.orientation) : "—"],
  ];

  infoGrid.innerHTML = rows
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(String(value))}</dd>`)
    .join("");
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function stripMetadata() {
  if (!currentFile) return;

  stripBtn.disabled = true;
  stripSpinner.classList.remove("hidden");
  setStatus("Gerando imagem sem metadados…", "loading");

  const formData = new FormData();
  formData.append("image", currentFile);

  try {
    const res = await apiFetch("/api/strip", { method: "POST", body: formData });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Falha ao gerar a imagem.");
    }

    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    const downloadName = match ? match[1] : "imagem_sem_metadados.jpg";
    const mime = blob.type || "image/jpeg";

    downloadCleanImageFromBlob(blob, downloadName);
    showResultPanel(blob, downloadName, mime);

    setStatus("Download iniciado — envie no Ghost Chat quando quiser.", "success");
  } catch (err) {
    setStatus(err.message || "Erro ao remover metadados.", "error");
  } finally {
    stripBtn.disabled = false;
    stripSpinner.classList.add("hidden");
  }
}

function downloadCleanImageFromBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  login(loginPassword.value);
});

logoutBtn.addEventListener("click", logout);
redownloadBtn.addEventListener("click", downloadCleanImage);
ghostChatLink.addEventListener("click", (e) => {
  e.preventDefault();
  openGhostChat();
});
ghostChatShareBtn.addEventListener("click", shareCleanImage);

pickBtn.addEventListener("click", () => fileInput.click());
changeFileBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
  fileInput.value = "";
});

metaSearch.addEventListener("input", () => applyMetadataFilter(metaSearch.value));

stripBtn.addEventListener("click", stripMetadata);

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});

checkSession();
