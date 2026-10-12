const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 20 * 1024 * 1024
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '20mb' }));

// کاربران آنلاین: socketId -> { username, id }
const onlineUsers = new Map();
// رمزهای ذخیره‌شده: username -> password (تا وقتی سرور روشن باشه)
const userPasswords = new Map();
// ری‌اکشن‌ها: messageId -> { emoji: [usernames] }
const messageReactions = new Map();

function getOnlineList() {
  return Array.from(onlineUsers.values()).map(u => ({
    id: u.id,
    username: u.username
  }));
}

function makePrivateRoom(userA, userB) {
  return 'private_' + [userA, userB].sort().join('_');
}

function getTime() {
  return new Date().toLocaleTimeString('fa-IR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

io.on('connection', (socket) => {
  console.log('کاربر جدید:', socket.id);

  // ورود با رمز
  socket.on('join', (data) => {
    const name = (data?.username || '').trim().slice(0, 20);
    const password = (data?.password || '').trim().slice(0, 50);

    if (!name) {
      socket.emit('join error', { message: 'نام را وارد کنید' });
      return;
    }
    if (!password) {
      socket.emit('join error', { message: 'رمز عبور را وارد کنید' });
      return;
    }

    // اگر اسم قبلاً ثبت شده
    if (userPasswords.has(name)) {
      if (userPasswords.get(name) !== password) {
        socket.emit('join error', { message: 'رمز عبور اشتباه است' });
        return;
      }
    } else {
      // اسم جدید → رمز را ذخیره کن
      userPasswords.set(name, password);
    }

    // اگر قبلاً با این سوکت اسمی داشت پاک کن
    onlineUsers.set(socket.id, { id: socket.id, username: name });
    socket.username = name;

    socket.emit('join success', { username: name });
    io.emit('online users', getOnlineList());
    io.emit('system message', {
      text: `${name} وارد شد`,
      time: getTime()
    });
  });

  // پیام عمومی
  socket.on('public message', (data) => {
    if (!socket.username || !data) return;

    const msg = {
      id: makeId(),
      type: data.type === 'image' ? 'image' : 'text',
      username: socket.username,
      time: getTime(),
      replyTo: data.replyTo || null,
      replyText: data.replyText || null,
      replyUser: data.replyUser || null
    };

    if (msg.type === 'image') {
      if (!data.image || !data.image.startsWith('data:image/')) return;
      if (data.image.length > 20 * 1024 * 1024) return;
      msg.image = data.image;
      msg.caption = (data.caption || '').slice(0, 500);
    } else {
      const text = String(data.message || '').trim().slice(0, 3000);
      if (!text) return;
      msg.message = text;
    }

    io.emit('public message', msg);
  });

  // پیام خصوصی
  socket.on('private message', (data) => {
    if (!socket.username || !data || !data.to) return;

    const room = makePrivateRoom(socket.username, data.to);
    socket.join(room);

    for (const [id, user] of onlineUsers) {
      if (user.username === data.to) {
        io.sockets.sockets.get(id)?.join(room);
        break;
      }
    }

    const msg = {
      id: makeId(),
      type: data.type === 'image' ? 'image' : 'text',
      from: socket.username,
      to: data.to,
      time: getTime(),
      replyTo: data.replyTo || null,
      replyText: data.replyText || null,
      replyUser: data.replyUser || null
    };

    if (msg.type === 'image') {
      if (!data.image || !data.image.startsWith('data:image/')) return;
      if (data.image.length > 20 * 1024 * 1024) return;
      msg.image = data.image;
      msg.caption = (data.caption || '').slice(0, 500);
    } else {
      const text = String(data.message || '').trim().slice(0, 3000);
      if (!text) return;
      msg.message = text;
    }

    io.to(room).emit('private message', msg);
  });

  // ری‌اکشن
  socket.on('reaction', (data) => {
    if (!socket.username || !data?.messageId || !data?.emoji) return;
    const { messageId, emoji } = data;
    const allowed = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
    if (!allowed.includes(emoji)) return;

    if (!messageReactions.has(messageId)) {
      messageReactions.set(messageId, {});
    }
    const reactions = messageReactions.get(messageId);
    if (!reactions[emoji]) reactions[emoji] = [];

    // اگر قبلاً همین کاربر این ری‌اکشن را زده، بردار (toggle)
    const idx = reactions[emoji].indexOf(socket.username);
    if (idx >= 0) {
      reactions[emoji].splice(idx, 1);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji].push(socket.username);
    }

    io.emit('reaction update', {
      messageId,
      reactions: reactions
    });
  });

  // تایپینگ
  socket.on('typing', (data) => {
    if (!socket.username) return;
    if (data && data.to) {
      const room = makePrivateRoom(socket.username, data.to);
      socket.to(room).emit('typing', { username: socket.username, private: true });
    } else {
      socket.broadcast.emit('typing', { username: socket.username, private: false });
    }
  });

  socket.on('stop typing', (data) => {
    if (!socket.username) return;
    if (data && data.to) {
      const room = makePrivateRoom(socket.username, data.to);
      socket.to(room).emit('stop typing', { username: socket.username, private: true });
    } else {
      socket.broadcast.emit('stop typing', { username: socket.username, private: false });
    }
  });

  socket.on('get online', () => {
    socket.emit('online users', getOnlineList());
  });

  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      onlineUsers.delete(socket.id);
      io.emit('online users', getOnlineList());
      io.emit('system message', {
        text: `${user.username} خارج شد`,
        time: getTime()
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`سرور پیام‌رسان نسخه ۳ روی پورت ${PORT} اجرا شد`);
});
