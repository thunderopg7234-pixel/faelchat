from __future__ import annotations

import eventlet

eventlet.monkey_patch()

import os
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room
from sqlalchemy import inspect, or_, text
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / 'static' / 'uploads'
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
    'mp4', 'mov', 'webm', 'm4v',
    'mp3', 'wav', 'ogg', 'm4a', 'aac',
    'pdf', 'txt', 'zip', 'rar', '7z', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
}
IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'}
VIDEO_EXTENSIONS = {'mp4', 'mov', 'webm', 'm4v'}
AUDIO_EXTENSIONS = {'mp3', 'wav', 'ogg', 'm4a', 'aac'}

app = Flask(__name__)

db_url = os.getenv('DATABASE_URL', 'sqlite:///faelchat.db')
if db_url.startswith('postgres://'):
    db_url = db_url.replace('postgres://', 'postgresql://', 1)

app.config['SQLALCHEMY_DATABASE_URI'] = db_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'fael_super_secret')
app.config['UPLOAD_FOLDER'] = str(UPLOAD_DIR)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins='*', max_http_buffer_size=100 * 1024 * 1024, async_mode='eventlet')

active_users: dict[str, set[str]] = {}


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), nullable=False)
    tele_id = db.Column(db.String(50), unique=True, nullable=False, index=True)
    password = db.Column(db.String(50), nullable=False)
    pfp = db.Column(db.String(255), default='')
    bio = db.Column(db.String(280), default='')
    is_online = db.Column(db.Boolean, default=False, index=True)
    last_seen_at = db.Column(db.DateTime, nullable=True, index=True)


class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room = db.Column(db.String(100), nullable=False, index=True)
    sender_id = db.Column(db.String(50), nullable=False)
    sender_name = db.Column(db.String(50), nullable=False)
    content = db.Column(db.Text, nullable=False, default='')
    msg_type = db.Column(db.String(20), default='text')
    file_url = db.Column(db.String(255), default='')
    is_deleted = db.Column(db.Boolean, default=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class Group(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    code = db.Column(db.String(50), unique=True, nullable=False, index=True)
    pfp = db.Column(db.String(255), default='')
    description = db.Column(db.String(280), default='')
    owner_id = db.Column(db.String(50), default='')


class GroupMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    group_code = db.Column(db.String(50), nullable=False, index=True)
    tele_id = db.Column(db.String(50), nullable=False, index=True)


class Channel(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    code = db.Column(db.String(50), unique=True, nullable=False, index=True)
    pfp = db.Column(db.String(255), default='')
    description = db.Column(db.String(280), default='')
    owner_id = db.Column(db.String(50), nullable=False, index=True)


class ChannelMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    channel_code = db.Column(db.String(50), nullable=False, index=True)
    tele_id = db.Column(db.String(50), nullable=False, index=True)


def ensure_schema():
    db.create_all()

    def q(identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    def add_column_if_missing(table_name: str, column_name: str, ddl: str):
        inspector = inspect(db.engine)
        current = {col['name'] for col in inspector.get_columns(table_name)}
        if column_name in current:
            return
        with db.engine.begin() as conn:
            conn.execute(text(f'ALTER TABLE {q(table_name)} ADD COLUMN {q(column_name)} {ddl}'))

    add_column_if_missing(User.__tablename__, 'bio', "VARCHAR(280) DEFAULT ''")
    add_column_if_missing(User.__tablename__, 'is_online', 'BOOLEAN DEFAULT FALSE')
    add_column_if_missing(User.__tablename__, 'last_seen_at', 'TIMESTAMP NULL')
    add_column_if_missing(Group.__tablename__, 'description', "VARCHAR(280) DEFAULT ''")
    add_column_if_missing(Group.__tablename__, 'owner_id', "VARCHAR(50) DEFAULT ''")


with app.app_context():
    ensure_schema()


# ---------- helpers ----------
def json_error(message: str, status_code: int = 400):
    return jsonify({'status': 'error', 'message': message}), status_code


def allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_file_type(filename: str) -> str:
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext in IMAGE_EXTENSIONS:
        return 'image'
    if ext in VIDEO_EXTENSIONS:
        return 'video'
    if ext in AUDIO_EXTENSIONS:
        return 'audio'
    return 'file'


def save_upload(file_storage) -> tuple[str, str]:
    if not file_storage or not file_storage.filename:
        raise ValueError('No file selected')
    if not allowed_file(file_storage.filename):
        raise ValueError('File type not allowed')

    original_name = secure_filename(file_storage.filename)
    unique_name = f"{uuid.uuid4().hex}_{original_name}"
    file_path = UPLOAD_DIR / unique_name
    file_storage.save(file_path)
    file_url = f'/static/uploads/{unique_name}'
    return file_url, get_file_type(original_name)


def normalize_handle(value: str) -> str:
    return (value or '').strip().lstrip('@').replace(' ', '').lower()


def to_iso(value):
    return value.isoformat() + 'Z' if value else None


def presence_payload(user: User | None):
    if not user:
        return {'is_online': False, 'last_seen_at': None, 'status_text': 'Unavailable'}
    if user.is_online:
        return {'is_online': True, 'last_seen_at': to_iso(user.last_seen_at), 'status_text': 'Online'}
    if user.last_seen_at:
        return {'is_online': False, 'last_seen_at': to_iso(user.last_seen_at), 'status_text': 'Last seen recently'}
    return {'is_online': False, 'last_seen_at': None, 'status_text': 'Offline'}


def touch_online(tele_id: str, sid: str | None = None):
    if not tele_id:
        return
    if sid:
        active_users.setdefault(tele_id, set()).add(sid)
    user = User.query.filter_by(tele_id=tele_id).first()
    if user:
        user.is_online = True
        db.session.commit()
        socketio.emit('presence_update', {'tele_id': tele_id, **presence_payload(user)})


def touch_offline(tele_id: str, sid: str | None = None):
    if not tele_id:
        return
    if sid and tele_id in active_users:
        active_users[tele_id].discard(sid)
        if not active_users[tele_id]:
            active_users.pop(tele_id, None)
    if tele_id in active_users:
        return
    user = User.query.filter_by(tele_id=tele_id).first()
    if user:
        user.is_online = False
        user.last_seen_at = datetime.utcnow()
        db.session.commit()
        socketio.emit('presence_update', {'tele_id': tele_id, **presence_payload(user)})


def get_group_members(code: str):
    return [m.tele_id for m in GroupMember.query.filter_by(group_code=code).all()]


def get_channel_members(code: str):
    return [m.tele_id for m in ChannelMember.query.filter_by(channel_code=code).all()]


def can_post_in_room(sender_id: str, room: str) -> bool:
    if room.startswith('channel_'):
        code = room.replace('channel_', '', 1)
        channel = Channel.query.filter_by(code=code).first()
        return bool(channel and channel.owner_id == sender_id)
    return True


def room_kind(room: str) -> str:
    if room.startswith('group_'):
        return 'group'
    if room.startswith('channel_'):
        return 'channel'
    return 'private'


# ---------- routes ----------
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/signup', methods=['POST'])
def signup():
    data = request.json or {}
    username = (data.get('username') or '').strip()
    tele_id = normalize_handle(data.get('tele_id') or '')
    password = (data.get('password') or '').strip()

    if not username or not tele_id or not password:
        return json_error('Fill all fields')
    if User.query.filter_by(tele_id=tele_id).first():
        return json_error('ID already taken!')

    user = User(username=username, tele_id=tele_id, password=password, last_seen_at=datetime.utcnow())
    db.session.add(user)
    db.session.commit()
    return jsonify({'status': 'success', 'username': user.username, 'tele_id': user.tele_id, 'pfp': user.pfp or '', 'bio': user.bio or ''})


@app.route('/login', methods=['POST'])
def login():
    data = request.json or {}
    tele_id = normalize_handle(data.get('tele_id') or '')
    password = (data.get('password') or '').strip()

    user = User.query.filter_by(tele_id=tele_id, password=password).first()
    if not user:
        return json_error('Invalid credentials', 401)

    user.is_online = True
    user.last_seen_at = datetime.utcnow()
    db.session.commit()

    return jsonify({
        'status': 'success',
        'username': user.username,
        'tele_id': user.tele_id,
        'pfp': user.pfp or '',
        'bio': user.bio or '',
        **presence_payload(user),
    })


@app.route('/search_suggestions')
def search_suggestions():
    q = normalize_handle(request.args.get('q') or '')
    my_id = normalize_handle(request.args.get('my_id') or '')
    if not q:
        return jsonify([])

    like_term = f'%{q}%'
    results = []

    users = User.query.filter(
        or_(User.tele_id.ilike(like_term), User.username.ilike(like_term))
    ).order_by(User.username.asc()).limit(8).all()
    for user in users:
        if user.tele_id == my_id:
            continue
        results.append({'type': 'user', 'name': user.username, 'id': user.tele_id, 'pfp': user.pfp or '', 'bio': user.bio or '', **presence_payload(user)})

    groups = Group.query.filter(
        or_(Group.code.ilike(like_term), Group.name.ilike(like_term))
    ).order_by(Group.name.asc()).limit(6).all()
    for group in groups:
        results.append({'type': 'group', 'name': group.name, 'id': group.code, 'pfp': group.pfp or '', 'description': group.description or ''})

    channels = Channel.query.filter(
        or_(Channel.code.ilike(like_term), Channel.name.ilike(like_term))
    ).order_by(Channel.name.asc()).limit(6).all()
    for channel in channels:
        results.append({'type': 'channel', 'name': channel.name, 'id': channel.code, 'pfp': channel.pfp or '', 'description': channel.description or ''})

    return jsonify(results[:12])


@app.route('/create_group', methods=['POST'])
def create_group():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    code = normalize_handle(data.get('code') or '')
    creator_id = normalize_handle(data.get('creator_id') or '')
    description = (data.get('description') or '').strip()

    if not name or not code or not creator_id:
        return json_error('Fill all fields')
    if Group.query.filter_by(code=code).first() or Channel.query.filter_by(code=code).first():
        return json_error('Code already exists!')

    group = Group(name=name, code=code, description=description, owner_id=creator_id)
    db.session.add(group)
    db.session.add(GroupMember(group_code=code, tele_id=creator_id))
    db.session.commit()
    return jsonify({'status': 'success', 'group': {'name': group.name, 'code': group.code, 'pfp': group.pfp or '', 'description': group.description or ''}})


@app.route('/join_group', methods=['POST'])
def join_group():
    data = request.json or {}
    code = normalize_handle(data.get('code') or '')
    tele_id = normalize_handle(data.get('tele_id') or '')

    group = Group.query.filter_by(code=code).first()
    if not group:
        return json_error('Group not found')

    exists = GroupMember.query.filter_by(group_code=code, tele_id=tele_id).first()
    if not exists:
        db.session.add(GroupMember(group_code=code, tele_id=tele_id))
        db.session.commit()

    return jsonify({'status': 'success', 'group': {'name': group.name, 'code': group.code, 'pfp': group.pfp or '', 'description': group.description or ''}})


@app.route('/create_channel', methods=['POST'])
def create_channel():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    code = normalize_handle(data.get('code') or '')
    owner_id = normalize_handle(data.get('owner_id') or '')
    description = (data.get('description') or '').strip()

    if not name or not code or not owner_id:
        return json_error('Fill all fields')
    if Channel.query.filter_by(code=code).first() or Group.query.filter_by(code=code).first():
        return json_error('Code already exists!')

    channel = Channel(name=name, code=code, owner_id=owner_id, description=description)
    db.session.add(channel)
    db.session.add(ChannelMember(channel_code=code, tele_id=owner_id))
    db.session.commit()
    return jsonify({'status': 'success', 'channel': {'name': channel.name, 'code': channel.code, 'pfp': channel.pfp or '', 'description': channel.description or '', 'owner_id': channel.owner_id}})


@app.route('/join_channel', methods=['POST'])
def join_channel():
    data = request.json or {}
    code = normalize_handle(data.get('code') or '')
    tele_id = normalize_handle(data.get('tele_id') or '')

    channel = Channel.query.filter_by(code=code).first()
    if not channel:
        return json_error('Channel not found')

    exists = ChannelMember.query.filter_by(channel_code=code, tele_id=tele_id).first()
    if not exists:
        db.session.add(ChannelMember(channel_code=code, tele_id=tele_id))
        db.session.commit()

    return jsonify({'status': 'success', 'channel': {'name': channel.name, 'code': channel.code, 'pfp': channel.pfp or '', 'description': channel.description or '', 'owner_id': channel.owner_id}})


@app.route('/recent_chats/<my_id>')
def recent_chats(my_id):
    my_id = normalize_handle(my_id)
    chat_dict = {}
    messages = Message.query.order_by(Message.timestamp.desc()).all()

    for msg in messages:
        kind = room_kind(msg.room)
        if kind == 'private':
            if my_id not in msg.room.split('_'):
                continue
            if msg.room in chat_dict:
                continue
            a, b = msg.room.split('_', 1)
            other_id = a if b == my_id else b
            other_user = User.query.filter_by(tele_id=other_id).first()
            if not other_user:
                continue
            last_msg = 'Deleted' if msg.is_deleted else (msg.content if msg.msg_type == 'text' else f'[{msg.msg_type}]')
            chat_dict[msg.room] = {
                'kind': 'private',
                'is_group': False,
                'is_channel': False,
                'id': other_id,
                'name': other_user.username,
                'pfp': other_user.pfp or '',
                'last_msg': last_msg,
                'timestamp': to_iso(msg.timestamp),
                **presence_payload(other_user),
            }
        elif kind == 'group':
            code = msg.room.replace('group_', '', 1)
            if my_id not in get_group_members(code):
                continue
            if msg.room in chat_dict:
                continue
            group = Group.query.filter_by(code=code).first()
            if not group:
                continue
            body = 'Deleted' if msg.is_deleted else (msg.content if msg.msg_type == 'text' else f'[{msg.msg_type}]')
            chat_dict[msg.room] = {
                'kind': 'group',
                'is_group': True,
                'is_channel': False,
                'id': group.code,
                'name': group.name,
                'pfp': group.pfp or '',
                'description': group.description or '',
                'last_msg': f'{msg.sender_name}: {body}',
                'timestamp': to_iso(msg.timestamp),
            }
        else:
            code = msg.room.replace('channel_', '', 1)
            if my_id not in get_channel_members(code):
                continue
            if msg.room in chat_dict:
                continue
            channel = Channel.query.filter_by(code=code).first()
            if not channel:
                continue
            body = 'Deleted' if msg.is_deleted else (msg.content if msg.msg_type == 'text' else f'[{msg.msg_type}]')
            chat_dict[msg.room] = {
                'kind': 'channel',
                'is_group': False,
                'is_channel': True,
                'id': channel.code,
                'name': channel.name,
                'pfp': channel.pfp or '',
                'description': channel.description or '',
                'last_msg': f'{msg.sender_name}: {body}',
                'timestamp': to_iso(msg.timestamp),
                'owner_id': channel.owner_id,
            }

    memberships = GroupMember.query.filter_by(tele_id=my_id).all()
    for membership in memberships:
        group = Group.query.filter_by(code=membership.group_code).first()
        if not group:
            continue
        room_name = f'group_{group.code}'
        if room_name in chat_dict:
            continue
        chat_dict[room_name] = {
            'kind': 'group', 'is_group': True, 'is_channel': False,
            'id': group.code, 'name': group.name, 'pfp': group.pfp or '', 'description': group.description or '',
            'last_msg': 'No messages yet', 'timestamp': None,
        }

    channel_memberships = ChannelMember.query.filter_by(tele_id=my_id).all()
    for membership in channel_memberships:
        channel = Channel.query.filter_by(code=membership.channel_code).first()
        if not channel:
            continue
        room_name = f'channel_{channel.code}'
        if room_name in chat_dict:
            continue
        chat_dict[room_name] = {
            'kind': 'channel', 'is_group': False, 'is_channel': True,
            'id': channel.code, 'name': channel.name, 'pfp': channel.pfp or '', 'description': channel.description or '',
            'last_msg': channel.description or 'Broadcast channel', 'timestamp': None, 'owner_id': channel.owner_id,
        }

    result = sorted(chat_dict.values(), key=lambda item: item.get('timestamp') or '', reverse=True)
    return jsonify(result)


@app.route('/history/<path:room>')
def get_history(room):
    messages = Message.query.filter_by(room=room).order_by(Message.timestamp.asc()).all()
    result = []
    for msg in messages:
        user = User.query.filter_by(tele_id=msg.sender_id).first()
        result.append({
            'id': msg.id,
            'room': msg.room,
            'sender_id': msg.sender_id,
            'sender_name': msg.sender_name,
            'sender_pfp': user.pfp if user else '',
            'content': msg.content,
            'msg_type': msg.msg_type,
            'file_url': msg.file_url or '',
            'is_deleted': msg.is_deleted,
            'timestamp': to_iso(msg.timestamp),
        })
    return jsonify(result)


@app.route('/profile/<tele_id>')
def profile(tele_id):
    tele_id = normalize_handle(tele_id)
    user = User.query.filter_by(tele_id=tele_id).first()
    if user:
        return jsonify({'status': 'success', 'kind': 'user', 'username': user.username, 'tele_id': user.tele_id, 'pfp': user.pfp or '', 'bio': user.bio or '', **presence_payload(user)})

    group = Group.query.filter_by(code=tele_id).first()
    if group:
        return jsonify({'status': 'success', 'kind': 'group', 'name': group.name, 'tele_id': group.code, 'pfp': group.pfp or '', 'description': group.description or '', 'member_count': len(get_group_members(group.code)), 'owner_id': group.owner_id})

    channel = Channel.query.filter_by(code=tele_id).first()
    if channel:
        return jsonify({'status': 'success', 'kind': 'channel', 'name': channel.name, 'tele_id': channel.code, 'pfp': channel.pfp or '', 'description': channel.description or '', 'member_count': len(get_channel_members(channel.code)), 'owner_id': channel.owner_id})

    return json_error('Profile not found', 404)


@app.route('/update_profile', methods=['POST'])
def update_profile():
    data = request.json or {}
    tele_id = normalize_handle(data.get('tele_id') or '')
    username = (data.get('username') or '').strip()
    bio = (data.get('bio') or '').strip()[:280]

    if not tele_id or not username:
        return json_error('Fill all fields')
    user = User.query.filter_by(tele_id=tele_id).first()
    if not user:
        return json_error('User not found', 404)

    user.username = username
    user.bio = bio
    db.session.commit()
    return jsonify({'status': 'success', 'username': user.username, 'tele_id': user.tele_id, 'pfp': user.pfp or '', 'bio': user.bio or ''})


@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return json_error('No file')
    file = request.files['file']
    try:
        file_url, detected_type = save_upload(file)
    except ValueError as exc:
        return json_error(str(exc))

    upload_type = (request.form.get('type') or '').strip()
    if upload_type == 'pfp':
        tele_id = normalize_handle(request.form.get('tele_id') or '')
        user = User.query.filter_by(tele_id=tele_id).first()
        if not user:
            return json_error('User not found', 404)
        user.pfp = file_url
        db.session.commit()
        return jsonify({'status': 'success', 'url': file_url, 'type': 'pfp'})

    return jsonify({'status': 'success', 'url': file_url, 'type': detected_type})


# ---------- socket events ----------
@socketio.on('connect')
def on_connect():
    pass


@socketio.on('presence_online')
def presence_online(data):
    my_id = normalize_handle((data or {}).get('my_id') or '')
    if not my_id:
        return
    join_room(my_id)
    touch_online(my_id, request.sid)


@socketio.on('disconnect')
def on_disconnect():
    for tele_id, sids in list(active_users.items()):
        if request.sid in sids:
            touch_offline(tele_id, request.sid)
            break


@socketio.on('presence_offline')
def presence_offline(data):
    my_id = normalize_handle((data or {}).get('my_id') or '')
    if my_id:
        touch_offline(my_id, request.sid)


@socketio.on('join_chat')
def join_chat(data):
    room = (data or {}).get('room')
    if room:
        join_room(room)


@socketio.on('private_message')
def handle_private_message(data):
    room = (data or {}).get('room', '')
    sender_id = normalize_handle((data or {}).get('sender_id', ''))
    sender_name = (data or {}).get('sender_name', '')
    msg_type = (data or {}).get('msg_type', 'text')
    content = (data or {}).get('content', '')
    file_url = (data or {}).get('file_url', '')
    target_id = normalize_handle((data or {}).get('target_id', ''))

    if not room or not sender_id or not sender_name:
        return
    if not content and not file_url:
        return
    if not can_post_in_room(sender_id, room):
        emit('action_error', {'message': 'Only the channel owner can post here.'}, room=request.sid)
        return

    msg = Message(room=room, sender_id=sender_id, sender_name=sender_name, content=content, msg_type=msg_type, file_url=file_url)
    db.session.add(msg)
    db.session.commit()

    sender = User.query.filter_by(tele_id=sender_id).first()
    payload = {
        **(data or {}),
        'id': msg.id,
        'room': room,
        'sender_pfp': sender.pfp if sender else '',
        'timestamp': to_iso(msg.timestamp),
    }
    emit('new_message', payload, room=room)

    kind = room_kind(room)
    if kind == 'group':
        for member_id in get_group_members(target_id):
            emit('ping_radar', payload, room=member_id)
    elif kind == 'channel':
        for member_id in get_channel_members(target_id):
            emit('ping_radar', payload, room=member_id)
    else:
        emit('ping_radar', payload, room=target_id)
        emit('ping_radar', payload, room=sender_id)


@socketio.on('typing')
def handle_typing(data):
    room = (data or {}).get('room', '')
    tele_id = normalize_handle((data or {}).get('tele_id', ''))
    name = (data or {}).get('name', '')
    target_id = normalize_handle((data or {}).get('target_id', ''))
    is_typing = bool((data or {}).get('is_typing', False))
    if not room or not tele_id:
        return
    payload = {'room': room, 'tele_id': tele_id, 'name': name, 'is_typing': is_typing}
    if room_kind(room) == 'private':
        emit('typing', payload, room=target_id)
    else:
        emit('typing', payload, room=room, include_self=False)


@socketio.on('delete_message')
def delete_message(data):
    msg_id = (data or {}).get('msg_id')
    sender_id = normalize_handle((data or {}).get('sender_id'))
    msg = Message.query.get(msg_id)
    if not msg or msg.sender_id != sender_id:
        return
    msg.is_deleted = True
    db.session.commit()
    emit('message_deleted', {'msg_id': msg.id, 'room': msg.room}, room=msg.room)

    kind = room_kind(msg.room)
    if kind == 'group':
        for member_id in get_group_members(msg.room.replace('group_', '', 1)):
            emit('ping_radar', {}, room=member_id)
    elif kind == 'channel':
        for member_id in get_channel_members(msg.room.replace('channel_', '', 1)):
            emit('ping_radar', {}, room=member_id)
    else:
        for uid in msg.room.split('_'):
            emit('ping_radar', {}, room=uid)


@socketio.on('call_user')
def call_user(data):
    emit('incoming_call', data, room=normalize_handle((data or {}).get('target_id')))


@socketio.on('answer_call')
def answer_call(data):
    emit('call_answered', data, room=normalize_handle((data or {}).get('target_id')))


@socketio.on('ice_candidate')
def ice_candidate(data):
    emit('ice_candidate', data, room=normalize_handle((data or {}).get('target_id')))


@socketio.on('reject_call')
def reject_call(data):
    emit('call_rejected', {}, room=normalize_handle((data or {}).get('target_id')))


@socketio.on('end_call')
def end_call(data):
    emit('call_ended', {}, room=normalize_handle((data or {}).get('target_id')))


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)), debug=False)
