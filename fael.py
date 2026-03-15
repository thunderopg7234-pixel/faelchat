from __future__ import annotations

import os
import uuid
from datetime import datetime
from pathlib import Path

try:
    import eventlet
    eventlet.monkey_patch()
    SOCKET_ASYNC_MODE = 'eventlet'
except Exception:
    eventlet = None
    SOCKET_ASYNC_MODE = 'threading'

from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room, leave_room
from sqlalchemy import or_, text, inspect
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
socketio = SocketIO(app, cors_allowed_origins='*', max_http_buffer_size=100 * 1024 * 1024, async_mode=SOCKET_ASYNC_MODE)

ONLINE_USERS: dict[str, str] = {}
ROOM_TYPING: dict[str, set[str]] = {}


class User(db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), nullable=False)
    tele_id = db.Column(db.String(50), unique=True, nullable=False, index=True)
    password = db.Column(db.String(50), nullable=False)
    pfp = db.Column(db.String(255), default='')
    bio = db.Column(db.String(280), default='')
    theme = db.Column(db.String(32), default='midnight-cyan')
    last_seen_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class Message(db.Model):
    __tablename__ = 'message'
    id = db.Column(db.Integer, primary_key=True)
    room = db.Column(db.String(100), nullable=False, index=True)
    sender_id = db.Column(db.String(50), nullable=False)
    sender_name = db.Column(db.String(50), nullable=False)
    content = db.Column(db.Text, nullable=False, default='')
    msg_type = db.Column(db.String(20), default='text')
    file_url = db.Column(db.String(255), default='')
    is_deleted = db.Column(db.Boolean, default=False)
    edited_at = db.Column(db.DateTime, nullable=True)
    reply_to_id = db.Column(db.Integer, nullable=True, index=True)
    reactions = db.Column(db.Text, default='')
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class Group(db.Model):
    __tablename__ = 'group'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    code = db.Column(db.String(50), unique=True, nullable=False, index=True)
    pfp = db.Column(db.String(255), default='')
    description = db.Column(db.String(280), default='')
    kind = db.Column(db.String(20), default='group')  # group or channel
    owner_id = db.Column(db.String(50), default='')
    pin_message_id = db.Column(db.Integer, nullable=True)


class GroupMember(db.Model):
    __tablename__ = 'group_member'
    id = db.Column(db.Integer, primary_key=True)
    group_code = db.Column(db.String(50), nullable=False, index=True)
    tele_id = db.Column(db.String(50), nullable=False, index=True)
    role = db.Column(db.String(20), default='member')


def ensure_schema():
    engine = db.engine
    inspector = inspect(engine)

    def add_column_if_missing(table_name: str, column_name: str, ddl: str):
        if table_name not in inspector.get_table_names():
            return
        columns = {col['name'] for col in inspector.get_columns(table_name)}
        if column_name in columns:
            return
        with engine.begin() as conn:
            conn.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN "{column_name}" {ddl}'))

    add_column_if_missing('user', 'bio', "VARCHAR(280) DEFAULT ''")
    add_column_if_missing('user', 'theme', "VARCHAR(32) DEFAULT 'midnight-cyan'")
    add_column_if_missing('user', 'last_seen_at', "TIMESTAMP")
    add_column_if_missing('message', 'edited_at', 'TIMESTAMP')
    add_column_if_missing('message', 'reply_to_id', 'INTEGER')
    add_column_if_missing('message', 'reactions', "TEXT DEFAULT ''")
    add_column_if_missing('group', 'description', "VARCHAR(280) DEFAULT ''")
    add_column_if_missing('group', 'kind', "VARCHAR(20) DEFAULT 'group'")
    add_column_if_missing('group', 'owner_id', "VARCHAR(50) DEFAULT ''")
    add_column_if_missing('group', 'pin_message_id', 'INTEGER')
    add_column_if_missing('group_member', 'role', "VARCHAR(20) DEFAULT 'member'")

    with engine.begin() as conn:
        conn.execute(text('UPDATE "user" SET last_seen_at = CURRENT_TIMESTAMP WHERE last_seen_at IS NULL'))
        conn.execute(text("UPDATE \"group\" SET kind = 'group' WHERE kind IS NULL OR kind = ''"))
        conn.execute(text("UPDATE \"group_member\" SET role = 'member' WHERE role IS NULL OR role = ''"))
        conn.execute(text("UPDATE \"message\" SET reactions = '' WHERE reactions IS NULL"))


with app.app_context():
    db.create_all()
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
    return f'/static/uploads/{unique_name}', get_file_type(original_name)


def normalize_handle(value: str) -> str:
    return (value or '').strip().lstrip('@').replace(' ', '').lower()


def avatar_payload(name: str, pfp: str) -> dict:
    return {'name': name, 'pfp': pfp or ''}


def make_room(my_id: str, target_id: str, is_group: bool) -> str:
    return f'group_{target_id}' if is_group else '_'.join(sorted([my_id, target_id]))


def is_online(tele_id: str) -> bool:
    return tele_id in ONLINE_USERS


def format_user_status(user: User | None):
    if not user:
        return {'online': False, 'last_seen_label': 'Unavailable', 'last_seen_at': None}
    if is_online(user.tele_id):
        return {'online': True, 'last_seen_label': 'online', 'last_seen_at': user.last_seen_at.isoformat() if user.last_seen_at else None}
    if not user.last_seen_at:
        return {'online': False, 'last_seen_label': 'last seen recently', 'last_seen_at': None}
    return {
        'online': False,
        'last_seen_label': f'last seen {user.last_seen_at.isoformat()}',
        'last_seen_at': user.last_seen_at.isoformat(),
    }


def parse_reactions(raw: str) -> dict:
    result: dict[str, list[str]] = {}
    if not raw:
        return result
    for item in raw.split('|'):
        if not item or ':' not in item:
            continue
        emoji, users = item.split(':', 1)
        result[emoji] = [u for u in users.split(',') if u]
    return result


def serialize_reactions(reactions: dict) -> str:
    chunks = []
    for emoji, users in reactions.items():
        clean = sorted({u for u in users if u})
        if clean:
            chunks.append(f"{emoji}:{','.join(clean)}")
    return '|'.join(chunks)


def reaction_summary(raw: str) -> list[dict]:
    items = []
    for emoji, users in parse_reactions(raw).items():
        items.append({'emoji': emoji, 'count': len(users), 'users': users})
    return items


def can_post(actor_id: str, target_code: str, is_group: bool) -> bool:
    if not is_group:
        return True
    group = Group.query.filter_by(code=target_code).first()
    if not group:
        return False
    if group.kind != 'channel':
        return True
    member = GroupMember.query.filter_by(group_code=target_code, tele_id=actor_id).first()
    return bool(member and member.role in {'owner', 'admin'})


def message_payload(msg: Message) -> dict:
    sender = User.query.filter_by(tele_id=msg.sender_id).first()
    reply_message = Message.query.get(msg.reply_to_id) if msg.reply_to_id else None
    return {
        'id': msg.id,
        'room': msg.room,
        'sender_id': msg.sender_id,
        'sender_name': msg.sender_name,
        'sender_pfp': sender.pfp if sender else '',
        'content': msg.content,
        'msg_type': msg.msg_type,
        'file_url': msg.file_url or '',
        'is_deleted': msg.is_deleted,
        'timestamp': msg.timestamp.isoformat(),
        'edited_at': msg.edited_at.isoformat() if msg.edited_at else None,
        'reply_to_id': msg.reply_to_id,
        'reply_preview': {
            'id': reply_message.id,
            'sender_name': reply_message.sender_name,
            'content': reply_message.content,
            'msg_type': reply_message.msg_type,
            'file_url': reply_message.file_url,
        } if reply_message else None,
        'reactions': reaction_summary(msg.reactions),
    }


def room_meta_for_code(code: str):
    room = Group.query.filter_by(code=code).first()
    if not room:
        return None
    member_count = GroupMember.query.filter_by(group_code=code).count()
    pin = Message.query.get(room.pin_message_id) if room.pin_message_id else None
    return {
        'name': room.name,
        'code': room.code,
        'pfp': room.pfp or '',
        'description': room.description or '',
        'kind': room.kind,
        'owner_id': room.owner_id or '',
        'member_count': member_count,
        'pin_message': message_payload(pin) if pin else None,
    }


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
    return jsonify({'status': 'success', 'username': user.username, 'tele_id': user.tele_id, 'pfp': user.pfp or '', 'bio': user.bio or '', 'theme': user.theme or 'midnight-cyan'})


@app.route('/login', methods=['POST'])
def login():
    data = request.json or {}
    tele_id = normalize_handle(data.get('tele_id') or '')
    password = (data.get('password') or '').strip()
    user = User.query.filter_by(tele_id=tele_id, password=password).first()
    if not user:
        return json_error('Invalid credentials', 401)
    return jsonify({
        'status': 'success',
        'username': user.username,
        'tele_id': user.tele_id,
        'pfp': user.pfp or '',
        'bio': user.bio or '',
        'theme': user.theme or 'midnight-cyan',
    })


@app.route('/search_suggestions')
def search_suggestions():
    q = normalize_handle(request.args.get('q') or '')
    my_id = normalize_handle(request.args.get('my_id') or '')
    if not q:
        return jsonify([])
    like_term = f'%{q}%'
    users = User.query.filter(or_(User.tele_id.ilike(like_term), User.username.ilike(like_term))).order_by(
        db.case((User.tele_id.ilike(q), 0), (User.tele_id.ilike(f'{q}%'), 1), else_=2), User.username.asc()
    ).limit(8).all()
    groups = Group.query.filter(or_(Group.code.ilike(like_term), Group.name.ilike(like_term))).order_by(
        db.case((Group.code.ilike(q), 0), (Group.code.ilike(f'{q}%'), 1), else_=2), Group.name.asc()
    ).limit(8).all()
    results = []
    for user in users:
        if user.tele_id == my_id:
            continue
        results.append({
            'type': 'user', 'name': user.username, 'id': user.tele_id, 'pfp': user.pfp or '', 'bio': user.bio or '',
            **format_user_status(user)
        })
    for group in groups:
        results.append({
            'type': group.kind, 'name': group.name, 'id': group.code, 'pfp': group.pfp or '', 'description': group.description or ''
        })
    return jsonify(results[:12])


@app.route('/create_room', methods=['POST'])
def create_room():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    code = normalize_handle(data.get('code') or '')
    creator_id = normalize_handle(data.get('creator_id') or '')
    kind = (data.get('kind') or 'group').strip().lower()
    description = (data.get('description') or '').strip()[:280]
    if kind not in {'group', 'channel'}:
        kind = 'group'
    if not name or not code or not creator_id:
        return json_error('Fill all fields')
    if Group.query.filter_by(code=code).first():
        return json_error(f'{kind.title()} code already exists!')
    room = Group(name=name, code=code, kind=kind, description=description, owner_id=creator_id)
    db.session.add(room)
    db.session.add(GroupMember(group_code=code, tele_id=creator_id, role='owner'))
    db.session.commit()
    return jsonify({'status': 'success', 'room': room_meta_for_code(code)})


@app.route('/join_room', methods=['POST'])
def join_room_route():
    data = request.json or {}
    code = normalize_handle(data.get('code') or '')
    tele_id = normalize_handle(data.get('tele_id') or '')
    room = Group.query.filter_by(code=code).first()
    if not room:
        return json_error('Room not found')
    member = GroupMember.query.filter_by(group_code=code, tele_id=tele_id).first()
    if not member:
        db.session.add(GroupMember(group_code=code, tele_id=tele_id, role='member'))
        db.session.commit()
    return jsonify({'status': 'success', 'room': room_meta_for_code(code)})


@app.route('/recent_chats/<my_id>')
def recent_chats(my_id):
    my_id = normalize_handle(my_id)
    chat_dict = {}
    messages = Message.query.filter(Message.room.contains(my_id)).order_by(Message.timestamp.desc()).all()
    for msg in messages:
        if msg.room.startswith('group_'):
            continue
        if msg.room in chat_dict:
            continue
        parts = msg.room.split('_')
        if len(parts) != 2:
            continue
        other_id = parts[0] if parts[1] == my_id else parts[1]
        if other_id == my_id:
            continue
        other_user = User.query.filter_by(tele_id=other_id).first()
        if not other_user:
            continue
        last_msg = 'Deleted' if msg.is_deleted else (msg.content if msg.msg_type == 'text' else f'[{msg.msg_type}]')
        chat_dict[msg.room] = {
            'is_group': False,
            'id': other_id,
            'name': other_user.username,
            'pfp': other_user.pfp or '',
            'bio': other_user.bio or '',
            'last_msg': last_msg,
            'time': msg.timestamp.isoformat(),
            'ts': msg.timestamp.timestamp(),
            **format_user_status(other_user),
        }
    memberships = GroupMember.query.filter_by(tele_id=my_id).all()
    for membership in memberships:
        room = Group.query.filter_by(code=membership.group_code).first()
        if not room:
            continue
        room_name = f'group_{room.code}'
        last_msg = Message.query.filter_by(room=room_name).order_by(Message.timestamp.desc()).first()
        last_text, time_str, ts = 'No messages yet', '', 0
        if last_msg:
            body = 'Deleted' if last_msg.is_deleted else (last_msg.content if last_msg.msg_type == 'text' else f'[{last_msg.msg_type}]')
            prefix = '' if room.kind == 'channel' else f'{last_msg.sender_name}: '
            last_text = f'{prefix}{body}'
            time_str = last_msg.timestamp.isoformat()
            ts = last_msg.timestamp.timestamp()
        chat_dict[room_name] = {
            'is_group': True,
            'id': room.code,
            'name': room.name,
            'pfp': room.pfp or '',
            'description': room.description or '',
            'kind': room.kind,
            'role': membership.role,
            'last_msg': last_text,
            'time': time_str,
            'ts': ts,
        }
    result = sorted(chat_dict.values(), key=lambda item: item.get('ts', 0), reverse=True)
    for item in result:
        item.pop('ts', None)
    return jsonify(result)


@app.route('/history/<path:room>')
def get_history(room):
    messages = Message.query.filter_by(room=room).order_by(Message.timestamp.asc()).all()
    result = [message_payload(msg) for msg in messages]
    return jsonify(result)


@app.route('/profile/<tele_id>')
def profile(tele_id):
    user = User.query.filter_by(tele_id=normalize_handle(tele_id)).first()
    if not user:
        return json_error('User not found', 404)
    payload = {'status': 'success', 'username': user.username, 'tele_id': user.tele_id, 'pfp': user.pfp or '', 'bio': user.bio or '', **format_user_status(user)}
    return jsonify(payload)


@app.route('/room_meta/<code>')
def room_meta(code):
    meta = room_meta_for_code(normalize_handle(code))
    if not meta:
        return json_error('Room not found', 404)
    return jsonify({'status': 'success', 'room': meta})


@app.route('/update_profile', methods=['POST'])
def update_profile():
    data = request.json or {}
    tele_id = normalize_handle(data.get('tele_id') or '')
    username = (data.get('username') or '').strip()
    bio = (data.get('bio') or '').strip()[:280]
    theme = (data.get('theme') or '').strip()
    if not tele_id or not username:
        return json_error('Fill all fields')
    user = User.query.filter_by(tele_id=tele_id).first()
    if not user:
        return json_error('User not found', 404)
    user.username = username
    user.bio = bio
    if theme:
        user.theme = theme
    db.session.commit()
    return jsonify({'status': 'success', 'username': user.username, 'tele_id': user.tele_id, 'pfp': user.pfp or '', 'bio': user.bio or '', 'theme': user.theme or 'midnight-cyan'})


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
    tele_id = normalize_handle(request.form.get('tele_id') or '')
    target_code = normalize_handle(request.form.get('target_code') or '')

    if upload_type == 'pfp':
        user = User.query.filter_by(tele_id=tele_id).first()
        if not user:
            return json_error('User not found', 404)
        user.pfp = file_url
        db.session.commit()
        return jsonify({'status': 'success', 'url': file_url, 'type': 'pfp'})

    if upload_type == 'room_pfp':
        room = Group.query.filter_by(code=target_code).first()
        if not room:
            return json_error('Room not found', 404)
        room.pfp = file_url
        db.session.commit()
        return jsonify({'status': 'success', 'url': file_url, 'type': 'room_pfp'})

    return jsonify({'status': 'success', 'url': file_url, 'type': detected_type})


# ---------- socket events ----------
@socketio.on('connect_radar')
def connect_radar(data):
    my_id = normalize_handle((data or {}).get('my_id') or '')
    if not my_id:
        return
    join_room(my_id)
    ONLINE_USERS[my_id] = request.sid
    user = User.query.filter_by(tele_id=my_id).first()
    if user:
        user.last_seen_at = datetime.utcnow()
        db.session.commit()
    emit('presence_update', {'tele_id': my_id, 'online': True, 'last_seen_at': datetime.utcnow().isoformat()}, broadcast=True)


@socketio.on('disconnect')
def disconnected():
    my_id = None
    for tele_id, sid in list(ONLINE_USERS.items()):
        if sid == request.sid:
            my_id = tele_id
            ONLINE_USERS.pop(tele_id, None)
            break
    if my_id:
        for room, typers in ROOM_TYPING.items():
            if my_id in typers:
                typers.discard(my_id)
                emit('typing_update', {'room': room, 'users': list(typers)}, room=room)
        user = User.query.filter_by(tele_id=my_id).first()
        if user:
            user.last_seen_at = datetime.utcnow()
            db.session.commit()
            emit('presence_update', {'tele_id': my_id, 'online': False, 'last_seen_at': user.last_seen_at.isoformat()}, broadcast=True)


@socketio.on('join_chat')
def join_chat_socket(data):
    room = (data or {}).get('room')
    if room:
        join_room(room)


@socketio.on('leave_chat')
def leave_chat_socket(data):
    room = (data or {}).get('room')
    if room:
        leave_room(room)


@socketio.on('typing')
def typing_socket(data):
    room = (data or {}).get('room', '')
    user_id = normalize_handle((data or {}).get('user_id') or '')
    is_typing = bool((data or {}).get('is_typing'))
    if not room or not user_id:
        return
    typers = ROOM_TYPING.setdefault(room, set())
    if is_typing:
        typers.add(user_id)
    else:
        typers.discard(user_id)
    emit('typing_update', {'room': room, 'users': list(typers)}, room=room)


@socketio.on('private_message')
def handle_private_message(data):
    room = (data or {}).get('room', '')
    sender_id = normalize_handle((data or {}).get('sender_id', ''))
    sender_name = (data or {}).get('sender_name', '')
    msg_type = (data or {}).get('msg_type', 'text')
    content = (data or {}).get('content', '')
    file_url = (data or {}).get('file_url', '')
    target_id = normalize_handle((data or {}).get('target_id') or '')
    is_group = bool((data or {}).get('is_group'))
    reply_to_id = (data or {}).get('reply_to_id')

    if not room or not sender_id or not sender_name:
        return
    if not content and not file_url:
        return
    if not can_post(sender_id, target_id, is_group):
        emit('flash_error', {'message': 'Only channel admins can post there.'}, room=request.sid)
        return

    msg = Message(room=room, sender_id=sender_id, sender_name=sender_name, content=content, msg_type=msg_type, file_url=file_url, reply_to_id=reply_to_id)
    db.session.add(msg)
    db.session.commit()

    payload = message_payload(msg)
    payload.update({'target_id': target_id, 'is_group': is_group})
    emit('new_message', payload, room=room)

    if room in ROOM_TYPING:
        ROOM_TYPING[room].discard(sender_id)
        emit('typing_update', {'room': room, 'users': list(ROOM_TYPING[room])}, room=room)

    if is_group:
        members = GroupMember.query.filter_by(group_code=target_id).all()
        for member in members:
            emit('ping_radar', payload, room=member.tele_id)
    else:
        emit('ping_radar', payload, room=target_id)
        emit('ping_radar', payload, room=sender_id)


@socketio.on('delete_message')
def delete_message(data):
    msg_id = (data or {}).get('msg_id')
    sender_id = normalize_handle((data or {}).get('sender_id') or '')
    msg = Message.query.get(msg_id)
    if not msg or msg.sender_id != sender_id:
        return
    msg.is_deleted = True
    db.session.commit()
    emit('message_deleted', {'msg_id': msg.id, 'room': msg.room}, room=msg.room)
    for uid in msg.room.replace('group_', '').split('_'):
        emit('ping_radar', {}, room=uid)


@socketio.on('edit_message')
def edit_message(data):
    msg_id = (data or {}).get('msg_id')
    sender_id = normalize_handle((data or {}).get('sender_id') or '')
    content = ((data or {}).get('content') or '').strip()
    msg = Message.query.get(msg_id)
    if not msg or msg.sender_id != sender_id or msg.is_deleted or not content:
        return
    msg.content = content[:4000]
    msg.edited_at = datetime.utcnow()
    db.session.commit()
    emit('message_edited', message_payload(msg), room=msg.room)


@socketio.on('toggle_reaction')
def toggle_reaction(data):
    msg_id = (data or {}).get('msg_id')
    user_id = normalize_handle((data or {}).get('user_id') or '')
    emoji = (data or {}).get('emoji') or '❤️'
    msg = Message.query.get(msg_id)
    if not msg or not user_id or msg.is_deleted:
        return
    reactions = parse_reactions(msg.reactions)
    users = set(reactions.get(emoji, []))
    if user_id in users:
        users.remove(user_id)
    else:
        users.add(user_id)
    if users:
        reactions[emoji] = sorted(users)
    elif emoji in reactions:
        del reactions[emoji]
    msg.reactions = serialize_reactions(reactions)
    db.session.commit()
    emit('reactions_updated', {'msg_id': msg.id, 'reactions': reaction_summary(msg.reactions), 'room': msg.room}, room=msg.room)


@socketio.on('pin_message')
def pin_message(data):
    code = normalize_handle((data or {}).get('target_id') or '')
    actor_id = normalize_handle((data or {}).get('actor_id') or '')
    msg_id = (data or {}).get('msg_id')
    room = Group.query.filter_by(code=code).first()
    member = GroupMember.query.filter_by(group_code=code, tele_id=actor_id).first()
    if not room or not member or member.role not in {'owner', 'admin'}:
        return
    room.pin_message_id = msg_id
    db.session.commit()
    emit('room_meta_updated', {'target_id': code, 'room': room_meta_for_code(code)}, room=f'group_{code}')


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)), debug=False)
