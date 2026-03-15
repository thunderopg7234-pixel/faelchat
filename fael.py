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
    privacy_last_seen = db.Column(db.String(20), default='everyone')
    blocked_users = db.Column(db.Text, default='')
    last_seen_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    status_text = db.Column(db.String(120), default='')
    banner_url = db.Column(db.String(255), default='')
    profile_music = db.Column(db.String(120), default='')
    mood = db.Column(db.String(60), default='')
    birthday = db.Column(db.String(20), default='')
    profile_color = db.Column(db.String(32), default='')
    premium_emoji = db.Column(db.String(16), default='')


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
    delivered_to = db.Column(db.Text, default='')
    seen_by = db.Column(db.Text, default='')
    forwarded_from = db.Column(db.String(120), default='')
    expires_at = db.Column(db.DateTime, nullable=True)
    edit_history = db.Column(db.Text, default='')
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class Group(db.Model):
    __tablename__ = 'group'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    code = db.Column(db.String(50), unique=True, nullable=False, index=True)
    pfp = db.Column(db.String(255), default='')
    description = db.Column(db.String(280), default='')
    kind = db.Column(db.String(20), default='group')  # group or channel
    visibility = db.Column(db.String(20), default='public')
    invite_token = db.Column(db.String(64), default='')
    owner_id = db.Column(db.String(50), default='')
    pin_message_id = db.Column(db.Integer, nullable=True)
    join_approval = db.Column(db.Boolean, default=False)
    public_handle = db.Column(db.String(60), default='')
    rules_text = db.Column(db.Text, default='')
    welcome_message = db.Column(db.String(200), default='')
    slow_mode_seconds = db.Column(db.Integer, default=0)
    is_verified = db.Column(db.Boolean, default=False)
    wallpaper = db.Column(db.String(255), default='')


class GroupMember(db.Model):
    __tablename__ = 'group_member'
    id = db.Column(db.Integer, primary_key=True)
    group_code = db.Column(db.String(50), nullable=False, index=True)
    tele_id = db.Column(db.String(50), nullable=False, index=True)
    role = db.Column(db.String(20), default='member')


class JoinRequest(db.Model):
    __tablename__ = 'join_request'
    id = db.Column(db.Integer, primary_key=True)
    group_code = db.Column(db.String(50), nullable=False, index=True)
    tele_id = db.Column(db.String(50), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class AdminLog(db.Model):
    __tablename__ = 'admin_log'
    id = db.Column(db.Integer, primary_key=True)
    group_code = db.Column(db.String(50), nullable=False, index=True)
    actor_id = db.Column(db.String(50), default='')
    action = db.Column(db.String(120), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class UploadAsset(db.Model):
    __tablename__ = 'upload_asset'
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), default='')
    mime_type = db.Column(db.String(120), default='application/octet-stream')
    kind = db.Column(db.String(20), default='file')
    blob = db.Column(db.LargeBinary, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


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
    add_column_if_missing('user', 'privacy_last_seen', "VARCHAR(20) DEFAULT 'everyone'")
    add_column_if_missing('user', 'blocked_users', "TEXT DEFAULT ''")
    add_column_if_missing('user', 'last_seen_at', "TIMESTAMP")
    add_column_if_missing('user', 'status_text', "VARCHAR(120) DEFAULT ''")
    add_column_if_missing('user', 'banner_url', "VARCHAR(255) DEFAULT ''")
    add_column_if_missing('user', 'profile_music', "VARCHAR(120) DEFAULT ''")
    add_column_if_missing('user', 'mood', "VARCHAR(60) DEFAULT ''")
    add_column_if_missing('user', 'birthday', "VARCHAR(20) DEFAULT ''")
    add_column_if_missing('user', 'profile_color', "VARCHAR(32) DEFAULT ''")
    add_column_if_missing('user', 'premium_emoji', "VARCHAR(16) DEFAULT ''")
    add_column_if_missing('group', 'wallpaper', "VARCHAR(255) DEFAULT ''")
    add_column_if_missing('message', 'edited_at', 'TIMESTAMP')
    add_column_if_missing('message', 'reply_to_id', 'INTEGER')
    add_column_if_missing('message', 'reactions', "TEXT DEFAULT ''")
    add_column_if_missing('message', 'delivered_to', "TEXT DEFAULT ''")
    add_column_if_missing('message', 'seen_by', "TEXT DEFAULT ''")
    add_column_if_missing('message', 'forwarded_from', "VARCHAR(120) DEFAULT ''")
    add_column_if_missing('message', 'expires_at', 'TIMESTAMP')
    add_column_if_missing('message', 'edit_history', "TEXT DEFAULT ''")
    add_column_if_missing('group', 'description', "VARCHAR(280) DEFAULT ''")
    add_column_if_missing('group', 'kind', "VARCHAR(20) DEFAULT 'group'")
    add_column_if_missing('group', 'visibility', "VARCHAR(20) DEFAULT 'public'")
    add_column_if_missing('group', 'invite_token', "VARCHAR(64) DEFAULT ''")
    add_column_if_missing('group', 'owner_id', "VARCHAR(50) DEFAULT ''")
    add_column_if_missing('group', 'pin_message_id', 'INTEGER')
    add_column_if_missing('group', 'join_approval', 'BOOLEAN DEFAULT FALSE')
    add_column_if_missing('group', 'public_handle', "VARCHAR(60) DEFAULT ''")
    add_column_if_missing('group', 'rules_text', "TEXT DEFAULT ''")
    add_column_if_missing('group', 'welcome_message', "VARCHAR(200) DEFAULT ''")
    add_column_if_missing('group', 'slow_mode_seconds', 'INTEGER DEFAULT 0')
    add_column_if_missing('group', 'is_verified', 'BOOLEAN DEFAULT FALSE')
    add_column_if_missing('group_member', 'role', "VARCHAR(20) DEFAULT 'member'")

    with engine.begin() as conn:
        conn.execute(text('UPDATE "user" SET last_seen_at = CURRENT_TIMESTAMP WHERE last_seen_at IS NULL'))
        conn.execute(text("UPDATE \"group\" SET kind = 'group' WHERE kind IS NULL OR kind = ''"))
        conn.execute(text("UPDATE \"group\" SET visibility = 'public' WHERE visibility IS NULL OR visibility = ''"))
        conn.execute(text("UPDATE \"group\" SET invite_token = '' WHERE invite_token IS NULL"))
        conn.execute(text("UPDATE \"user\" SET privacy_last_seen = 'everyone' WHERE privacy_last_seen IS NULL OR privacy_last_seen = ''"))
        conn.execute(text("UPDATE \"user\" SET blocked_users = '' WHERE blocked_users IS NULL"))
        conn.execute(text("UPDATE \"group_member\" SET role = 'member' WHERE role IS NULL OR role = ''"))
        conn.execute(text("UPDATE \"message\" SET reactions = '' WHERE reactions IS NULL"))
        conn.execute(text("UPDATE \"message\" SET delivered_to = '' WHERE delivered_to IS NULL"))
        conn.execute(text("UPDATE \"message\" SET seen_by = '' WHERE seen_by IS NULL"))
        conn.execute(text("UPDATE \"message\" SET forwarded_from = '' WHERE forwarded_from IS NULL"))
        conn.execute(text("UPDATE \"message\" SET edit_history = '' WHERE edit_history IS NULL"))
        conn.execute(text("UPDATE \"group\" SET public_handle = '' WHERE public_handle IS NULL"))
        conn.execute(text("UPDATE \"group\" SET rules_text = '' WHERE rules_text IS NULL"))
        conn.execute(text("UPDATE \"group\" SET welcome_message = '' WHERE welcome_message IS NULL"))


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
    blob = file_storage.read()
    if not blob:
        raise ValueError('Empty file')
    kind = get_file_type(original_name)
    asset = UploadAsset(filename=original_name, mime_type=(getattr(file_storage, 'mimetype', None) or 'application/octet-stream'), kind=kind, blob=blob)
    db.session.add(asset)
    db.session.commit()
    return f'/asset/{asset.id}', kind


def normalize_handle(value: str) -> str:
    return (value or '').strip().lstrip('@').replace(' ', '').lower()


def avatar_payload(name: str, pfp: str) -> dict:
    return {'name': name, 'pfp': pfp or ''}


def make_room(my_id: str, target_id: str, is_group: bool) -> str:
    return f'group_{target_id}' if is_group else '_'.join(sorted([my_id, target_id]))


def is_online(tele_id: str) -> bool:
    return tele_id in ONLINE_USERS


def format_user_status(user: User | None, viewer_id: str = ''):
    if not user:
        return {'online': False, 'last_seen_label': 'Unavailable', 'last_seen_at': None}
    if is_online(user.tele_id):
        return {'online': True, 'last_seen_label': 'online', 'last_seen_at': user.last_seen_at.isoformat() if user.last_seen_at else None}
    if not can_view_last_seen(viewer_id, user):
        return {'online': False, 'last_seen_label': 'last seen hidden', 'last_seen_at': None}
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


def parse_simple_list(raw: str) -> list[str]:
    return [part for part in (raw or '').split(',') if part]


def append_simple_list(raw: str, value: str) -> str:
    value = normalize_handle(value)
    if not value:
        return raw or ''
    items = set(parse_simple_list(raw))
    items.add(value)
    return ','.join(sorted(items))




def parse_blocked(raw: str) -> set[str]:
    return {u for u in parse_simple_list(raw) if u}


def can_view_last_seen(viewer_id: str, user: User | None) -> bool:
    if not user:
        return False
    if normalize_handle(viewer_id) == user.tele_id:
        return True
    return (user.privacy_last_seen or 'everyone') != 'nobody'


def is_blocked(sender_id: str, receiver_id: str) -> bool:
    receiver = User.query.filter_by(tele_id=normalize_handle(receiver_id)).first()
    if not receiver:
        return False
    return normalize_handle(sender_id) in parse_blocked(receiver.blocked_users)

def add_admin_log(group_code: str, actor_id: str, action: str):
    try:
        db.session.add(AdminLog(group_code=group_code, actor_id=actor_id or '', action=action[:120]))
        db.session.commit()
    except Exception:
        db.session.rollback()

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
        'delivered_to': parse_simple_list(msg.delivered_to),
        'seen_by': parse_simple_list(msg.seen_by),
        'forwarded_from': msg.forwarded_from or '',
        'expires_at': msg.expires_at.isoformat() if msg.expires_at else None,
        'edit_history': [x for x in (msg.edit_history or '').split('\n---\n') if x][-10:],
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
        'visibility': room.visibility or 'public',
        'invite_token': room.invite_token or '',
        'owner_id': room.owner_id or '',
        'member_count': member_count,
        'pin_message': message_payload(pin) if pin else None,
        'join_approval': bool(room.join_approval),
        'public_handle': room.public_handle or room.code,
        'rules_text': room.rules_text or '',
        'welcome_message': room.welcome_message or '',
        'slow_mode_seconds': room.slow_mode_seconds or 0,
        'is_verified': bool(room.is_verified),
        'wallpaper': room.wallpaper or '',
    }


def upsert_user(tele_id: str, username: str = '', password: str | None = None, pfp: str = '', bio: str = '', theme: str = '', status_text: str = '', banner_url: str = '', profile_music: str = '', mood: str = '', birthday: str = '', profile_color: str = '', premium_emoji: str = '') -> User | None:
    tele_id = normalize_handle(tele_id)
    username = (username or '').strip()
    if not tele_id:
        return None
    user = User.query.filter_by(tele_id=tele_id).first()
    if not user:
        user = User(tele_id=tele_id, username=username or tele_id, password=password or '')
        db.session.add(user)
    if username:
        user.username = username[:50]
    elif not user.username:
        user.username = tele_id
    if password is not None and password and not user.password:
        user.password = password[:50]
    if pfp:
        user.pfp = pfp[:255]
    if bio is not None:
        user.bio = (bio or '')[:280]
    if theme:
        user.theme = theme[:32]
    if status_text is not None:
        user.status_text = (status_text or '')[:120]
    if banner_url is not None:
        user.banner_url = (banner_url or '')[:255]
    if profile_music is not None:
        user.profile_music = (profile_music or '')[:120]
    if mood is not None:
        user.mood = (mood or '')[:60]
    if birthday is not None:
        user.birthday = (birthday or '')[:20]
    if profile_color is not None:
        user.profile_color = (profile_color or '')[:32]
    if premium_emoji is not None:
        user.premium_emoji = (premium_emoji or '')[:16]
    user.last_seen_at = datetime.utcnow()
    db.session.commit()
    return user


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
    user = upsert_user(tele_id=tele_id, username=username, password=password)
    return jsonify({'status': 'success', 'username': user.username, 'tele_id': user.tele_id, 'pfp': user.pfp or '', 'bio': user.bio or '', 'theme': user.theme or 'midnight-cyan', 'privacy_last_seen': user.privacy_last_seen or 'everyone', 'status_text': user.status_text or '', 'banner_url': user.banner_url or '', 'profile_music': user.profile_music or '', 'mood': user.mood or '', 'birthday': user.birthday or '', 'profile_color': user.profile_color or '', 'premium_emoji': user.premium_emoji or ''})


@app.route('/login', methods=['POST'])
def login():
    data = request.json or {}
    tele_id = normalize_handle(data.get('tele_id') or '')
    password = (data.get('password') or '').strip()
    user = User.query.filter_by(tele_id=tele_id, password=password).first()
    if not user:
        return json_error('Invalid credentials', 401)
    user.last_seen_at = datetime.utcnow()
    db.session.commit()
    return jsonify({
        'status': 'success',
        'username': user.username,
        'tele_id': user.tele_id,
        'pfp': user.pfp or '',
        'bio': user.bio or '',
        'theme': user.theme or 'midnight-cyan',
        'status_text': user.status_text or '',
        'banner_url': user.banner_url or '',
        'profile_music': user.profile_music or '',
        'mood': user.mood or '',
        'birthday': user.birthday or '',
    })


@app.route('/ensure_user', methods=['POST'])
def ensure_user_route():
    data = request.json or {}
    tele_id = normalize_handle(data.get('tele_id') or '')
    username = (data.get('username') or '').strip()
    if not tele_id or not username:
        return json_error('Missing user identity')
    user = upsert_user(
        tele_id=tele_id,
        username=username,
        pfp=(data.get('pfp') or '').strip(),
        bio=(data.get('bio') or '').strip(),
        theme=(data.get('theme') or '').strip(),
        status_text=(data.get('status_text') or '').strip(),
        banner_url=(data.get('banner_url') or '').strip(),
        profile_music=(data.get('profile_music') or '').strip(),
        mood=(data.get('mood') or '').strip(),
        birthday=(data.get('birthday') or '').strip(),
        profile_color=(data.get('profile_color') or '').strip(),
        premium_emoji=(data.get('premium_emoji') or '').strip()[:8],
    )
    return jsonify({'status': 'success', 'username': user.username, 'tele_id': user.tele_id})


@app.route('/search_suggestions')
def search_suggestions():
    raw_q = (request.args.get('q') or '').strip()
    q = normalize_handle(raw_q)
    my_id = normalize_handle(request.args.get('my_id') or '')
    if len(raw_q) < 1:
        return jsonify([])

    raw_like = f"%{raw_q}%"
    prefix_like = f"{q}%"

    users = User.query.filter(
        User.tele_id != my_id,
        or_(
            User.username.ilike(raw_like),
            User.tele_id.ilike(prefix_like),
        )
    ).order_by(
        db.case(
            (User.username.ilike(raw_q), 0),
            (User.username.ilike(f'{raw_q}%'), 1),
            (User.tele_id.ilike(q), 2),
            (User.tele_id.ilike(prefix_like), 3),
            else_=4,
        ),
        User.username.asc(),
    ).limit(6).all()

    groups = Group.query.filter(
        or_(
            Group.name.ilike(raw_like),
            Group.code.ilike(prefix_like),
            Group.public_handle.ilike(prefix_like),
        )
    ).order_by(
        db.case(
            (Group.name.ilike(raw_q), 0),
            (Group.name.ilike(f'{raw_q}%'), 1),
            (Group.public_handle.ilike(q), 2),
            (Group.public_handle.ilike(prefix_like), 3),
            (Group.code.ilike(q), 4),
            else_=5,
        ),
        Group.name.asc(),
    ).limit(6).all()

    results = []
    joined_codes = {m.group_code for m in GroupMember.query.filter_by(tele_id=my_id).all()} if my_id else set()
    for user in users:
        results.append({
            'type': 'user', 'name': user.username or user.tele_id, 'id': user.tele_id, 'pfp': user.pfp or '',
            'bio': user.bio or '', 'profile_color': user.profile_color or '', 'premium_emoji': user.premium_emoji or '',
            **format_user_status(user, my_id)
        })
    for group in groups:
        if (group.visibility or 'public') == 'private' and group.code not in joined_codes:
            continue
        results.append({
            'type': group.kind, 'name': group.name, 'id': group.code, 'pfp': group.pfp or '', 'description': group.description or '',
            'visibility': group.visibility or 'public', 'public_handle': group.public_handle or ''
        })
    return jsonify(results[:3])


@app.route('/create_room', methods=['POST'])
def create_room():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    code = normalize_handle(data.get('code') or '')
    creator_id = normalize_handle(data.get('creator_id') or '')
    kind = (data.get('kind') or 'group').strip().lower()
    description = (data.get('description') or '').strip()[:280]
    visibility = (data.get('visibility') or 'public').strip().lower()
    join_approval = bool(data.get('join_approval'))
    public_handle = normalize_handle(data.get('public_handle') or code)[:60]
    rules_text = (data.get('rules_text') or '').strip()[:3000]
    welcome_message = (data.get('welcome_message') or '').strip()[:200]
    slow_mode_seconds = int(data.get('slow_mode_seconds') or 0) if str(data.get('slow_mode_seconds') or '0').isdigit() else 0
    is_verified = bool(data.get('is_verified'))
    if kind not in {'group', 'channel'}:
        kind = 'group'
    if not name or not code or not creator_id:
        return json_error('Fill all fields')
    if Group.query.filter_by(code=code).first():
        return json_error(f'{kind.title()} code already exists!')
    if visibility not in {'public','private'}:
        visibility = 'public'
    invite_token = uuid.uuid4().hex[:10] if visibility == 'private' else ''
    room = Group(name=name, code=code, kind=kind, description=description, visibility=visibility, invite_token=invite_token, owner_id=creator_id, join_approval=join_approval, public_handle=public_handle, rules_text=rules_text, welcome_message=welcome_message, slow_mode_seconds=min(max(slow_mode_seconds,0),3600), is_verified=is_verified)
    db.session.add(room)
    db.session.add(GroupMember(group_code=code, tele_id=creator_id, role='owner'))
    db.session.commit()
    add_admin_log(code, creator_id, f'created {kind}')
    return jsonify({'status': 'success', 'room': room_meta_for_code(code)})


@app.route('/join_room', methods=['POST'])
def join_room_route():
    data = request.json or {}
    code = normalize_handle(data.get('code') or '')
    tele_id = normalize_handle(data.get('tele_id') or '')
    token = (data.get('invite_token') or '').strip()
    room = Group.query.filter_by(code=code).first()
    if not room:
        return json_error('Room not found')
    if (room.visibility or 'public') == 'private' and token != (room.invite_token or ''):
        member = GroupMember.query.filter_by(group_code=code, tele_id=tele_id).first()
        if not member:
            return json_error('Invite token required')
    member = GroupMember.query.filter_by(group_code=code, tele_id=tele_id).first()
    if room.join_approval and not member and tele_id != room.owner_id:
        existing = JoinRequest.query.filter_by(group_code=code, tele_id=tele_id).first()
        if not existing:
            db.session.add(JoinRequest(group_code=code, tele_id=tele_id))
            db.session.commit()
            add_admin_log(code, tele_id, 'requested to join')
        return jsonify({'status': 'pending', 'message': 'Join request sent', 'room': room_meta_for_code(code)})
    if not member:
        db.session.add(GroupMember(group_code=code, tele_id=tele_id, role='member'))
        db.session.commit()
        add_admin_log(code, tele_id, 'joined room')
        if room.welcome_message:
            welcome = Message(room=f'group_{room.code}', sender_id=room.owner_id or 'system', sender_name=room.name, content=room.welcome_message, msg_type='system')
            db.session.add(welcome)
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
            'profile_color': other_user.profile_color or '',
            'premium_emoji': other_user.premium_emoji or '',
            'last_msg': last_msg,
            'time': msg.timestamp.isoformat(),
            'ts': msg.timestamp.timestamp(),
            **format_user_status(other_user, my_id),
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
        'visibility': room.visibility or 'public',
        'invite_token': room.invite_token or '',
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
    viewer_id = normalize_handle(request.args.get('viewer_id') or '')
    user = User.query.filter_by(tele_id=normalize_handle(tele_id)).first()
    if not user:
        return json_error('User not found', 404)
    payload = {'status': 'success', 'username': user.username, 'tele_id': user.tele_id, 'pfp': user.pfp or '', 'bio': user.bio or '', 'privacy_last_seen': user.privacy_last_seen or 'everyone', 'status_text': user.status_text or '', 'banner_url': user.banner_url or '', 'profile_music': user.profile_music or '', 'mood': user.mood or '', 'birthday': user.birthday or '', 'profile_color': user.profile_color or '', 'premium_emoji': user.premium_emoji or '', **format_user_status(user, viewer_id)}
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
    privacy_last_seen = (data.get('privacy_last_seen') or '').strip()
    status_text = (data.get('status_text') or '').strip()[:120]
    banner_url = (data.get('banner_url') or '').strip()[:255]
    profile_music = (data.get('profile_music') or '').strip()[:120]
    mood = (data.get('mood') or '').strip()[:60]
    birthday = (data.get('birthday') or '').strip()[:20]
    profile_color = (data.get('profile_color') or '').strip()[:32]
    premium_emoji = (data.get('premium_emoji') or '').strip()[:8]
    if not tele_id or not username:
        return json_error('Fill all fields')
    user = User.query.filter_by(tele_id=tele_id).first()
    if not user:
        user = upsert_user(tele_id=tele_id, username=username)
    user.username = username
    user.bio = bio
    if theme:
        user.theme = theme
    if privacy_last_seen in {'everyone','nobody'}:
        user.privacy_last_seen = privacy_last_seen
    user.status_text = status_text
    user.banner_url = banner_url
    user.profile_music = profile_music
    user.mood = mood
    user.birthday = birthday
    user.profile_color = profile_color
    user.premium_emoji = premium_emoji
    db.session.commit()
    return jsonify({'status': 'success', 'username': user.username, 'tele_id': user.tele_id, 'pfp': user.pfp or '', 'bio': user.bio or '', 'theme': user.theme or 'midnight-cyan', 'privacy_last_seen': user.privacy_last_seen or 'everyone', 'status_text': user.status_text or '', 'banner_url': user.banner_url or '', 'profile_music': user.profile_music or '', 'mood': user.mood or '', 'birthday': user.birthday or '', 'profile_color': user.profile_color or '', 'premium_emoji': user.premium_emoji or ''})


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




@app.route('/asset/<int:asset_id>')
def asset_file(asset_id):
    from flask import Response
    asset = UploadAsset.query.get(asset_id)
    if not asset:
        return json_error('Asset not found', 404)
    return Response(asset.blob, mimetype=asset.mime_type, headers={'Content-Disposition': f'inline; filename={asset.filename}'})


@app.route('/media_gallery/<path:room>')
def media_gallery(room):
    messages = Message.query.filter_by(room=room).filter(Message.msg_type.in_(['image','video','audio','file'])).order_by(Message.timestamp.desc()).all()
    return jsonify([message_payload(msg) for msg in messages if not msg.is_deleted])


@app.route('/room_members/<code>')
def room_members(code):
    code = normalize_handle(code)
    members = GroupMember.query.filter_by(group_code=code).all()
    room = Group.query.filter_by(code=code).first()
    if not room:
        return json_error('Room not found', 404)
    results = []
    for member in members:
        user = User.query.filter_by(tele_id=member.tele_id).first()
        if not user:
            continue
        results.append({
            'tele_id': user.tele_id,
            'username': user.username,
            'pfp': user.pfp or '',
            'role': member.role or 'member',
            'online': is_online(user.tele_id),
        })
    return jsonify({'status':'success','room': room_meta_for_code(code), 'members': results})


@app.route('/room_member_role', methods=['POST'])
def room_member_role():
    data = request.json or {}
    code = normalize_handle(data.get('code') or '')
    actor_id = normalize_handle(data.get('actor_id') or '')
    target_id = normalize_handle(data.get('target_id') or '')
    role = (data.get('role') or 'member').strip().lower()
    if role not in {'member','admin'}:
        role = 'member'
    actor = GroupMember.query.filter_by(group_code=code, tele_id=actor_id).first()
    target = GroupMember.query.filter_by(group_code=code, tele_id=target_id).first()
    room = Group.query.filter_by(code=code).first()
    if not room or not actor or actor.role != 'owner' or not target or target.tele_id == room.owner_id:
        return json_error('Not allowed', 403)
    target.role = role
    db.session.commit()
    return jsonify({'status':'success'})




@app.route('/update_room_settings', methods=['POST'])
def update_room_settings():
    data = request.json or {}
    code = normalize_handle(data.get('code') or '')
    actor_id = normalize_handle(data.get('actor_id') or '')
    room = Group.query.filter_by(code=code).first()
    member = GroupMember.query.filter_by(group_code=code, tele_id=actor_id).first()
    if not room or not member or member.role not in {'owner','admin'}:
        return json_error('Not allowed', 403)
    room.join_approval = bool(data.get('join_approval'))
    room.public_handle = normalize_handle(data.get('public_handle') or room.public_handle or room.code)[:60]
    room.rules_text = (data.get('rules_text') or room.rules_text or '')[:3000]
    room.welcome_message = (data.get('welcome_message') or room.welcome_message or '')[:200]
    try:
        room.slow_mode_seconds = min(max(int(data.get('slow_mode_seconds') or 0), 0), 3600)
    except Exception:
        room.slow_mode_seconds = 0
    room.is_verified = bool(data.get('is_verified')) if member.role == 'owner' else bool(room.is_verified)
    room.wallpaper = (data.get('wallpaper') or room.wallpaper or '')[:255]
    db.session.commit()
    add_admin_log(code, actor_id, 'updated room settings')
    return jsonify({'status':'success','room': room_meta_for_code(code)})


@app.route('/room_join_requests/<code>')
def room_join_requests(code):
    code = normalize_handle(code)
    actor_id = normalize_handle(request.args.get('actor_id') or '')
    member = GroupMember.query.filter_by(group_code=code, tele_id=actor_id).first()
    if not member or member.role not in {'owner','admin'}:
        return json_error('Not allowed', 403)
    requests = JoinRequest.query.filter_by(group_code=code).order_by(JoinRequest.created_at.asc()).all()
    result = []
    for req in requests:
        user = User.query.filter_by(tele_id=req.tele_id).first()
        if user:
            result.append({'tele_id': user.tele_id, 'username': user.username, 'pfp': user.pfp or '', 'created_at': req.created_at.isoformat()})
    return jsonify({'status':'success','requests': result})


@app.route('/approve_join_request', methods=['POST'])
def approve_join_request():
    data = request.json or {}
    code = normalize_handle(data.get('code') or '')
    actor_id = normalize_handle(data.get('actor_id') or '')
    target_id = normalize_handle(data.get('target_id') or '')
    approve = bool(data.get('approve', True))
    member = GroupMember.query.filter_by(group_code=code, tele_id=actor_id).first()
    req = JoinRequest.query.filter_by(group_code=code, tele_id=target_id).first()
    if not member or member.role not in {'owner','admin'} or not req:
        return json_error('Not allowed', 403)
    if approve and not GroupMember.query.filter_by(group_code=code, tele_id=target_id).first():
        db.session.add(GroupMember(group_code=code, tele_id=target_id, role='member'))
    db.session.delete(req)
    db.session.commit()
    add_admin_log(code, actor_id, f"{'approved' if approve else 'declined'} join request for {target_id}")
    return jsonify({'status':'success'})


@app.route('/admin_logs/<code>')
def admin_logs(code):
    code = normalize_handle(code)
    actor_id = normalize_handle(request.args.get('actor_id') or '')
    member = GroupMember.query.filter_by(group_code=code, tele_id=actor_id).first()
    if not member or member.role not in {'owner','admin'}:
        return json_error('Not allowed', 403)
    logs = AdminLog.query.filter_by(group_code=code).order_by(AdminLog.created_at.desc()).limit(100).all()
    return jsonify({'status':'success','logs':[{'actor_id': log.actor_id, 'action': log.action, 'created_at': log.created_at.isoformat()} for log in logs]})

@app.route('/delete_chat', methods=['POST'])
def delete_chat_route():
    data = request.json or {}
    actor_id = normalize_handle(data.get('actor_id') or '')
    target_id = normalize_handle(data.get('target_id') or '')
    is_group = bool(data.get('is_group'))
    if not actor_id or not target_id:
        return json_error('Missing chat')
    room = make_room(actor_id, target_id, is_group)
    if is_group:
        member = GroupMember.query.filter_by(group_code=target_id, tele_id=actor_id).first()
        if member:
            db.session.delete(member)
            db.session.commit()
        return jsonify({'status':'success'})
    Message.query.filter_by(room=room).delete()
    db.session.commit()
    return jsonify({'status':'success'})


@app.route('/upload_room_pfp', methods=['POST'])
def upload_room_pfp():
    file = request.files.get('photo')
    code = normalize_handle(request.form.get('code') or '')
    actor_id = normalize_handle(request.form.get('actor_id') or '')
    room = Group.query.filter_by(code=code).first()
    member = GroupMember.query.filter_by(group_code=code, tele_id=actor_id).first()
    if not room or not member or member.role not in {'owner','admin'}:
        return json_error('Not allowed', 403)
    if not file:
        return json_error('No file selected')
    url, _kind = save_uploaded_asset(file, 'image')
    room.pfp = url
    db.session.commit()
    add_admin_log(code, actor_id, 'updated room photo')
    return jsonify({'status':'success','url': url, 'room': room_meta_for_code(code)})


@app.route('/upload_room_wallpaper', methods=['POST'])
def upload_room_wallpaper():
    file = request.files.get('photo')
    code = normalize_handle(request.form.get('code') or '')
    actor_id = normalize_handle(request.form.get('actor_id') or '')
    room = Group.query.filter_by(code=code).first()
    member = GroupMember.query.filter_by(group_code=code, tele_id=actor_id).first()
    if not room or not member or member.role not in {'owner','admin'}:
        return json_error('Not allowed', 403)
    if not file:
        return json_error('No file selected')
    url, _kind = save_uploaded_asset(file, 'image')
    room.wallpaper = url
    db.session.commit()
    add_admin_log(code, actor_id, 'updated room wallpaper')
    return jsonify({'status':'success','url': url, 'room': room_meta_for_code(code)})


@app.route('/delete_room', methods=['POST'])
def delete_room_route():
    data = request.json or {}
    code = normalize_handle(data.get('code') or '')
    actor_id = normalize_handle(data.get('actor_id') or '')
    room = Group.query.filter_by(code=code).first()
    if not room or room.owner_id != actor_id:
        return json_error('Not allowed', 403)
    Message.query.filter_by(room=f'group_{code}').delete()
    GroupMember.query.filter_by(group_code=code).delete()
    JoinRequest.query.filter_by(group_code=code).delete()
    AdminLog.query.filter_by(group_code=code).delete()
    db.session.delete(room)
    db.session.commit()
    return jsonify({'status':'success'})


@app.route('/delete_account', methods=['POST'])
def delete_account_route():
    data = request.json or {}
    tele_id = normalize_handle(data.get('tele_id') or '')
    password = (data.get('password') or '').strip()
    user = User.query.filter_by(tele_id=tele_id).first()
    if not user or user.password != password:
        return json_error('Wrong password', 403)
    Message.query.filter(Message.sender_id == tele_id).delete()
    GroupMember.query.filter_by(tele_id=tele_id).delete()
    JoinRequest.query.filter_by(tele_id=tele_id).delete()
    owned_rooms = Group.query.filter_by(owner_id=tele_id).all()
    for room in owned_rooms:
        Message.query.filter_by(room=f'group_{room.code}').delete()
        GroupMember.query.filter_by(group_code=room.code).delete()
        JoinRequest.query.filter_by(group_code=room.code).delete()
        AdminLog.query.filter_by(group_code=room.code).delete()
        db.session.delete(room)
    db.session.delete(user)
    db.session.commit()
    return jsonify({'status':'success'})


@app.route('/block_user', methods=['POST'])
def block_user():
    data = request.json or {}
    actor_id = normalize_handle(data.get('actor_id') or '')
    target_id = normalize_handle(data.get('target_id') or '')
    mode = (data.get('mode') or 'toggle').strip()
    actor = User.query.filter_by(tele_id=actor_id).first()
    if not actor or not target_id:
        return json_error('User not found', 404)
    blocked = parse_blocked(actor.blocked_users)
    if mode == 'block':
        blocked.add(target_id)
    elif mode == 'unblock':
        blocked.discard(target_id)
    else:
        blocked.remove(target_id) if target_id in blocked else blocked.add(target_id)
    actor.blocked_users = ','.join(sorted(blocked))
    db.session.commit()
    return jsonify({'status':'success','blocked_users':sorted(blocked)})


@app.route('/privacy/<tele_id>')
def privacy(tele_id):
    user = User.query.filter_by(tele_id=normalize_handle(tele_id)).first()
    if not user:
        return json_error('User not found', 404)
    return jsonify({'status':'success','privacy_last_seen': user.privacy_last_seen or 'everyone', 'blocked_users': sorted(parse_blocked(user.blocked_users))})


# ---------- socket events ----------
@socketio.on('connect_radar')
def connect_radar(data):
    payload = data or {}
    my_id = normalize_handle(payload.get('my_id') or '')
    username = (payload.get('username') or '').strip()
    if not my_id:
        return
    join_room(my_id)
    ONLINE_USERS[my_id] = request.sid
    user = User.query.filter_by(tele_id=my_id).first()
    if not user and username:
        user = upsert_user(my_id, username=username)
    elif user:
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
    user_id = normalize_handle((data or {}).get('user_id') or '')
    if room:
        join_room(room)
    if room and user_id:
        changed = False
        messages = Message.query.filter_by(room=room).all()
        for msg in messages:
            before_delivered = msg.delivered_to or ''
            before_seen = msg.seen_by or ''
            msg.delivered_to = append_simple_list(msg.delivered_to, user_id)
            msg.seen_by = append_simple_list(msg.seen_by, user_id)
            if msg.delivered_to != before_delivered or msg.seen_by != before_seen:
                changed = True
        if changed:
            db.session.commit()
            emit('room_receipts_updated', {'room': room, 'messages': [message_payload(m) for m in messages]}, room=room)


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
    forwarded_from = ((data or {}).get('forwarded_from') or '')[:120]
    self_destruct_seconds = int((data or {}).get('self_destruct_seconds') or 0) if str((data or {}).get('self_destruct_seconds') or '0').isdigit() else 0

    if not room or not sender_id or not sender_name:
        return
    if not content and not file_url:
        return
    if not is_group and is_blocked(sender_id, target_id):
        emit('flash_error', {'message': 'This user has blocked you.'}, room=request.sid)
        return
    if not can_post(sender_id, target_id, is_group):
        emit('flash_error', {'message': 'Only channel admins can post there.'}, room=request.sid)
        return
    if is_group:
        room_cfg = Group.query.filter_by(code=target_id).first()
        if room_cfg and (room_cfg.slow_mode_seconds or 0) > 0:
            last_msg = Message.query.filter_by(room=room, sender_id=sender_id).order_by(Message.timestamp.desc()).first()
            if last_msg and (datetime.utcnow() - last_msg.timestamp).total_seconds() < room_cfg.slow_mode_seconds:
                emit('flash_error', {'message': f'Slow mode active. Wait {room_cfg.slow_mode_seconds}s between messages.'}, room=request.sid)
                return

    delivered_to = append_simple_list('', sender_id)
    seen_by = append_simple_list('', sender_id)
    if not is_group and target_id in ONLINE_USERS:
        delivered_to = append_simple_list(delivered_to, target_id)
    expires_at = datetime.utcnow() if self_destruct_seconds > 0 else None
    if self_destruct_seconds > 0:
        from datetime import timedelta
        expires_at = datetime.utcnow() + timedelta(seconds=min(self_destruct_seconds, 86400))
    msg = Message(room=room, sender_id=sender_id, sender_name=sender_name, content=content, msg_type=msg_type, file_url=file_url, reply_to_id=reply_to_id, forwarded_from=forwarded_from, delivered_to=delivered_to, seen_by=seen_by, expires_at=expires_at)
    db.session.add(msg)
    db.session.commit()
    if is_group:
        add_admin_log(target_id, sender_id, f'sent {msg_type} message')

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
    msg.edit_history = ((msg.edit_history + '\n---\n') if msg.edit_history else '') + (msg.content or '')
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
    token = (data.get('invite_token') or '').strip()
    room = Group.query.filter_by(code=code).first()
    member = GroupMember.query.filter_by(group_code=code, tele_id=actor_id).first()
    if not room or not member or member.role not in {'owner', 'admin'}:
        return
    room.pin_message_id = msg_id
    db.session.commit()
    add_admin_log(code, actor_id, f'pinned message {msg_id}')
    emit('room_meta_updated', {'target_id': code, 'room': room_meta_for_code(code)}, room=f'group_{code}')


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)), debug=False)
