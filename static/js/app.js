const socket = io();

const THEMES = {
  'midnight-cyan': { label: 'Midnight Cyan', color: '#06131f' },
  'ocean-blue': { label: 'Ocean Blue', color: '#0b5cff' },
  'royal-violet': { label: 'Royal Violet', color: '#6f37ff' },
  'emerald-luxe': { label: 'Emerald Luxe', color: '#0b8d72' },
  'aurora-glass': { label: 'Aurora Glass', color: '#ee5d92' },
  'obsidian-gold': { label: 'Obsidian Gold', color: '#0B0B0F' },
  'crimson-noir': { label: 'Crimson Noir', color: '#0E0A0B' },
  'arctic-glass': { label: 'Arctic Glass', color: '#EEF6FF' },
  'sakura-neon': { label: 'Sakura Neon', color: '#FFF2F7' },
  'matrix-cyber': { label: 'Matrix Cyber', color: '#05080A' },
  'sunset-luxe': { label: 'Sunset Luxe', color: '#FFF7F2' },
  'ice-purple': { label: 'Ice Purple', color: '#F5F3FF' },
  'amoled-void': { label: 'AMOLED Void', color: '#000000' },
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
  privacyLastSeen: localStorage.getItem('fPrivacyLastSeen') || 'everyone',
  blockedUsers: new Set(JSON.parse(localStorage.getItem('fBlockedUsers') || '[]')),
  passcode: localStorage.getItem('fPasscode') || '',
  mediaRecorder: null,
  recordedChunks: [],
  roomVisibility: 'public',
  roomInviteToken: '',
  myStatusText: localStorage.getItem('fStatusText') || '',
  myBannerUrl: localStorage.getItem('fBannerUrl') || '',
  myProfileMusic: localStorage.getItem('fProfileMusic') || '',
  myMood: localStorage.getItem('fMood') || '',
  myBirthday: localStorage.getItem('fBirthday') || '',
  myProfileColor: localStorage.getItem('fProfileColor') || '#8ec5ff',
  myPremiumEmoji: localStorage.getItem('fPremiumEmoji') || '',
  wallpaper: localStorage.getItem('fWallpaper') || 'aurora',
  bubbleStyle: localStorage.getItem('fBubbleStyle') || 'default',
  compactMode: localStorage.getItem('fCompactMode') === '1',
  amoledMode: localStorage.getItem('fAmoledMode') === '1',
  pinnedChats: new Set(JSON.parse(localStorage.getItem('fPinnedChats') || '[]')),
  hiddenChats: new Set(JSON.parse(localStorage.getItem('fHiddenChats') || '[]')),
  savedMessages: JSON.parse(localStorage.getItem('fSavedMessages') || '[]'),
  selfDestructSeconds: Number(localStorage.getItem('fSelfDestructSeconds') || '0'),
  hiddenPasscode: localStorage.getItem('fHiddenPasscode') || '',
};
state.cropper = { mode: '', img: null, fileName: '', mimeType: 'image/png' };

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

function setAvatar(el, name, pfp, color = '') {
  if (!el) return;
  el.style.backgroundImage = pfp ? `url(${pfp})` : '';
  el.style.backgroundColor = !pfp && color ? color : '';
  el.textContent = pfp ? '' : getInitial(name);
}

function displayNameWithEmoji(name = '', emoji = '') {
  return `${escapeHtml(name)}${emoji ? ` <span class="premium-emoji">${escapeHtml(emoji)}</span>` : ''}`;
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
  state.myProfileColor = data.profile_color || state.myProfileColor;
  state.myPremiumEmoji = data.premium_emoji || '';
  applyTheme(data.theme || state.myTheme, false);
  localStorage.setItem('fID', state.myID);
  localStorage.setItem('fName', state.myName);
  localStorage.setItem('fPFP', state.myPFP);
  localStorage.setItem('fBio', state.myBio);
  localStorage.setItem('fTheme', state.myTheme);
  localStorage.setItem('fProfileColor', state.myProfileColor);
  localStorage.setItem('fPremiumEmoji', state.myPremiumEmoji);
  startSession();
}

function hydrateProfile() {
  setAvatar(byId('settings-pfp-icon'), state.myName, state.myPFP, state.myProfileColor);
  setAvatar(byId('settings-mini-avatar'), state.myName, state.myPFP, state.myProfileColor);
  byId('settings-fullname').innerHTML = displayNameWithEmoji(state.myName, state.myPremiumEmoji);
  byId('settings-id').textContent = `@${state.myID}`;
  byId('settings-bio').textContent = state.myBio || 'No bio yet';
  byId('settings-fullname-2').innerHTML = displayNameWithEmoji(state.myName, state.myPremiumEmoji);
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
  setAvatar(byId('sheet-avatar'), state.currentTargetName, state.currentTargetPFP, state.currentTargetColor || '');
  byId('sheet-name').innerHTML = displayNameWithEmoji(state.currentTargetName || 'User', state.currentTargetPremiumEmoji || '');
  byId('sheet-handle').textContent = state.isCurrentChatGroup ? state.currentTargetID : `@${state.currentTargetID}`;
  byId('sheet-kind').textContent = state.currentTargetKind;
  byId('sheet-bio').textContent = state.currentTargetBio || 'No description yet';
  byId('chat-profile-sheet').classList.remove('hidden');
}

function closeProfileSheet() { byId('chat-profile-sheet').classList.add('hidden'); byId('sheet-more-panel')?.classList.add('hidden'); }

function toggleProfileMore() { byId('sheet-more-panel')?.classList.toggle('hidden'); }
function openProfileSheetMore() { if (state.currentTargetID === state.myID) { closeProfileSheet(); openModal('profile-modal'); return; } toggleProfileMore(); }
function focusProfileSearch() { closeProfileSheet(); setTimeout(() => byId('chat-search-input')?.focus(), 80); }
function openProfileAvatar() {
  const src = state.currentTargetPFP || state.myPFP || '';
  if (!src) return showToast('No photo');
  byId('pfp-viewer-name').textContent = state.currentTargetName || state.myName || 'Profile photo';
  byId('pfp-viewer-img').src = src;
  byId('pfp-viewer').classList.remove('hidden');
}
function closeProfileAvatar() { byId('pfp-viewer').classList.add('hidden'); }
function copyChatIdentity() { navigator.clipboard?.writeText(state.currentTargetID || ''); showToast('Copied'); }

async function syncCurrentUser() {
  if (!state.myID || !state.myName) return;
  try {
    await fetch('/ensure_user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tele_id: state.myID,
        username: state.myName,
        pfp: state.myPFP || '',
        bio: state.myBio || '',
        theme: state.myTheme || 'midnight-cyan',
        status_text: state.myStatusText || '',
        banner_url: state.myBannerUrl || '',
        profile_music: state.myProfileMusic || '',
        mood: state.myMood || '',
        birthday: state.myBirthday || '',
        profile_color: state.myProfileColor || '',
        premium_emoji: state.myPremiumEmoji || ''
      })
    });
  } catch (e) {
    console.warn('ensure_user failed', e);
  }
}

async function startSession() {
  byId('auth-screen').classList.add('hidden');
  byId('main-app').classList.remove('hidden');
  maybeShowMobileTabs();
  hydrateProfile();
  renderThemeCards();
  applyTheme(state.myTheme, false);
  await syncCurrentUser();
  socket.emit('connect_radar', { my_id: state.myID, username: state.myName });
  await loadPrivacySettings();
  await loadRecentChats();
  maybeLockApp();
}

function logout() {
  localStorage.clear();
  location.reload();
}

async function deleteCurrentAccount(){
  const password = prompt('Enter your password to delete account');
  if (!password) return;
  const res = await fetch('/delete_account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tele_id:state.myID,password})});
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not delete account');
  localStorage.clear();
  location.reload();
}

async function deleteChatPrompt(id, isGroup){
  const ok = confirm(isGroup ? 'Delete or leave this room?' : 'Delete this chat for everyone?');
  if (!ok) return;
  const res = await fetch('/delete_chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actor_id:state.myID,target_id:id,is_group:Boolean(isGroup)})});
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not delete chat');
  if (state.currentTargetID === id) closeCurrentChat();
  await loadRecentChats();
}

async function deleteCurrentRoom(){
  if (!state.isCurrentChatGroup) return;
  if (!confirm('Delete this room permanently?')) return;
  const res = await fetch('/delete_room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:state.currentTargetID,actor_id:state.myID})});
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not delete room');
  closeCurrentChat();
  await loadRecentChats();
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
          <div class="avatar ${!item.pfp ? 'auto' : ''}" style="background-image:${item.pfp ? `url(${item.pfp})` : 'none'};${(!item.pfp && item.profile_color) ? `background-color:${item.profile_color};` : ''}">${item.pfp ? '' : escapeHtml(getInitial(item.name))}</div>
          ${!item.is_group && item.online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="chat-meta">
          <div class="row-between"><strong>${item.is_group ? escapeHtml(item.name) : displayNameWithEmoji(item.name, item.premium_emoji || '')}</strong><small>${formatTime(item.time)}</small></div>
          <p>${escapeHtml(item.last_msg || statusText)}</p>
          <small class="muted">${escapeHtml(statusText)}${muted ? ' · muted' : ''}</small>
        </div>
        <div class="chat-row-actions"><span class="tag">${badge}${muted ? ' · mute' : ''}</span><button class="row-mini-btn" onclick="event.stopPropagation();deleteChatPrompt(${JSON.stringify(''+ '${item.id}')}, ${'${item.is_group}'})">⌫</button></div>
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
  const rows = (await res.json()).filter((item) => !(item.type === 'user' && normalizeHandle(item.id || '') === normalizeHandle(state.myID || '')));
  suggestions.classList.add('show');
  const topRows = rows.slice(0,3);
  suggestions.innerHTML = topRows.length ? topRows.map((item) => {
    const label = item.type === 'user' ? formatRelativeStatus(item.last_seen_label || (item.online ? 'online' : 'offline')) : (item.type === 'channel' ? 'Read-only by default' : 'Group room');
    const isGroup = item.type !== 'user';
    return `
      <div class="suggestion-row" onclick="chooseSuggestion(${JSON.stringify(item)})">
        <div class="avatar-row-wrap">
          <div class="avatar" style="background-image:${item.pfp ? `url(${item.pfp})` : 'none'};${(!item.pfp && item.profile_color) ? `background-color:${item.profile_color};` : ''}">${item.pfp ? '' : escapeHtml(getInitial(item.name))}</div>
          ${item.type === 'user' && item.online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="chat-meta">
          <strong>${item.type === 'user' ? displayNameWithEmoji(item.name, item.premium_emoji || '') : escapeHtml(item.name)}</strong>
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
    visibility: byId('room-visibility').value,
    creator_id: state.myID,
    kind: state.roomKindChoice,
  };
  const res = await fetch('/create_room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not create room');
  closeModal('room-modal');
  ['room-name','room-code','room-description'].forEach((id) => byId(id).value = ''); byId('room-visibility').value='public';
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
          <button class="icon-btn slim-icon" onclick="openMediaGallery()">▣</button>
          <button class="icon-btn slim-icon" onclick="document.getElementById('media-upload').click()">⌁</button>
          <button class="icon-btn slim-icon" onclick="toggleHeaderTools()">⋯</button>
        </div>
      </div>
      <div id="pin-banner" class="pin-banner hidden"></div>
      <div id="reply-preview" class="reply-preview hidden"></div>
      <div id="header-tools" class="chat-tools-bar hidden">
        <input id="chat-search-input" class="chat-search-input" placeholder="Search in this chat" oninput="filterMessagesInView()">
        <button class="icon-btn" onclick="toggleArchiveCurrentChat()">🗃️</button>
        <button class="icon-btn" onclick="toggleMuteCurrentChat()">🔕</button>
      </div>
      <div id="messages-view" class="messages-view"></div>
      <div class="chat-input-area">
        <button class="attach-btn slim-icon" onclick="document.getElementById('media-upload').click()">＋</button>
        <input type="file" id="media-upload" class="hidden" multiple onchange="uploadMedia(event)">
        <button class="attach-btn slim-icon" onmousedown="startVoiceRecord()" onmouseup="stopVoiceRecord()" ontouchstart="startVoiceRecord()" ontouchend="stopVoiceRecord()">◉</button>
        <input type="text" id="msg-input" placeholder="Type a message" oninput="handleTypingInput()" onkeypress="if(event.key==='Enter') sendMsg()">
        <button class="send-btn" onclick="sendMsg()">➤</button>
      </div>
    </div>`;
  byId('chat-header-name').innerHTML = displayNameWithEmoji(name, meta?.premium_emoji || '');
  setAvatar(byId('chat-header-avatar'), name, pfp, meta?.profile_color || '');
}

function toggleHeaderTools(){ byId('header-tools')?.classList.toggle('hidden'); }


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
  state.currentTargetColor = meta.profile_color || '';
  state.currentTargetPremiumEmoji = meta.premium_emoji || '';
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
      state.roomVisibility = metaData.room.visibility || 'public';
      state.roomInviteToken = metaData.room.invite_token || '';
      showPinBanner(metaData.room.pin_message);
      updateChatHeaderStatus(`${metaData.room.kind} · ${metaData.room.member_count} members · ${state.roomVisibility}`);
    }
  } else {
    const pRes = await fetch(`/profile/${encodeURIComponent(id)}?viewer_id=${encodeURIComponent(state.myID)}`);
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
  const files = [...(event.target.files || [])];
  if (!files.length || !state.currentTargetID) return;
  event.target.value = '';
  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.status !== 'success') { showToast(data.message || 'Upload failed'); continue; }
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
  }
  clearReply();
}

function openPfpCropper(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    event.target.value = '';
    return showToast('Choose an image');
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      state.cropper = { mode: 'pfp', img, fileName: file.name, mimeType: file.type || 'image/png' };
      byId('crop-zoom').value = '1';
      byId('crop-x').value = '0';
      byId('crop-y').value = '0';
      openModal('image-crop-modal');
      updateCropper();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function updateCropper() {
  const canvas = byId('cropper-canvas');
  const img = state.cropper?.img;
  if (!canvas || !img) return;
  const ctx = canvas.getContext('2d');
  const zoom = Number(byId('crop-zoom')?.value || 1);
  const shiftX = Number(byId('crop-x')?.value || 0);
  const shiftY = Number(byId('crop-y')?.value || 0);
  const size = Math.min(img.width, img.height) / zoom;
  let sx = (img.width - size) / 2 + shiftX * ((img.width - size) / 2 || 1);
  let sy = (img.height - size) / 2 + shiftY * ((img.height - size) / 2 || 1);
  sx = Math.max(0, Math.min(img.width - size, sx));
  sy = Math.max(0, Math.min(img.height - size, sy));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
}

function closeImageCropper() {
  closeModal('image-crop-modal');
  state.cropper = { mode: '', img: null, fileName: '', mimeType: 'image/png' };
}

function cropCanvasToBlob(type = 'image/png', quality = 0.92) {
  return new Promise((resolve) => byId('cropper-canvas')?.toBlob(resolve, type, quality));
}

async function uploadCroppedPFP() {
  const blob = await cropCanvasToBlob('image/png', 0.95);
  if (!blob) return showToast('Could not crop image');
  const fd = new FormData();
  fd.append('file', new File([blob], 'profile.png', { type: 'image/png' }));
  fd.append('type', 'pfp');
  fd.append('tele_id', state.myID);
  const res = await fetch('/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Profile photo upload failed');
  state.myPFP = data.url;
  localStorage.setItem('fPFP', state.myPFP);
  hydrateProfile();
  await loadRecentChats();
  closeImageCropper();
  showToast('Profile photo updated');
}

async function sendCroppedSticker() {
  if (!state.currentTargetID) return showToast('Open a chat first');
  const blob = await cropCanvasToBlob('image/webp', 0.92);
  if (!blob) return showToast('Could not build sticker');
  const fd = new FormData();
  fd.append('file', new File([blob], 'sticker.webp', { type: 'image/webp' }));
  const res = await fetch('/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Sticker upload failed');
  socket.emit('private_message', {
    room: buildRoom(state.currentTargetID, state.isCurrentChatGroup),
    sender_id: state.myID,
    sender_name: state.myName,
    target_id: state.currentTargetID,
    is_group: state.isCurrentChatGroup,
    msg_type: 'image',
    content: '[sticker]',
    file_url: data.url,
    reply_to_id: state.replyTo?.id || null,
  });
  closeImageCropper();
  showToast('Sticker sent');
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
      <div class="avatar" style="background-image:${item.pfp ? `url(${item.pfp})` : 'none'};${(!item.pfp && item.profile_color) ? `background-color:${item.profile_color};` : ''}">${item.pfp ? '' : escapeHtml(getInitial(item.name))}</div>
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


async function loadPrivacySettings() {
  if (!state.myID) return;
  const res = await fetch(`/privacy/${encodeURIComponent(state.myID)}`);
  const data = await res.json();
  if (data.status === 'success') {
    state.privacyLastSeen = data.privacy_last_seen || 'everyone';
    state.blockedUsers = new Set(data.blocked_users || []);
    localStorage.setItem('fPrivacyLastSeen', state.privacyLastSeen);
    localStorage.setItem('fBlockedUsers', JSON.stringify([...state.blockedUsers]));
    const sel = byId('privacy-last-seen');
    if (sel) sel.value = state.privacyLastSeen;
  }
}

async function savePrivacySettings() {
  state.privacyLastSeen = byId('privacy-last-seen').value;
  const pass = byId('app-passcode').value.trim();
  if (pass) {
    state.passcode = pass;
    localStorage.setItem('fPasscode', pass);
  }
  const res = await fetch('/update_profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tele_id: state.myID, username: state.myName, bio: state.myBio, theme: state.myTheme, privacy_last_seen: state.privacyLastSeen })
  });
  const data = await res.json();
  if (data.status === 'success') {
    localStorage.setItem('fPrivacyLastSeen', state.privacyLastSeen);
    closeModal('privacy-modal');
    showToast('Privacy saved');
  }
}

function clearPasscode() {
  state.passcode = '';
  localStorage.removeItem('fPasscode');
  byId('app-passcode').value = '';
  showToast('App lock removed');
}

function maybeLockApp() {
  if (!state.passcode) return;
  byId('passcode-lock').classList.remove('hidden');
}

function unlockApp() {
  const val = byId('unlock-passcode').value.trim();
  if (val !== state.passcode) return showToast('Wrong passcode');
  byId('passcode-lock').classList.add('hidden');
  byId('unlock-passcode').value = '';
}

async function openMediaGallery() {
  if (!state.currentTargetID) return;
  const res = await fetch(`/media_gallery/${encodeURIComponent(buildRoom(state.currentTargetID, state.isCurrentChatGroup))}`);
  const items = await res.json();
  const grid = byId('media-gallery-grid');
  grid.innerHTML = items.length ? items.map((item) => {
    if (item.msg_type === 'image') return `<a class="gallery-card" href="${item.file_url}" target="_blank"><img src="${item.file_url}" alt="image"><span>${escapeHtml(item.content || 'Image')}</span></a>`;
    if (item.msg_type === 'video') return `<a class="gallery-card" href="${item.file_url}" target="_blank"><video src="${item.file_url}" muted playsinline></video><span>${escapeHtml(item.content || 'Video')}</span></a>`;
    if (item.msg_type === 'audio') return `<div class="gallery-card"><div class="gallery-file">🎵</div><audio controls src="${item.file_url}"></audio><span>${escapeHtml(item.content || 'Audio')}</span></div>`;
    return `<a class="gallery-card" href="${item.file_url}" target="_blank"><div class="gallery-file">📁</div><span>${escapeHtml(item.content || 'File')}</span></a>`;
  }).join('') : '<div class="empty-mini">No media yet</div>';
  openModal('media-gallery-modal');
}

async function openMembersModal() {
  if (!state.isCurrentChatGroup) return showToast('Only for groups and channels');
  const res = await fetch(`/room_members/${encodeURIComponent(state.currentTargetID)}`);
  const data = await res.json();
  if (data.status !== 'success') return showToast('Could not load members');
  const list = byId('members-list');
  list.innerHTML = data.members.map((m) => `
    <div class="forward-row">
      <div class="avatar" style="background-image:${m.pfp ? `url(${m.pfp})` : 'none'}">${m.pfp ? '' : escapeHtml(getInitial(m.username))}</div>
      <div class="chat-meta">
        <strong>${escapeHtml(m.username)}</strong>
        <p>@${escapeHtml(m.tele_id)}</p>
        <small class="muted">${m.role}${m.online ? ' · online' : ''}</small>
      </div>
      ${state.currentRole === 'owner' && m.tele_id !== state.myID ? `<button class="base-btn secondary mini-btn" onclick="toggleAdminRole('${m.tele_id}','${m.role === 'admin' ? 'member' : 'admin'}')">${m.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>` : ''}
    </div>`).join('');
  openModal('members-modal');
}

async function toggleAdminRole(targetId, role) {
  const res = await fetch('/room_member_role', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code: state.currentTargetID, actor_id: state.myID, target_id: targetId, role })});
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Not allowed');
  showToast('Role updated');
  openMembersModal();
}

async function toggleBlockCurrentUser() {
  if (state.isCurrentChatGroup) return showToast('Blocking is for private chats');
  const res = await fetch('/block_user', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ actor_id: state.myID, target_id: state.currentTargetID, mode: state.blockedUsers.has(state.currentTargetID) ? 'unblock' : 'block' })});
  const data = await res.json();
  if (data.status !== 'success') return showToast('Could not update block list');
  state.blockedUsers = new Set(data.blocked_users || []);
  localStorage.setItem('fBlockedUsers', JSON.stringify([...state.blockedUsers]));
  showToast(state.blockedUsers.has(state.currentTargetID) ? 'User blocked' : 'User unblocked');
}

function copyInviteLink() {
  if (!state.currentTargetID) return;
  const base = location.origin;
  const value = state.isCurrentChatGroup ? `${base}/?room=${encodeURIComponent(state.currentTargetID)}${state.roomInviteToken ? `&invite=${encodeURIComponent(state.roomInviteToken)}` : ''}` : `@${state.currentTargetID}`;
  navigator.clipboard?.writeText(value);
  showToast('Invite copied');
}

async function startVoiceRecord() {
  if (!navigator.mediaDevices?.getUserMedia || state.mediaRecorder?.state === 'recording') return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.recordedChunks = [];
    state.mediaRecorder = new MediaRecorder(stream);
    state.mediaRecorder.ondataavailable = (e) => { if (e.data.size) state.recordedChunks.push(e.data); };
    state.mediaRecorder.onstop = async () => {
      const blob = new Blob(state.recordedChunks, { type: 'audio/webm' });
      if (!blob.size || !state.currentTargetID) return;
      const fd = new FormData();
      fd.append('file', new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' }));
      const res = await fetch('/upload', { method:'POST', body: fd });
      const data = await res.json();
      if (data.status !== 'success') return showToast('Voice upload failed');
      socket.emit('private_message', { room: buildRoom(state.currentTargetID, state.isCurrentChatGroup), sender_id: state.myID, sender_name: state.myName, target_id: state.currentTargetID, is_group: state.isCurrentChatGroup, msg_type: data.type, content: 'Voice note', file_url: data.url, reply_to_id: state.replyTo?.id || null });
      showToast('Voice note sent');
      clearReply();
      stream.getTracks().forEach((t) => t.stop());
    };
    state.mediaRecorder.start();
    showToast('Recording… hold and release to send');
  } catch (e) {
    showToast('Microphone permission needed');
  }
}

function stopVoiceRecord() {
  if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
}



const WALLPAPERS = {
  aurora: 'radial-gradient(circle at top right, rgba(255,122,184,.25), transparent 30%), radial-gradient(circle at bottom left, rgba(34,211,238,.22), transparent 28%)',
  ocean: 'linear-gradient(180deg, rgba(25,75,180,.18), rgba(0,0,0,0)), radial-gradient(circle at 20% 20%, rgba(42,109,245,.20), transparent 35%)',
  sunset: 'radial-gradient(circle at top left, rgba(249,115,22,.28), transparent 28%), radial-gradient(circle at bottom right, rgba(251,113,133,.24), transparent 30%)',
  void: 'radial-gradient(circle at top right, rgba(59,130,246,.18), transparent 28%), radial-gradient(circle at bottom left, rgba(34,211,238,.16), transparent 24%)',
  sakura: 'radial-gradient(circle at top right, rgba(236,72,153,.18), transparent 28%), radial-gradient(circle at bottom left, rgba(249,168,212,.22), transparent 28%)'
};

function applyWallpaperSetting(value, persist = true) {
  state.wallpaper = WALLPAPERS[value] ? value : 'aurora';
  document.body.style.setProperty('--chat-wallpaper', WALLPAPERS[state.wallpaper]);
  if (persist) localStorage.setItem('fWallpaper', state.wallpaper);
  const picker = byId('wallpaper-picker');
  if (picker) picker.value = state.wallpaper;
}
function applyBubbleStyle(value, persist = true) {
  state.bubbleStyle = value || 'default';
  document.body.dataset.bubbleStyle = state.bubbleStyle;
  if (persist) localStorage.setItem('fBubbleStyle', state.bubbleStyle);
  const picker = byId('bubble-style-picker');
  if (picker) picker.value = state.bubbleStyle;
}
function toggleCompactMode() { state.compactMode = !state.compactMode; document.body.classList.toggle('compact-mode', state.compactMode); localStorage.setItem('fCompactMode', state.compactMode ? '1':'0'); showToast(state.compactMode ? 'Compact mode on' : 'Compact mode off'); }
function toggleAmoledMode() { state.amoledMode = !state.amoledMode; document.body.classList.toggle('amoled-mode', state.amoledMode); localStorage.setItem('fAmoledMode', state.amoledMode ? '1':'0'); showToast(state.amoledMode ? 'AMOLED mode on' : 'AMOLED mode off'); }
function openQuickFab() {
  const options = ['Saved Messages','Discover','Theme Studio','Create Room','Stickers'];
  const choice = prompt(`Quick actions:
1 Saved Messages
2 Discover
3 Theme Studio
4 Create Room
5 Stickers
Type 1-5`);
  if (choice === '1') return openSavedMessages();
  if (choice === '2') return openDiscover();
  if (choice === '3') return openModal('theme-modal');
  if (choice === '4') return openModal('room-modal');
  if (choice === '5') return openModal('sticker-modal');
}
function savePinnedChats() { saveSet('fPinnedChats', state.pinnedChats); }
function togglePinChat(id = state.currentTargetID, isGroup = state.isCurrentChatGroup) { if (!id) return; const key = `${isGroup ? 'group' : 'dm'}:${id}`; state.pinnedChats.has(key) ? state.pinnedChats.delete(key) : state.pinnedChats.add(key); savePinnedChats(); renderRecentChats(); showToast(state.pinnedChats.has(key) ? 'Chat pinned' : 'Chat unpinned'); }
function toggleHideCurrentChat() { if (!state.currentTargetID) return; const key = roomKey(); state.hiddenChats.has(key) ? state.hiddenChats.delete(key) : state.hiddenChats.add(key); saveSet('fHiddenChats', state.hiddenChats); renderRecentChats(); showToast(state.hiddenChats.has(key) ? 'Moved to hidden chats' : 'Removed from hidden chats'); }
function openSavedMessages() { const list = byId('saved-list'); list.innerHTML = state.savedMessages.length ? state.savedMessages.map((m,idx)=>`<div class="forward-row"><div class="chat-meta"><strong>${escapeHtml(m.sender_name || 'Saved')}</strong><p>${escapeHtml(m.content || '[' + (m.msg_type||'message') + ']')}</p><small>${formatDayTime(m.saved_at)}</small></div><button class="base-btn secondary mini-btn" onclick="sendSavedToCurrent(${idx})">Send here</button></div>`).join('') : '<div class="empty-mini">No saved messages yet</div>'; openModal('saved-modal'); }
function saveMessageLocally(id) { const src = state.messageCache[id]; if (!src) return; state.savedMessages.unshift({ ...src, saved_at: new Date().toISOString() }); state.savedMessages = state.savedMessages.slice(0, 200); localStorage.setItem('fSavedMessages', JSON.stringify(state.savedMessages)); showToast('Saved to Saved Messages'); }
function sendSavedToCurrent(idx) { const item = state.savedMessages[idx]; if (!item || !state.currentTargetID) return; socket.emit('private_message', { room: buildRoom(state.currentTargetID, state.isCurrentChatGroup), sender_id: state.myID, sender_name: state.myName, target_id: state.currentTargetID, is_group: state.isCurrentChatGroup, msg_type: item.msg_type, content: item.content, file_url: item.file_url, forwarded_from: 'Saved Messages', self_destruct_seconds: state.selfDestructSeconds || 0 }); closeModal('saved-modal'); }
function scheduleCurrentMessage() { const input = byId('msg-input'); if (!input || !input.value.trim()) return showToast('Type a message first'); const seconds = Number(prompt('Send after how many seconds?', '30') || '0'); if (!seconds) return; const payload = { room: buildRoom(state.currentTargetID, state.isCurrentChatGroup), sender_id: state.myID, sender_name: state.myName, target_id: state.currentTargetID, is_group: state.isCurrentChatGroup, msg_type: 'text', content: input.value.trim(), reply_to_id: state.replyTo?.id || null, self_destruct_seconds: state.selfDestructSeconds || 0 }; setTimeout(() => socket.emit('private_message', payload), seconds * 1000); input.value = ''; showToast(`Scheduled in ${seconds}s`); }
function sendSticker(emoji) { if (!state.currentTargetID) return showToast('Open a chat first'); socket.emit('private_message', { room: buildRoom(state.currentTargetID, state.isCurrentChatGroup), sender_id: state.myID, sender_name: state.myName, target_id: state.currentTargetID, is_group: state.isCurrentChatGroup, msg_type: 'text', content: emoji, self_destruct_seconds: state.selfDestructSeconds || 0 }); closeModal('sticker-modal'); }
function translateTextLite(text) { const dict = { hello:'halo', hi:'hai', thanks:'terima kasih', thank:'terima kasih', yes:'ya', no:'tidak', love:'cinta', friend:'kawan', good:'baik', night:'malam', morning:'pagi' }; return String(text||'').split(/(\s+)/).map(w => dict[w.toLowerCase()] || w).join(''); }
function translateMessage(id) { const msg = state.messageCache[id]; if (!msg?.content) return; alert(`Lite translation:

${translateTextLite(msg.content)}`); }
function openDiscover() { const list = byId('discover-list'); const chats = state.recentChats.filter(c => c.is_group).slice(0, 20); list.innerHTML = chats.length ? chats.map(c => `<button class="forward-row" onclick="openChat(${JSON.stringify('NAME')}, ${JSON.stringify('ID')}, '', true, {id:${JSON.stringify('ID')}, name:${JSON.stringify('NAME')}, is_group:true, kind:${JSON.stringify('group')}})">` .replace('NAME', c.name).replace('ID', c.id) + `<div class="chat-meta"><strong>${escapeHtml(c.name)}</strong><p>${escapeHtml(c.description || c.kind || 'community')}</p></div><span class="badge-pill">${escapeHtml(c.kind || 'group')}</span></button>`).join('') : '<div class="empty-mini">No communities to discover yet. Create a public group or channel first.</div>'; openModal('discover-modal'); }
async function openJoinRequests() { if (!state.isCurrentChatGroup) return showToast('Only for groups/channels'); const res = await fetch(`/room_join_requests/${encodeURIComponent(state.currentTargetID)}?actor_id=${encodeURIComponent(state.myID)}`); const data = await res.json(); const list = byId('join-requests-list'); if (data.status !== 'success') { list.innerHTML = `<div class="empty-mini">${escapeHtml(data.message || 'Not allowed')}</div>`; } else { list.innerHTML = data.requests.length ? data.requests.map(r => `<div class="forward-row"><div class="chat-meta"><strong>${escapeHtml(r.username)}</strong><p>@${escapeHtml(r.tele_id)}</p><small>${formatDayTime(r.created_at)}</small></div><div class="inline-btns"><button class="base-btn secondary mini-btn" onclick="handleJoinRequest('${r.tele_id}', false)">Decline</button><button class="base-btn mini-btn" onclick="handleJoinRequest('${r.tele_id}', true)">Approve</button></div></div>`).join('') : '<div class="empty-mini">No join requests</div>'; } openModal('join-requests-modal'); }
async function handleJoinRequest(targetId, approve) { const res = await fetch('/approve_join_request', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code: state.currentTargetID, actor_id: state.myID, target_id: targetId, approve })}); const data = await res.json(); if (data.status !== 'success') return showToast(data.message || 'Could not update request'); openJoinRequests(); showToast(approve ? 'Request approved' : 'Request declined'); }
async function openAdminLogs() { if (!state.isCurrentChatGroup) return showToast('Only for groups/channels'); const res = await fetch(`/admin_logs/${encodeURIComponent(state.currentTargetID)}?actor_id=${encodeURIComponent(state.myID)}`); const data = await res.json(); const list = byId('admin-logs-list'); if (data.status !== 'success') { list.innerHTML = `<div class="empty-mini">${escapeHtml(data.message || 'Not allowed')}</div>`; } else { list.innerHTML = data.logs.length ? data.logs.map(l => `<div class="forward-row"><div class="chat-meta"><strong>${escapeHtml(l.action)}</strong><p>${escapeHtml(l.actor_id || 'system')}</p><small>${formatDayTime(l.created_at)}</small></div></div>`).join('') : '<div class="empty-mini">No admin logs</div>'; } openModal('admin-logs-modal'); }
async function saveRoomSettings() { const payload = { code: state.currentTargetID, actor_id: state.myID, public_handle: byId('room-public-handle').value.trim(), rules_text: byId('room-rules-text').value.trim(), welcome_message: byId('room-welcome-message').value.trim(), slow_mode_seconds: byId('room-slow-mode').value.trim(), join_approval: byId('room-join-approval').value === 'true', is_verified: byId('room-verified').value === 'true' }; const res = await fetch('/update_room_settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }); const data = await res.json(); if (data.status !== 'success') return showToast(data.message || 'Could not save room settings'); state.roomInviteToken = data.room.invite_token || ''; showToast('Room settings saved'); closeModal('room-settings-modal'); openChat(state.currentTargetName, state.currentTargetID, state.currentTargetPFP, state.isCurrentChatGroup, data.room); }
function prefillRoomSettings(room) { if (!room) return; byId('room-public-handle').value = room.public_handle || room.code || ''; byId('room-rules-text').value = room.rules_text || ''; byId('room-welcome-message').value = room.welcome_message || ''; byId('room-slow-mode').value = room.slow_mode_seconds || 0; byId('room-join-approval').value = room.join_approval ? 'true' : 'false'; byId('room-verified').value = room.is_verified ? 'true' : 'false'; }
const _origRenderRecentChats = renderRecentChats; renderRecentChats = function() { _origRenderRecentChats(); const list = byId('chat-list'); if (!list) return; const rows = [...list.querySelectorAll('.chat-row')]; rows.forEach(row => { const id = row.dataset.chatId; const key = `${row.dataset.group === 'true' ? 'group' : 'dm'}:${id}`; if (state.hiddenChats.has(key) && state.listFilter !== 'archived') row.style.display = 'none'; if (state.pinnedChats.has(key)) row.classList.add('pinned-chat'); }); const parent = list; const pinned = rows.filter(r=>r.classList.contains('pinned-chat')); pinned.forEach(r => parent.prepend(r)); }
const _origHydrateProfile = hydrateProfile; hydrateProfile = function() { _origHydrateProfile(); state.myStatusText && (byId('settings-bio').textContent = state.myStatusText); byId('edit-status-text').value = state.myStatusText || ''; byId('edit-profile-music').value = state.myProfileMusic || ''; byId('edit-mood').value = state.myMood || ''; byId('edit-birthday').value = state.myBirthday || ''; byId('edit-banner-url').value = state.myBannerUrl || ''; };
const _origSaveProfile = saveProfile; saveProfile = async function() { const username = byId('edit-display-name').value.trim(); const bio = byId('edit-bio').value.trim(); const status_text = byId('edit-status-text').value.trim(); const profile_music = byId('edit-profile-music').value.trim(); const mood = byId('edit-mood').value.trim(); const birthday = byId('edit-birthday').value.trim(); const banner_url = byId('edit-banner-url').value.trim(); const profile_color = byId('edit-profile-color').value.trim(); const premium_emoji = byId('edit-premium-emoji').value.trim(); const res = await fetch('/update_profile', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tele_id: state.myID, username, bio, theme: state.myTheme, status_text, profile_music, mood, birthday, banner_url, profile_color, premium_emoji, privacy_last_seen: state.privacyLastSeen })}); const data = await res.json(); if (data.status !== 'success') return showToast(data.message || 'Could not update profile'); state.myName = data.username; state.myBio = data.bio || ''; state.myStatusText = data.status_text || ''; state.myProfileMusic = data.profile_music || ''; state.myMood = data.mood || ''; state.myBirthday = data.birthday || ''; state.myBannerUrl = data.banner_url || ''; state.myProfileColor = data.profile_color || '#8ec5ff'; state.myPremiumEmoji = data.premium_emoji || ''; localStorage.setItem('fName', state.myName); localStorage.setItem('fBio', state.myBio); localStorage.setItem('fStatusText', state.myStatusText); localStorage.setItem('fProfileMusic', state.myProfileMusic); localStorage.setItem('fMood', state.myMood); localStorage.setItem('fBirthday', state.myBirthday); localStorage.setItem('fBannerUrl', state.myBannerUrl); localStorage.setItem('fProfileColor', state.myProfileColor); localStorage.setItem('fPremiumEmoji', state.myPremiumEmoji); hydrateProfile(); closeModal('profile-modal'); await loadRecentChats(); showToast('Profile updated'); };
const _origStartSession = startSession; startSession = async function() { await _origStartSession(); byId('floating-fab').classList.remove('hidden'); document.body.classList.toggle('compact-mode', state.compactMode); document.body.classList.toggle('amoled-mode', state.amoledMode); applyWallpaperSetting(state.wallpaper, false); applyBubbleStyle(state.bubbleStyle, false); const picker = byId('wallpaper-picker'); if (picker && !picker.options.length) { ['aurora','ocean','sunset','void','sakura'].forEach(k => picker.insertAdjacentHTML('beforeend', `<option value="${k}">${k[0].toUpperCase()+k.slice(1)}</option>`)); picker.value = state.wallpaper; } const sd = byId('self-destruct-seconds'); if (sd) sd.value = String(state.selfDestructSeconds || 0); const hp = byId('hidden-passcode'); if (hp) hp.value = state.hiddenPasscode || ''; const settingsCard = document.querySelector('.telegram-card'); if (settingsCard && !document.getElementById('extra-settings-hook')) { settingsCard.insertAdjacentHTML('beforeend', `<button id="extra-settings-hook" class="telegram-row" onclick="openSavedMessages()"><span class="row-icon pink">💾</span><span>Saved Messages</span></button><button class="telegram-row" onclick="openDiscover()"><span class="row-icon pink">🌐</span><span>Community Discover</span></button>`); } };
const _origRenderChatPanel = renderChatPanel; renderChatPanel = function(name,pfp,isGroup){ _origRenderChatPanel(name,pfp,isGroup); const tools = document.querySelector('.chat-tools-bar'); if (tools && !document.getElementById('chat-search-filter')) { tools.insertAdjacentHTML('beforeend', `<select id="chat-search-filter" class="chat-search-input mini-select" onchange="filterMessagesInView()"><option value="all">All</option><option value="media">Media</option><option value="links">Links</option><option value="files">Files</option><option value="voice">Voice</option></select><button class="icon-btn" onclick="togglePinChat()">📌</button><button class="icon-btn" onclick="openSavedMessages()">💾</button><button class="icon-btn" onclick="openModal('sticker-modal')">✨</button>`); } const area = document.querySelector('.chat-input-area'); if (area && !document.getElementById('schedule-send-btn')) { area.insertAdjacentHTML('beforeend', `<button id="schedule-send-btn" class="attach-btn" onclick="scheduleCurrentMessage()">⏱</button>`); } const actions = document.querySelector('.header-actions'); if (actions && isGroup && !document.getElementById('room-settings-btn')) { actions.insertAdjacentHTML('beforeend', `<button id="room-settings-btn" class="icon-btn" onclick="openModal('room-settings-modal'); prefillRoomSettings({ public_handle: state.currentTargetID, rules_text: state.currentTargetBio, welcome_message: '', slow_mode_seconds: 0, join_approval: false, is_verified: false });">🛠</button><button class="icon-btn" onclick="openAdminLogs()">📜</button>`); } };
const _origOpenChat = openChat; openChat = async function(name,id,pfp,isGroup,meta={}) { await _origOpenChat(name,id,pfp,isGroup,meta); if (isGroup) { try { const res = await fetch(`/room_meta/${encodeURIComponent(id)}`); const data = await res.json(); if (data.status === 'success') { prefillRoomSettings(data.room); if (data.room.rules_text && !sessionStorage.getItem(`rulesSeen:${id}`)) { alert(`Rules for ${name}:\n\n${data.room.rules_text}`); sessionStorage.setItem(`rulesSeen:${id}`,'1'); } } } catch (e) {} } };
const _origSendMsg = sendMsg; sendMsg = async function() { state.selfDestructSeconds = Number(byId('self-destruct-seconds')?.value || state.selfDestructSeconds || 0); localStorage.setItem('fSelfDestructSeconds', String(state.selfDestructSeconds)); return _origSendMsg(); };
const _origFilterMessagesInView = filterMessagesInView; filterMessagesInView = function() { state.chatSearch = byId('chat-search-input')?.value.trim().toLowerCase() || ''; const mode = byId('chat-search-filter')?.value || 'all'; document.querySelectorAll('.msg-wrapper').forEach((wrap) => { const msg = state.messageCache[Number(wrap.dataset.msgId)] || {}; const text = wrap.innerText.toLowerCase(); let match = !state.chatSearch || text.includes(state.chatSearch); if (mode === 'media') match = ['image','video'].includes(msg.msg_type); if (mode === 'links') match = /https?:\/\//.test(msg.content || ''); if (mode === 'files') match = msg.msg_type === 'file'; if (mode === 'voice') match = msg.msg_type === 'audio'; if (state.chatSearch && mode !== 'all') match = match && text.includes(state.chatSearch); wrap.classList.toggle('search-hidden', !match); }); };
const _origMessageBodyHtml = messageBodyHtml; messageBodyHtml = function(data) { if (String(data.content || '').startsWith('[[poll]]')) { try { const payload = JSON.parse(String(data.content).replace('[[poll]]','')); const options = (payload.options || []).map((opt, idx)=>`<button class="poll-option" onclick="toggleReaction(${data.id}, '${idx+1}️⃣')">${escapeHtml(opt)}</button>`).join(''); return `<div class="bubble ${data.sender_id === state.myID ? 'sent':'received'}"><div class="poll-card"><strong>${escapeHtml(payload.question || 'Poll')}</strong><div class="poll-options">${options}</div></div></div>`; } catch(e){} } return _origMessageBodyHtml(data); };
const _origMessageHtml = messageHtml; messageHtml = function(data) { const html = _origMessageHtml(data); return html.replace('</div>\n        <div class="reaction-row">', `<button class="mini-inline-action" onclick="saveMessageLocally(${data.id})">Save</button><button class="mini-inline-action" onclick="translateMessage(${data.id})">Translate</button></div>\n        <div class="reaction-row">`); };
const _origCreateRoom = createRoom; createRoom = async function() { const payload = { name: byId('room-name').value.trim(), code: normalizeHandle(byId('room-code').value), creator_id: state.myID, kind: state.roomKindChoice, description: byId('room-description').value.trim(), visibility: byId('room-visibility').value, join_approval: confirm('Require join approval? OK = yes, Cancel = no'), public_handle: normalizeHandle(prompt('Optional public @handle for this room', byId('room-code').value) || byId('room-code').value), rules_text: prompt('Optional rules page text before joining', '') || '', welcome_message: prompt('Optional welcome message', '') || '', slow_mode_seconds: prompt('Slow mode seconds (0 for off)', '0') || '0', is_verified: false }; const res = await fetch('/create_room', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}); const data = await res.json(); if (data.status !== 'success') return showToast(data.message || 'Could not create room'); closeModal('room-modal'); byId('room-name').value=''; byId('room-code').value=''; byId('room-description').value=''; await loadRecentChats(); openChat(data.room.name, data.room.code, data.room.pfp || '', true, { ...data.room, is_group: true }); showToast(`${data.room.kind} ready`); };
const _origChooseSuggestion = chooseSuggestion; chooseSuggestion = async function(item) { if (item.type === 'group' || item.type === 'channel') { if (item.description) { const ok = confirm(`About this ${item.type}:\n\n${item.description}\n\nJoin?`); if (!ok) return; } } const result = await _origChooseSuggestion(item); return result; };
const _origJoinRoom = joinRoom; joinRoom = async function() { const code = byId('room-code').value.trim(); const token = prompt('Invite token if needed. Leave empty for public rooms.', '') || ''; const res = await fetch('/join_room', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code, tele_id: state.myID, invite_token: token })}); const data = await res.json(); if (data.status === 'pending') { closeModal('room-modal'); return showToast('Join request sent'); } if (data.status !== 'success') return showToast(data.message || 'Could not join'); closeModal('room-modal'); await loadRecentChats(); openChat(data.room.name, data.room.code, data.room.pfp || '', true, { ...data.room, is_group: true }); };
window.sendLocationCard = function() { if (!navigator.geolocation) return showToast('Location not supported'); navigator.geolocation.getCurrentPosition((pos) => { socket.emit('private_message', { room: buildRoom(state.currentTargetID, state.isCurrentChatGroup), sender_id: state.myID, sender_name: state.myName, target_id: state.currentTargetID, is_group: state.isCurrentChatGroup, msg_type: 'text', content: `📍 https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}` }); }); };
window.openAIAssistant = function() { const promptText = prompt('Ask the mini bot anything'); if (!promptText || !state.currentTargetID) return; const reply = `🤖 FaelBot: ${translateTextLite(promptText).split('').reverse().join('')}`; socket.emit('private_message', { room: buildRoom(state.currentTargetID, state.isCurrentChatGroup), sender_id: state.myID, sender_name: 'FaelBot', target_id: state.currentTargetID, is_group: state.isCurrentChatGroup, msg_type: 'text', content: reply }); };
window.makePoll = function() { if (!state.currentTargetID) return showToast('Open a chat first'); const q = prompt('Poll question'); if (!q) return; const opts = (prompt('Options separated by commas', 'Yes,No,Maybe') || '').split(',').map(s=>s.trim()).filter(Boolean).slice(0,6); if (!opts.length) return; socket.emit('private_message', { room: buildRoom(state.currentTargetID, state.isCurrentChatGroup), sender_id: state.myID, sender_name: state.myName, target_id: state.currentTargetID, is_group: state.isCurrentChatGroup, msg_type: 'text', content: '[[poll]]' + JSON.stringify({ question:q, options:opts }) }); };


// ---- Divine UI stability patch ----
Object.assign(THEMES, {
  'obsidian-gold': { label: 'Obsidian Gold', color: '#0B0B0F' },
  'crimson-noir': { label: 'Crimson Noir', color: '#0E0A0B' },
  'arctic-glass': { label: 'Arctic Glass', color: '#EEF6FF' },
  'sakura-neon': { label: 'Sakura Neon', color: '#FFF2F7' },
  'matrix-cyber': { label: 'Matrix Cyber', color: '#05080A' },
  'sunset-luxe': { label: 'Sunset Luxe', color: '#FFF7F2' },
  'ice-purple': { label: 'Ice Purple', color: '#F5F3FF' },
  'amoled-void': { label: 'AMOLED Void', color: '#000000' },
});

function themeMetaColor(themeKey) {
  return (THEMES[themeKey] && THEMES[themeKey].color) || '#06131f';
}

const _origApplyTheme = applyTheme;
applyTheme = function(themeKey, persist = true) {
  const safe = THEMES[themeKey] ? themeKey : 'midnight-cyan';
  _origApplyTheme(safe, persist);
  document.documentElement.style.setProperty('--theme-meta-color', themeMetaColor(safe));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeMetaColor(safe));
};

function currentRoomKeyFor(item) {
  return `${item.is_group ? 'group' : 'dm'}:${item.id}`;
}

function recentChatRowHtml(item) {
  const kind = item.kind || (item.is_group ? 'group' : 'private');
  const badge = kind === 'channel' ? 'channel' : item.is_group ? 'group' : 'user';
  const statusText = item.is_group
    ? `${kind}${item.role ? ` · ${item.role}` : ''}`
    : formatRelativeStatus(item.last_seen_label || (item.online ? 'online' : 'offline'));
  const key = currentRoomKeyFor(item);
  const muted = state.mutedChats.has(key);
  const pinned = state.pinnedChats.has(key);
  return `
    <button type="button" class="chat-row ${pinned ? 'pinned-chat' : ''} ${state.currentTargetID === item.id && String(state.isCurrentChatGroup) === String(item.is_group) ? 'active' : ''}"
      data-chat-id="${escapeHtml(item.id)}"
      data-chat-name="${escapeHtml(item.name)}"
      data-chat-pfp="${escapeHtml(item.pfp || '')}"
      data-chat-group="${item.is_group ? '1' : '0'}"
      data-chat-meta="${encodeURIComponent(JSON.stringify(item))}">
      <div class="avatar-row-wrap">
        <div class="avatar ${!item.pfp ? 'auto' : ''}" style="background-image:${item.pfp ? `url(${item.pfp})` : 'none'};${(!item.pfp && item.profile_color) ? `background-color:${item.profile_color};` : ''}">${item.pfp ? '' : escapeHtml(getInitial(item.name))}</div>
        ${!item.is_group && item.online ? '<span class="online-dot"></span>' : ''}
      </div>
      <div class="chat-meta">
        <div class="row-between"><strong>${item.is_group ? escapeHtml(item.name) : displayNameWithEmoji(item.name, item.premium_emoji || '')}</strong><small>${formatTime(item.time)}</small></div>
        <p>${escapeHtml(item.last_msg || statusText)}</p>
        <small class="muted">${escapeHtml(statusText)}${muted ? ' · muted' : ''}</small>
      </div>
      <div class="chat-row-actions"><span class="tag">${badge}${muted ? ' · mute' : ''}</span><button class="row-mini-btn" onclick="event.stopPropagation();deleteChatPrompt(${JSON.stringify(''+ '${item.id}')}, ${'${item.is_group}'})">⌫</button></div>
    </button>`;
}

renderRecentChats = function() {
  const list = byId('chat-list');
  if (!list) return;
  const filtered = state.recentChats.filter((item) => {
    const key = currentRoomKeyFor(item);
    const archived = state.archivedChats.has(key);
    const hidden = state.hiddenChats.has(key);
    if (hidden) return false;
    if (state.listFilter === 'archived') return archived;
    if (archived) return false;
    if (state.listFilter === 'all') return true;
    return (item.kind || (item.is_group ? 'group' : 'private')) === state.listFilter;
  }).sort((a, b) => {
    const aPinned = state.pinnedChats.has(currentRoomKeyFor(a)) ? 1 : 0;
    const bPinned = state.pinnedChats.has(currentRoomKeyFor(b)) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return new Date(b.time || 0) - new Date(a.time || 0);
  });
  list.innerHTML = filtered.length ? filtered.map(recentChatRowHtml).join('') : '<div class="empty-mini">No chats yet</div>';
};

doSearch = async function() {
  const q = byId('search-input').value.trim();
  const suggestions = byId('suggestions');
  if (!q) {
    suggestions.innerHTML = '';
    suggestions.classList.remove('show');
    return;
  }
  const res = await fetch(`/search_suggestions?q=${encodeURIComponent(q)}&my_id=${encodeURIComponent(state.myID)}`);
  const rows = (await res.json()).filter((item) => !(item.type === 'user' && normalizeHandle(item.id || '') === normalizeHandle(state.myID || '')));
  suggestions.classList.add('show');
  const topRows = rows.slice(0,3);
  suggestions.innerHTML = topRows.length ? topRows.map((item) => {
    const label = item.type === 'user'
      ? formatRelativeStatus(item.last_seen_label || (item.online ? 'online' : 'offline'))
      : (item.type === 'channel' ? 'Read-only channel' : 'Group room');
    const subtitle = item.type === 'user' ? '@' + item.id : (item.public_handle ? '@' + item.public_handle : (item.description || item.id));
    return `
      <button type="button" class="suggestion-row"
        data-item="${encodeURIComponent(JSON.stringify(item))}">
        <div class="avatar-row-wrap">
          <div class="avatar" style="background-image:${item.pfp ? `url(${item.pfp})` : 'none'};${(!item.pfp && item.profile_color) ? `background-color:${item.profile_color};` : ''}">${item.pfp ? '' : escapeHtml(getInitial(item.name))}</div>
          ${item.type === 'user' && item.online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="chat-meta">
          <strong>${escapeHtml(item.name)}</strong>
          <p>${escapeHtml(subtitle)}</p>
          <small class="muted">${escapeHtml(label)}</small>
        </div>
        <span class="tag">${escapeHtml(item.type)}</span>
      </button>`;
  }).join('') : '<div class="empty-mini">No results</div>';
};

chooseSuggestion = async function(item) {
  byId('search-input').value = '';
  byId('suggestions').innerHTML = '';
  byId('suggestions').classList.remove('show');
  if (!item || !item.id) return showToast('Invalid search result');
  if (item.type === 'user') {
    await openChat(item.name, item.id, item.pfp || '', false, item);
    if (isMobileLayout()) setMobileTab('chat');
    return;
  }
  const res = await fetch('/join_room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: item.id, tele_id: state.myID })
  });
  const data = await res.json();
  if (data.status === 'pending') return showToast('Join request sent');
  if (data.status !== 'success') return showToast(data.message || 'Could not join');
  await loadRecentChats();
  await openChat(data.room.name, data.room.code, data.room.pfp || '', true, data.room);
  if (isMobileLayout()) setMobileTab('chat');
};

const _oldOpenProfileSheet = openProfileSheet;
openProfileSheet = async function() {
  _oldOpenProfileSheet();
  const card = document.querySelector('#chat-profile-sheet .profile-sheet-card');
  if (!card || !state.currentTargetID) return;
  byId('sheet-more-panel')?.classList.add('hidden');
  byId('sheet-name').textContent = state.currentTargetName || 'Profile';
  byId('sheet-edit-btn').textContent = state.currentTargetID === state.myID ? 'Edit' : 'More';
  byId('sheet-avatar').onclick = null;
  setAvatar(byId('sheet-avatar'), state.currentTargetName || 'U', state.currentTargetPFP || '');
  const hero = byId('sheet-hero');
  if (hero) hero.style.backgroundImage = '';
  let extraHtml = '';
  let statusLine = 'last seen recently';
  let handle = '@' + (state.currentTargetID || 'user');
  let bio = state.currentTargetBio || 'No bio yet';
  let kindLabel = state.isCurrentChatGroup ? 'Channel / Group' : 'Private chat';
  let kindSub = 'Tap avatar to zoom';

  if (state.isCurrentChatGroup) {
    try {
      const res = await fetch(`/room_meta/${encodeURIComponent(state.currentTargetID)}`);
      const data = await res.json();
      if (data.status === 'success') {
        const room = data.room;
        handle = room.public_handle ? '@' + room.public_handle : state.currentTargetID;
        bio = room.description || 'No description yet';
        kindLabel = `${room.kind}${room.is_verified ? ' · verified' : ''}`;
        kindSub = `${room.member_count || 0} members · ${room.visibility || 'public'}`;
        statusLine = room.kind === 'channel' ? `${room.member_count || 0} subscribers` : `${room.member_count || 0} members`;
        extraHtml = `<div class="profile-stat-grid">
          <div class="profile-stat"><span>Visibility</span><strong>${escapeHtml(room.visibility || 'public')}</strong></div>
          <div class="profile-stat"><span>Invite</span><strong>${room.invite_token ? 'Private link' : 'Room code'}</strong></div>
          <div class="profile-stat"><span>Role</span><strong>${escapeHtml(state.currentRole || 'member')}</strong></div>
          <div class="profile-stat"><span>Saved media</span><strong>Open gallery</strong></div>
        </div>`;
      }
    } catch (e) {}
  } else {
    try {
      const res = await fetch(`/profile/${encodeURIComponent(state.currentTargetID)}?viewer_id=${encodeURIComponent(state.myID)}`);
      const data = await res.json();
      if (data.status === 'success') {
        if (hero) hero.style.backgroundImage = data.banner_url ? `linear-gradient(180deg, rgba(40,167,201,.22), rgba(34,84,126,.68)), url(${data.banner_url})` : 'linear-gradient(180deg, rgba(111,216,255,.55), rgba(74,177,209,.96))';
        statusLine = data.online ? 'online' : (data.last_seen_label || 'last seen recently');
        handle = '@' + (data.username || state.currentTargetID || 'user');
        bio = data.bio || 'No bio yet';
        kindLabel = data.status_text || 'private profile';
        kindSub = data.mood || 'Tap avatar to zoom';
        extraHtml = `<div class="profile-stat-grid">
          <div class="profile-stat"><span>Status</span><strong>${escapeHtml(data.status_text || formatRelativeStatus(data.last_seen_label || 'offline'))}</strong></div>
          <div class="profile-stat"><span>Birthday</span><strong>${escapeHtml(data.birthday || '—')}</strong></div>
          <div class="profile-stat"><span>Mood</span><strong>${escapeHtml(data.mood || '—')}</strong></div>
          <div class="profile-stat"><span>Music</span><strong>${escapeHtml(data.profile_music || '—')}</strong></div>
        </div>`;
      }
    } catch (e) {}
  }
  byId('sheet-status-line').textContent = statusLine;
  byId('sheet-handle').textContent = handle;
  byId('sheet-bio').textContent = bio;
  byId('sheet-kind').textContent = kindLabel;
  byId('sheet-kind-sub').textContent = kindSub;
  let mount = card.querySelector('.profile-sheet-extra');
  if (!mount) {
    mount = document.createElement('div');
    mount.className = 'profile-sheet-extra';
    card.appendChild(mount);
  }
  mount.innerHTML = extraHtml;
};

const _origRenderChatPanel2 = renderChatPanel;
renderChatPanel = function(name, pfp, isGroup) {
  _origRenderChatPanel2(name, pfp, isGroup);
  const area = document.querySelector('.chat-input-area');
  if (area) {
    area.innerHTML = `
      <button class="attach-btn" onclick="document.getElementById('media-upload').click()">📎</button>
      <input type="file" id="media-upload" class="hidden" multiple onchange="uploadMedia(event)">
      <input type="text" id="msg-input" placeholder="Message" oninput="handleTypingInput()" onkeypress="if(event.key==='Enter') sendMsg()">
      <button class="attach-btn slim-icon" onmousedown="startVoiceRecord()" onmouseup="stopVoiceRecord()" ontouchstart="startVoiceRecord()" ontouchend="stopVoiceRecord()">◉</button>
      <button class="send-btn" onclick="sendMsg()">➤</button>`;
  }
  const header = document.querySelector('.chat-header-left');
  if (header) header.setAttribute('role', 'button');
};

const _origOpenChat2 = openChat;
openChat = async function(name, id, pfp, isGroup, meta = {}) {
  await _origOpenChat2(name, id, pfp, isGroup, meta);
  const panel = byId('chat-panel');
  panel?.classList.add('chat-panel-live');
  const input = byId('msg-input');
  if (input) input.placeholder = isGroup ? `Message ${name}` : 'Message';
};

function bindDivineTapHandlers() {
  byId('chat-list')?.addEventListener('click', async (e) => {
    const row = e.target.closest('.chat-row');
    if (!row) return;
    const metaRaw = row.dataset.chatMeta ? decodeURIComponent(row.dataset.chatMeta) : '{}';
    let meta = {};
    try { meta = JSON.parse(metaRaw); } catch (e) {}
    await openChat(row.dataset.chatName || meta.name || '', row.dataset.chatId || meta.id || '', row.dataset.chatPfp || meta.pfp || '', row.dataset.chatGroup === '1', meta);
  });
  byId('suggestions')?.addEventListener('click', async (e) => {
    const row = e.target.closest('.suggestion-row');
    if (!row) return;
    let item = {};
    try { item = JSON.parse(decodeURIComponent(row.dataset.item || '%7B%7D')); } catch (e) {}
    await chooseSuggestion(item);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) {
      byId('suggestions')?.classList.remove('show');
    }
  });
}

window.addEventListener('load', bindDivineTapHandlers);


/* ---- Godly room polish patch ---- */
state.messageActionOpenId = null;

function shouldGroupWith(prev, curr) {
  return !!prev && !!curr && prev.sender_id === curr.sender_id;
}

function renderMessageList(msgs) {
  state.messageCache = {};
  const view = byId('messages-view');
  if (!view) return;
  view.innerHTML = (msgs || []).map((msg, index, arr) => godlyMessageHtml(msg, index, arr)).join('');
  bindMessageMenus();
}

function godlyActionButtons(data, sent) {
  return `
    <button onclick="prepareReplyById(${data.id})">Reply</button>
    <button onclick="openReactionPicker(${data.id}, this)">React</button>
    <button onclick="openForwardModal(${data.id})">Forward</button>
    <button onclick="saveMessageById(${data.id})">Save</button>
    <button onclick="translateMessageById(${data.id})">Translate</button>
    ${sent && !data.is_deleted ? `<button onclick="editMyMessage(${data.id})">Edit</button><button class="danger-action" onclick="deleteMyMessage(${data.id})">Delete</button>` : `<button class="danger-action" onclick="deleteMessageFromView(${data.id})">Delete</button>`}
    ${state.isCurrentChatGroup && ['owner','admin'].includes(state.currentRole) ? `<button onclick="pinMessage(${data.id})">Pin</button>` : ''}
  `;
}

function godlyMessageHtml(data, index = 0, arr = [data]) {
  state.messageCache[data.id] = data;
  const sent = data.sender_id === state.myID;
  const prev = arr[index - 1];
  const next = arr[index + 1];
  const samePrev = shouldGroupWith(prev, data);
  const sameNext = shouldGroupWith(data, next);
  const showAvatar = !sent && !samePrev;
  const showSender = !sent && state.isCurrentChatGroup && !samePrev;
  const showTime = !sameNext;
  const menuOpen = state.messageActionOpenId === data.id;
  const toggle = `<button class="msg-action-toggle ${sent ? 'left' : 'right'}" onclick="toggleMessageMenu(${data.id}, event)">⋯</button>`;
  return `
    <div class="msg-wrapper ${sent ? 'sent' : 'received'} ${samePrev ? 'grouped-prev' : ''} ${sameNext ? 'grouped-next' : ''}" data-msg-id="${data.id}">
      ${sent ? toggle : ''}
      ${showAvatar ? `<div class="avatar mini" style="background-image:${data.sender_pfp ? `url(${data.sender_pfp})` : 'none'}">${data.sender_pfp ? '' : escapeHtml(getInitial(data.sender_name))}</div>` : `<div class="avatar-spacer ${sent ? 'hidden-spacer' : ''}"></div>`}
      <div class="msg-stack">
        ${showSender ? `<div class="msg-sender">${escapeHtml(data.sender_name)}</div>` : ''}
        ${messageBodyHtml(data)}
        ${showTime ? `<div class="bubble-time">${formatTime(data.timestamp)} ${data.edited_at ? '· edited' : ''} ${deliveryLabel(data)}</div>` : ''}
        <div class="message-actions ${menuOpen ? '' : 'hidden'}" id="msg-actions-${data.id}">${godlyActionButtons(data, sent)}</div>
        <div class="reaction-row">${(data.reactions || []).map((r) => `<button class="reaction-pill" onclick="toggleReaction(${data.id}, '${r.emoji}')">${r.emoji} <span>${r.count}</span></button>`).join('')}</div>
      </div>
      ${sent ? '' : toggle}
    </div>`;
}

function toggleMessageMenu(id, event) {
  event?.stopPropagation();
  state.messageActionOpenId = state.messageActionOpenId === id ? null : id;
  const msgs = Object.values(state.messageCache).sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  renderMessageList(msgs);
  const view = byId('messages-view');
  if (view) view.scrollTop = view.scrollHeight;
}

function bindMessageMenus() {
  document.querySelectorAll('.message-actions').forEach((el) => {
    if (!el.id) return;
    if (el.classList.contains('hidden')) return;
  });
}

function saveMessageById(id) {
  const msg = state.messageCache[id];
  if (!msg) return;
  const exists = state.savedMessages.some((m) => m.id === id && m.room === state.activeRoom);
  if (exists) return showToast('Already saved');
  state.savedMessages.unshift({ ...msg, room: state.activeRoom });
  localStorage.setItem('fSavedMessages', JSON.stringify(state.savedMessages));
  showToast('Saved message');
}

function translateMessageById(id) {
  const msg = state.messageCache[id];
  if (!msg?.content) return showToast('No text to translate');
  navigator.clipboard?.writeText(msg.content);
  showToast('Text copied for translate');
}

const __prevRenderChatPanel = renderChatPanel;
renderChatPanel = function(name, pfp, isGroup) {
  const panel = byId('chat-panel');
  panel.className = 'chat-panel glass-card';
  panel.innerHTML = `
    <div class="chat-shell telegram-room-shell">
      <div class="chat-header telegram-room-header">
        <div class="chat-header-left clickable" onclick="openProfileSheet()">
          <button class="back-btn mobile-only" onclick="event.stopPropagation(); closeCurrentChat()">←</button>
          <div id="chat-header-avatar" class="avatar"></div>
          <div class="chat-header-meta">
            <strong id="chat-header-name"></strong>
            <p id="chat-status-text">Loading…</p>
          </div>
        </div>
        <div class="header-actions compact-actions">
          <button class="icon-btn" onclick="document.getElementById('media-upload').click()">📎</button>
          <button class="icon-btn" onclick="toggleHeaderDrawer(event)">⋯</button>
        </div>
      </div>
      <div id="header-drawer" class="header-drawer hidden">
        <div class="header-drawer-inner glass-card">
          <div class="header-drawer-top"><strong>Chat options</strong><button class="icon-btn" onclick="toggleHeaderDrawer(event, true)">✕</button></div>
          <div class="header-drawer-grid">
            <button class="telegram-row compact" onclick="openMediaGallery()">🖼️ Media</button>
            <button class="telegram-row compact" onclick="toggleArchiveCurrentChat()">🗃️ Archive</button>
            <button class="telegram-row compact" onclick="toggleMuteCurrentChat()">🔕 Mute</button>
            <button class="telegram-row compact" onclick="copyInviteLink()">🔗 Invite</button>
            <button class="telegram-row compact" onclick="openModal('theme-modal')">🎨 Theme</button>
            <button class="telegram-row compact" onclick="openProfileSheet()">👤 Profile</button>
          </div>
          <div class="header-search-row"><input id="chat-search-input" class="chat-search-input" placeholder="Search in this chat" oninput="filterMessagesInView()"></div>
        </div>
      </div>
      <div id="pin-banner" class="pin-banner hidden"></div>
      <div id="reply-preview" class="reply-preview hidden"></div>
      <div id="messages-view" class="messages-view"></div>
      <div class="chat-input-area telegram-composer">
        <button class="attach-btn" onclick="document.getElementById('media-upload').click()">📎</button>
        <input type="file" id="media-upload" class="hidden" multiple onchange="uploadMedia(event)">
        <input type="text" id="msg-input" placeholder="Message" oninput="handleTypingInput()" onkeypress="if(event.key==='Enter') sendMsg()">
        <button class="attach-btn slim-icon" onmousedown="startVoiceRecord()" onmouseup="stopVoiceRecord()" ontouchstart="startVoiceRecord()" ontouchend="stopVoiceRecord()">◉</button>
        <button class="send-btn" onclick="sendMsg()">➤</button>
      </div>
    </div>`;
  byId('chat-header-name').innerHTML = displayNameWithEmoji(name, meta?.premium_emoji || '');
  setAvatar(byId('chat-header-avatar'), name, pfp, meta?.profile_color || '');
}

function toggleHeaderTools(){ byId('header-tools')?.classList.toggle('hidden'); }
;

function toggleHeaderDrawer(event, forceClose = false) {
  event?.stopPropagation();
  const drawer = byId('header-drawer');
  if (!drawer) return;
  drawer.classList.toggle('hidden', forceClose ? true : !drawer.classList.contains('hidden'));
}

const __prevOpenChat = openChat;
openChat = async function(name, id, pfp, isGroup, meta = {}) {
  if (state.activeRoom) socket.emit('leave_chat', { room: state.activeRoom });
  state.currentTargetID = id;
  state.currentTargetName = name;
  state.currentTargetPFP = pfp || '';
  state.currentTargetBio = meta.bio || meta.description || '';
  state.currentTargetColor = meta.profile_color || '';
  state.currentTargetPremiumEmoji = meta.premium_emoji || '';
  state.currentTargetKind = meta.kind || (isGroup ? 'group' : 'private');
  state.currentRole = meta.role || 'member';
  state.isCurrentChatGroup = isGroup;
  state.replyTo = null;
  state.messageActionOpenId = null;
  renderChatPanel(name, pfp, isGroup);
  renderReplyPreview();
  const room = buildRoom(id, isGroup);
  state.activeRoom = room;
  socket.emit('join_chat', { room, user_id: state.myID });
  const res = await fetch(`/history/${encodeURIComponent(room)}`);
  const msgs = await res.json();
  renderMessageList(msgs);
  const draft = state.drafts[roomKey(id, isGroup)] || '';
  setTimeout(() => { const input = byId('msg-input'); if (input) input.value = draft; }, 0);
  const view = byId('messages-view');
  if (view) view.scrollTop = view.scrollHeight;
  if (isGroup) {
    const metaRes = await fetch(`/room_meta/${encodeURIComponent(id)}`);
    const metaData = await metaRes.json();
    if (metaData.status === 'success') {
      state.currentTargetBio = metaData.room.description || '';
      state.currentTargetKind = metaData.room.kind;
      state.roomVisibility = metaData.room.visibility || 'public';
      state.roomInviteToken = metaData.room.invite_token || '';
      showPinBanner(metaData.room.pin_message);
      updateChatHeaderStatus(`${metaData.room.kind} · ${metaData.room.member_count} members · ${state.roomVisibility}`);
    }
  } else {
    const pRes = await fetch(`/profile/${encodeURIComponent(id)}?viewer_id=${encodeURIComponent(state.myID)}`);
    const pdata = await pRes.json();
    if (pdata.status === 'success') {
      state.currentTargetBio = pdata.bio || '';
      updateChatHeaderStatus(formatRelativeStatus(pdata.last_seen_label || (pdata.online ? 'online' : 'offline')));
    }
  }
  renderRecentChats();
  document.body.classList.add('chat-room-open');
  if (isMobileLayout()) setMobileTab('chat');
};

const __prevCloseCurrentChat = closeCurrentChat;
closeCurrentChat = function() {
  document.body.classList.remove('chat-room-open');
  const drawer = byId('header-drawer');
  if (drawer) drawer.classList.add('hidden');
  __prevCloseCurrentChat();
};

const __prevRenderBubble = renderBubble;
renderBubble = function(data) {
  state.messageCache[data.id] = data;
  const msgs = Object.values(state.messageCache).sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  renderMessageList(msgs);
  const view = byId('messages-view');
  if (view) view.scrollTop = view.scrollHeight;
};

socket.off?.('new_message');
socket.on('new_message', (data) => {
  if (data.room === state.activeRoom) renderBubble(data);
  loadRecentChats();
});

socket.on('message_edited', (data) => {
  state.messageCache[data.id] = data;
  const msgs = Object.values(state.messageCache).sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  renderMessageList(msgs);
});

socket.on('room_receipts_updated', (payload) => {
  if (payload.room !== state.activeRoom) return;
  (payload.messages || []).forEach((msg) => { state.messageCache[msg.id] = msg; });
  const msgs = Object.values(state.messageCache).sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  renderMessageList(msgs);
});

window.addEventListener('click', (event) => {
  if (!event.target.closest('#header-drawer') && !event.target.closest('.header-actions')) byId('header-drawer')?.classList.add('hidden');
  if (!event.target.closest('.msg-action-toggle') && !event.target.closest('.message-actions')) {
    if (state.messageActionOpenId !== null) {
      state.messageActionOpenId = null;
      const msgs = Object.values(state.messageCache).sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
      if (msgs.length && byId('messages-view')) renderMessageList(msgs);
    }
  }
});

bindDivineTapHandlers = function() {
  const chatList = byId('chat-list');
  if (chatList && !chatList.dataset.boundTap) {
    chatList.dataset.boundTap = '1';
    chatList.addEventListener('click', async (e) => {
      const row = e.target.closest('.chat-row');
      if (!row) return;
      const metaRaw = row.dataset.chatMeta ? decodeURIComponent(row.dataset.chatMeta) : '{}';
      let meta = {};
      try { meta = JSON.parse(metaRaw); } catch (e) {}
      await openChat(row.dataset.chatName || meta.name || '', row.dataset.chatId || meta.id || '', row.dataset.chatPfp || meta.pfp || '', row.dataset.chatGroup === '1', meta);
    });
  }
  const sugg = byId('suggestions');
  if (sugg && !sugg.dataset.boundTap) {
    sugg.dataset.boundTap = '1';
    sugg.addEventListener('click', async (e) => {
      const row = e.target.closest('.suggestion-row');
      if (!row) return;
      let item = {};
      try { item = JSON.parse(decodeURIComponent(row.dataset.item || '%7B%7D')); } catch (e) {}
      await chooseSuggestion(item);
    });
  }
};

window.addEventListener('load', bindDivineTapHandlers);


let _lastTouchEnd = 0; document.addEventListener('touchend', (event) => { const now = Date.now(); if (now - _lastTouchEnd <= 300) event.preventDefault(); _lastTouchEnd = now; }, {passive:false});


// ---- final compact telegram patch ----
function recentRowDeleteButton(item){
  return `<button class="row-mini-btn" onclick="event.stopPropagation();deleteChatPrompt(${JSON.stringify(item.id)}, ${item.is_group ? 'true' : 'false'})">⌫</button>`;
}
recentChatRowHtml = function(item) {
  const kind = item.kind || (item.is_group ? 'group' : 'private');
  const badge = kind === 'channel' ? 'channel' : item.is_group ? 'group' : 'user';
  const statusText = item.is_group ? `${kind}${item.role ? ` · ${item.role}` : ''}` : formatRelativeStatus(item.last_seen_label || (item.online ? 'online' : 'offline'));
  const key = currentRoomKeyFor(item);
  const muted = state.mutedChats.has(key);
  const pinned = state.pinnedChats.has(key);
  return `
    <button type="button" class="chat-row ${pinned ? 'pinned-chat' : ''} ${state.currentTargetID === item.id && String(state.isCurrentChatGroup) === String(item.is_group) ? 'active' : ''}"
      data-chat-id="${escapeHtml(item.id)}"
      onclick='openChat(${JSON.stringify(item.name)}, ${JSON.stringify(item.id)}, ${JSON.stringify(item.pfp || '')}, ${item.is_group ? 'true' : 'false'}, ${JSON.stringify(item)})'>
      <div class="avatar-row-wrap">
        <div class="avatar ${!item.pfp ? 'auto' : ''}" style="background-image:${item.pfp ? `url(${item.pfp})` : 'none'};${(!item.pfp && item.profile_color) ? `background-color:${item.profile_color};` : ''}">${item.pfp ? '' : escapeHtml(getInitial(item.name))}</div>
        ${!item.is_group && item.online ? '<span class="online-dot"></span>' : ''}
      </div>
      <div class="chat-meta">
        <div class="row-between"><strong>${item.is_group ? escapeHtml(item.name) : displayNameWithEmoji(item.name, item.premium_emoji || '')}</strong><small>${formatTime(item.time)}</small></div>
        <p>${escapeHtml(item.last_msg || statusText)}</p>
        <small class="muted">${escapeHtml(statusText)}${muted ? ' · muted' : ''}</small>
      </div>
      <div class="chat-row-actions"><span class="tag">${badge}${muted ? ' · mute' : ''}</span>${recentRowDeleteButton(item)}</div>
    </button>`;
};

renderRecentChats = function(){
  const list = byId('chat-list'); if (!list) return;
  const filtered = state.recentChats.filter((item) => {
    const key = currentRoomKeyFor(item);
    const archived = state.archivedChats.has(key);
    const hidden = state.hiddenChats.has(key);
    if (hidden) return false;
    if (state.listFilter === 'archived') return archived;
    if (archived) return false;
    if (state.listFilter === 'all') return true;
    return (item.kind || (item.is_group ? 'group' : 'private')) === state.listFilter;
  }).sort((a,b)=> new Date(b.time||0)-new Date(a.time||0));
  list.innerHTML = filtered.length ? filtered.map(recentChatRowHtml).join('') : '<div class="empty-mini">No chats yet</div>';
};

renderChatPanel = function(name, pfp, isGroup) {
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
          <button class="icon-btn slim-icon" onclick="openMediaGallery()">▣</button>
          <button class="icon-btn slim-icon" onclick="document.getElementById('media-upload').click()">⌁</button>
          <button class="icon-btn slim-icon" onclick="toggleHeaderTools()">⋯</button>
        </div>
      </div>
      <div id="pin-banner" class="pin-banner hidden"></div>
      <div id="reply-preview" class="reply-preview hidden"></div>
      <div id="header-tools" class="chat-tools-bar hidden">
        <input id="chat-search-input" class="chat-search-input" placeholder="Search in this chat" oninput="filterMessagesInView()">
        <button class="icon-btn slim-icon" onclick="toggleArchiveCurrentChat()">⌗</button>
        <button class="icon-btn slim-icon" onclick="toggleMuteCurrentChat()">◌</button>
        ${isGroup ? '<button class="icon-btn slim-icon" onclick="deleteCurrentRoom()">⊘</button>' : ''}
      </div>
      <div id="messages-view" class="messages-view"></div>
      <div class="chat-input-area">
        <button class="attach-btn slim-icon" onclick="document.getElementById('media-upload').click()">＋</button>
        <input type="file" id="media-upload" class="hidden" multiple onchange="uploadMedia(event)">
        <button class="attach-btn slim-icon" onmousedown="startVoiceRecord()" onmouseup="stopVoiceRecord()" ontouchstart="startVoiceRecord()" ontouchend="stopVoiceRecord()">◉</button>
        <input type="text" id="msg-input" placeholder="Message" oninput="handleTypingInput()" onkeypress="if(event.key==='Enter') sendMsg()">
        <button class="send-btn" onclick="sendMsg()">➤</button>
      </div>
    </div>`;
  byId('chat-header-name').innerHTML = displayNameWithEmoji(name, state.currentTargetPremiumEmoji || '');
  setAvatar(byId('chat-header-avatar'), name, pfp, state.currentTargetColor || '');
};

openProfileSheet = function(){
  setAvatar(byId('sheet-avatar'), state.currentTargetName, state.currentTargetPFP, state.currentTargetColor || '');
  byId('sheet-name').innerHTML = displayNameWithEmoji(state.currentTargetName || 'User', state.currentTargetPremiumEmoji || '');
  byId('sheet-handle').textContent = state.isCurrentChatGroup ? state.currentTargetID : `@${state.currentTargetID}`;
  byId('sheet-kind').textContent = state.currentTargetKind;
  byId('sheet-bio').textContent = state.currentTargetBio || 'No description yet';
  byId('chat-profile-sheet').classList.remove('hidden');
};


function deleteMessageFromView(id) {
  const wrap = document.querySelector(`.msg-wrapper[data-msg-id="${id}"]`);
  if (!wrap) return;
  if (!confirm('Delete this message from your view?')) return;
  wrap.remove();
  delete state.messageCache[id];
  state.messageActionOpenId = null;
  showToast('Message removed');
}

(function setupInteractionGuards(){
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function (event) {
    const now = Date.now();
    if (now - lastTouchEnd <= 280) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  document.addEventListener('selectstart', function(e){
    if (e.target.closest('.bubble, .msg-wrapper, .msg-action-toggle, .attach-btn, .send-btn')) {
      e.preventDefault();
    }
  });

  document.addEventListener('contextmenu', function(e){
    if (e.target.closest('.bubble, .msg-wrapper, .msg-action-toggle, .attach-btn, .send-btn')) {
      e.preventDefault();
    }
  });
})();


// ---- compact recent chats swipe-delete refinement patch ----
function recentDeleteButtonHtml(item) {
  return `<button type="button" class="recent-delete-action" onclick="event.stopPropagation();deleteChatPrompt(${JSON.stringify(item.id)}, ${item.is_group ? 'true' : 'false'})">Delete</button>`;
}

recentChatRowHtml = function(item) {
  const kind = item.kind || (item.is_group ? 'group' : 'private');
  const badge = kind === 'channel' ? 'channel' : item.is_group ? 'group' : 'user';
  const statusText = item.is_group ? `${kind}${item.role ? ` · ${item.role}` : ''}` : formatRelativeStatus(item.last_seen_label || (item.online ? 'online' : 'offline'));
  const key = currentRoomKeyFor(item);
  const muted = state.mutedChats.has(key);
  const pinned = state.pinnedChats.has(key);
  const active = state.currentTargetID === item.id && String(state.isCurrentChatGroup) === String(item.is_group);
  const preview = escapeHtml(item.last_msg || statusText || 'No messages yet');
  const status = escapeHtml(statusText + (muted ? ' · muted' : ''));
  const meta = encodeURIComponent(JSON.stringify(item));
  return `
    <div class="recent-chat-shell ${pinned ? 'pinned-chat' : ''}" data-chat-id="${escapeHtml(item.id)}" data-group="${item.is_group ? '1' : '0'}">
      <button type="button" class="chat-row compact-row-card ${active ? 'active' : ''}"
        data-chat-id="${escapeHtml(item.id)}"
        data-chat-name="${escapeHtml(item.name)}"
        data-chat-pfp="${escapeHtml(item.pfp || '')}"
        data-chat-group="${item.is_group ? '1' : '0'}"
        data-chat-meta="${meta}">
        <div class="avatar-row-wrap">
          <div class="avatar ${!item.pfp ? 'auto' : ''}" style="background-image:${item.pfp ? `url(${item.pfp})` : 'none'};${(!item.pfp && item.profile_color) ? `background-color:${item.profile_color};` : ''}">${item.pfp ? '' : escapeHtml(getInitial(item.name))}</div>
          ${!item.is_group && item.online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="chat-meta compact-chat-meta">
          <div class="row-between compact-row-between">
            <strong>${item.is_group ? escapeHtml(item.name) : displayNameWithEmoji(item.name, item.premium_emoji || '')}</strong>
            <small>${formatTime(item.time)}</small>
          </div>
          <p class="chat-preview-line">${preview}</p>
          <div class="row-between compact-row-between bottom-meta">
            <small class="muted">${status}</small>
            <span class="tag compact-tag">${badge}</span>
          </div>
        </div>
      </button>
      ${recentDeleteButtonHtml(item)}
    </div>`;
};

renderRecentChats = function(){
  const list = byId('chat-list'); if (!list) return;
  const filtered = state.recentChats.filter((item) => {
    const key = currentRoomKeyFor(item);
    const archived = state.archivedChats.has(key);
    const hidden = state.hiddenChats.has(key);
    if (hidden) return false;
    if (state.listFilter === 'archived') return archived;
    if (archived) return false;
    if (state.listFilter === 'all') return true;
    return (item.kind || (item.is_group ? 'group' : 'private')) === state.listFilter;
  }).sort((a,b)=> new Date(b.time||0)-new Date(a.time||0));
  list.innerHTML = filtered.length ? filtered.map(recentChatRowHtml).join('') : '<div class="empty-mini">No chats yet</div>';
  bindRecentChatSwipe();
};

function closeAllRecentSwipes(exceptEl = null){
  document.querySelectorAll('.recent-chat-shell.open').forEach((el) => {
    if (exceptEl && el === exceptEl) return;
    el.classList.remove('open');
    el.style.setProperty('--swipe-x', '0px');
  });
}

function bindRecentChatSwipe(){
  const list = byId('chat-list');
  if (!list) return;
  list.querySelectorAll('.recent-chat-shell').forEach((shell) => {
    if (shell.dataset.swipeBound === '1') return;
    shell.dataset.swipeBound = '1';
    let startX = 0, startY = 0, dragging = false, locked = false, deltaX = 0;
    const main = shell.querySelector('.chat-row');
    const maxSwipe = 92;
    const setSwipe = (px) => shell.style.setProperty('--swipe-x', `${Math.max(-maxSwipe, Math.min(0, px))}px`);
    const onStart = (x,y) => { startX = x; startY = y; dragging = true; locked = false; deltaX = shell.classList.contains('open') ? -maxSwipe : 0; closeAllRecentSwipes(shell); };
    const onMove = (x,y,e) => {
      if (!dragging) return;
      const dx = x - startX;
      const dy = y - startY;
      if (!locked) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { dragging = false; return; }
        if (Math.abs(dx) < 8) return;
        locked = true;
      }
      e?.preventDefault?.();
      const base = shell.classList.contains('open') ? -maxSwipe : 0;
      setSwipe(base + dx);
      deltaX = base + dx;
    };
    const onEnd = () => {
      if (!dragging && !locked) return;
      dragging = false;
      const shouldOpen = deltaX < -36;
      shell.classList.toggle('open', shouldOpen);
      setSwipe(shouldOpen ? -maxSwipe : 0);
    };

    shell.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      onStart(t.clientX, t.clientY);
    }, {passive:true});
    shell.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      onMove(t.clientX, t.clientY, e);
    }, {passive:false});
    shell.addEventListener('touchend', onEnd, {passive:true});
    shell.addEventListener('mousedown', (e) => onStart(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY, e));
    window.addEventListener('mouseup', onEnd);

    main?.addEventListener('click', (e) => {
      if (shell.classList.contains('open')) {
        e.preventDefault();
        e.stopPropagation();
        shell.classList.remove('open');
        setSwipe(0);
      }
    }, true);
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.recent-chat-shell')) closeAllRecentSwipes();
});


/* ---- Godly divine merge patch: archive/theme/wallpaper/telegram actions ---- */
state.roomWallpaper = '';

function openArchivedManager(){
  const list = byId('archived-list');
  const archived = (state.recentChats || []).filter((item) => state.archivedChats.has(currentRoomKeyFor(item)));
  list.innerHTML = archived.length ? archived.map((item) => `
    <div class="forward-row">
      <div class="chat-meta"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.last_msg || item.description || 'Archived chat')}</p></div>
      <button class="base-btn mini-btn" onclick="void(0)">noop</button>
    </div>`).join('') : '<div class="empty-mini">No archived chats</div>';
  // replace noop buttons after render
  [...list.querySelectorAll('.mini-btn')].forEach((btn, idx) => {
    btn.textContent = 'Unarchive';
    btn.onclick = () => {
      const item = archived[idx];
      if (!item) return;
      const key = currentRoomKeyFor(item);
      state.archivedChats.delete(key);
      saveSet('fArchivedChats', state.archivedChats);
      openArchivedManager();
      renderRecentChats();
      showToast('Chat unarchived');
    };
  });
  openModal('archived-modal');
}

function unarchiveAllChats(){
  if (!state.archivedChats.size) return showToast('No archived chats');
  state.archivedChats = new Set();
  saveSet('fArchivedChats', state.archivedChats);
  renderRecentChats();
  openArchivedManager();
  showToast('All chats unarchived');
}

const __oldRenderThemeCards = renderThemeCards;
renderThemeCards = function(){
  __oldRenderThemeCards();
  const settings = byId('settings-theme-grid');
  if (settings) settings.innerHTML = '';
  const a = byId('theme-grad-a'), b = byId('theme-grad-b'), c = byId('theme-accent');
  const stored = JSON.parse(localStorage.getItem('fCustomTheme') || '{}');
  if (a) a.value = stored.a || '#101a27';
  if (b) b.value = stored.b || '#1d8cf8';
  if (c) c.value = stored.c || '#22d3ee';
};

function previewCustomTheme(){
  const a = byId('theme-grad-a')?.value || '#101a27';
  const b = byId('theme-grad-b')?.value || '#1d8cf8';
  const c = byId('theme-accent')?.value || '#22d3ee';
  document.documentElement.style.setProperty('--custom-theme-bg', `linear-gradient(180deg, ${a}, ${b})`);
  document.documentElement.style.setProperty('--custom-theme-accent', c);
}
function saveCustomTheme(){
  const payload = { a: byId('theme-grad-a')?.value || '#101a27', b: byId('theme-grad-b')?.value || '#1d8cf8', c: byId('theme-accent')?.value || '#22d3ee' };
  localStorage.setItem('fCustomTheme', JSON.stringify(payload));
  applyTheme('custom-gradient');
  previewCustomTheme();
  showToast('Custom theme saved');
}
function resetCustomTheme(){ localStorage.removeItem('fCustomTheme'); applyTheme('midnight-cyan'); showToast('Custom theme reset'); }

Object.assign(THEMES, { 'custom-gradient': { label:'Custom Gradient', color:'#101a27' } });
const __prevApplyTheme2 = applyTheme;
applyTheme = function(themeKey, persist = true){
  __prevApplyTheme2(themeKey, persist);
  if (themeKey === 'custom-gradient') {
    const stored = JSON.parse(localStorage.getItem('fCustomTheme') || '{}');
    document.body.dataset.theme = 'custom-gradient';
    document.documentElement.style.setProperty('--custom-theme-bg', `linear-gradient(180deg, ${stored.a || '#101a27'}, ${stored.b || '#1d8cf8'})`);
    document.documentElement.style.setProperty('--custom-theme-accent', stored.c || '#22d3ee');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', stored.a || '#101a27');
  }
};

const __prevOpenChat2 = openChat;
openChat = async function(name, id, pfp, isGroup, meta = {}){
  await __prevOpenChat2(name, id, pfp, isGroup, meta);
  state.roomWallpaper = meta.wallpaper || '';
  if (state.roomWallpaper) applyWallpaperSetting(state.roomWallpaper, false);
};

const __prevSaveRoomSettings2 = saveRoomSettings;
saveRoomSettings = async function(){
  const payload = { code: state.currentTargetID, actor_id: state.myID, public_handle: byId('room-public-handle')?.value.trim(), rules_text: byId('room-rules-text')?.value.trim(), welcome_message: byId('room-welcome-message')?.value.trim(), slow_mode_seconds: byId('room-slow-mode')?.value.trim(), join_approval: byId('room-join-approval')?.value === 'true', is_verified: byId('room-verified')?.value === 'true', wallpaper: byId('room-wallpaper-picker')?.value || '' };
  const res = await fetch('/update_room_settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not save room settings');
  state.roomInviteToken = data.room.invite_token || '';
  state.roomWallpaper = data.room.wallpaper || '';
  closeModal('room-settings-modal');
  await openChat(state.currentTargetName, state.currentTargetID, data.room.pfp || state.currentTargetPFP, state.isCurrentChatGroup, data.room);
  showToast('Room settings saved');
};

const __prevPrefillRoomSettings = prefillRoomSettings;
prefillRoomSettings = function(room = {}){
  __prevPrefillRoomSettings(room);
  let picker = byId('room-wallpaper-picker');
  if (!picker) {
    const anchor = byId('room-verified');
    if (anchor?.parentElement) {
      const label = document.createElement('label'); label.className='modal-label'; label.textContent='Shared room wallpaper';
      picker = document.createElement('select'); picker.id='room-wallpaper-picker'; picker.className='base-input';
      picker.innerHTML = Object.keys(WALLPAPERS).map(k=>`<option value="${k}">${k.replace(/-/g,' ')}</option>`).join('');
      anchor.parentElement.insertBefore(label, anchor.nextSibling);
      anchor.parentElement.insertBefore(picker, label.nextSibling);
      const pfpBtn = document.createElement('button'); pfpBtn.className='base-btn secondary'; pfpBtn.textContent='Change room photo'; pfpBtn.onclick = () => byId('room-pfp-upload').click();
      const pfpInput = document.createElement('input'); pfpInput.type='file'; pfpInput.id='room-pfp-upload'; pfpInput.accept='image/*'; pfpInput.className='hidden'; pfpInput.onchange = uploadRoomPfp;
      anchor.parentElement.appendChild(pfpBtn); anchor.parentElement.appendChild(pfpInput);
    }
  }
  if (picker) picker.value = room.wallpaper || 'aurora';
};

async function uploadRoomPfp(event){
  const file = event.target.files?.[0];
  if (!file || !state.currentTargetID) return;
  const form = new FormData(); form.append('photo', file); form.append('code', state.currentTargetID); form.append('actor_id', state.myID);
  const res = await fetch('/upload_room_pfp', { method:'POST', body: form });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Upload failed');
  state.currentTargetPFP = data.url || '';
  await openChat(state.currentTargetName, state.currentTargetID, state.currentTargetPFP, state.isCurrentChatGroup, data.room || {});
  showToast('Room photo updated');
}

function telegramMessageActions(data, sent){
  return `
    <button onclick="prepareReplyById(${data.id})">Reply</button>
    <button onclick="openReactionPicker(${data.id}, this)">React</button>
    <button onclick="openForwardModal(${data.id})">Forward</button>
    <button onclick="saveMessageById(${data.id})">Save</button>
    ${sent && !data.is_deleted ? `<button onclick="editMyMessage(${data.id})">Edit</button><button class="danger-action" onclick="deleteMyMessage(${data.id})">Delete</button>` : `<button class="danger-action" onclick="deleteMessageFromView(${data.id})">Delete</button>`}
    ${state.isCurrentChatGroup && ['owner','admin'].includes(state.currentRole) ? `<button onclick="pinMessage(${data.id})">Pin</button>` : ''}`;
}

function bindLongPressActions(){
  document.querySelectorAll('.msg-wrapper').forEach((wrap) => {
    if (wrap.dataset.lpBound === '1') return;
    wrap.dataset.lpBound = '1';
    let timer = null;
    const id = Number(wrap.dataset.msgId);
    const start = (e) => {
      if (e.target.closest('.reaction-pill, .message-actions button')) return;
      timer = setTimeout(() => {
        state.messageActionOpenId = id;
        const msgs = Object.values(state.messageCache).sort((a,b)=>new Date(a.timestamp||0)-new Date(b.timestamp||0));
        renderMessageList(msgs);
      }, 360);
    };
    const stop = () => { if (timer) clearTimeout(timer); timer = null; };
    wrap.addEventListener('touchstart', start, { passive:true });
    wrap.addEventListener('touchend', stop); wrap.addEventListener('touchcancel', stop);
    wrap.addEventListener('mousedown', start); wrap.addEventListener('mouseup', stop); wrap.addEventListener('mouseleave', stop);
    wrap.addEventListener('contextmenu', (e) => { e.preventDefault(); state.messageActionOpenId = id; const msgs = Object.values(state.messageCache).sort((a,b)=>new Date(a.timestamp||0)-new Date(b.timestamp||0)); renderMessageList(msgs); });
  });
}

const __prevRenderMessageList2 = renderMessageList;
renderMessageList = function(msgs){ __prevRenderMessageList2(msgs); bindLongPressActions(); };

godlyMessageHtml = function(data, index = 0, arr = [data]) {
  state.messageCache[data.id] = data;
  const sent = data.sender_id === state.myID;
  const prev = arr[index - 1];
  const next = arr[index + 1];
  const samePrev = shouldGroupWith(prev, data);
  const sameNext = shouldGroupWith(data, next);
  const showAvatar = !sent && !samePrev;
  const showSender = !sent && state.isCurrentChatGroup && !samePrev;
  const showTime = !sameNext;
  const menuOpen = state.messageActionOpenId === data.id;
  return `
    <div class="msg-wrapper ${sent ? 'sent' : 'received'} ${samePrev ? 'grouped-prev' : ''} ${sameNext ? 'grouped-next' : ''}" data-msg-id="${data.id}">
      ${showAvatar ? `<div class="avatar mini" style="background-image:${data.sender_pfp ? `url(${data.sender_pfp})` : 'none'}">${data.sender_pfp ? '' : escapeHtml(getInitial(data.sender_name))}</div>` : `<div class="avatar-spacer ${sent ? 'hidden-spacer' : ''}"></div>`}
      <div class="msg-stack">
        ${showSender ? `<div class="msg-sender">${escapeHtml(data.sender_name)}</div>` : ''}
        ${messageBodyHtml(data)}
        ${showTime ? `<div class="bubble-time">${formatTime(data.timestamp)} ${data.edited_at ? '· edited' : ''} ${deliveryLabel(data)}</div>` : ''}
        <div class="message-actions ${menuOpen ? '' : 'hidden'}" id="msg-actions-${data.id}">${telegramMessageActions(data, sent)}</div>
        <div class="reaction-row">${(data.reactions || []).map((r) => `<button class="reaction-pill" onclick="toggleReaction(${data.id}, '${r.emoji}')">${r.emoji} <span>${r.count}</span></button>`).join('')}</div>
      </div>
    </div>`;
};

renderChatPanel = function(name, pfp, isGroup) {
  const panel = byId('chat-panel');
  panel.className = 'chat-panel glass-card';
  panel.innerHTML = `
    <div class="chat-shell telegram-room-shell">
      <div class="chat-header telegram-room-header">
        <div class="chat-header-left clickable" onclick="openProfileSheet()">
          <button class="back-btn mobile-only" onclick="event.stopPropagation(); closeCurrentChat()">←</button>
          <div id="chat-header-avatar" class="avatar"></div>
          <div class="chat-header-meta">
            <strong id="chat-header-name"></strong>
            <p id="chat-status-text">Loading…</p>
          </div>
        </div>
        <div class="header-actions compact-actions">
          <button class="icon-btn" onclick="toggleHeaderDrawer(event)">⋯</button>
        </div>
      </div>
      <div id="header-drawer" class="header-drawer hidden">
        <div class="header-drawer-inner glass-card">
          <div class="header-drawer-top"><strong>Chat options</strong><button class="icon-btn" onclick="toggleHeaderDrawer(event, true)">✕</button></div>
          <div class="header-drawer-grid">
            <button class="telegram-row compact" onclick="openMediaGallery()">Media</button>
            <button class="telegram-row compact" onclick="toggleArchiveCurrentChat()">Archive</button>
            <button class="telegram-row compact" onclick="toggleMuteCurrentChat()">Mute</button>
            <button class="telegram-row compact" onclick="copyInviteLink()">Invite</button>
            <button class="telegram-row compact" onclick="openProfileSheet()">Profile</button>
          </div>
          <div class="header-search-row"><input id="chat-search-input" class="chat-search-input" placeholder="Search in this chat" oninput="filterMessagesInView()"></div>
        </div>
      </div>
      <div id="pin-banner" class="pin-banner hidden"></div>
      <div id="reply-preview" class="reply-preview hidden"></div>
      <div id="messages-view" class="messages-view"></div>
      <div class="chat-input-area telegram-composer">
        <button class="attach-btn" onclick="document.getElementById('media-upload').click()">＋</button>
        <input type="file" id="media-upload" class="hidden" multiple onchange="uploadMedia(event)">
        <input type="text" id="msg-input" placeholder="Message" oninput="handleTypingInput()" onkeypress="if(event.key==='Enter') sendMsg()">
        <button class="attach-btn slim-icon" onmousedown="startVoiceRecord()" onmouseup="stopVoiceRecord()" ontouchstart="startVoiceRecord()" ontouchend="stopVoiceRecord()">◉</button>
        <button class="send-btn" onclick="sendMsg()">➤</button>
      </div>
    </div>`;
  byId('chat-header-name').innerHTML = displayNameWithEmoji(name, state.currentTargetPremiumEmoji || '');
  setAvatar(byId('chat-header-avatar'), name, pfp, state.currentTargetColor || '');
};

// tighter search matching and cap 3 suggestions
const __prevDoSearch2 = doSearch;
doSearch = async function(){
  const q = byId('search-input')?.value.trim();
  const suggestions = byId('suggestions');
  if (!q) { suggestions.innerHTML=''; suggestions.classList.remove('show'); return; }
  const res = await fetch(`/search_suggestions?q=${encodeURIComponent(q)}&my_id=${encodeURIComponent(state.myID)}`);
  let rows = await res.json();
  const norm = q.toLowerCase();
  rows = (rows || []).filter((item) => {
    const fields = [item.name, item.id, item.public_handle, item.description].filter(Boolean).map(v => String(v).toLowerCase());
    return fields.some(v => v.startsWith(norm) || v.includes(` ${norm}`));
  }).slice(0,3);
  suggestions.classList.add('show');
  suggestions.innerHTML = rows.length ? rows.map((item)=>{
    const label = item.type === 'user' ? formatRelativeStatus(item.last_seen_label || (item.online ? 'online':'offline')) : (item.type === 'channel' ? 'Channel' : 'Group');
    return `<button type="button" class="suggestion-row" data-item="${encodeURIComponent(JSON.stringify(item))}"><div class="avatar-row-wrap"><div class="avatar" style="background-image:${item.pfp ? `url(${item.pfp})` : 'none'}">${item.pfp ? '' : escapeHtml(getInitial(item.name))}</div></div><div class="chat-meta"><strong>${item.type === 'user' ? displayNameWithEmoji(item.name, item.premium_emoji || '') : escapeHtml(item.name)}</strong><p>@${escapeHtml(item.id || '')}</p><small class="muted">${escapeHtml(label)}</small></div></button>`;
  }).join('') : '<div class="empty-mini">No suggestions</div>';
};


// ---- divine patch: no refresh, scrollable theme studio, media crop, slimmer recent list ----
(function(){
  let touchStartY = 0;
  document.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length) touchStartY = e.touches[0].clientY;
  }, {passive:true});
  document.addEventListener('touchmove', (e) => {
    const target = e.target.closest('.messages-view, .chat-list, .settings-panel, .modal-card, .theme-grid');
    if (!target) return;
    const currentY = e.touches && e.touches.length ? e.touches[0].clientY : 0;
    const pullingDown = currentY > touchStartY;
    if (pullingDown && target.scrollTop <= 0) e.preventDefault();
  }, {passive:false});
})();

function resolveWallpaperCss(value){
  if (!value) return WALLPAPERS.aurora;
  if (WALLPAPERS[value]) return WALLPAPERS[value];
  if (/^https?:|^\/|^data:image\//.test(value)) return `linear-gradient(rgba(255,255,255,.02), rgba(255,255,255,.02)), url(${value}) center/cover no-repeat`;
  return value;
}
const __prevApplyWallpaperSetting3 = applyWallpaperSetting;
applyWallpaperSetting = function(value, persist = true){
  state.wallpaper = value || 'aurora';
  document.body.style.setProperty('--chat-wallpaper', resolveWallpaperCss(state.wallpaper));
  if (persist) localStorage.setItem('fWallpaper', state.wallpaper);
  const picker = byId('wallpaper-picker');
  if (picker && WALLPAPERS[state.wallpaper]) picker.value = state.wallpaper;
};

const __prevOpenChat3 = openChat;
openChat = async function(name, id, pfp, isGroup, meta = {}){
  await __prevOpenChat3(name, id, pfp, isGroup, meta);
  state.roomWallpaper = meta.wallpaper || '';
  if (state.roomWallpaper) {
    document.body.style.setProperty('--chat-wallpaper', resolveWallpaperCss(state.roomWallpaper));
  } else {
    applyWallpaperSetting(state.wallpaper, false);
  }
};

const __prevMessageBodyHtml2 = messageBodyHtml;
messageBodyHtml = function(data){
  if (data.is_deleted) return '<div class="bubble deleted">Message deleted</div>';
  const bubbleClass = data.sender_id === state.myID ? 'sent' : 'received';
  const forwarded = data.forwarded_from ? `<div class="forward-label">Forwarded from ${escapeHtml(data.forwarded_from)}</div>` : '';
  const reply = data.reply_preview ? `<div class="reply-card"><strong>${escapeHtml(data.reply_preview.sender_name)}</strong><p>${escapeHtml(data.reply_preview.content || '[' + data.reply_preview.msg_type + ']')}</p></div>` : '';
  const cleanText = (data.content || '').trim();
  const safeText = cleanText && cleanText !== '[sticker]' ? `<div>${escapeHtml(cleanText).replaceAll('\n', '<br>')}</div>` : '';
  if (data.msg_type === 'image') return `<div class="bubble ${bubbleClass} image-wrap">${forwarded}${reply}<img class="message-media" src="${data.file_url}" alt="image">${safeText}</div>`;
  if (data.msg_type === 'video') return `<div class="bubble ${bubbleClass} video-wrap">${forwarded}${reply}<video class="message-media" src="${data.file_url}" controls playsinline></video>${safeText}</div>`;
  if (data.msg_type === 'audio') return `<div class="bubble ${bubbleClass} audio-wrap">${forwarded}${reply}<audio src="${data.file_url}" controls></audio>${safeText}</div>`;
  if (data.msg_type === 'file') return `<div class="bubble ${bubbleClass}">${forwarded}${reply}<a class="file-card" href="${data.file_url}" target="_blank"><span>📁</span><span>${escapeHtml(data.content || 'Open file')}</span></a></div>`;
  return `<div class="bubble ${bubbleClass}">${forwarded}${reply}${safeText}</div>`;
};

function ensureRoomSettingsEnhancements(){
  const picker = byId('room-wallpaper-picker');
  if (picker && !picker.options.length) {
    picker.innerHTML = Object.keys(WALLPAPERS).map(k => `<option value="${k}">${k[0].toUpperCase()+k.slice(1)}</option>`).join('');
  }
}
const __prevOpenModal2 = openModal;
openModal = function(id){
  __prevOpenModal2(id);
  if (id === 'room-settings-modal') ensureRoomSettingsEnhancements();
};

const __prevPrefillRoomSettings2 = prefillRoomSettings;
prefillRoomSettings = function(room={}){
  __prevPrefillRoomSettings2(room);
  ensureRoomSettingsEnhancements();
  const picker = byId('room-wallpaper-picker');
  if (picker) {
    if (WALLPAPERS[room.wallpaper || '']) picker.value = room.wallpaper;
    else picker.value = 'aurora';
    picker.dataset.currentWallpaper = room.wallpaper || '';
  }
};

const __prevSaveRoomSettings3 = saveRoomSettings;
saveRoomSettings = async function(){
  const picker = byId('room-wallpaper-picker');
  const wallpaperValue = (picker?.dataset.currentWallpaper || picker?.value || '').trim();
  const payload = { code: state.currentTargetID, actor_id: state.myID, public_handle: byId('room-public-handle')?.value.trim(), rules_text: byId('room-rules-text')?.value.trim(), welcome_message: byId('room-welcome-message')?.value.trim(), slow_mode_seconds: byId('room-slow-mode')?.value.trim(), join_approval: byId('room-join-approval')?.value === 'true', is_verified: byId('room-verified')?.value === 'true', wallpaper: wallpaperValue };
  const res = await fetch('/update_room_settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not save room settings');
  state.roomInviteToken = data.room.invite_token || '';
  state.roomWallpaper = data.room.wallpaper || '';
  closeModal('room-settings-modal');
  await openChat(state.currentTargetName, state.currentTargetID, data.room.pfp || state.currentTargetPFP, state.isCurrentChatGroup, data.room);
  showToast('Room settings saved');
};

async function uploadRoomWallpaper(event){
  const file = event.target.files?.[0];
  if (!file || !state.currentTargetID) return;
  const form = new FormData();
  form.append('photo', file); form.append('code', state.currentTargetID); form.append('actor_id', state.myID);
  const res = await fetch('/upload_room_wallpaper', { method:'POST', body: form });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Wallpaper upload failed');
  const picker = byId('room-wallpaper-picker');
  if (picker) picker.dataset.currentWallpaper = data.url || '';
  state.roomWallpaper = data.url || '';
  if (state.roomWallpaper) document.body.style.setProperty('--chat-wallpaper', resolveWallpaperCss(state.roomWallpaper));
  showToast('Room wallpaper updated');
  event.target.value = '';
}

state.mediaCropQueue = state.mediaCropQueue || [];
function setCropperModeUi(){
  const primary = byId('crop-primary-btn');
  const sticker = byId('crop-sticker-btn');
  const chooser = document.querySelector('#image-crop-card .modal-actions.two:last-child .base-btn.secondary:last-child');
  if (!primary || !sticker) return;
  if (state.cropper?.mode === 'media') {
    primary.textContent = 'Send photo';
    primary.onclick = sendCroppedMedia;
    sticker.classList.remove('hidden');
    if (chooser) { chooser.textContent = 'Choose another'; chooser.onclick = () => byId('media-upload')?.click(); }
  } else {
    primary.textContent = 'Save photo';
    primary.onclick = uploadCroppedPFP;
    sticker.classList.remove('hidden');
    if (chooser) { chooser.textContent = 'Choose another'; chooser.onclick = () => byId('pfp-upload')?.click(); }
  }
}
function handleCropPrimaryAction(){
  if (state.cropper?.mode === 'media') return sendCroppedMedia();
  return uploadCroppedPFP();
}
async function openMediaCropper(file){
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      state.cropper = { mode: 'media', img, fileName: file.name, mimeType: file.type || 'image/jpeg' };
      byId('crop-zoom').value = '1';
      byId('crop-x').value = '0';
      byId('crop-y').value = '0';
      setCropperModeUi();
      openModal('image-crop-modal');
      updateCropper();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
async function sendCroppedMedia(){
  if (!state.currentTargetID) return showToast('Open a chat first');
  const blob = await cropCanvasToBlob('image/jpeg', 0.94);
  if (!blob) return showToast('Could not crop image');
  const fd = new FormData();
  fd.append('file', new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
  const res = await fetch('/upload', { method:'POST', body: fd });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Upload failed');
  socket.emit('private_message', { room: buildRoom(state.currentTargetID, state.isCurrentChatGroup), sender_id: state.myID, sender_name: state.myName, target_id: state.currentTargetID, is_group: state.isCurrentChatGroup, msg_type: 'image', content: '', file_url: data.url, reply_to_id: state.replyTo?.id || null });
  closeImageCropper();
  showToast('Photo sent');
}
const __prevOpenPfpCropper3 = openPfpCropper;
openPfpCropper = function(event){ __prevOpenPfpCropper3(event); setTimeout(setCropperModeUi, 0); };
const __prevUploadMedia2 = uploadMedia;
uploadMedia = async function(event){
  const files = [...(event.target.files || [])];
  event.target.value = '';
  if (!files.length || !state.currentTargetID) return;
  for (const file of files) {
    if ((file.type || '').startsWith('image/')) {
      await openMediaCropper(file);
      return;
    }
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/upload', { method:'POST', body: fd });
    const data = await res.json();
    if (data.status !== 'success') { showToast(data.message || 'Upload failed'); continue; }
    socket.emit('private_message', { room: buildRoom(state.currentTargetID, state.isCurrentChatGroup), sender_id: state.myID, sender_name: state.myName, target_id: state.currentTargetID, is_group: state.isCurrentChatGroup, msg_type: data.type, content: data.type === 'file' ? file.name : '', file_url: data.url, reply_to_id: state.replyTo?.id || null });
  }
  clearReply();
};

recentChatRowHtml = function(item) {
  const kind = item.kind || (item.is_group ? 'group' : 'private');
  const badge = kind === 'channel' ? 'channel' : item.is_group ? 'group' : 'user';
  const statusText = item.is_group ? `${kind}${item.role ? ` · ${item.role}` : ''}` : formatRelativeStatus(item.last_seen_label || (item.online ? 'online' : 'offline'));
  const key = currentRoomKeyFor(item);
  const muted = state.mutedChats.has(key);
  const pinned = state.pinnedChats.has(key);
  const active = state.currentTargetID === item.id && String(state.isCurrentChatGroup) === String(item.is_group);
  const preview = escapeHtml(item.last_msg || statusText || 'No messages yet');
  const status = escapeHtml(statusText + (muted ? ' · muted' : ''));
  const meta = encodeURIComponent(JSON.stringify(item));
  return `
    <div class="recent-chat-shell ${pinned ? 'pinned-chat' : ''}" data-chat-id="${escapeHtml(item.id)}" data-group="${item.is_group ? '1' : '0'}">
      <button type="button" class="chat-row compact-row-card ${active ? 'active' : ''}"
        data-chat-id="${escapeHtml(item.id)}"
        data-chat-name="${escapeHtml(item.name)}"
        data-chat-pfp="${escapeHtml(item.pfp || '')}"
        data-chat-group="${item.is_group ? '1' : '0'}"
        data-chat-meta="${meta}">
        <div class="avatar-row-wrap">
          <div class="avatar ${!item.pfp ? 'auto' : ''}" style="background-image:${item.pfp ? `url(${item.pfp})` : 'none'};${(!item.pfp && item.profile_color) ? `background-color:${item.profile_color};` : ''}">${item.pfp ? '' : escapeHtml(getInitial(item.name))}</div>
          ${!item.is_group && item.online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="chat-meta compact-chat-meta">
          <div class="row-between compact-row-between">
            <strong>${item.is_group ? escapeHtml(item.name) : displayNameWithEmoji(item.name, item.premium_emoji || '')}</strong>
            <small>${formatTime(item.time)}</small>
          </div>
          <p class="chat-preview-line">${preview}</p>
        </div>
      </button>
      ${recentDeleteButtonHtml(item)}
    </div>`;
};

// ---- Divine settings collapsing hero patch ----
const PROFILE_COLOR_PRESETS = [
  ['#8ec5ff','#d3f0ff'], ['#f472b6','#ffd0ea'], ['#7c3aed','#22d3ee'], ['#10b981','#9cf9d7'],
  ['#f97316','#ffd8b3'], ['#ef4444','#fecaca'], ['#0f172a','#334155'], ['#d4a84f','#f6e3a8']
];

function hexToRgb(hex){
  const v = String(hex||'').replace('#','');
  const s = v.length===3 ? v.split('').map(c=>c+c).join('') : v;
  const n = parseInt(s || '000000', 16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}
function rgbToHex(r,g,b){ return '#' + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join(''); }
function mixHex(a,b,t){ const A=hexToRgb(a), B=hexToRgb(b); return rgbToHex(A.r+(B.r-A.r)*t, A.g+(B.g-A.g)*t, A.b+(B.b-A.b)*t); }
function lightenHex(hex, amount=.35){ return mixHex(hex, '#ffffff', amount); }
function darkenHex(hex, amount=.18){ return mixHex(hex, '#000000', amount); }
function applyProfileAccent(color){
  const base = color || state.myProfileColor || '#8ec5ff';
  const soft = lightenHex(base, .36);
  document.documentElement.style.setProperty('--profile-accent', base);
  document.documentElement.style.setProperty('--profile-accent-2', soft);
  const hero = byId('settings-hero-bg');
  if (hero) hero.style.background = `radial-gradient(120px 120px at 20% 20%, rgba(255,255,255,.25), transparent 60%), radial-gradient(180px 180px at 80% 18%, rgba(255,255,255,.18), transparent 62%), linear-gradient(180deg, ${soft}, ${base})`;
}
async function syncProfileColor(){
  if (!state.myID) return;
  try {
    await fetch('/update_profile', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tele_id: state.myID, username: state.myName, bio: state.myBio || '', theme: state.myTheme, status_text: state.myStatusText || '', profile_music: state.myProfileMusic || '', mood: state.myMood || '', birthday: state.myBirthday || '', banner_url: state.myBannerUrl || '', profile_color: state.myProfileColor || '#8ec5ff', premium_emoji: state.myPremiumEmoji || '', privacy_last_seen: state.privacyLastSeen })});
  } catch(e){}
}
function renderProfileColorGrid(){
  const grid = byId('profile-color-grid'); if (!grid) return;
  const colors = [...PROFILE_COLOR_PRESETS, [state.myProfileColor || '#8ec5ff', lightenHex(state.myProfileColor || '#8ec5ff', .4)]];
  grid.innerHTML = colors.map(([a,b],idx)=>`<button class="theme-card ${state.myProfileColor===a?'active':''}" onclick="pickProfileColor('${a}')"><span class="theme-swatch" style="background:linear-gradient(135deg, ${a}, ${b})"></span><span>${idx===colors.length-1?'Current':'Gradient '+(idx+1)}</span></button>`).join('');
  if (byId('profile-color-custom')) byId('profile-color-custom').value = state.myProfileColor || '#8ec5ff';
}
window.pickProfileColor = function(color){ state.myProfileColor = color; localStorage.setItem('fProfileColor', color); renderProfileColorGrid(); hydrateProfile(); applyProfileAccent(color); };
window.applyProfileColorCustom = function(){ const val = byId('profile-color-custom')?.value || '#8ec5ff'; pickProfileColor(val); };
window.saveProfileColorSelection = async function(){ await syncProfileColor(); closeModal('profile-color-modal'); showToast('Profile colour saved'); };

async function extractDominantColorFromUrl(url){
  return new Promise((resolve)=>{
    const img = new Image(); img.crossOrigin='anonymous';
    img.onload = () => {
      const c = document.createElement('canvas'); const size = 32; c.width = size; c.height = size;
      const ctx = c.getContext('2d', { willReadFrequently:true });
      ctx.drawImage(img,0,0,size,size);
      const data = ctx.getImageData(0,0,size,size).data; let r=0,g=0,b=0,count=0;
      for (let i=0;i<data.length;i+=16){ const a=data[i+3]; if (a<80) continue; r+=data[i]; g+=data[i+1]; b+=data[i+2]; count++; }
      if (!count) return resolve('#8ec5ff');
      resolve(rgbToHex(r/count,g/count,b/count));
    };
    img.onerror = () => resolve('#8ec5ff');
    img.src = url;
  });
}

const __prevHydrateProfileDivine = hydrateProfile;
hydrateProfile = function(){
  __prevHydrateProfileDivine();
  applyProfileAccent(state.myProfileColor || '#8ec5ff');
  renderProfileColorGrid();
  const own = byId('settings-hero-avatar-btn');
  if (own) own.onclick = () => { byId('pfp-viewer-name').textContent = state.myName || 'Profile photo'; if (!state.myPFP) return showToast('No photo'); byId('pfp-viewer-img').src = state.myPFP; byId('pfp-viewer').classList.remove('hidden'); };
};

const __prevUploadCroppedPFP = uploadCroppedPFP;
uploadCroppedPFP = async function(){
  await __prevUploadCroppedPFP();
  if (state.myPFP) {
    const dominant = await extractDominantColorFromUrl(state.myPFP);
    state.myProfileColor = darkenHex(dominant, .06);
    localStorage.setItem('fProfileColor', state.myProfileColor);
    applyProfileAccent(state.myProfileColor);
    renderProfileColorGrid();
    await syncProfileColor();
    hydrateProfile();
  }
};

const __prevSaveProfileDivine = saveProfile;
saveProfile = async function(){
  await __prevSaveProfileDivine();
  applyProfileAccent(state.myProfileColor || '#8ec5ff');
  renderProfileColorGrid();
};

(function initSettingsHero(){
  const panel = byId('settings-view');
  const hero = byId('settings-hero');
  if (!panel || !hero) return;
  let raf = null;
  const onScroll = () => {
    const t = panel.scrollTop || 0;
    const collapse = Math.max(0, Math.min(1, t / 170));
    panel.style.setProperty('--settings-collapse', collapse.toFixed(3));
    hero.classList.toggle('shrunk', collapse > .78);
    if (!raf) raf = requestAnimationFrame(()=>{ raf=null; });
  };
  panel.addEventListener('scroll', onScroll, { passive:true });
  let startY = 0;
  panel.addEventListener('touchstart', e => { if (panel.scrollTop <= 0 && e.touches[0]) startY = e.touches[0].clientY; }, { passive:true });
  panel.addEventListener('touchmove', e => {
    if (panel.scrollTop > 0 || !e.touches[0]) { panel.style.setProperty('--settings-stretch', '0'); return; }
    const delta = Math.max(0, e.touches[0].clientY - startY);
    panel.style.setProperty('--settings-stretch', Math.min(.9, delta / 180).toFixed(3));
  }, { passive:true });
  panel.addEventListener('touchend', () => panel.style.setProperty('--settings-stretch', '0'), { passive:true });
  onScroll();
})();

const __prevOpenProfileSheetDivine = openProfileSheet;
openProfileSheet = function(){
  __prevOpenProfileSheetDivine();
  const hero = byId('sheet-hero');
  if (!hero) return;
  const base = state.currentTargetColor || state.myProfileColor || '#8ec5ff';
  const soft = lightenHex(base, .35);
  hero.style.background = `radial-gradient(120px 120px at 20% 20%, rgba(255,255,255,.22), transparent 60%), radial-gradient(170px 170px at 80% 12%, rgba(255,255,255,.14), transparent 62%), linear-gradient(180deg, ${soft}, ${base})`;
};

// render grid after boot
setTimeout(()=>{ renderProfileColorGrid(); applyProfileAccent(state.myProfileColor || '#8ec5ff'); }, 30);


// ---- In-app notifications + unread badges patch ----
state.unreadCounts = JSON.parse(localStorage.getItem('fUnreadCounts') || '{}');
state.inappBannerTimers = {};
function saveUnreadCounts(){ localStorage.setItem('fUnreadCounts', JSON.stringify(state.unreadCounts || {})); }
function getChatKey(itemOrId, isGroup){
  if (typeof itemOrId === 'object' && itemOrId) return currentRoomKeyFor(itemOrId);
  return `${isGroup ? 'group' : 'dm'}:${itemOrId}`;
}
function markCurrentChatRead(){
  if (!state.currentTargetID) return;
  const key = getChatKey(state.currentTargetID, state.isCurrentChatGroup);
  if (state.unreadCounts[key]) {
    delete state.unreadCounts[key];
    saveUnreadCounts();
    renderRecentChats();
    refreshTabBadges();
  }
}
function totalUnreadCount(){ return Object.values(state.unreadCounts || {}).reduce((a,b)=>a+(Number(b)||0),0); }
function refreshTabBadges(){
  const total = totalUnreadCount();
  document.querySelectorAll('.mobile-tab-btn[data-tab="chats"], .mobile-tab-btn[data-tab="chat"]').forEach((btn)=>{
    let badge = btn.querySelector('.tab-badge');
    if (!badge) { badge = document.createElement('span'); badge.className='tab-badge'; btn.appendChild(badge); }
    if (total > 0) { badge.textContent = total > 99 ? '99+' : String(total); btn.classList.add('has-badge'); }
    else { badge.textContent=''; btn.classList.remove('has-badge'); }
  });
}
function ensureBannerHost(){
  let host = byId('top-inapp-stack');
  if (!host) {
    host = document.createElement('div');
    host.id = 'top-inapp-stack';
    host.className = 'top-inapp-stack';
    document.body.appendChild(host);
  }
  return host;
}
function showInAppBanner(payload){
  const key = getChatKey(payload.id, payload.is_group);
  if (state.mutedChats?.has(key)) return;
  const host = ensureBannerHost();
  const card = document.createElement('button');
  card.className = 'inapp-banner';
  card.type = 'button';
  card.innerHTML = `<div class="avatar" style="background-image:${payload.pfp ? `url(${payload.pfp})` : 'none'};${(!payload.pfp && payload.profile_color) ? `background-color:${payload.profile_color};` : ''}">${payload.pfp ? '' : escapeHtml(getInitial(payload.name || 'U'))}</div><div class="chat-meta"><strong>${escapeHtml(payload.name || 'New message')}</strong><p>${escapeHtml(payload.preview || 'New message')}</p><small class="mini-muted">Tap to open</small></div>`;
  card.onclick = async () => {
    card.remove();
    await openChat(payload.name, payload.id, payload.pfp || '', payload.is_group, payload.meta || {});
  };
  host.appendChild(card);
  clearTimeout(state.inappBannerTimers[key]);
  state.inappBannerTimers[key] = setTimeout(() => card.remove(), 3500);
}
function updateUnreadForMessage(msg){
  if (!msg?.room) return;
  const isGroup = msg.room.startsWith('group_');
  const targetId = isGroup ? msg.room.replace('group_','') : (msg.sender_id === state.myID ? null : msg.sender_id);
  if (!targetId) return;
  const key = getChatKey(targetId, isGroup);
  if (state.activeRoom === msg.room) return markCurrentChatRead();
  state.unreadCounts[key] = (state.unreadCounts[key] || 0) + 1;
  saveUnreadCounts();
  refreshTabBadges();
  renderRecentChats();
  const payload = {
    id: targetId,
    is_group: isGroup,
    name: isGroup ? (state.recentChats.find(c => c.id === targetId && c.is_group)?.name || msg.sender_name || 'Group') : (msg.sender_name || targetId),
    pfp: state.recentChats.find(c => c.id === targetId && String(c.is_group) === String(isGroup))?.pfp || '',
    profile_color: state.recentChats.find(c => c.id === targetId && String(c.is_group) === String(isGroup))?.profile_color || '',
    preview: msg.msg_type === 'text' ? (msg.content || 'New message') : `[${msg.msg_type}]`,
    meta: state.recentChats.find(c => c.id === targetId && String(c.is_group) === String(isGroup)) || { id: targetId, is_group: isGroup }
  };
  showInAppBanner(payload);
}
const __prevRenderRecentChatsNotify = renderRecentChats;
renderRecentChats = function(){
  __prevRenderRecentChatsNotify();
  document.querySelectorAll('.recent-chat-shell').forEach((shell)=>{
    const id = shell.dataset.chatId; const isGroup = shell.dataset.group === '1';
    const key = getChatKey(id, isGroup);
    const count = state.unreadCounts[key] || 0;
    let pill = shell.querySelector('.unread-pill');
    if (!pill && count > 0) { pill = document.createElement('span'); pill.className='unread-pill'; shell.querySelector('.chat-meta .row-between')?.appendChild(pill); }
    if (pill) {
      if (count > 0) { pill.textContent = count > 99 ? '99+' : String(count); }
      else pill.remove();
    }
  });
  refreshTabBadges();
};
const __prevOpenChatNotify = openChat;
openChat = async function(name,id,pfp,isGroup,meta={}){ await __prevOpenChatNotify(name,id,pfp,isGroup,meta); markCurrentChatRead(); };
const __prevCloseCurrentChatNotify = closeCurrentChat;
closeCurrentChat = function(){ __prevCloseCurrentChatNotify(); refreshTabBadges(); };
const __origSocketNewMessage = socket.listeners && socket.listeners('new_message');
socket.on('new_message', (data) => {
  if (data.room === state.activeRoom) renderBubble(data);
  else updateUnreadForMessage(data);
  loadRecentChats();
});
window.addEventListener('load', refreshTabBadges);
