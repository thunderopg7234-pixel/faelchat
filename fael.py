from __future__ import annotations

import os
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room
from sqlalchemy import or_
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
socketio = SocketIO(app, cors_allowed_origins='*', max_http_buffer_size=100 * 1024 * 1024)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), nullable=False)
    tele_id = db.Column(db.String(50), unique=True, nullable=False, index=True)
    password = db.Column(db.String(50), nullable=False)
    pfp = db.Column(db.String(255), default='')


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


class GroupMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    group_code = db.Column(db.String(50), nullable=False, index=True)
    tele_id = db.Column(db.String(50), nullable=False, index=True)


with app.app_context():
    db.create_all()


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


def avatar_payload(name: str, pfp: str) -> dict:
    return {'name': name, 'pfp': pfp or ''}


def make_room(my_id: str, target_id: str, is_group: bool) -> str:
    return f'group_{target_id}' if is_group else '_'.join(sorted([my_id, target_id]))


# ---------- routes ----------
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/signup', methods=['POST'])
def signup():
    data = request.json or {}
    username = (data.get('username') or '').strip()
    tele_id = (data.get('tele_id') or '').strip()
    password = (data.get('password') or '').strip()

    if not username or not tele_id or not password:
        return json_error('Fill all fields')

    if User.query.filter_by(tele_id=tele_id).first():
        return json_error('ID already taken!')

    user = User(username=username, tele_id=tele_id, password=password)
    db.session.add(user)
    db.session.commit()
    return jsonify({'status': 'success', 'username': user.username, 'tele_id': user.tele_id, 'pfp': user.pfp or ''})


@app.route('/login', methods=['POST'])
def login():
    data = request.json or {}
    tele_id = (data.get('tele_id') or '').strip()
    password = (data.get('password') or '').strip()

    user = User.query.filter_by(tele_id=tele_id, password=password).first()
    if not user:
        return json_error('Invalid credentials', 401)

    return jsonify({
        'status': 'success',
        'username': user.username,
        'tele_id': user.tele_id,
        'pfp': user.pfp or ''
    })


@app.route('/search_suggestions')
def search_suggestions():
    q = (request.args.get('q') or '').strip()
    my_id = (request.args.get('my_id') or '').strip()
    if not q:
        return jsonify([])

    like_term = f'%{q}%'

    users = User.query.filter(
        or_(User.tele_id.ilike(like_term), User.username.ilike(like_term))
    ).order_by(
        db.case((User.tele_id.ilike(q), 0), (User.tele_id.ilike(f'{q}%'), 1), else_=2),
        User.username.asc()
    ).limit(8).all()

    groups = Group.query.filter(
        or_(Group.code.ilike(like_term), Group.name.ilike(like_term))
    ).order_by(
        db.case((Group.code.ilike(q), 0), (Group.code.ilike(f'{q}%'), 1), else_=2),
        Group.name.asc()
    ).limit(8).all()

    results = []
    for user in users:
        if user.tele_id == my_id:
            continue
        results.append({'type': 'user', 'name': user.username, 'id': user.tele_id, 'pfp': user.pfp or ''})
    for group in groups:
        results.append({'type': 'group', 'name': group.name, 'id': group.code, 'pfp': group.pfp or ''})
    return jsonify(results[:10])


@app.route('/create_group', methods=['POST'])
def create_group():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    code = (data.get('code') or '').strip()
    creator_id = (data.get('creator_id') or '').strip()

    if not name or not code or not creator_id:
        return json_error('Fill all fields')
    if Group.query.filter_by(code=code).first():
        return json_error('Group code already exists!')

    group = Group(name=name, code=code)
    db.session.add(group)
    db.session.add(GroupMember(group_code=code, tele_id=creator_id))
    db.session.commit()
    return jsonify({'status': 'success'})


@app.route('/join_group', methods=['POST'])
def join_group():
    data = request.json or {}
    code = (data.get('code') or '').strip()
    tele_id = (data.get('tele_id') or '').strip()

    group = Group.query.filter_by(code=code).first()
    if not group:
        return json_error('Group not found')

    exists = GroupMember.query.filter_by(group_code=code, tele_id=tele_id).first()
    if not exists:
        db.session.add(GroupMember(group_code=code, tele_id=tele_id))
        db.session.commit()

    return jsonify({'status': 'success', 'group': {'name': group.name, 'code': group.code, 'pfp': group.pfp or ''}})


@app.route('/recent_chats/<my_id>')
def recent_chats(my_id):
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
            'last_msg': last_msg,
            'time': msg.timestamp.strftime('%H:%M'),
            'ts': msg.timestamp.timestamp(),
        }

    memberships = GroupMember.query.filter_by(tele_id=my_id).all()
    for membership in memberships:
        group = Group.query.filter_by(code=membership.group_code).first()
        if not group:
            continue

        room_name = f'group_{group.code}'
        last_msg = Message.query.filter_by(room=room_name).order_by(Message.timestamp.desc()).first()
        last_text, time_str, ts = 'No messages yet', '', 0
        if last_msg:
            body = 'Deleted' if last_msg.is_deleted else (last_msg.content if last_msg.msg_type == 'text' else f'[{last_msg.msg_type}]')
            last_text = f'{last_msg.sender_name}: {body}'
            time_str = last_msg.timestamp.strftime('%H:%M')
            ts = last_msg.timestamp.timestamp()

        chat_dict[room_name] = {
            'is_group': True,
            'id': group.code,
            'name': group.name,
            'pfp': group.pfp or '',
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
            'timestamp': msg.timestamp.strftime('%H:%M'),
        })
    return jsonify(result)


@app.route('/profile/<tele_id>')
def profile(tele_id):
    user = User.query.filter_by(tele_id=tele_id).first()
    if not user:
        return json_error('User not found', 404)
    return jsonify({'status': 'success', 'username': user.username, 'tele_id': user.tele_id, 'pfp': user.pfp or ''})


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
        tele_id = (request.form.get('tele_id') or '').strip()
        user = User.query.filter_by(tele_id=tele_id).first()
        if not user:
            return json_error('User not found', 404)
        user.pfp = file_url
        db.session.commit()
        return jsonify({'status': 'success', 'url': file_url, 'type': 'pfp'})

    return jsonify({'status': 'success', 'url': file_url, 'type': detected_type})


# ---------- socket events ----------
@socketio.on('connect_radar')
def connect_radar(data):
    my_id = (data or {}).get('my_id')
    if my_id:
        join_room(my_id)


@socketio.on('join_chat')
def join_chat(data):
    room = (data or {}).get('room')
    if room:
        join_room(room)


@socketio.on('private_message')
def handle_private_message(data):
    room = (data or {}).get('room', '')
    sender_id = (data or {}).get('sender_id', '')
    sender_name = (data or {}).get('sender_name', '')
    msg_type = (data or {}).get('msg_type', 'text')
    content = (data or {}).get('content', '')
    file_url = (data or {}).get('file_url', '')

    if not room or not sender_id or not sender_name:
        return
    if not content and not file_url:
        return

    msg = Message(
        room=room,
        sender_id=sender_id,
        sender_name=sender_name,
        content=content,
        msg_type=msg_type,
        file_url=file_url,
    )
    db.session.add(msg)
    db.session.commit()

    sender = User.query.filter_by(tele_id=sender_id).first()
    payload = {
        **data,
        'id': msg.id,
        'room': room,
        'sender_pfp': sender.pfp if sender else '',
        'timestamp': msg.timestamp.strftime('%H:%M'),
    }

    emit('new_message', payload, room=room)

    if payload.get('is_group'):
        members = GroupMember.query.filter_by(group_code=payload.get('target_id')).all()
        for member in members:
            emit('ping_radar', payload, room=member.tele_id)
    else:
        emit('ping_radar', payload, room=payload.get('target_id'))
        emit('ping_radar', payload, room=sender_id)


@socketio.on('delete_message')
def delete_message(data):
    msg_id = (data or {}).get('msg_id')
    sender_id = (data or {}).get('sender_id')
    msg = Message.query.get(msg_id)
    if not msg or msg.sender_id != sender_id:
        return

    msg.is_deleted = True
    db.session.commit()
    emit('message_deleted', {'msg_id': msg.id, 'room': msg.room}, room=msg.room)

    if msg.room.startswith('group_'):
        group_code = msg.room.replace('group_', '', 1)
        for member in GroupMember.query.filter_by(group_code=group_code).all():
            emit('ping_radar', {}, room=member.tele_id)
    else:
        for uid in msg.room.split('_'):
            emit('ping_radar', {}, room=uid)


@socketio.on('call_user')
def call_user(data):
    emit('incoming_call', data, room=(data or {}).get('target_id'))


@socketio.on('answer_call')
def answer_call(data):
    emit('call_answered', data, room=(data or {}).get('target_id'))


@socketio.on('ice_candidate')
def ice_candidate(data):
    emit('ice_candidate', data, room=(data or {}).get('target_id'))


@socketio.on('reject_call')
def reject_call(data):
    emit('call_rejected', {}, room=(data or {}).get('target_id'))


@socketio.on('end_call')
def end_call(data):
    emit('call_ended', {}, room=(data or {}).get('target_id'))


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)), debug=False)
