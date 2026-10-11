const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 20 * 1024 * 1024 // 20MB برای عکس‌های بزرگ‌تر
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '20mb' }));

// کاربران آنلاین: socketId -> { username, id }
const onlineUsers = new Map();

function getOnlineList() {
  return Array.from(onlineUsers.values()).map(u => ({
    id: u.id,
    username: u.username
  }));
}

function makePrivateRoom(userA, userB) {
  // اتاق خصوصی بر اساس دو اسم (مرتب شده)
  return 'private_' + [userA, userB].sort().join('_');
}

io.on('connection', (socket) => {
  console.log('کاربر جدید:', socket.id);

  // ورود کاربر
  socket.on('join', (username) => {
    const name = (username || 'ناشناس').trim().slice(0, 20);
    if (!name) return;

    // اگر قبلاً با این اسم بود، آپدیت کن
    onlineUsers.set(socket.id, {
      id: socket.id,
      username: name
    });
    socket.username = name;

    // به همه لیست آنلاین جدید را بفرست
    io.emit('online users', getOnlineList());
    io.emit('system message', {
      text: `${name} وارد شد`,
      time: getTime()
    });
  });

  // پیام عمومی
  socket.on('public message', (data) => {
    if (!socket.username || !data) return;

    if (data.type === 'image') {
      if (!data.image || !data.image.startsWith('data:image/')) return;
      // محدودیت حجم تقریبی (base64 حدود ۱.۳ برابر حجم واقعی)
      if (data.image.length > 20 * 1024 * 1024) return;

      io.emit('public message', {
        type: 'image',
        username: socket.username,
        image: data.image,
        caption: (data.caption || '').slice(0, 500),
        time: getTime(),
        id: Date.now() + Math.random()
      });
    } else {
      const text = String(data.message || '').trim().slice(0, 3000);
      if (!text) return;

      io.emit('public message', {
        type: 'text',
        username: socket.username,
        message: text,
        time: getTime(),
        id: Date.now() + Math.random()
      });
    }
  });

  // پیام خصوصی
  socket.on('private message', (data) => {
    if (!socket.username || !data || !data.to) return;

    const room = makePrivateRoom(socket.username, data.to);
    socket.join(room);

    // طرف مقابل را هم به اتاق دعوت کن (اگر آنلاین باشد)
    for (const [id, user] of onlineUsers) {
      if (user.username === data.to) {
        io.sockets.sockets.get(id)?.join(room);
        break;
      }
    }

    if (data.type === 'image') {
      if (!data.image || !data.image.startsWith('data:image/')) return;
      if (data.image.length > 20 * 1024 * 1024) return;

      io.to(room).emit('private message', {
        type: 'image',
        from: socket.username,
        to: data.to,
        image: data.image,
        caption: (data.caption || '').slice(0, 500),
        time: getTime(),
        id: Date.now() + Math.random()
      });
    } else {
      const text = String(data.message || '').trim().slice(0, 3000);
      if (!text) return;

      io.to(room).emit('private message', {
        type: 'text',
        from: socket.username,
        to: data.to,
        message: text,
        time: getTime(),
        id: Date.now() + Math.random()
      });
    }
  });

  // کاربر شروع به تایپ کرده
  socket.on('typing', (data) => {
    if (!socket.username) return;
    if (data && data.to) {
      // تایپ خصوصی
      const room = makePrivateRoom(socket.username, data.to);
      socket.to(room).emit('typing', {
        username: socket.username,
        private: true
      });
    } else {
      // تایپ عمومی
      socket.broadcast.emit('typing', {
        username: socket.username,
        private: false
      });
    }
  });

  socket.on('stop typing', (data) => {
    if (!socket.username) return;
    if (data && data.to) {
      const room = makePrivateRoom(socket.username, data.to);
      socket.to(room).emit('stop typing', {
        username: socket.username,
        private: true
      });
    } else {
      socket.broadcast.emit('stop typing', {
        username: socket.username,
        private: false
      });
    }
  });

  // درخواست لیست آنلاین
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
    console.log('قطع شد:', socket.id);
  });
});

function getTime() {
  return new Date().toLocaleTimeString('fa-IR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`سرور پیام‌رسان نسخه ۲ روی پورت ${PORT} اجرا شد`);
});
