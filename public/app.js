// public/app.js
(() => {
  // ============ DOM ============
  const historyWrap = document.getElementById("history");
  const chatEl = document.getElementById("chat");
  const inputEl = document.getElementById("msg");
  const composerEl = document.getElementById("composer");
  const spacerEl = document.getElementById("bottom-spacer");

  const modelSel = document.getElementById("modelSel");
  const personaToggle = document.getElementById("personaToggle");
  const settingsBtn = document.getElementById("settingsBtn");
  const sendBtn = document.getElementById("sendBtn");

  const settingsMask = document.getElementById("settingsMask");
  const customPromptEl = document.getElementById("customPrompt");
  const savePromptBtn = document.getElementById("savePrompt");
  const clearPromptBtn = document.getElementById("clearPrompt");
  const closeSettingsBtn = document.getElementById("closeSettings");
  const historyKeepEl = document.getElementById("historyKeep");
  const clearHistoryBtn = document.getElementById("clearHistory");
  const promptKeepEl = document.getElementById("promptKeep");

  const donateBtn = document.getElementById("donateBtn");
  const donateMask = document.getElementById("donateMask");
  const donateClose = document.getElementById("donateClose");

  const historyListEl = document.getElementById("historyList");
  const newChatBtn = document.getElementById("newChatBtn");

  if (!historyWrap || !chatEl || !inputEl || !composerEl || !spacerEl) {
    console.error("Missing required DOM nodes. Check ids: #history #chat #msg #composer #bottom-spacer.");
    return;
  }

  // ============ Models ============
  const MODELS = (window.APP_MODELS || [
    { id: "meta/llama-3.1-405b-instruct", label: "meta/llama-3.1" },
    { id: "z-ai/glm5", label: "glm5" },
    { id: "openai/gpt-oss-120b", label: "gpt-oss-120b" },
  ]);

  // ============ Token Estimator ============
  function estimateTokens(text){
    if (!text) return 0;
    let cjk = 0, ascii = 0;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") continue;
      const isCJK =
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3040 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7AF) ||
        (code >= 0xFF00 && code <= 0xFFEF);
      if (isCJK) cjk++; else ascii++;
    }
    return cjk + Math.ceil(ascii / 4);
  }

  // ============ Layout helpers ============
  function updateSpacer(){
    if (!composerEl || !spacerEl) return;
    const rect = composerEl.getBoundingClientRect();
    const rootStyle = getComputedStyle(document.documentElement);
    const gap = parseFloat(rootStyle.getPropertyValue("--composer-gap")) || 18;
    const extra = parseFloat(rootStyle.getPropertyValue("--spacer-extra")) || 28;
    const h = Math.ceil(rect.height + gap + extra);
    spacerEl.style.height = h + "px";
    historyWrap.style.scrollPaddingBottom = h + "px";
  }

  function isNearBottom(){
    const threshold = 120;
    return (historyWrap.scrollHeight - historyWrap.scrollTop - historyWrap.clientHeight) < threshold;
  }

  function scrollToBottom(){
    historyWrap.scrollTo({ top: historyWrap.scrollHeight, behavior: "auto" });
  }

  function makeRow(role){
    const row = document.createElement("div");
    row.className = "row " + (role === "user" ? "user" : "ai");

    const avatar = document.createElement("div");
    avatar.className = "avatar " + (role === "user" ? "human" : "bot");
    avatar.textContent = (role === "user" ? "U" : "B");

    const content = document.createElement("div");
    content.className = "content";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = (role === "user" ? "User" : "Bot");

    const bubble = document.createElement("div");
    bubble.className = "bubble " + (role === "user" ? "user" : "ai");

    const stats = document.createElement("div");
    stats.className = "stats";

    content.appendChild(meta);
    content.appendChild(bubble);
    content.appendChild(stats);

    if (role === "user") {
      row.appendChild(content);
      row.appendChild(avatar);
    } else {
      row.appendChild(avatar);
      row.appendChild(content);
    }

    chatEl.insertBefore(row, spacerEl);
    if (isNearBottom()) scrollToBottom();

    return { bubble, stats };
  }

  function clearUIRows(){
    const nodes = Array.from(chatEl.children);
    for (const n of nodes) {
      if (n === spacerEl) continue;
      chatEl.removeChild(n);
    }
  }

  // ============ Storage Keys ============
  const LS_MODEL = "cfw_model";
  const LS_USE_BUILTIN = "cfw_use_builtin";

  const LS_HISTORY_ENABLED = "cfw_history_enabled";
  const LS_CHAT_SESSION = "cfw_chat_session_v1";

  const LS_PROMPT_ENABLED = "cfw_prompt_enabled";
  const LS_CUSTOM_PROMPT = "cfw_custom_prompt_v1";

  const LS_CONVERSATIONS = "cfw_conversations_v1";
  const LS_CURRENT_CONV_ID = "cfw_current_conversation_id_v1";

  // ============ Persona / Settings ============
  let chatPassword = null;

  let useBuiltin = (localStorage.getItem(LS_USE_BUILTIN) ?? "1") === "1";
  if (personaToggle) personaToggle.textContent = useBuiltin ? "😈" : "😇";

  let historyEnabled = (localStorage.getItem(LS_HISTORY_ENABLED) ?? "0") === "1";
  let promptEnabled = (localStorage.getItem(LS_PROMPT_ENABLED) ?? "1") === "1";

  if (historyKeepEl) historyKeepEl.checked = historyEnabled;
  if (promptKeepEl) promptKeepEl.checked = promptEnabled;

  function persistConversationsIfEnabled(conversations){
    if (!historyEnabled) return;
    try {
      localStorage.setItem(LS_CONVERSATIONS, JSON.stringify(conversations));
    } catch {}
  }

  function loadConversations(){
    const raw = localStorage.getItem(LS_CONVERSATIONS);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function persistCurrentConvIdIfEnabled(id){
    if (!historyEnabled) return;
    try { localStorage.setItem(LS_CURRENT_CONV_ID, id); } catch {}
  }

  function loadCurrentConvId(){
    return localStorage.getItem(LS_CURRENT_CONV_ID);
  }

  // ============ Multi-conversation state ============
  let conversations = loadConversations();
  let currentConvId = loadCurrentConvId();

  function createNewConversation(){
    const newConv = {
      id: Date.now().toString(),
      title: "新对话",
      messages: []
    };
    conversations.unshift(newConv);
    currentConvId = newConv.id;
    persistConversationsIfEnabled(conversations);
    persistCurrentConvIdIfEnabled(currentConvId);
    renderHistoryList();
    switchConversation(currentConvId);
  }

  function getCurrentConversation(){
    return conversations.find(c => c.id === currentConvId) || null;
  }

  function switchConversation(convId){
    currentConvId = convId;
    const conv = getCurrentConversation();

    clearUIRows();

    if (conv && Array.isArray(conv.messages)) {
      for (const m of conv.messages) {
        const r = makeRow(m.role === "user" ? "user" : "assistant");
        r.bubble.textContent = m.content || "";
        r.stats.textContent = "";
      }
    }

    if (historyEnabled) persistCurrentConvIdIfEnabled(currentConvId);
    renderHistoryList();
    updateSpacer();
    scrollToBottom();
  }

  function deleteConversation(convId, event){
    if (event) event.stopPropagation();
    if (!confirm("确定要删除这个对话吗？")) return;

    conversations = conversations.filter(c => c.id !== convId);

    if (currentConvId === convId) {
      const nextId = conversations[0]?.id || null;
      if (!nextId) {
        conversations = [];
        createNewConversation();
        return;
      }
      switchConversation(nextId);
    } else {
      renderHistoryList();
    }

    persistConversationsIfEnabled(conversations);
  }

  function renderHistoryList(){
    if (!historyListEl) return;
    historyListEl.innerHTML = "";

    for (const conv of conversations) {
      const item = document.createElement("div");
      item.className = "history-item" + (conv.id === currentConvId ? " active" : "");
      item.innerHTML = `
        <span class="history-title">${conv.title || "新对话"}</span>
        <button class="delete-btn" type="button" aria-label="delete" data-del="${conv.id}">🗑️</button>
      `;

      item.onclick = () => switchConversation(conv.id);
      const delBtn = item.querySelector("button[data-del]");
      if (delBtn) {
        delBtn.addEventListener("click", (e) => deleteConversation(conv.id, e));
      }

      historyListEl.appendChild(item);
    }
  }

  if (newChatBtn) {
    newChatBtn.addEventListener("click", () => createNewConversation());
  }

  // ============ Ensure initial conversation ============
  if (conversations.length === 0) {
    createNewConversation();
  } else {
    const exists = conversations.some(c => c.id === currentConvId);
    if (!exists) currentConvId = conversations[0].id;
    renderHistoryList();
    switchConversation(currentConvId);
  }

  // ============ Model selector (optional: if config injected modelSel/personaToggle etc) ============
  function initModels(){
    if (!modelSel) return;
    modelSel.innerHTML = "";
    for (const m of MODELS) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      modelSel.appendChild(opt);
    }
    const saved = localStorage.getItem(LS_MODEL);
    modelSel.value = saved || MODELS[0].id;
    modelSel.addEventListener("change", () => {
      localStorage.setItem(LS_MODEL, modelSel.value);
    });
  }

  if (personaToggle) {
    personaToggle.addEventListener("click", () => {
      useBuiltin = !useBuiltin;
      personaToggle.textContent = useBuiltin ? "😈" : "😇";
      localStorage.setItem(LS_USE_BUILTIN, useBuiltin ? "1" : "0");
    });
  }

  // Settings UI
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      settingsMask.style.display = "flex";
      if (historyKeepEl) historyKeepEl.checked = historyEnabled;
      if (promptKeepEl) promptKeepEl.checked = promptEnabled;
      if (customPromptEl) customPromptEl.value = (localStorage.getItem(LS_CUSTOM_PROMPT) || "");
    });
  }
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener("click", () => { settingsMask.style.display = "none"; });
  }
  if (settingsMask) {
    settingsMask.addEventListener("click", (e) => { if (e.target === settingsMask) settingsMask.style.display = "none"; });
  }

  if (historyKeepEl) {
    historyKeepEl.addEventListener("change", () => {
      historyEnabled = !!historyKeepEl.checked;
      localStorage.setItem(LS_HISTORY_ENABLED, historyEnabled ? "1" : "0");
      if (historyEnabled) persistConversationsIfEnabled(conversations);
    });
  }

  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", () => {
      if (!confirm("确定清除本地历史？\n只会删除对话记录，不会影响网页自定义人物模板。")) return;
      localStorage.removeItem(LS_CONVERSATIONS);
      localStorage.removeItem(LS_CURRENT_CONV_ID);
      // reset
      conversations = [];
      currentConvId = null;
      clearUIRows();
      createNewConversation();
    });
  }

  if (promptKeepEl) {
    promptKeepEl.addEventListener("change", () => {
      promptEnabled = !!promptKeepEl.checked;
      localStorage.setItem(LS_PROMPT_ENABLED, promptEnabled ? "1" : "0");
      if (!promptEnabled) localStorage.removeItem(LS_CUSTOM_PROMPT);
    });
  }

  if (savePromptBtn) {
    savePromptBtn.addEventListener("click", () => {
      const val = customPromptEl ? (customPromptEl.value || "") : "";
      if (promptEnabled) localStorage.setItem(LS_CUSTOM_PROMPT, val);
      else localStorage.removeItem(LS_CUSTOM_PROMPT);
      if (settingsMask) settingsMask.style.display = "none";
    });
  }

  if (clearPromptBtn) {
    clearPromptBtn.addEventListener("click", () => {
      if (!confirm("确定清除网页自定义人物模板？\n只会删除自定义模板，不会影响本地历史。")) return;
      localStorage.removeItem(LS_CUSTOM_PROMPT);
      if (customPromptEl) customPromptEl.value = "";
    });
  }

  // donate
  function openDonate(){ donateMask.style.display = "flex"; }
  function closeDonate(){ donateMask.style.display = "none"; }
  if (donateBtn) donateBtn.addEventListener("click", openDonate);
  if (donateClose) donateClose.addEventListener("click", closeDonate);
  if (donateMask) donateMask.addEventListener("click", (e) => { if (e.target === donateMask) closeDonate(); });

  // Scroll positioning updates
  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = inputEl.scrollHeight + "px";
    const stick = isNearBottom();
    updateSpacer();
    if (stick) scrollToBottom();
  });

  function setupResizeObserver(){
    if (typeof ResizeObserver === "undefined" || !composerEl) return;
    const ro = new ResizeObserver(() => {
      const stick = isNearBottom();
      updateSpacer();
      if (stick) scrollToBottom();
    });
    ro.observe(composerEl);
  }

  function setupViewportListener(){
    if (!window.visualViewport) return;
    window.visualViewport.addEventListener("resize", () => {
      const stick = isNearBottom();
      updateSpacer();
      if (stick) scrollToBottom();
    });
  }

  window.addEventListener("resize", () => {
    const stick = isNearBottom();
    updateSpacer();
    if (stick) scrollToBottom();
  });

  // Password prompt forever
  function askPasswordForever(){
    while (!chatPassword) {
      const input = prompt("请输入聊天密码:");
      if (input === null) continue;
      chatPassword = input.trim();
      if (!chatPassword) chatPassword = null;
    }
  }

  // Token stats cum
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalOutEstimate = 0;

  async function send(){
    updateSpacer();

    const text = inputEl.value.trim();
    if (!text) return;

    const conv = getCurrentConversation();
    if (!conv) return;

    // update title for first message
    if (conv.title === "新对话") {
      conv.title = text.substring(0, 15) + (text.length > 15 ? "..." : "");
    }

    // UI user row
    const userRow = makeRow("user");
    userRow.bubble.textContent = text;

    // persist message to conversation
    conv.messages.push({ role: "user", content: text });
    if (historyEnabled) persistConversationsIfEnabled(conversations);

    // update stats quick estimate
    const inEst = estimateTokens(text);
    userRow.stats.textContent = `Input(估算): ≈${inEst}`;

    // clear input
    inputEl.value = "";
    inputEl.style.height = "auto";
    updateSpacer();
    scrollToBottom();

    // UI assistant row
    const aiRow = makeRow("assistant");
    aiRow.stats.textContent = "";

    let outStartMs = 0;
    let full = "";
    let exactUsage = null;

    let customPrompt = "";
    if (!useBuiltin) {
      if (promptEnabled) customPrompt = localStorage.getItem(LS_CUSTOM_PROMPT) || "";
    }

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: chatPassword,
        model: modelSel ? modelSel.value : (MODELS[0]?.id || ""),
        use_builtin_persona: useBuiltin,
        custom_system_prompt: customPrompt,
        messages: conv.messages
      })
    });

    if (res.status === 403) {
      alert("密码错误");
      chatPassword = null;
      askPasswordForever();
      return;
    }

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      aiRow.bubble.textContent = `Request failed (${res.status}):\n${t}`;
      aiRow.stats.textContent = "";
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.replace("data: ", "").trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.usage) exactUsage = parsed.usage;

          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            if (!outStartMs) outStartMs = performance.now();
            full += delta;
            aiRow.bubble.textContent = full;
            if (isNearBottom()) scrollToBottom();
          }
        } catch {}
      }
    }

    const outEndMs = performance.now();
    const seconds = Math.max(0.001, (outEndMs - (outStartMs || outEndMs)) / 1000);

    // persist assistant message
    conv.messages.push({ role: "assistant", content: full });
    if (historyEnabled) persistConversationsIfEnabled(conversations);

    if (exactUsage && typeof exactUsage.completion_tokens === "number") {
      const p = exactUsage.prompt_tokens || 0;
      const c = exactUsage.completion_tokens || 0;
      const t = exactUsage.total_tokens || (p + c);

      totalPromptTokens += p;
      totalCompletionTokens += c;

      const tps = c / seconds;

      aiRow.stats.textContent =
        `Prompt: ${p} | Completion: ${c} | Total: ${t} | Speed: ${tps.toFixed(2)} tok/s | CumPrompt: ${totalPromptTokens} | CumCompletion: ${totalCompletionTokens}`;
    } else {
      const outEst = estimateTokens(full);
      totalOutEstimate += outEst;
      const tps = outEst / seconds;

      aiRow.stats.textContent =
        `Output(估算): ≈${outEst} | Total Out(估算): ≈${totalOutEstimate} | Speed(估算): ${tps.toFixed(2)} tok/s | (usage未返回)`;
    }

    updateSpacer();
    scrollToBottom();
  }

  if (sendBtn) sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  function init(){
    askPasswordForever();
    initModels();
    setupResizeObserver();
    setupViewportListener();
    updateSpacer();
    scrollToBottom();
  }

  init();
})();

