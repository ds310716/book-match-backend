require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const supabase = require('./config/supabase');

const authRoutes = require('./routes/auth');
const booksRoutes = require('./routes/books');
const matchRoutes = require('./routes/match');

const app = express();
const server = http.createServer(app);

// Socket.IO 配置 - 允許 Vercel 前端連接
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// CORS 配置
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true
}));

app.use(express.json());

// 健康檢查端點（Render 需要）
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '書籍配對聊天室 API',
    version: '1.0.0'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/books', booksRoutes);
app.use('/api/match', matchRoutes);
app.use('/api/notifications', require('./routes/notifications'));

// Socket.IO 認證
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('認證失敗'));
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (error) {
    next(new Error('認證失敗'));
  }
});

// Socket.IO 事件處理
io.on('connection', (socket) => {
  console.log('使用者連線:', socket.userId);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`使用者 ${socket.userId} 加入聊天室 ${roomId}`);
  });

  socket.on('send-message', async (data) => {
    try {
      const { roomId, message } = data;

      // 驗證使用者是否為聊天室參與者
      const { data: participation } = await supabase
        .from('chat_room_participants')
        .select('id')
        .eq('chat_room_id', roomId)
        .eq('user_id', socket.userId)
        .single();

      if (!participation) {
        return socket.emit('error', { message: '你不在這個聊天室中' });
      }

      // 儲存訊息到資料庫
      const { data: newMessage, error } = await supabase
        .from('messages')
        .insert([
          {
            chat_room_id: roomId,
            sender_id: socket.userId,
            content: message
          }
        ])
        .select(`
          id,
          content,
          created_at,
          sender:users!messages_sender_id_fkey (id, username)
        `)
        .single();

      if (error) throw error;

      // 廣播訊息給聊天室所有成員
      io.to(roomId).emit('new-message', {
        roomId,
        message: {
          id: newMessage.id,
          sender: newMessage.sender,
          content: newMessage.content,
          timestamp: newMessage.created_at
        }
      });
    } catch (error) {
      console.error('發送訊息錯誤:', error);
      socket.emit('error', { message: '發送訊息失敗' });
    }
  });

  socket.on('disconnect', () => {
    console.log('使用者離線:', socket.userId);
  });
});

// 錯誤處理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '伺服器錯誤' });
});

// 啟動伺服器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`伺服器運行在 port ${PORT}`);
});
