const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '6mb' }));

// لیست کاربران آنلاین
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('کاربر جدید وصل شد:', socket.id);

  // کاربر نامش را اعلام می‌کند
  socket.on('join', (username) => {
    const name = (username || 'ناشناس').trim().slice(0, 20);
    onlineUsers.set(socket.id, name);
    socket.username = name;

    // به همه بگو کی اومد و لیست آنلاین‌ها را بفرست
    io.emit('user joined', {
      username: name,
      online: Array.from(onlineUsers.values())
    });
  });

  // پیام متنی
  socket.on('chat message', (data) => {
    if (!data || !data.message) return;
    const msg = {
      type: 'text',
      username: socket.username || data.username || 'ناشناس',
      message: String(data.message).slice(0, 2000),
      time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
    };
    io.emit('chat message', msg);
  });

  // پیام عکس (به صورت base64)
  socket.on('image message', (data) => {
    if (!data || !data.image) return;
    // فقط تصاویر مجاز
    if (!data.image.startsWith('data:image/')) return;

    const msg = {
      type: 'image',
      username: socket.username || data.username || 'ناشناس',
      image: data.image,
      caption: data.caption ? String(data.caption).slice(0, 500) : '',
      time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
    };
    io.emit('chat message', msg);
  });

  socket.on('disconnect', () => {
    const name = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    if (name) {
      io.emit('user left', {
        username: name,
        online: Array.from(onlineUsers.values())
      });
    }
    console.log('کاربر قطع شد:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`سرور پیام‌رسان روی پورت ${PORT} اجرا شد`);
});
