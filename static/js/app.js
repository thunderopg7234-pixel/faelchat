const socket = io();

const state = {
  myID: localStorage.getItem('fID') || '',
  myName: localStorage.getItem('fName') || '',
  myPFP: localStorage.getItem('fPFP') || '',
  myBio: localStorage.getItem('fBio') || '',
  currentTargetID: '',
  currentTargetName: '',
  currentTargetPFP: '',
  currentTargetKind: 'private',
  currentStatusText: '',
  mobileTab: 'chats',
  isSignUp: false,
  profileCache: {},
  typingTimer: null,
  sentTyping: false,
  unread: JSON.parse(localStorage.getItem('fUnread') || '{}'),
  deferredInstallPrompt: null,
  theme: localStorage.getItem('fTheme') || 'default',
};

const byId = (id) => document.getElementById(id);

function saveUnread() { localStorage.setItem('fUnread', JSON.stringify(state.unread)); }
function markUnread(room, increment = true) {
  if (!room) return;
  state.unread[room] = increment ? (Number(state.unread[room] || 0) + 1) : Number(state.unread[room] || 0);
  saveUnread();
}
function clearUnread(room) {
  if (!room) return;
  delete state.unread[room];
  saveUnread();
}
function applyTheme(theme = state.theme) {
  state.theme = theme;
  localStorage.setItem('fTheme', theme);
  document.body.dataset.theme = theme;
  const btn = byId('theme-toggle-btn');
  if (btn) btn.textContent = theme === 'midnight' ? '☀️ Light look' : '🌙 Midnight';
}
function ensureUtilityButtons() {
  const settingsTop = document.querySelector('.settings-top');
  if (settingsTop && !byId('theme-toggle-btn')) {
    const btn = document.createElement('button');
    btn.id = 'theme-toggle-btn';
    btn.className = 'base-btn secondary theme-toggle';
    btn.type = 'button';
    btn.onclick = () => applyTheme(state.theme === 'midnight' ? 'default' : 'midnight');
    settingsTop.appendChild(btn);
  }
  applyTheme(state.theme);
}
function ensureInstallBanner() {
  if (byId('install-banner')) return;
  const app = byId('main-app');
  if (!app) return;
  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.className = 'install-banner glass-card hidden';
  banner.innerHTML = `<div><strong>Install FelChat</strong><p>Open it fullscreen like a real app.</p></div><div class="install-actions"><button class="base-btn secondary mini-btn" id="install-later-btn" type="button">Later</button><button class="base-btn mini-btn" id="install-now-btn" type="button">Install</button></div>`;
  app.parentNode.insertBefore(banner, app);
  byId('install-later-btn').onclick = () => banner.classList.add('hidden');
  byId('install-now-btn').onclick = async () => {
    if (state.deferredInstallPrompt) {
      state.deferredInstallPrompt.prompt();
      try { await state.deferredInstallPrompt.userChoice; } catch (e) {}
      state.deferredInstallPrompt = null;
      banner.classList.add('hidden');
    } else {
      showToast('Use Add to Home Screen in your browser menu');
    }
  };
}
function updateInstallBanner() {
  const banner = byId('install-banner');
  if (!banner) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  banner.classList.toggle('hidden', standalone || (!state.deferredInstallPrompt && !/iphone|ipad|ipod/i.test(navigator.userAgent)));
}

if (window.__IS_STANDALONE__) {
  document.body.classList.add('standalone-mode');
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/static/sw.js').catch(() => {});
  });
}
const escapeHtml = (str = '') => String(str)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function normalizeHandle(value = '') {
  return value.trim().replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
}
function getInitial(name = '?') { return (name || '?').trim().charAt(0).toUpperCase(); }
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
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 2400);
}
function isMobileLayout() { return window.innerWidth <= 980; }
function kindLabel(kind) {
  if (kind === 'group') return 'Group chat';
  if (kind === 'channel') return 'Channel';
  return 'Private chat';
}
function buildRoom(id, kind) {
  if (kind === 'group') return `group_${id}`;
  if (kind === 'channel') return `channel_${id}`;
  return [state.myID, id].sort().join('_');
}
function formatTime(iso, full = false) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (full) {
    return d.toLocaleString([], { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
  }
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function formatPresence(isOnline, lastSeenAt) {
  if (isOnline) return 'Online';
  if (!lastSeenAt) return 'Offline';
  return `Last seen ${formatTime(lastSeenAt, true)}`;
}

function toggleAuth(forceSignUp = null) {
  state.isSignUp = forceSignUp === null ? !state.isSignUp : Boolean(forceSignUp);
  byId('display-name-wrap').classList.toggle('hidden', !state.isSignUp);
  byId('abtn').textContent = state.isSignUp ? 'Create Account' : 'Log In';
  byId('auth-title').textContent = state.isSignUp ? 'Create your account' : 'Welcome back';
  byId('auth-subtitle').textContent = state.isSignUp ? 'Sign up with a display name, @username, and password.' : 'Log in with your @username and password.';
  byId('auth-switch-text').textContent = state.isSignUp ? 'Already have an account?' : 'Don’t have an account?';
  byId('auth-switch-link').textContent = state.isSignUp ? 'Log in' : 'Sign up';
}
function switchToSignUp() {
  logout(false);
  toggleAuth(true);
}

async function handleAuth() {
  const username = byId('aname').value.trim();
  const tele_id = normalizeHandle(byId('aid').value);
  const password = byId('apass').value.trim();
  if (!tele_id || !password || (state.isSignUp && !username)) {
    showToast('Fill all fields');
    return;
  }
  const route = state.isSignUp ? '/signup' : '/login';
  const res = await fetch(route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, tele_id, password })
  });
  const data = await res.json();
  if (data.status !== 'success') {
    showToast(data.message || 'Could not continue');
    return;
  }
  state.myID = data.tele_id;
  state.myName = data.username;
  state.myPFP = data.pfp || '';
  state.myBio = data.bio || '';
  localStorage.setItem('fID', state.myID);
  localStorage.setItem('fName', state.myName);
  localStorage.setItem('fPFP', state.myPFP);
  localStorage.setItem('fBio', state.myBio);
  byId('aid').value = '';
  byId('apass').value = '';
  byId('aname').value = '';
  startSession();
}

function hydrateProfile() {
  byId('auth-screen').classList.add('hidden');
  byId('main-app').classList.remove('hidden');
  byId('mobile-tabbar').classList.remove('hidden');
  byId('settings-fullname').textContent = state.myName;
  byId('settings-fullname-2').textContent = state.myName;
  byId('settings-id').textContent = `@${state.myID}`;
  byId('settings-id-2').textContent = `@${state.myID}`;
  byId('settings-bio').textContent = state.myBio || 'No bio yet';
  byId('edit-display-name').value = state.myName;
  byId('edit-bio').value = state.myBio || '';
  setAvatar(byId('settings-pfp-icon'), state.myName, state.myPFP);
  setAvatar(byId('settings-mini-avatar'), state.myName, state.myPFP);
  ensureUtilityButtons();
  ensureInstallBanner();
  updateInstallBanner();
  setMobileTab(state.currentTargetID && isMobileLayout() ? 'chat' : 'chats');
}

async function startSession() {
  hydrateProfile();
  socket.emit('presence_online', { my_id: state.myID });
  await loadRecentChats();
}

function logout(show = true) {
  if (state.myID) socket.emit('presence_offline', { my_id: state.myID });
  Object.assign(state, { myID: '', myName: '', myPFP: '', myBio: '', currentTargetID: '', currentTargetName: '', currentTargetPFP: '', currentTargetKind: 'private' });
  localStorage.removeItem('fID');
  localStorage.removeItem('fName');
  localStorage.removeItem('fPFP');
  localStorage.removeItem('fBio');
  byId('auth-screen').classList.remove('hidden');
  byId('main-app').classList.add('hidden');
  byId('mobile-tabbar').classList.add('hidden');
  document.body.classList.remove('chat-open');
  byId('chat-panel').className = 'chat-panel glass-card empty-state';
  byId('chat-panel').innerHTML = `<div class="empty-center"><div class="empty-icon">💬</div><h3>Select a chat</h3><p>Search a user, open a recent chat, create a group, or launch your own channel.</p></div>`;
  if (show) showToast('Logged out');
}

function setMobileTab(tab) {
  state.mobileTab = tab;
  const main = byId('main-app');
  main.dataset.mobileTab = tab;
  ['chats', 'chat', 'settings'].forEach((name) => byId(`tab-btn-${name}`)?.classList.toggle('active', name === tab));
  document.body.classList.toggle('chat-open', tab === 'chat' && isMobileLayout() && Boolean(state.currentTargetID));
}
function closeCurrentChat() {
  state.currentTargetID = '';
  document.body.classList.remove('chat-open');
  setMobileTab('chats');
}
function openModal(id) { byId(id).classList.remove('hidden'); }
function closeModal(id) { byId(id).classList.add('hidden'); }

async function saveProfile() {
  const username = byId('edit-display-name').value.trim();
  const bio = byId('edit-bio').value.trim();
  if (!username) return showToast('Display name is required');
  const res = await fetch('/update_profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tele_id: state.myID, username, bio })
  });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not update profile');
  state.myName = data.username;
  state.myBio = data.bio || '';
  localStorage.setItem('fName', state.myName);
  localStorage.setItem('fBio', state.myBio);
  hydrateProfile();
  closeModal('profile-modal');
  await loadRecentChats();
  showToast('Profile updated');
}

async function loadRecentChats() {
  if (!state.myID) return;
  const res = await fetch(`/recent_chats/${encodeURIComponent(state.myID)}`);
  const chats = await res.json();
  const list = byId('chat-list');
  list.innerHTML = '';
  chats.forEach((chat) => {
    const row = document.createElement('button');
    row.className = 'chat-row';
    row.dataset.chatId = chat.id;
    row.dataset.kind = chat.kind;
    row.onclick = () => openChat(chat.name, chat.id, chat.pfp, chat.kind, chat);
    row.innerHTML = `
      <div class="avatar-stack">
        <div class="avatar" id="avatar-${chat.kind}-${chat.id}"></div>
        ${chat.kind === 'private' && chat.is_online ? '<span class="presence-dot"></span>' : ''}
      </div>
      <div class="chat-meta">
        <strong>${escapeHtml(chat.name)}</strong>
        <small class="muted">${escapeHtml(chat.kind === 'private' ? formatPresence(chat.is_online, chat.last_seen_at) : kindLabel(chat.kind))}</small>
        <p>${escapeHtml(chat.last_msg || '')}</p>
      </div>
      <div class="chat-side">
        <small class="muted">${chat.timestamp ? formatTime(chat.timestamp) : ''}</small>
        <div class="chat-side-bottom">
          <span class="tag">${chat.kind}</span>
          ${state.unread[buildRoom(chat.id, chat.kind)] ? `<span class="unread-badge">${Math.min(state.unread[buildRoom(chat.id, chat.kind)], 99)}</span>` : ''}
        </div>
      </div>`;
    list.appendChild(row);
    setAvatar(row.querySelector('.avatar'), chat.name, chat.pfp);
    if (state.currentTargetID === chat.id && state.currentTargetKind === chat.kind) row.classList.add('active');
  });
}


function setSearchDropdownState(active) {
  const wrap = byId('search-input')?.closest('.search-wrap');
  if (!wrap) return;
  wrap.classList.toggle('searching', !!active);
}

async function doSearch() {
  const q = byId('search-input').value.trim();
  const sug = byId('suggestions');
  if (!q) {
    sug.classList.remove('show');
    sug.innerHTML = '';
    setSearchDropdownState(false);
    return;
  }
  const res = await fetch(`/search_suggestions?q=${encodeURIComponent(q)}&my_id=${encodeURIComponent(state.myID)}`);
  const items = await res.json();
  sug.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'suggestion-row';
    empty.innerHTML = `<div class="chat-meta"><strong>No results</strong><p>Try another name, group, or channel.</p></div>`;
    sug.appendChild(empty);
  }
  items.forEach((item) => {
    const row = document.createElement('button');
    row.className = 'suggestion-row';
    const subtitle = item.type === 'user' ? formatPresence(item.is_online, item.last_seen_at) : (item.description || kindLabel(item.type));
    row.innerHTML = `<div class="avatar-stack"><div class="avatar"></div>${item.type === 'user' && item.is_online ? '<span class="presence-dot"></span>' : ''}</div><div class="chat-meta"><strong>${escapeHtml(item.name)}</strong><small class="muted">${escapeHtml(item.type)}</small><p>${escapeHtml(subtitle)}</p></div>`;
    setAvatar(row.querySelector('.avatar'), item.name, item.pfp);
    row.onclick = async () => {
      byId('search-input').value = '';
      sug.classList.remove('show');
      setSearchDropdownState(false);
      await openChat(item.name, item.id, item.pfp, item.type === 'user' ? 'private' : item.type, item);
    };
    sug.appendChild(row);
  });
  sug.classList.add('show');
  setSearchDropdownState(true);
}

async function createGroup() {
  const name = byId('group-name').value.trim();
  const code = normalizeHandle(byId('group-code').value);
  const description = byId('group-description').value.trim();
  if (!name || !code) return showToast('Fill group name and code');
  const res = await fetch('/create_group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, code, description, creator_id: state.myID }) });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not create group');
  closeModal('group-modal');
  ['group-name', 'group-code', 'group-description'].forEach((id) => byId(id).value = '');
  await loadRecentChats();
  await openChat(data.group.name, data.group.code, data.group.pfp, 'group', data.group);
  showToast('Group created');
}
async function joinGroup() {
  const code = normalizeHandle(byId('group-code').value);
  if (!code) return showToast('Enter a group code');
  const res = await fetch('/join_group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, tele_id: state.myID }) });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not join group');
  closeModal('group-modal');
  ['group-name', 'group-code', 'group-description'].forEach((id) => byId(id).value = '');
  await loadRecentChats();
  await openChat(data.group.name, data.group.code, data.group.pfp, 'group', data.group);
  showToast('Joined group');
}
async function createChannel() {
  const name = byId('channel-name').value.trim();
  const code = normalizeHandle(byId('channel-code').value);
  const description = byId('channel-description').value.trim();
  if (!name || !code) return showToast('Fill channel name and code');
  const res = await fetch('/create_channel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, code, description, owner_id: state.myID }) });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not create channel');
  closeModal('channel-modal');
  ['channel-name', 'channel-code', 'channel-description'].forEach((id) => byId(id).value = '');
  await loadRecentChats();
  await openChat(data.channel.name, data.channel.code, data.channel.pfp, 'channel', data.channel);
  showToast('Channel created');
}
async function joinChannel() {
  const code = normalizeHandle(byId('channel-code').value);
  if (!code) return showToast('Enter a channel code');
  const res = await fetch('/join_channel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, tele_id: state.myID }) });
  const data = await res.json();
  if (data.status !== 'success') return showToast(data.message || 'Could not join channel');
  closeModal('channel-modal');
  ['channel-name', 'channel-code', 'channel-description'].forEach((id) => byId(id).value = '');
  await loadRecentChats();
  await openChat(data.channel.name, data.channel.code, data.channel.pfp, 'channel', data.channel);
  showToast('Joined channel');
}

function renderChatPanel(name, pfp, kind, details = {}) {
  const panel = byId('chat-panel');
  const isOwner = kind === 'channel' && details.owner_id === state.myID;
  panel.className = 'chat-panel glass-card';
  panel.innerHTML = `
    <div class="chat-shell">
      <div class="chat-header">
        <div class="chat-header-left clickable" onclick="openProfileSheet()">
          <button class="back-btn mobile-only" onclick="event.stopPropagation(); closeCurrentChat()">←</button>
          <div id="chat-header-avatar" class="avatar"></div>
          <div class="chat-header-meta">
            <strong id="chat-header-name"></strong>
            <p id="chat-header-status">${escapeHtml(details.status_text || kindLabel(kind))}</p>
          </div>
        </div>
        <div class="header-actions">
          <button class="icon-btn" onclick="shareCurrentChat()">🔗</button>
          <button class="icon-btn" onclick="document.getElementById('media-upload').click()">📎</button>
        </div>
      </div>
      ${kind === 'channel' && !isOwner ? '<div class="channel-banner">Broadcast channel — only the owner can post updates.</div>' : ''}
      <div id="messages-view" class="messages-view"></div>
      <div class="typing-indicator" id="typing-indicator"></div>
      <div class="chat-input-area">
        <button class="attach-btn" onclick="document.getElementById('media-upload').click()">＋</button>
        <input type="file" id="media-upload" class="hidden" onchange="uploadMedia(event)">
        <input type="text" id="msg-input" placeholder="${kind === 'channel' && !isOwner ? 'Read only channel' : 'Type a message'}" ${kind === 'channel' && !isOwner ? 'disabled' : ''}>
        <button class="send-btn" onclick="sendMsg()" ${kind === 'channel' && !isOwner ? 'disabled' : ''}>➤</button>
      </div>
    </div>`;
  byId('chat-header-name').textContent = name;
  setAvatar(byId('chat-header-avatar'), name, pfp);
  const input = byId('msg-input');
  if (input && !input.disabled) {
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') sendMsg(); });
    input.addEventListener('input', emitTypingPulse);
  }
}

async function openChat(name, id, pfp, kind = 'private', preview = {}) {
  state.currentTargetID = id;
  state.currentTargetName = name;
  state.currentTargetPFP = pfp || '';
  state.currentTargetKind = kind;
  state.currentStatusText = preview.status_text || kindLabel(kind);
  renderChatPanel(name, pfp, kind, preview);
  document.querySelectorAll('.chat-row').forEach((el) => el.classList.toggle('active', el.dataset.chatId === id && el.dataset.kind === kind));

  const room = buildRoom(id, kind);
  clearUnread(room);
  socket.emit('join_chat', { room });
  const [historyRes, profileRes] = await Promise.all([
    fetch(`/history/${encodeURIComponent(room)}`),
    fetch(`/profile/${encodeURIComponent(id)}`),
  ]);
  const msgs = await historyRes.json();
  const profile = await profileRes.json();
  if (profile.status === 'success') state.profileCache[id] = profile;
  applyHeaderProfile(profile.status === 'success' ? profile : preview);

  const view = byId('messages-view');
  view.innerHTML = '';
  msgs.forEach(renderBubble);
  view.scrollTop = view.scrollHeight;
  if (isMobileLayout()) setMobileTab('chat');
}

function applyHeaderProfile(profile) {
  if (!profile) return;
  const statusEl = byId('chat-header-status');
  if (statusEl) {
    if (profile.kind === 'user' || state.currentTargetKind === 'private') {
      statusEl.textContent = formatPresence(profile.is_online, profile.last_seen_at);
    } else if (profile.kind === 'channel') {
      statusEl.textContent = `${profile.member_count || 0} subscribers`;
    } else {
      statusEl.textContent = `${profile.member_count || 0} members`;
    }
  }
}

function messageBodyHtml(data) {
  if (data.is_deleted) return `<div class="bubble ${data.sender_id === state.myID ? 'sent' : 'received'} deleted">Message deleted</div>`;
  if (data.msg_type === 'image') return `<div class="image-wrap"><img class="message-media" src="${data.file_url}" alt="${escapeHtml(data.content || 'image')}"></div>`;
  if (data.msg_type === 'video') return `<div class="video-wrap"><video class="message-media" src="${data.file_url}" controls></video></div>`;
  if (data.msg_type === 'audio') return `<div class="audio-wrap"><audio src="${data.file_url}" controls></audio></div>`;
  if (data.msg_type === 'file') return `<a class="file-card" href="${data.file_url}" target="_blank"><span>📄</span><span>${escapeHtml(data.content || 'file')}</span></a>`;
  return `<div class="bubble ${data.sender_id === state.myID ? 'sent' : 'received'}">${escapeHtml(data.content)}</div>`;
}

function renderBubble(data) {
  const view = byId('messages-view');
  if (!view) return;
  const sent = data.sender_id === state.myID;
  const wrap = document.createElement('div');
  wrap.className = `msg-wrapper ${sent ? 'sent' : 'received'}`;
  wrap.dataset.msgId = data.id;
  wrap.innerHTML = `
    ${sent ? '' : '<div class="avatar small-avatar"></div>'}
    <div class="msg-stack">
      ${!sent && state.currentTargetKind !== 'private' ? `<div class="msg-sender">${escapeHtml(data.sender_name)}</div>` : ''}
      ${messageBodyHtml(data)}
      <div class="bubble-time">${formatTime(data.timestamp)}${sent ? ' · double tap to delete' : ''}</div>
    </div>`;
  if (!sent) setAvatar(wrap.querySelector('.avatar'), data.sender_name, data.sender_pfp);
  if (sent && !data.is_deleted) {
    wrap.addEventListener('dblclick', () => {
      if (confirm('Delete this message?')) socket.emit('delete_message', { msg_id: data.id, sender_id: state.myID });
    });
  }
  view.appendChild(wrap);
  view.scrollTop = view.scrollHeight;
}

function emitTypingPulse() {
  if (!state.currentTargetID) return;
  const room = buildRoom(state.currentTargetID, state.currentTargetKind);
  if (!state.sentTyping) {
    socket.emit('typing', { room, target_id: state.currentTargetID, tele_id: state.myID, name: state.myName, is_typing: true });
    state.sentTyping = true;
  }
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => stopTyping(), 1200);
}
function stopTyping() {
  if (!state.sentTyping || !state.currentTargetID) return;
  socket.emit('typing', { room: buildRoom(state.currentTargetID, state.currentTargetKind), target_id: state.currentTargetID, tele_id: state.myID, name: state.myName, is_typing: false });
  state.sentTyping = false;
}

function sendMsg() {
  const input = byId('msg-input');
  if (!input || input.disabled) return;
  const content = input.value.trim();
  if (!content || !state.currentTargetID) return;
  const room = buildRoom(state.currentTargetID, state.currentTargetKind);
  socket.emit('private_message', { room, sender_id: state.myID, sender_name: state.myName, target_id: state.currentTargetID, msg_type: 'text', content });
  input.value = '';
  stopTyping();
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
  socket.emit('private_message', { room: buildRoom(state.currentTargetID, state.currentTargetKind), sender_id: state.myID, sender_name: state.myName, target_id: state.currentTargetID, msg_type: data.type, content: file.name, file_url: data.url });
}

async function uploadPFP(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file); fd.append('type', 'pfp'); fd.append('tele_id', state.myID);
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

async function openProfileSheet() {
  if (!state.currentTargetID) return;
  let profile = state.profileCache[state.currentTargetID];
  if (!profile) {
    const res = await fetch(`/profile/${encodeURIComponent(state.currentTargetID)}`);
    profile = await res.json();
    if (profile.status === 'success') state.profileCache[state.currentTargetID] = profile;
  }
  if (profile.status !== 'success') return showToast('Could not open profile');
  const sheet = byId('chat-profile-sheet');
  byId('sheet-name').textContent = profile.username || profile.name || state.currentTargetName;
  byId('sheet-handle').textContent = `@${profile.tele_id || state.currentTargetID}`;
  byId('sheet-kind').textContent = kindLabel(profile.kind === 'user' ? 'private' : profile.kind);
  byId('sheet-kind').dataset.code = profile.tele_id || state.currentTargetID;
  byId('sheet-status').textContent = profile.kind === 'user' ? formatPresence(profile.is_online, profile.last_seen_at) : `${profile.member_count || 0} ${profile.kind === 'channel' ? 'subscribers' : 'members'}`;
  byId('sheet-bio').textContent = profile.bio || profile.description || 'No bio yet.';
  setAvatar(byId('sheet-avatar'), profile.username || profile.name, profile.pfp);
  sheet.classList.remove('hidden');
}
function closeProfileSheet() { byId('chat-profile-sheet').classList.add('hidden'); }
function copyChatIdentity() {
  if (!state.currentTargetID) return;
  navigator.clipboard.writeText(`@${state.currentTargetID}`);
  showToast('ID copied');
}


function shareCurrentChat() {
  if (!state.currentTargetID) return;
  const title = `${state.currentTargetName} on FelChat`;
  const text = state.currentTargetKind === 'private'
    ? `Chat with @${state.currentTargetID} on FelChat`
    : `Join ${state.currentTargetKind} @${state.currentTargetID} on FelChat`;
  if (navigator.share) {
    navigator.share({ title, text, url: window.location.origin }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text);
    showToast('Invite text copied');
  }
}

socket.on('new_message', (data) => {
  const activeRoom = state.currentTargetID ? buildRoom(state.currentTargetID, state.currentTargetKind) : '';
  if (data.room === activeRoom) {
    renderBubble(data);
  } else if (data.sender_id !== state.myID) {
    markUnread(data.room, true);
    loadRecentChats();
  }
});
socket.on('ping_radar', () => loadRecentChats());
socket.on('message_deleted', (data) => {
  const msgEl = document.querySelector(`[data-msg-id="${data.msg_id}"] .msg-stack`);
  if (msgEl) msgEl.innerHTML = `<div class="bubble deleted">Message deleted</div><div class="bubble-time"></div>`;
});
socket.on('typing', (data) => {
  const room = state.currentTargetID ? buildRoom(state.currentTargetID, state.currentTargetKind) : '';
  if (data.room !== room || data.tele_id === state.myID) return;
  const el = byId('typing-indicator');
  if (!el) return;
  el.textContent = data.is_typing ? `${data.name || 'Someone'} is typing...` : '';
});
socket.on('presence_update', (data) => {
  if (state.currentTargetKind === 'private' && data.tele_id === state.currentTargetID) {
    const statusEl = byId('chat-header-status');
    if (statusEl) statusEl.textContent = formatPresence(data.is_online, data.last_seen_at);
    const sheetStatus = byId('sheet-status');
    if (sheetStatus && !byId('chat-profile-sheet').classList.contains('hidden')) sheetStatus.textContent = formatPresence(data.is_online, data.last_seen_at);
  }
  loadRecentChats();
});
socket.on('action_error', (data) => showToast(data.message || 'Action failed'));

window.addEventListener('click', (event) => {
  if (!event.target.closest('.search-wrap')) { byId('suggestions').classList.remove('show'); setSearchDropdownState(false); }
  if (event.target.classList.contains('modal')) event.target.classList.add('hidden');
});
window.addEventListener('beforeunload', () => { if (state.myID) socket.emit('presence_offline', { my_id: state.myID }); });
window.addEventListener('resize', () => setMobileTab(state.currentTargetID && isMobileLayout() ? 'chat' : (isMobileLayout() ? state.mobileTab : 'chats')));


window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  updateInstallBanner();
});
window.addEventListener('appinstalled', () => {
  state.deferredInstallPrompt = null;
  updateInstallBanner();
  showToast('FelChat installed');
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.myID) socket.emit('presence_online', { my_id: state.myID });
});
applyTheme(state.theme);

if (state.myID) startSession();
