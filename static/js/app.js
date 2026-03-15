const socket = io();

const THEMES = {
  'midnight-cyan': { label: 'Midnight Cyan', color: '#06131f' },
  'ocean-blue': { label: 'Ocean Blue', color: '#0b5cff' },
  'royal-violet': { label: 'Royal Violet', color: '#6f37ff' },
  'emerald-luxe': { label: 'Emerald Luxe', color: '#0b8d72' },
  'aurora-glass': { label: 'Aurora Glass', color: '#ee5d92' },
};

const state = {
  myID: localStorage.getItem('fID') || '',
  myName: localStorage.getItem('fName') || '',
  myPFP: localStorage.getItem('fPFP') || '',
  myBio: localStorage.getItem('fBio') || '',
  myTheme: localStorage.getItem('fTheme') || 'midnight-cyan',
  currentTargetID: '',
  currentTargetName: '',
  currentTargetPFP: '',
  currentTargetBio: '',
  currentTargetKind: 'private',
  currentRole: 'member',
  isCurrentChatGroup: false,
  isSignUp: false,
  mobileTab: 'chats',
  listFilter: 'all',
  roomKindChoice: 'group',
  recentChats: [],
  replyTo: null,
  activeRoom: '',
  lastTypingSent: 0,
  typingTimer: null,
  selectedMessageId: null,
  messageCache: {},
  archivedChats: new Set(JSON.parse(localStorage.getItem('fArchivedChats') || '[]')),
  mutedChats: new Set(JSON.parse(localStorage.getItem('fMutedChats') || '[]')),
  drafts: JSON.parse(localStorage.getItem('fDrafts') || '{}'),
  chatSearch: '',
  forwardSourceId: null,
};

const byId = (id) => document.getElementById(id);
const escapeHtml = (str = '') => String(str)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function normalizeHandle(value = '') {
  return value.trim().replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
}

function getInitial(name = '?') {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function setAvatar(el, name, pfp) {
  if (!el) return;
  el.style.backgroundImage = pfp ? `url(${pfp})` : '';
  el.textContent = pfp ? '' : getInitial(name);
}

function showToast(message) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 2200);
}

function applyTheme(themeKey, persist = true) {
  const safe = THEMES[themeKey] ? themeKey : 'midnight-cyan';
  state.myTheme = safe;
  document.body.dataset.theme = safe;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES[safe].color);
  if (persist) localStorage.setItem('fTheme', safe);
  renderThemeCards();
}

function renderThemeCards() {
  const html = Object.entries(THEMES).map(([key, info]) => `
    <button class="theme-card ${state.myTheme === key ? 'active' : ''}" onclick="chooseTheme('${key}')">
      <span class="theme-swatch theme-${key}"></span>
      <strong>${info.label}</strong>
    </button>
  `).join('');
  const grid = byId('theme-grid');
  const settings = byId('settings-theme-grid');
  if (grid) grid.innerHTML = html;
  if (settings) settings.innerHTML = html;
}

async function chooseTheme(themeKey) {
  applyTheme(themeKey);
  if (!state.myID) return;
  await fetch('/update_profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tele_id: state.myID, username: state.myName, bio: state.myBio, theme: themeKey })
  });
}

function toggleAuth(forceSignUp = null) {
  state.isSignUp = forceSignUp === null ? !state.isSignUp : Boolean(forceSignUp);
  byId('display-name-wrap').classList.toggle('hidden', !state.isSignUp);
  byId('abtn').textContent = state.isSignUp ? 'Create account' : 'Log In';
  byId('auth-title').textContent = state.isSignUp ? 'Create your account' : 'Welcome back';
  byId('auth-subtitle').textContent = state.isSignUp ? 'Choose a display name, @username, and password.' : 'Log in with your @username and password.';
  byId('auth-switch-text').textContent = state.isSignUp ? 'Already have an account?' : 'Don’t have an account?';
  byId('auth-switch-link').textContent = state.isSignUp ? 'Log in' : 'Sign up';
}

function switchToSignUp() { toggleAuth(true); }

async function handleAuth() {
  const tele_id = normalizeHandle(byId('aid').value);
  const password = byId('apass').value.trim();
  const username = byId('aname').value.trim();
  const endpoint = state.isSignUp ? '/signup' : '/login';
  const payload = state.isSignUp ? { username, tele_id, password } : { tele_id, password };
  const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not continue');
  state.myID = data.tele_id;
  state.myName = data.username;
  state.myPFP = data.pfp || '';
  state.myBio = data.bio || '';
  applyTheme(data.theme || state.myTheme, false);
  localStorage.setItem('fID', state.myID);
  localStorage.setItem('fName', state.myName);
  localStorage.setItem('fPFP', state.myPFP);
  localStorage.setItem('fBio', state.myBio);
  localStorage.setItem('fTheme', state.myTheme);
  startSession();
}

function hydrateProfile() {
  setAvatar(byId('settings-pfp-icon'), state.myName, state.myPFP);
  setAvatar(byId('settings-mini-avatar'), state.myName, state.myPFP);
  byId('settings-fullname').textContent = state.myName;
  byId('settings-id').textContent = `@${state.myID}`;
  byId('settings-bio').textContent = state.myBio || 'No bio yet';
  byId('settings-fullname-2').textContent = state.myName;
  byId('settings-id-2').textContent = `@${state.myID}`;
  byId('edit-display-name').value = state.myName;
  byId('edit-bio').value = state.myBio;
}

function saveSet(key, setObj) { localStorage.setItem(key, JSON.stringify([...setObj])); }
function roomKey(id = state.currentTargetID, isGroup = state.isCurrentChatGroup) { return `${isGroup ? 'group' : 'dm'}:${id}`; }
function maybeShowMobileTabs() {
  byId('mobile-tabbar').classList.toggle('hidden', !state.myID);
}

function isMobileLayout() { return window.innerWidth <= 980; }

function setMobileTab(tab) {
  state.mobileTab = tab;
  byId('main-app').dataset.mobileTab = tab;
  document.querySelectorAll('.mobile-tab-btn').forEach((btn) => btn.classList.remove('active'));
  byId(`tab-btn-${tab}`)?.classList.add('active');
}

function setListFilter(filter, el) {
  state.listFilter = filter;
  document.querySelectorAll('.chip[data-filter]').forEach((chip) => chip.classList.remove('active'));
  el?.classList.add('active');
  renderRecentChats();
}

function setRoomKind(kind, el) {
  state.roomKindChoice = kind;
  document.querySelectorAll('.modal-filter-row .chip').forEach((chip) => chip.classList.remove('active'));
  el?.classList.add('active');
}

function openModal(id) { byId(id).classList.remove('hidden'); }
function closeModal(id) { byId(id).classList.add('hidden'); }

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDayTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatRelativeStatus(raw) {
  if (!raw) return 'offline';
  if (raw === 'online') return 'online';
  if (raw.startsWith('last seen ')) {
    const iso = raw.slice(10);
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return `last seen ${formatDayTime(iso)}`;
  }
  return raw;
}

function openProfileSheet() {
  setAvatar(byId('sheet-avatar'), state.currentTargetName, state.currentTargetPFP);
  byId('sheet-name').textContent = state.currentTargetName || 'User';
  byId('sheet-handle').textContent = state.isCurrentChatGroup ? state.currentTargetID : `@${state.currentTargetID}`;
  byId('sheet-kind').textContent = state.currentTargetKind;
  byId('sheet-bio').textContent = state.currentTargetBio || 'No description yet';
  byId('chat-profile-sheet').classList.remove('hidden');
}

function closeProfileSheet() { byId('chat-profile-sheet').classList.add('hidden'); }
function copyChatIdentity() { navigator.clipboard?.writeText(state.currentTargetID || ''); showToast('Copied'); }

async function startSession() {
  byId('auth-screen').classList.add('hidden');
  byId('main-app').classList.remove('hidden');
  maybeShowMobileTabs();
  hydrateProfile();
  renderThemeCards();
  applyTheme(state.myTheme, false);
  socket.emit('connect_radar', { my_id: state.myID });
  await loadRecentChats();
}

function logout() {
  localStorage.clear();
  location.reload();
}

async function loadRecentChats() {
  const res = await fetch(`/recent_chats/${encodeURIComponent(state.myID)}`);
  state.recentChats = await res.json();
  renderRecentChats();
}

function renderRecentChats() {
  const list = byId('chat-list');
  const filtered = state.recentChats.filter((item) => {
    const key = `${item.is_group ? 'group' : 'dm'}:${item.id}`;
    const archived = state.archivedChats.has(key);
    if (state.listFilter === 'archived') return archived;
    if (archived) return false;
    if (state.listFilter === 'all') return true;
    return (item.kind || (item.is_group ? 'group' : 'private')) === state.listFilter;
  });
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-mini">No chats yet</div>';
    return;
  }
  list.innerHTML = filtered.map((item) => {
    const kind = item.kind || (item.is_group ? 'group' : 'private');
    const badge = kind === 'channel' ? 'channel' : item.is_group ? 'group' : 'person';
    const statusText = item.is_group ? `${kind}${item.role ? ` · ${item.role}` : ''}` : formatRelativeStatus(item.last_seen_label || (item.online ? 'online' : 'offline'));
    const key = `${item.is_group ? 'group' : 'dm'}:${item.id}`;
    const muted = state.mutedChats.has(key);
    return `
      <div class="chat-row ${state.currentTargetID === item.id && String(state.isCurrentChatGroup) === String(item.is_group) ? 'active' : ''}" data-chat-id="${item.id}" data-group="${item.is_group}" onclick="openChat(${JSON.stringify(item.name)}, ${JSON.stringify(item.id)}, ${JSON.stringify(item.pfp || '')}, ${item.is_group}, ${JSON.stringify(item)})">
        <div class="avatar-row-wrap">
          <div class="avatar ${!item.pfp ? 'auto' : ''}" style="background-image:${item.pfp ? `url(${item.pfp})` : 'none'}">${item.pfp ? '' : escapeHtml(getInitial(item.name))}</div>
          ${!item.is_group && item.online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="chat-meta">
          <div class="row-between"><strong>${escapeHtml(item.name)}</strong><small>${formatTime(item.time)}</small></div>
          <p>${escapeHtml(item.last_msg || statusText)}</p>
          <small class="muted">${escapeHtml(statusText)}${muted ? ' · muted' : ''}</small>
        </div>
        <span class="tag">${badge}${muted ? ' · mute' : ''}</span>
      </div>
    `;
  }).join('');
}

async function doSearch() {
  const q = byId('search-input').value.trim();
  const suggestions = byId('suggestions');
  if (!q) {
    suggestions.innerHTML = '';
    suggestions.classList.remove('show');
    return;
  }
  const res = await fetch(`/search_suggestions?q=${encodeURIComponent(q)}&my_id=${encodeURIComponent(state.myID)}`);
  const rows = await res.json();
  suggestions.classList.add('show');
  suggestions.innerHTML = rows.length ? rows.map((item) => {
    const label = item.type === 'user' ? formatRelativeStatus(item.last_seen_label || (item.online ? 'online' : 'offline')) : (item.type === 'channel' ? 'Read-only by default' : 'Group room');
    const isGroup = item.type !== 'user';
    return `
      <div class="suggestion-row" onclick="chooseSuggestion(${JSON.stringify(item)})">
        <div class="avatar-row-wrap">
          <div class="avatar" style="background-image:${item.pfp ? `url(${item.pfp})` : 'none'}">${item.pfp ? '' : escapeHtml(getInitial(item.name))}</div>
          ${item.type === 'user' && item.online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="chat-meta">
          <strong>${escapeHtml(item.name)}</strong>
          <p>${escapeHtml(isGroup ? item.description || item.id : '@' + item.id)}</p>
          <small class="muted">${escapeHtml(label)}</small>
        </div>
        <span class="tag">${escapeHtml(item.type)}</span>
      </div>`;
  }).join('') : '<div class="empty-mini">No results</div>';
}

async function chooseSuggestion(item) {
  byId('search-input').value = '';
  byId('suggestions').classList.remove('show');
  if (item.type === 'user') {
    openChat(item.name, item.id, item.pfp || '', false, item);
  } else {
    const res = await fetch('/join_room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: item.id, tele_id: state.myID }) });
    const data = await res.json();
    if (data.status !== 'success') return showToast(data.message || 'Could not join');
    showToast(`Joined ${item.type}`);
    await loadRecentChats();
    openChat(data.room.name, data.room.code, data.room.pfp || '', true, data.room);
  }
}

async function createRoom() {
  const payload = {
    name: byId('room-name').value.trim(),
    code: byId('room-code').value.trim(),
    description: byId('room-description').value.trim(),
    creator_id: state.myID,
    kind: state.roomKindChoice,
  };
  const res = await fetch('/create_room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not create room');
  closeModal('room-modal');
  ['room-name','room-code','room-description'].forEach((id) => byId(id).value = '');
  await loadRecentChats();
  openChat(data.room.name, data.room.code, data.room.pfp || '', true, { ...data.room, role: 'owner' });
  showToast(`${data.room.kind} created`);
}

async function joinRoom() {
  const res = await fetch('/join_room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: byId('room-code').value.trim(), tele_id: state.myID }) });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not join');
  closeModal('room-modal');
  await loadRecentChats();
  openChat(data.room.name, data.room.code, data.room.pfp || '', true, data.room);
}

function buildRoom(id, isGroup) {
  return isGroup ? `group_${id}` : [state.myID, id].sort().join('_');
}

function renderChatPanel(name, pfp, isGroup) {
  const panel = byId('chat-panel');
  panel.className = 'chat-panel glass-card';
  panel.innerHTML = `
    <div class="chat-shell">
      <div class="chat-header">
        <div class="chat-header-left clickable" onclick="openProfileSheet()">
          <button class="back-btn mobile-only" onclick="event.stopPropagation(); closeCurrentChat()">←</button>
          <div id="chat-header-avatar" class="avatar"></div>
          <div class="chat-header-meta">
            <strong id="chat-header-name"></strong>
            <p id="chat-status-text">Loading…</p>
          </div>
        </div>
        <div class="header-actions">
          <button class="icon-btn" onclick="document.getElementById('media-upload').click()">📎</button>
          <button class="icon-btn" onclick="openModal('theme-modal')">🎨</button>
        </div>
      </div>
      <div id="pin-banner" class="pin-banner hidden"></div>
      <div id="reply-preview" class="reply-preview hidden"></div>
      <div class="chat-tools-bar">
        <input id="chat-search-input" class="chat-search-input" placeholder="Search in this chat" oninput="filterMessagesInView()">
        <button class="icon-btn" onclick="toggleArchiveCurrentChat()">🗃️</button>
        <button class="icon-btn" onclick="toggleMuteCurrentChat()">🔕</button>
      </div>
      <div id="messages-view" class="messages-view"></div>
      <div class="chat-input-area">
        <button class="attach-btn" onclick="document.getElementById('media-upload').click()">＋</button>
        <input type="file" id="media-upload" class="hidden" onchange="uploadMedia(event)">
        <input type="text" id="msg-input" placeholder="Type a message" oninput="handleTypingInput()" onkeypress="if(event.key==='Enter') sendMsg()">
        <button class="send-btn" onclick="sendMsg()">➤</button>
      </div>
    </div>`;
  byId('chat-header-name').textContent = name;
  setAvatar(byId('chat-header-avatar'), name, pfp);
}

function renderReplyPreview() {
  const box = byId('reply-preview');
  if (!box) return;
  if (!state.replyTo) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = `
    <div><strong>Replying to ${escapeHtml(state.replyTo.sender_name)}</strong><p>${escapeHtml(state.replyTo.content || `[${state.replyTo.msg_type}]`)}</p></div>
    <button class="icon-btn" onclick="clearReply()">✕</button>`;
}

function clearReply() { state.replyTo = null; renderReplyPreview(); }

function deliveryLabel(data) {
  if (!data || data.sender_id !== state.myID) return '';
  const seenOthers = (data.seen_by || []).filter((u) => u !== state.myID).length;
  const deliveredOthers = (data.delivered_to || []).filter((u) => u !== state.myID).length;
  if (seenOthers) return '✓✓';
  if (deliveredOthers) return '✓';
  return '•';
}

function updateChatHeaderStatus(text) { if (byId('chat-status-text')) byId('chat-status-text').textContent = text; }

async function openChat(name, id, pfp, isGroup, meta = {}) {
  if (state.activeRoom) socket.emit('leave_chat', { room: state.activeRoom });
  state.currentTargetID = id;
  state.currentTargetName = name;
  state.currentTargetPFP = pfp || '';
  state.currentTargetBio = meta.bio || meta.description || '';
  state.currentTargetKind = meta.kind || (isGroup ? 'group' : 'private');
  state.currentRole = meta.role || 'member';
  state.isCurrentChatGroup = isGroup;
  state.replyTo = null;
  renderChatPanel(name, pfp, isGroup);
  renderReplyPreview();
  const room = buildRoom(id, isGroup);
  state.activeRoom = room;
  socket.emit('join_chat', { room, user_id: state.myID });
  const res = await fetch(`/history/${encodeURIComponent(room)}`);
  const msgs = await res.json();
  state.messageCache = {};
  const view = byId('messages-view');
  view.innerHTML = msgs.map(messageHtml).join('');
  const draft = state.drafts[roomKey(id, isGroup)] || '';
  setTimeout(() => { const input = byId('msg-input'); if (input) input.value = draft; }, 0);
  bindMessageActions();
  view.scrollTop = view.scrollHeight;
  if (isGroup) {
    const metaRes = await fetch(`/room_meta/${encodeURIComponent(id)}`);
    const metaData = await metaRes.json();
    if (metaData.status === 'success') {
      state.currentTargetBio = metaData.room.description || '';
      state.currentTargetKind = metaData.room.kind;
      showPinBanner(metaData.room.pin_message);
      updateChatHeaderStatus(`${metaData.room.kind} · ${metaData.room.member_count} members`);
    }
  } else {
    const pRes = await fetch(`/profile/${encodeURIComponent(id)}`);
    const pdata = await pRes.json();
    if (pdata.status === 'success') {
      state.currentTargetBio = pdata.bio || '';
      updateChatHeaderStatus(formatRelativeStatus(pdata.last_seen_label || (pdata.online ? 'online' : 'offline')));
    }
  }
  renderRecentChats();
  if (isMobileLayout()) setMobileTab('chat');
}

function showPinBanner(pinMessage) {
  const banner = byId('pin-banner');
  if (!banner) return;
  if (!pinMessage) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }
  banner.classList.remove('hidden');
  banner.innerHTML = `<span>📌 ${escapeHtml(pinMessage.sender_name)}: ${escapeHtml(pinMessage.content || `[${pinMessage.msg_type}]`)}</span>`;
}

function messageBodyHtml(data) {
  if (data.is_deleted) return '<div class="bubble deleted">Message deleted</div>';
  const bubbleClass = data.sender_id === state.myID ? 'sent' : 'received';
  const safeText = data.content ? `<div>${escapeHtml(data.content).replaceAll('\n', '<br>')}</div>` : '';
  const forwarded = data.forwarded_from ? `<div class="forward-label">Forwarded from ${escapeHtml(data.forwarded_from)}</div>` : '';
  const reply = data.reply_preview ? `<div class="reply-card"><strong>${escapeHtml(data.reply_preview.sender_name)}</strong><p>${escapeHtml(data.reply_preview.content || '[' + data.reply_preview.msg_type + ']')}</p></div>` : '';
  if (data.msg_type === 'image') return `<div class="bubble ${bubbleClass} image-wrap">${forwarded}${reply}<img class="message-media" src="${data.file_url}" alt="image">${safeText}</div>`;
  if (data.msg_type === 'video') return `<div class="bubble ${bubbleClass} video-wrap">${forwarded}${reply}<video class="message-media" src="${data.file_url}" controls playsinline></video>${safeText}</div>`;
  if (data.msg_type === 'audio') return `<div class="bubble ${bubbleClass} audio-wrap">${forwarded}${reply}<audio src="${data.file_url}" controls></audio>${safeText}</div>`;
  if (data.msg_type === 'file') return `<div class="bubble ${bubbleClass}">${forwarded}${reply}<a class="file-card" href="${data.file_url}" target="_blank"><span>📁</span><span>${escapeHtml(data.content || 'Open file')}</span></a></div>`;
  return `<div class="bubble ${bubbleClass}">${forwarded}${reply}${safeText}</div>`;
}

function messageHtml(data) {
  state.messageCache[data.id] = data;
  const sent = data.sender_id === state.myID;
  return `
    <div class="msg-wrapper ${sent ? 'sent' : 'received'}" data-msg-id="${data.id}">
      ${sent ? '' : `<div class="avatar mini" style="background-image:${data.sender_pfp ? `url(${data.sender_pfp})` : 'none'}">${data.sender_pfp ? '' : escapeHtml(getInitial(data.sender_name))}</div>`}
      <div class="msg-stack">
        ${!sent && state.isCurrentChatGroup ? `<div class="msg-sender">${escapeHtml(data.sender_name)}</div>` : ''}
        ${messageBodyHtml(data)}
        <div class="bubble-time">${formatTime(data.timestamp)} ${data.edited_at ? '· edited' : ''} ${deliveryLabel(data)}</div>
        <div class="message-actions">
          <button onclick="prepareReplyById(${data.id})">Reply</button>
          <button onclick="openReactionPicker(${data.id}, this)">React</button>
          <button onclick="openForwardModal(${data.id})">Forward</button>
          ${sent && !data.is_deleted ? `<button onclick="editMyMessage(${data.id})">Edit</button><button onclick="deleteMyMessage(${data.id})">Delete</button>` : ''}
          ${state.isCurrentChatGroup && ['owner','admin'].includes(state.currentRole) ? `<button onclick="pinMessage(${data.id})">Pin</button>` : ''}
        </div>
        <div class="reaction-row">${(data.reactions || []).map((r) => `<button class="reaction-pill" onclick="toggleReaction(${data.id}, '${r.emoji}')">${r.emoji} <span>${r.count}</span></button>`).join('')}</div>
      </div>
    </div>`;
}

function bindMessageActions() {}

function renderBubble(data) {
  const view = byId('messages-view');
  if (!view) return;
  view.insertAdjacentHTML('beforeend', messageHtml(data));
  view.scrollTop = view.scrollHeight;
}

function prepareReply(data) {
  state.replyTo = data;
  renderReplyPreview();
  byId('msg-input')?.focus();
}

function prepareReplyById(id) {
  const data = state.messageCache[id];
  if (data) prepareReply(data);
}

async function sendMsg() {
  const input = byId('msg-input');
  const val = input.value.trim();
  if (!state.currentTargetID || !val) return;
  socket.emit('private_message', {
    room: buildRoom(state.currentTargetID, state.isCurrentChatGroup),
    sender_id: state.myID,
    sender_name: state.myName,
    target_id: state.currentTargetID,
    is_group: state.isCurrentChatGroup,
    msg_type: 'text',
    content: val,
    reply_to_id: state.replyTo?.id || null,
  });
  input.value = '';
  delete state.drafts[roomKey()];
  localStorage.setItem('fDrafts', JSON.stringify(state.drafts));
  clearReply();
  socket.emit('typing', { room: state.activeRoom, user_id: state.myID, is_typing: false });
}

async function uploadMedia(event) {
  const file = event.target.files?.[0];
  if (!file || !state.currentTargetID) return;
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/upload', { method: 'POST', body: fd });
  const data = await res.json();
  event.target.value = '';
  if (data.status !== 'success') return showToast(data.message || 'Upload failed');
  socket.emit('private_message', {
    room: buildRoom(state.currentTargetID, state.isCurrentChatGroup),
    sender_id: state.myID,
    sender_name: state.myName,
    target_id: state.currentTargetID,
    is_group: state.isCurrentChatGroup,
    msg_type: data.type,
    content: file.name,
    file_url: data.url,
    reply_to_id: state.replyTo?.id || null,
  });
  clearReply();
}

async function uploadPFP(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', 'pfp');
  fd.append('tele_id', state.myID);
  const res = await fetch('/upload', { method: 'POST', body: fd });
  const data = await res.json();
  event.target.value = '';
  if (data.status !== 'success') return showToast(data.message || 'Profile photo upload failed');
  state.myPFP = data.url;
  localStorage.setItem('fPFP', state.myPFP);
  hydrateProfile();
  await loadRecentChats();
  showToast('Profile photo updated');
}

async function saveProfile() {
  const username = byId('edit-display-name').value.trim();
  const bio = byId('edit-bio').value.trim();
  const res = await fetch('/update_profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tele_id: state.myID, username, bio, theme: state.myTheme })
  });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not update profile');
  state.myName = data.username; state.myBio = data.bio || '';
  localStorage.setItem('fName', state.myName); localStorage.setItem('fBio', state.myBio);
  hydrateProfile(); closeModal('profile-modal'); await loadRecentChats(); showToast('Profile updated');
}

function persistDraft() { const input = byId('msg-input'); if (!input || !state.currentTargetID) return; state.drafts[roomKey()] = input.value; localStorage.setItem('fDrafts', JSON.stringify(state.drafts)); }

function handleTypingInput() {
  persistDraft();
  const now = Date.now();
  if (now - state.lastTypingSent > 900) {
    socket.emit('typing', { room: state.activeRoom, user_id: state.myID, is_typing: true });
    state.lastTypingSent = now;
  }
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => socket.emit('typing', { room: state.activeRoom, user_id: state.myID, is_typing: false }), 1400);
}

function closeCurrentChat() {
  document.body.classList.remove('chat-open');
  setMobileTab('chats');
}

async function deleteMyMessage(id) { socket.emit('delete_message', { msg_id: id, sender_id: state.myID }); }

async function editMyMessage(id) {
  const msgEl = document.querySelector(`[data-msg-id="${id}"] .bubble:not(.deleted)`);
  const current = msgEl?.innerText || '';
  const next = prompt('Edit message', current);
  if (!next || next.trim() === current.trim()) return;
  socket.emit('edit_message', { msg_id: id, sender_id: state.myID, content: next.trim() });
}


function filterMessagesInView() {
  state.chatSearch = byId('chat-search-input')?.value.trim().toLowerCase() || '';
  document.querySelectorAll('.msg-wrapper').forEach((wrap) => {
    const text = wrap.innerText.toLowerCase();
    wrap.classList.toggle('search-hidden', Boolean(state.chatSearch) && !text.includes(state.chatSearch));
  });
}

function toggleArchiveCurrentChat() {
  if (!state.currentTargetID) return;
  const key = roomKey();
  if (state.archivedChats.has(key)) {
    state.archivedChats.delete(key);
    showToast('Chat restored');
  } else {
    state.archivedChats.add(key);
    showToast('Chat archived');
  }
  saveSet('fArchivedChats', state.archivedChats);
  renderRecentChats();
  closeProfileSheet();
}

function toggleMuteCurrentChat() {
  if (!state.currentTargetID) return;
  const key = roomKey();
  if (state.mutedChats.has(key)) {
    state.mutedChats.delete(key);
    showToast('Notifications unmuted');
  } else {
    state.mutedChats.add(key);
    showToast('Chat muted');
  }
  saveSet('fMutedChats', state.mutedChats);
  renderRecentChats();
  closeProfileSheet();
}

function copyInviteLink() {
  const value = state.isCurrentChatGroup ? `${location.origin}/#join=${state.currentTargetID}` : `@${state.currentTargetID}`;
  navigator.clipboard?.writeText(value);
  showToast('Invite copied');
}

function openForwardModal(id) {
  state.forwardSourceId = id;
  const source = state.messageCache[id];
  const list = byId('forward-list');
  const candidates = state.recentChats.filter((chat) => !(chat.id === state.currentTargetID && String(chat.is_group) === String(state.isCurrentChatGroup)));
  list.innerHTML = `<div class="empty-mini">Forwarding: ${escapeHtml(source?.content || '[' + (source?.msg_type || 'message') + ']')}</div>` + candidates.map((item) => `
    <button class="forward-row" onclick="forwardMessageTo(${id}, ${JSON.stringify(item.id)}, ${item.is_group})">
      <div class="avatar" style="background-image:${item.pfp ? `url(${item.pfp})` : 'none'}">${item.pfp ? '' : escapeHtml(getInitial(item.name))}</div>
      <div class="chat-meta"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.kind || (item.is_group ? 'group' : 'private'))}</p></div>
    </button>
  `).join('');
  openModal('forward-modal');
}

async function forwardMessageTo(sourceId, targetId, isGroup) {
  const source = state.messageCache[sourceId];
  if (!source) return;
  socket.emit('private_message', {
    room: isGroup ? `group_${targetId}` : [state.myID, targetId].sort().join('_'),
    sender_id: state.myID,
    sender_name: state.myName,
    target_id: targetId,
    is_group: isGroup,
    msg_type: source.msg_type,
    content: source.content,
    file_url: source.file_url,
    forwarded_from: `${source.sender_name}`,
  });
  closeModal('forward-modal');
  showToast('Message forwarded');
}

function openReactionPicker(id, anchor) {
  state.selectedMessageId = id;
  const picker = byId('reaction-picker');
  picker.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  picker.style.left = `${Math.max(12, r.left)}px`;
  picker.style.top = `${r.top - 48 + window.scrollY}px`;
}
function reactToCurrent(emoji) { toggleReaction(state.selectedMessageId, emoji); byId('reaction-picker').classList.add('hidden'); }
function toggleReaction(id, emoji) { socket.emit('toggle_reaction', { msg_id: id, user_id: state.myID, emoji }); }
function pinMessage(id) { socket.emit('pin_message', { msg_id: id, actor_id: state.myID, target_id: state.currentTargetID }); }

socket.on('new_message', (data) => {
  if (data.room === state.activeRoom) renderBubble(data);
  loadRecentChats();
});
socket.on('ping_radar', () => loadRecentChats());
socket.on('flash_error', (data) => showToast(data.message || 'Something went wrong'));
socket.on('message_deleted', (data) => {
  const wrap = document.querySelector(`[data-msg-id="${data.msg_id}"]`);
  if (!wrap) return;
  const bubble = wrap.querySelector('.bubble');
  bubble.className = `bubble ${wrap.classList.contains('sent') ? 'sent' : 'received'} deleted`;
  bubble.textContent = 'Message deleted';
  delete state.messageCache[data.msg_id];
});
socket.on('message_edited', (data) => {
  const wrap = document.querySelector(`[data-msg-id="${data.id}"]`);
  if (!wrap) return;
  wrap.outerHTML = messageHtml(data);
});
socket.on('reactions_updated', (payload) => {
  const wrap = document.querySelector(`[data-msg-id="${payload.msg_id}"] .reaction-row`);
  if (!wrap) return;
  wrap.innerHTML = (payload.reactions || []).map((r) => `<button class="reaction-pill" onclick="toggleReaction(${payload.msg_id}, '${r.emoji}')">${r.emoji} <span>${r.count}</span></button>`).join('');
});
socket.on('presence_update', (data) => {
  state.recentChats = state.recentChats.map((chat) => chat.id === data.tele_id ? { ...chat, online: data.online, last_seen_label: data.online ? 'online' : `last seen ${data.last_seen_at}` } : chat);
  renderRecentChats();
  if (!state.isCurrentChatGroup && state.currentTargetID === data.tele_id) updateChatHeaderStatus(data.online ? 'online' : formatRelativeStatus(`last seen ${data.last_seen_at}`));
});
socket.on('typing_update', (data) => {
  if (data.room !== state.activeRoom || state.isCurrentChatGroup) return;
  const otherUsers = (data.users || []).filter((u) => u !== state.myID);
  if (otherUsers.length) updateChatHeaderStatus('typing…');
});
socket.on('room_receipts_updated', (payload) => {
  if (payload.room !== state.activeRoom) return;
  (payload.messages || []).forEach((msg) => {
    state.messageCache[msg.id] = msg;
    const wrap = document.querySelector(`[data-msg-id="${msg.id}"]`);
    if (wrap) wrap.outerHTML = messageHtml(msg);
  });
});

socket.on('room_meta_updated', (payload) => {
  if (payload.target_id !== state.currentTargetID) return;
  showPinBanner(payload.room.pin_message);
  updateChatHeaderStatus(`${payload.room.kind} · ${payload.room.member_count} members`);
});

window.addEventListener('click', (event) => {
  if (!event.target.closest('.search-wrap')) byId('suggestions').classList.remove('show');
  if (!event.target.closest('#reaction-picker') && !event.target.closest('.message-actions button')) byId('reaction-picker').classList.add('hidden');
  if (event.target.classList.contains('modal')) event.target.classList.add('hidden');
});

applyTheme(state.myTheme, false);
renderThemeCards();
if (state.myID) startSession();
maybeShowMobileTabs();
