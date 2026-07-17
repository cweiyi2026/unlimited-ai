// public/app.js
(() => {
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

  const MODELS = (window.APP_MODELS || [
    { id: "meta/llama-3.1-405b-instruct", label: "meta/llama-3.1" },
    { id: "z-ai/glm5", label: "glm5" },
    { id: "openai/gpt-oss-120b", label: "gpt-oss-120b" },
  ]);

  const session = [];

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalInEstimate = 0;
  let totalOutEstimate = 0;

  // ====== 本地存储 Key（严格分离：历史 vs 自定义模板） ======
  const LS_MODEL = "cfw_model";
  const LS_USE_BUILTIN = "cfw_use_builtin";      // "1"=😈, "0"=😇

  const LS_HISTORY_ENABLED = "cfw_history_enabled";
  const LS_CHAT_SESSION = "cfw_chat_session_v1";

  const LS_PROMPT_ENABLED = "cfw_prompt_enabled";
  const LS_CUSTOM_PROMPT = "cfw_custom_prompt_v1";

  // ✅ 页面密码：每次进页面都弹窗（不落盘）
  let chatPassword = null;

  let useBuiltin = (localStorage.getItem(LS_USE_BUILTIN) ?? "1") === "1";
  personaToggle.textContent = useBuiltin ? "😈" : "😇";

  let historyEnabled = (localStorage.getItem(LS_HISTORY_ENABLED) ?? "0") === "1";
  let promptEnabled  = (localStorage.getItem(LS_PROMPT_ENABLED) ?? "1") === "1";
  historyKeepEl.checked = historyEnabled;
  promptKeepEl.checked = promptEnabled;

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

  function persistSessionIfEnabled(){
    if (!historyEnabled) return;
    try { localStorage.setItem(LS_CHAT_SESSION, JSON.stringify(session)); } catch {}
  }

  function restoreSessionIfEnabled(){
    if (!historyEnabled) return;
    const raw = localStorage.getItem(LS_CHAT_SESSION);
    if (!raw) return;

    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;

      session.length = 0;
      for (const m of arr) {
        if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
        session.push({ role: m.role, content: m.content });
      }

      clearUIRows();
      for (const m of session) {
        const r = makeRow(m.role === "user" ? "user" : "assistant");
        r.bubble.textContent = m.content;
        r.stats.textContent = "";
      }
    } catch {}
  }

  function initModels(){
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

  // 😈/😇
  personaToggle.addEventListener("click", () => {
    useBuiltin = !useBuiltin;
    personaToggle.textContent = useBuiltin ? "😈" : "😇";
    localStorage.setItem(LS_USE_BUILTIN, useBuiltin ? "1" : "0");
  });

  // Settings
  settingsBtn.addEventListener("click", () => {
    settingsMask.style.display = "flex";
    historyKeepEl.checked = historyEnabled;
    promptKeepEl.checked = promptEnabled;
    customPromptEl.value = (localStorage.getItem(LS_CUSTOM_PROMPT) || "");
  });
  closeSettingsBtn.addEventListener("click", () => {
    settingsMask.style.display = "none";
  });
  settingsMask.addEventListener("click", (e) => {
    if (e.target === settingsMask) settingsMask.style.display = "none";
  });

  // history
  historyKeepEl.addEventListener("change", () => {
    historyEnabled = !!historyKeepEl.checked;
    localStorage.setItem(LS_HISTORY_ENABLED, historyEnabled ? "1" : "0");
    if (historyEnabled) persistSessionIfEnabled();
  });
  clearHistoryBtn.addEventListener("click", () => {
    const ok = confirm("确定清除本地历史？\n只会删除对话记录，不会影响网页自定义人物模板。");
    if (!ok) return;
    localStorage.removeItem(LS_CHAT_SESSION);
    session.length = 0;
    clearUIRows();
    updateSpacer();
    scrollToBottom();
  });

  // custom prompt
  promptKeepEl.addEventListener("change", () => {
    promptEnabled = !!promptKeepEl.checked;
    localStorage.setItem(LS_PROMPT_ENABLED, promptEnabled ? "1" : "0");
    if (!promptEnabled) localStorage.removeItem(LS_CUSTOM_PROMPT);
  });
  savePromptBtn.addEventListener("click", () => {
    const val = customPromptEl.value || "";
    if (promptEnabled) localStorage.setItem(LS_CUSTOM_PROMPT, val);
    else localStorage.removeItem(LS_CUSTOM_PROMPT);
    settingsMask.style.display = "none";
  });
  clearPromptBtn.addEventListener("click", () => {
    const ok = confirm("确定清除网页自定义人物模板？\n只会删除自定义模板，不会影响本地历史。");
    if (!ok) return;
    localStorage.removeItem(LS_CUSTOM_PROMPT);
    customPromptEl.value = "";
  });

  // donate
  function openDonate(){ donateMask.style.display = "flex"; }
  function closeDonate(){ donateMask.style.display = "none"; }
  donateBtn.addEventListener("click", openDonate);
  donateClose.addEventListener("click", closeDonate);
  donateMask.addEventListener("click", (e) => { if (e.target === donateMask) closeDonate(); });

  // composer
  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = inputEl.scrollHeight + "px";
    const stick = isNearBottom();
    updateSpacer();
    if (stick) scrollToBottom();
  });

  function setupResizeObserver(){
    if (!composerEl || typeof ResizeObserver === "undefined") return;
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

  // ✅ 进页面弹窗要密码（你要的“最完美版本”行为）
  function askPasswordForever(){
    while (!chatPassword) {
      const input = prompt("请输入聊天密码:");
      if (input === null) continue;
      chatPassword = input.trim();
      if (!chatPassword) chatPassword = null;
    }
  }

  async function send(){
    updateSpacer();
    const text = inputEl.value.trim();
    if (!text) return;

    const userRow = makeRow("user");
    userRow.bubble.textContent = text;

    const inEst = estimateTokens(text);
    totalInEstimate += inEst;
    userRow.stats.textContent = `Input(估算): ≈${inEst} | Total In(估算): ≈${totalInEstimate}`;

    session.push({ role: "user", content: text });
    persistSessionIfEnabled();

    inputEl.value = "";
    inputEl.style.height = "auto";
    updateSpacer();
    scrollToBottom();

    const aiRow = makeRow("assistant");
    let outStartMs = 0;
    let outEndMs = 0;
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
        model: modelSel.value,
        use_builtin_persona: useBuiltin,
        custom_system_prompt: customPrompt,
        messages: session
      })
    });

    if (res.status === 403) {
      alert("密码错误");
      // 重新输入密码（按你最完美版本的习惯）
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

    outEndMs = performance.now();
    session.push({ role: "assistant", content: full });
    persistSessionIfEnabled();

    const seconds = Math.max(0.001, (outEndMs - (outStartMs || outEndMs)) / 1000);

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

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  function init(){
    // 进页面先要密码
    askPasswordForever();

    initModels();
    setupResizeObserver();
    setupViewportListener();
    updateSpacer();
    restoreSessionIfEnabled();
    scrollToBottom();
  }

  init();
})();
// 1. 定义数据结构与初始化
let conversations = JSON.parse(localStorage.getItem('chat_conversations')) || [];
let currentConvId = null;

// 页面加载时初始化
function init() {
    // 如果没有历史对话，默认创建一个
    if (conversations.length === 0) {
        createNewConversation();
    } else {
        // 如果有历史，默认选中第一个
        switchConversation(conversations[0].id);
    }
    renderHistoryList();
}

// 2. 新建对话功能
function createNewConversation() {
    const newConv = {
        id: Date.now().toString(), // 用时间戳作为唯一ID
        title: '新对话',
        messages: [] // 存放具体的聊天内容
    };
    conversations.unshift(newConv); // 新对话插入到数组最前面
    currentConvId = newConv.id;
    saveAndRender();
}

// 3. 切换对话功能
function switchConversation(convId) {
    currentConvId = convId;
    const currentConv = conversations.find(c => c.id === convId);
    
    // 清空当前聊天界面，并重新渲染该对话的历史消息
    const chatBox = document.getElementById('chat');
    chatBox.innerHTML = '<div id="bottom-spacer"></div>';
    
    if (currentConv) {
        currentConv.messages.forEach(msg => {
            appendMessage(msg.role, msg.content); // 假设你已有 appendMessage 方法
        });
    }
    renderHistoryList(); // 刷新侧边栏高亮状态
}

// 4. 发送消息时，同步保存到当前会话
function sendMessage() {
    const input = document.getElementById('msg');
    const text = input.value.trim();
    if (!text || !currentConvId) return;

    const currentConv = conversations.find(c => c.id === currentConvId);
    
    // 保存用户消息
    currentConv.messages.push({ role: 'user', content: text });
    
    // 如果是该对话的第一条消息，自动用这条消息作为标题
    if (currentConv.title === '新对话') {
        currentConv.title = text.substring(0, 15) + (text.length > 15 ? '...' : '');
    }

    // ... 这里是你原本调用 AI 接口获取回复的代码 ...
    // 获取到 AI 回复后，记得也 push 进 currentConv.messages 里
    
    saveAndRender();
    input.value = '';
}

// 5. 删除对话功能
function deleteConversation(convId, event) {
    event.stopPropagation(); // 阻止冒泡，防止触发切换对话
    if (!confirm('确定要删除这个对话吗？')) return;
    
    conversations = conversations.filter(c => c.id !== convId);
    if (currentConvId === convId) {
        // 如果删掉的是当前对话，自动切换到第一个，或者新建一个
        currentConvId = conversations[0]?.id || null;
        if (!currentConvId) createNewConversation();
        else switchConversation(currentConvId);
    }
    saveAndRender();
}

// 6. 统一保存与渲染
function saveAndRender() {
    localStorage.setItem('chat_conversations', JSON.stringify(conversations));
    renderHistoryList();
}

// 7. 渲染侧边栏列表
function renderHistoryList() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    conversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'history-item' + (conv.id === currentConvId ? ' active' : '');
        item.innerHTML = `
            <span class="history-title">${conv.title}</span>
            <button class="delete-btn" onclick="deleteConversation('${conv.id}', event)">🗑️</button>
        `;
        item.onclick = () => switchConversation(conv.id);
        list.appendChild(item);
    });
}

// 别忘了在页面加载时调用 init()
window.addEventListener('load', init);