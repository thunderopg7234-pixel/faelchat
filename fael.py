from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room
from werkzeug.utils import secure_filename
from datetime import datetime
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('postgresql://felchat_db_user:lW7v3IFPRcWC6FwEmv8raT2iq1d1FRqg@dpg-d6qmd9fpm1nc73b6492g-a/felchat_db', 'sqlite:///faelchat.db')
app.config['SECRET_KEY'] = 'fael_super_secret'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

UPLOAD_FOLDER = 'static/uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=1e8)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), nullable=False)
    tele_id = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(50), nullable=False)
    pfp = db.Column(db.String(200), default='')


class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room = db.Column(db.String(100), nullable=False)
    sender_id = db.Column(db.String(50), nullable=False)
    sender_name = db.Column(db.String(50), nullable=False)
    content = db.Column(db.Text, nullable=False)
    msg_type = db.Column(db.String(20), default='text')
    file_url = db.Column(db.String(200), default='')
    is_deleted = db.Column(db.Boolean, default=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)


class Group(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    code = db.Column(db.String(50), unique=True, nullable=False)
    pfp = db.Column(db.String(200), default='')


class GroupMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    group_code = db.Column(db.String(50), nullable=False)
    tele_id = db.Column(db.String(50), nullable=False)


with app.app_context():
    db.create_all()


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
        return jsonify({"status": "error", "message": "Fill all fields"})

    if User.query.filter_by(tele_id=tele_id).first():
        return jsonify({"status": "error", "message": "ID already taken!"})

    new_user = User(username=username, tele_id=tele_id, password=password)
    db.session.add(new_user)
    db.session.commit()
    return jsonify({"status": "success", "username": new_user.username, "pfp": ""})


@app.route('/login', methods=['POST'])
def login():
    data = request.json or {}
    tele_id = (data.get('tele_id') or '').strip()
    password = (data.get('password') or '').strip()

    user = User.query.filter_by(tele_id=tele_id, password=password).first()
    if user:
        return jsonify({
            "status": "success",
            "username": user.username,
            "tele_id": user.tele_id,
            "pfp": user.pfp
        })

    return jsonify({"status": "error", "message": "Invalid credentials"})


@app.route('/search_suggestions')
def search_suggestions():
    q = (request.args.get('q', '') or '').strip()
    if not q:
        return jsonify([])

    results = []

    users = User.query.filter(
        (User.tele_id.like(f'%{q}%')) | (User.username.like(f'%{q}%'))
    ).limit(5).all()

    for u in users:
        results.append({
            "type": "user",
            "name": u.username,
            "id": u.tele_id,
            "pfp": u.pfp
        })

    groups = Group.query.filter(
        (Group.code.like(f'%{q}%')) | (Group.name.like(f'%{q}%'))
    ).limit(5).all()

    for g in groups:
        results.append({
            "type": "group",
            "name": g.name,
            "id": g.code,
            "pfp": g.pfp
        })

    return jsonify(results)


@app.route('/create_group', methods=['POST'])
def create_group():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    code = (data.get('code') or '').strip()
    creator_id = (data.get('creator_id') or '').strip()

    if not name or not code or not creator_id:
        return jsonify({"status": "error", "message": "Fill all fields"})

    if Group.query.filter_by(code=code).first():
        return jsonify({"status": "error", "message": "Group code already exists!"})

    new_group = Group(name=name, code=code)
    db.session.add(new_group)

    member = GroupMember(group_code=code, tele_id=creator_id)
    db.session.add(member)
    db.session.commit()

    return jsonify({"status": "success"})


@app.route('/join_group', methods=['POST'])
def join_group():
    data = request.json or {}
    code = (data.get('code') or '').strip()
    tele_id = (data.get('tele_id') or '').strip()

    if not code or not tele_id:
        return jsonify({"status": "error", "message": "Missing data"})

    group = Group.query.filter_by(code=code).first()
    if not group:
        return jsonify({"status": "error", "message": "Group not found"})

    if not GroupMember.query.filter_by(group_code=code, tele_id=tele_id).first():
        member = GroupMember(group_code=code, tele_id=tele_id)
        db.session.add(member)
        db.session.commit()

    return jsonify({"status": "success"})


@app.route('/recent_chats/<my_id>')
def recent_chats(my_id):
    chat_dict = {}

    messages = Message.query.filter(
        Message.room.contains(my_id)
    ).order_by(Message.timestamp.desc()).all()

    for m in messages:
        if m.room.startswith('group_'):
            continue

        if m.room not in chat_dict:
            parts = m.room.split("_")
            if len(parts) != 2:
                continue

            other_id = parts[0] if parts[1] == my_id else parts[1]
            if other_id == my_id:
                continue

            other_user = User.query.filter_by(tele_id=other_id).first()
            if other_user:
                chat_dict[m.room] = {
                    "is_group": False,
                    "id": other_id,
                    "name": other_user.username,
                    "pfp": other_user.pfp,
                    "last_msg": "Deleted" if m.is_deleted else (
                        m.content if m.msg_type == 'text' else f"[{m.msg_type}]"
                    ),
                    "time": m.timestamp.strftime("%H:%M"),
                    "ts": m.timestamp.timestamp()
                }

    my_groups = GroupMember.query.filter_by(tele_id=my_id).all()
    for mg in my_groups:
        group = Group.query.filter_by(code=mg.group_code).first()
        if not group:
            continue

        room_name = f"group_{mg.group_code}"
        last_msg = Message.query.filter_by(room=room_name).order_by(Message.timestamp.desc()).first()

        last_text = "No messages yet"
        time_str = ""
        ts = 0

        if last_msg:
            last_text = f"{last_msg.sender_name}: " + (
                "Deleted" if last_msg.is_deleted else (
                    last_msg.content if last_msg.msg_type == 'text' else f"[{last_msg.msg_type}]"
                )
            )
            time_str = last_msg.timestamp.strftime("%H:%M")
            ts = last_msg.timestamp.timestamp()

        chat_dict[room_name] = {
            "is_group": True,
            "id": group.code,
            "name": group.name,
            "pfp": group.pfp,
            "last_msg": last_text,
            "time": time_str,
            "ts": ts
        }

    result = list(chat_dict.values())
    result.sort(key=lambda x: x.get("ts", 0), reverse=True)

    for item in result:
        item.pop("ts", None)

    return jsonify(result)


@app.route('/history/<room>')
def get_history(room):
    messages = Message.query.filter_by(room=room).order_by(Message.timestamp.asc()).all()
    result = []

    for m in messages:
        user = User.query.filter_by(tele_id=m.sender_id).first()
        pfp = user.pfp if user else ""
        result.append({
            "id": m.id,
            "sender_id": m.sender_id,
            "sender_name": m.sender_name,
            "sender_pfp": pfp,
            "content": m.content,
            "msg_type": m.msg_type,
            "file_url": m.file_url,
            "is_deleted": m.is_deleted,
            "timestamp": m.timestamp.strftime("%H:%M")
        })

    return jsonify(result)


@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file"})

    file = request.files['file']
    upload_type = request.form.get('type', 'image')

    if not file or file.filename == '':
        return jsonify({"error": "No file selected"})

    base_name = secure_filename(file.filename)
    filename = f"{datetime.utcnow().timestamp()}_{base_name}"

    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    file_url = f"/static/uploads/{filename}"

    if upload_type == 'pfp':
        user_id = request.form.get('tele_id')
        user = User.query.filter_by(tele_id=user_id).first()
        if user:
            user.pfp = file_url
            db.session.commit()

    return jsonify({"url": file_url})


@socketio.on('connect_radar')
def connect_radar(data):
    my_id = data.get('my_id')
    if my_id:
        join_room(my_id)


@socketio.on('join_chat')
def join_chat(data):
    room = data.get('room')
    if room:
        join_room(room)


@socketio.on('private_message')
def handle_msg(data):
    msg = Message(
        room=data['room'],
        sender_id=data['sender_id'],
        sender_name=data['sender_name'],
        content=data['content'],
        msg_type=data['msg_type'],
        file_url=data.get('file_url', '')
    )
    db.session.add(msg)
    db.session.commit()

    user = User.query.filter_by(tele_id=data['sender_id']).first()
    data['sender_pfp'] = user.pfp if user else ""
    data['id'] = msg.id
    data['timestamp'] = msg.timestamp.strftime("%H:%M")

    emit('new_message', data, room=data['room'])

    if data['is_group']:
        members = GroupMember.query.filter_by(group_code=data['target_id']).all()
        for m in members:
            emit('ping_radar', data, room=m.tele_id)
    else:
        emit('ping_radar', data, room=data['target_id'])
        emit('ping_radar', data, room=data['sender_id'])


@socketio.on('delete_message')
def delete_msg(data):
    msg = Message.query.get(data['msg_id'])
    if msg and msg.sender_id == data['sender_id']:
        msg.is_deleted = True
        db.session.commit()
        emit('message_deleted', {'msg_id': msg.id, 'room': msg.room}, room=msg.room)
        emit('ping_radar', {}, room=msg.sender_id)


# -------------------------
# WebRTC signaling for calls
# -------------------------

@socketio.on('call_user')
def call_user(data):
    target_id = data.get('target_id')
    sender_id = data.get('sender_id')
    sender_name = data.get('sender_name')
    offer = data.get('offer')
    call_type = data.get('call_type', 'audio')

    emit('incoming_call', {
        'sender_id': sender_id,
        'sender_name': sender_name,
        'offer': offer,
        'call_type': call_type
    }, room=target_id)


@socketio.on('answer_call')
def answer_call(data):
    target_id = data.get('target_id')
    answer = data.get('answer')

    emit('call_answered', {
        'answer': answer
    }, room=target_id)


@socketio.on('ice_candidate')
def ice_candidate(data):
    target_id = data.get('target_id')
    candidate = data.get('candidate')

    emit('ice_candidate', {
        'candidate': candidate
    }, room=target_id)


@socketio.on('reject_call')
def reject_call(data):
    target_id = data.get('target_id')
    emit('call_rejected', {}, room=target_id)


@socketio.on('end_call')
def end_call(data):
    target_id = data.get('target_id')
    emit('call_ended', {}, room=target_id)


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=8080, debug=True)
