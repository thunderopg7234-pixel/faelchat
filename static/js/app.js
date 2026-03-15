const socket = io();

const state = {
    myID: localStorage.getItem('fID') || '',
    myName: localStorage.getItem('fName') || '',
    myPFP: localStorage.getItem('fPFP') || '',
    currentTargetID: '',
    currentTargetName: '',
    currentTargetPFP: '',
    isCurrentChatGroup: false,
    isSignUp: false,
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
    showToast.timer = setTimeout(() => toast.classList.add('hidden'), 2400);
}

function toggleAuth(forceSignUp = null) {
    state.isSignUp = forceSignUp === null ? !state.isSignUp : Boolean(forceSignUp);
    byId('display-name-wrap').classList.toggle('hidden', !state.isSignUp);
    byId('abtn').textContent = state.isSignUp ? 'Create account' : 'Log In';
    byId('auth-title').textContent = state.isSignUp ? 'Create your account' : 'Welcome back';
    byId('auth-subtitle').textContent = state.isSignUp
        ? 'Choose your @username, display name, and password.'
        : 'Log in with your @username and password.';
    byId('auth-switch-text').textContent = state.isSignUp ? 'Already have an account?' : 'Don’t have an account?';
    byId('auth-switch-link').textContent = state.isSignUp ? 'Log in' : 'Sign up';
}

function switchToSignUp() {
    logout(false);
    toggleAuth(true);
    byId('auth-screen').classList.remove('hidden');
    byId('main-app').classList.add('hidden');
}

async function handleAuth() {
    const payload = {
        username: byId('aname').value.trim(),
        tele_id: normalizeHandle(byId('aid').value),
        password: byId('apass').value.trim(),
    };

    if (!payload.tele_id || !payload.password || (state.isSignUp && !payload.username)) {
        showToast('Fill all fields');
        return;
    }

    const endpoint = state.isSignUp ? '/signup' : '/login';
    const body = state.isSignUp ? payload : { tele_id: payload.tele_id, password: payload.password };
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.status !== 'success') {
        showToast(data.message || 'Something went wrong');
        return;
    }

    state.myID = data.tele_id || payload.tele_id;
    state.myName = data.username || payload.username;
    state.myPFP = data.pfp || '';
    localStorage.setItem('fID', state.myID);
    localStorage.setItem('fName', state.myName);
    localStorage.setItem('fPFP', state.myPFP);
    startSession();
    showToast(state.isSignUp ? 'Account created' : 'Logged in');
}

function logout(reload = true) {
    localStorage.removeItem('fID');
    localStorage.removeItem('fName');
    localStorage.removeItem('fPFP');
    if (reload) location.reload();
}

function openModal(id) { byId(id).classList.remove('hidden'); }
function closeModal(id) { byId(id).classList.add('hidden'); }

function hydrateProfile() {
    byId('settings-fullname').textContent = state.myName || 'User';
    byId('settings-id').textContent = `@${state.myID}`;
    byId('settings-fullname-2').textContent = state.myName || 'User';
    byId('settings-id-2').textContent = `@${state.myID}`;
    byId('edit-display-name').value = state.myName || '';
    setAvatar(byId('settings-pfp-icon'), state.myName, state.myPFP);
    setAvatar(byId('settings-mini-avatar'), state.myName, state.myPFP);
}

function startSession() {
    byId('auth-screen').classList.add('hidden');
    byId('main-app').classList.remove('hidden');
    hydrateProfile();
    socket.emit('connect_radar', { my_id: state.myID });
    loadRecentChats();
}

async function saveProfile() {
    const username = byId('edit-display-name').value.trim();
    if (!username) {
        showToast('Display name required');
        return;
    }

    const res = await fetch('/update_profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tele_id: state.myID, username }),
    });
    const data = await res.json();
    if (data.status !== 'success') {
        showToast(data.message || 'Could not update profile');
        return;
    }

    state.myName = data.username;
    localStorage.setItem('fName', state.myName);
    hydrateProfile();
    closeModal('profile-modal');
    await loadRecentChats();
    if (state.currentTargetID) {
        await openChat(state.currentTargetName, state.currentTargetID, state.currentTargetPFP, state.isCurrentChatGroup);
    }
    showToast('Profile updated');
}

async function doSearch() {
    const q = byId('search-input').value.trim();
    const sug = byId('suggestions');
    sug.innerHTML = '';
    if (!q) {
        sug.classList.remove('show');
        return;
    }

    const res = await fetch(`/search_suggestions?q=${encodeURIComponent(normalizeHandle(q) || q)}&my_id=${encodeURIComponent(state.myID)}`);
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
        sug.innerHTML = `<div class="suggestion-row"><div class="chat-meta"><strong>No result</strong><p>Try exact @username or group code</p></div></div>`;
        sug.classList.add('show');
        return;
    }

    data.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'suggestion-row';
        row.innerHTML = `
            <div class="avatar"></div>
            <div class="chat-meta">
                <strong>${escapeHtml(item.name)}</strong>
                <p>${item.type === 'user' ? '@' : ''}${escapeHtml(item.id)}</p>
            </div>
            <span class="tag">${item.type}</span>
        `;
        setAvatar(row.querySelector('.avatar'), item.name, item.pfp);
        row.onclick = async () => {
            sug.classList.remove('show');
            byId('search-input').value = '';
            await openChat(item.name, item.id, item.pfp, item.type === 'group');
        };
        sug.appendChild(row);
    });
    sug.classList.add('show');
}

async function createGroup() {
    const name = byId('group-name').value.trim();
    const code = normalizeHandle(byId('group-code').value);
    if (!name || !code) {
        showToast('Fill group name and code');
        return;
    }

    const res = await fetch('/create_group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code, creator_id: state.myID }),
    });
    const data = await res.json();
    if (data.status !== 'success') {
        showToast(data.message || 'Could not create group');
        return;
    }
    closeModal('group-modal');
    byId('group-name').value = '';
    byId('group-code').value = '';
    await loadRecentChats();
    await openChat(name, code, '', true);
    showToast('Group created');
}

async function joinGroup() {
    const code = normalizeHandle(byId('group-code').value);
    if (!code) {
        showToast('Enter a group code');
        return;
    }
    const res = await fetch('/join_group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, tele_id: state.myID }),
    });
    const data = await res.json();
    if (data.status !== 'success') {
        showToast(data.message || 'Could not join group');
        return;
    }
    closeModal('group-modal');
    byId('group-name').value = '';
    byId('group-code').value = '';
    await loadRecentChats();
    await openChat(data.group.name, data.group.code, data.group.pfp, true);
    showToast('Joined group');
}

function buildRoom(id, isGroup) {
    return isGroup ? `group_${id}` : [state.myID, id].sort().join('_');
}

function renderChatPanel(name, pfp, isGroup) {
    const panel = byId('chat-panel');
    panel.classList.remove('empty-state');
    panel.innerHTML = `
        <div class="chat-header">
            <div class="chat-header-left">
                <div id="chat-header-avatar" class="avatar"></div>
                <div class="chat-header-meta">
                    <strong id="chat-header-name"></strong>
                    <p>${isGroup ? 'Group chat' : 'Private chat'}</p>
                </div>
            </div>
            <div class="header-actions">
                <button class="icon-btn" onclick="document.getElementById('media-upload').click()">📎</button>
            </div>
        </div>
        <div id="messages-view" class="messages-view"></div>
        <div class="chat-input-area">
            <button class="attach-btn" onclick="document.getElementById('media-upload').click()">＋</button>
            <input type="file" id="media-upload" class="hidden" onchange="uploadMedia(event)">
            <input type="text" id="msg-input" placeholder="Type a message" onkeypress="if(event.key==='Enter') sendMsg()">
            <button class="send-btn" onclick="sendMsg()">➤</button>
        </div>
    `;
    byId('chat-header-name').textContent = name;
    setAvatar(byId('chat-header-avatar'), name, pfp);
}

async function openChat(name, id, pfp, isGroup) {
    state.currentTargetID = id;
    state.currentTargetName = name;
    state.currentTargetPFP = pfp || '';
    state.isCurrentChatGroup = isGroup;
    renderChatPanel(name, pfp, isGroup);

    document.querySelectorAll('.chat-row').forEach((el) => {
        el.classList.toggle('active', el.dataset.chatId === id && el.dataset.group === String(isGroup));
    });

    const room = buildRoom(id, isGroup);
    socket.emit('join_chat', { room });
    const res = await fetch(`/history/${encodeURIComponent(room)}`);
    const msgs = await res.json();
    const view = byId('messages-view');
    view.innerHTML = '';
    msgs.forEach(renderBubble);
    view.scrollTop = view.scrollHeight;
}

function messageBodyHtml(data) {
    if (data.is_deleted) {
        return '<div class="bubble deleted">Message deleted</div>';
    }

    const safeText = data.content ? `<div>${escapeHtml(data.content).replaceAll('\n', '<br>')}</div>` : '';

    if (data.msg_type === 'image') {
        return `<div class="bubble ${data.sender_id === state.myID ? 'sent' : 'received'} image-wrap"><img class="message-media" src="${data.file_url}" alt="image"></div>${safeText ? `<div class="bubble ${data.sender_id === state.myID ? 'sent' : 'received'}">${safeText}</div>` : ''}`;
    }
    if (data.msg_type === 'video') {
        return `<div class="bubble ${data.sender_id === state.myID ? 'sent' : 'received'} video-wrap"><video class="message-media" src="${data.file_url}" controls playsinline></video></div>${safeText ? `<div class="bubble ${data.sender_id === state.myID ? 'sent' : 'received'}">${safeText}</div>` : ''}`;
    }
    if (data.msg_type === 'audio') {
        return `<div class="bubble ${data.sender_id === state.myID ? 'sent' : 'received'} audio-wrap"><audio src="${data.file_url}" controls></audio></div>${safeText ? `<div class="bubble ${data.sender_id === state.myID ? 'sent' : 'received'}">${safeText}</div>` : ''}`;
    }
    if (data.msg_type === 'file') {
        const fileName = decodeURIComponent((data.file_url || '').split('/').pop() || 'file');
        return `<div class="bubble ${data.sender_id === state.myID ? 'sent' : 'received'}"><a class="file-card" href="${data.file_url}" target="_blank" rel="noopener"><span>📄</span><div><strong>${escapeHtml(fileName)}</strong><div>Open file</div></div></a></div>${safeText ? `<div class="bubble ${data.sender_id === state.myID ? 'sent' : 'received'}">${safeText}</div>` : ''}`;
    }
    return `<div class="bubble ${data.sender_id === state.myID ? 'sent' : 'received'}">${safeText || '&nbsp;'}</div>`;
}

function renderBubble(data) {
    const view = byId('messages-view');
    if (!view) return;

    const wrap = document.createElement('div');
    wrap.className = `msg-wrapper ${data.sender_id === state.myID ? 'sent' : 'received'}`;
    wrap.dataset.msgId = data.id;

    const showSenderAvatar = state.isCurrentChatGroup && data.sender_id !== state.myID;
    wrap.innerHTML = `
        ${showSenderAvatar ? '<div class="avatar msg-avatar"></div>' : ''}
        <div class="msg-stack">
            ${showSenderAvatar ? `<div class="msg-sender">${escapeHtml(data.sender_name || '')}</div>` : ''}
            ${messageBodyHtml(data)}
            <div class="bubble-time">${escapeHtml(data.timestamp || '')}</div>
        </div>
    `;

    if (showSenderAvatar) {
        setAvatar(wrap.querySelector('.msg-avatar'), data.sender_name, data.sender_pfp);
    }

    view.appendChild(wrap);
    view.scrollTop = view.scrollHeight;
}

async function loadRecentChats() {
    if (!state.myID) return;
    const res = await fetch(`/recent_chats/${encodeURIComponent(state.myID)}`);
    const chats = await res.json();
    const list = byId('chat-list');
    list.innerHTML = '';

    if (!Array.isArray(chats) || chats.length === 0) {
        list.innerHTML = `<div class="chat-row"><div class="chat-meta"><strong>No chats yet</strong><p>Use search to start chatting.</p></div></div>`;
        return;
    }

    chats.forEach((chat) => {
        const row = document.createElement('div');
        row.className = 'chat-row';
        row.dataset.chatId = chat.id;
        row.dataset.group = String(chat.is_group);
        row.innerHTML = `
            <div class="avatar row-avatar"></div>
            <div class="chat-meta">
                <strong>${escapeHtml(chat.name)}</strong>
                <p>${escapeHtml(chat.last_msg || '')}</p>
            </div>
            <small class="muted">${escapeHtml(chat.time || '')}</small>
        `;
        setAvatar(row.querySelector('.row-avatar'), chat.name, chat.pfp);
        row.onclick = () => openChat(chat.name, chat.id, chat.pfp, chat.is_group);
        list.appendChild(row);
    });
}

async function sendMsg() {
    const input = byId('msg-input');
    if (!input || !state.currentTargetID) return;
    const val = input.value.trim();
    if (!val) return;

    const payload = {
        room: buildRoom(state.currentTargetID, state.isCurrentChatGroup),
        sender_id: state.myID,
        sender_name: state.myName,
        target_id: state.currentTargetID,
        is_group: state.isCurrentChatGroup,
        msg_type: 'text',
        content: val,
    };
    socket.emit('private_message', payload);
    input.value = '';
}

async function uploadMedia(event) {
    const file = event.target.files?.[0];
    if (!file || !state.currentTargetID) return;

    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/upload', { method: 'POST', body: fd });
    const data = await res.json();
    event.target.value = '';

    if (data.status !== 'success') {
        showToast(data.message || 'Upload failed');
        return;
    }

    socket.emit('private_message', {
        room: buildRoom(state.currentTargetID, state.isCurrentChatGroup),
        sender_id: state.myID,
        sender_name: state.myName,
        target_id: state.currentTargetID,
        is_group: state.isCurrentChatGroup,
        msg_type: data.type,
        content: file.name,
        file_url: data.url,
    });
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

    if (data.status !== 'success') {
        showToast(data.message || 'Profile photo upload failed');
        return;
    }

    state.myPFP = data.url;
    localStorage.setItem('fPFP', state.myPFP);
    hydrateProfile();
    await loadRecentChats();
    if (state.currentTargetID) {
        await openChat(state.currentTargetName, state.currentTargetID, state.currentTargetPFP, state.isCurrentChatGroup);
    }
    showToast('Profile photo updated');
}

socket.on('new_message', (data) => {
    const activeRoom = state.currentTargetID ? buildRoom(state.currentTargetID, state.isCurrentChatGroup) : '';
    if (data.room === activeRoom) renderBubble(data);
});

socket.on('ping_radar', () => loadRecentChats());
socket.on('message_deleted', (data) => {
    const msgEl = document.querySelector(`[data-msg-id="${data.msg_id}"]`);
    if (!msgEl) return;
    const stack = msgEl.querySelector('.msg-stack');
    const isSent = msgEl.classList.contains('sent');
    stack.innerHTML = `<div class="bubble ${isSent ? 'sent' : 'received'} deleted">Message deleted</div><div class="bubble-time"></div>`;
});

window.addEventListener('click', (event) => {
    const suggestions = byId('suggestions');
    if (!event.target.closest('.search-wrap')) {
        suggestions.classList.remove('show');
    }
    if (event.target.classList.contains('modal')) {
        event.target.classList.add('hidden');
    }
});

if (state.myID) {
    startSession();
}
