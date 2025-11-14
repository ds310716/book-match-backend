const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const supabase = require('./config/supabase');

const app = express();
const server = http.createServer(app);

// CORS 設定
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

// Socket.IO 設定
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Socket.IO 認證中間件
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('認證失敗'));
    }

    // 驗證 JWT token
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    socket.userId = decoded.userId;
    next();
  } catch (error) {
    next(new Error('認證失敗'));
  }
});

// Socket.IO 連線處理
io.on('connection', (socket) => {
  console.log('使用者連線:', socket.id, 'User ID:', socket.userId);
  
  // 使用者加入自己的個人房間（用於接收個人通知）
  if (socket.userId) {
    socket.join(`user-${socket.userId}`);
    console.log(`✅ 使用者 ${socket.userId} 加入個人通知房間`);
  }

  // 加入聊天室
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`使用者 ${socket.userId} 加入聊天室 ${roomId}`);
  });

  // 離開聊天室
  socket.on('leave-room', (roomId) => {
    socket.leave(roomId);
    console.log(`使用者 ${socket.userId} 離開聊天室 ${roomId}`);
  });

  // 發送訊息
  socket.on('send-message', async (data) => {
    try {
      const { roomId, message } = data;

      // 儲存訊息到資料庫
      const { data: newMessage, error: messageError } = await supabase
        .from('messages')
        .insert([{
          chat_room_id: roomId,
          sender_id: socket.userId,
          content: message
        }])
        .select(`
          *,
          sender:users(id, username)
        `)
        .single();

      if (messageError) throw messageError;

      // 發送訊息給聊天室所有人
      io.to(roomId).emit('new-message', {
        message: newMessage,
        roomId
      });

      console.log(`✅ 訊息已發送到聊天室 ${roomId}`);

      // ===== 新增：創建通知並推送 =====
      
      // 1. 找出聊天室的另一個參與者
      const { data: participants, error: participantsError } = await supabase
        .from('chat_room_participants')
        .select('user_id, users(username, email)')
        .eq('chat_room_id', roomId)
        .neq('user_id', socket.userId);

      if (participantsError) {
        console.error('查詢參與者失敗:', participantsError);
        return;
      }

      if (participants && participants.length > 0) {
        const recipient = participants[0];
        const recipientId = recipient.user_id;

        // 2. 取得發送者資訊
        const { data: sender } = await supabase
          .from('users')
          .select('username')
          .eq('id', socket.userId)
          .single();

        // 3. 創建通知
        const messagePreview = message.length > 50 
          ? message.substring(0, 50) + '...' 
          : message;

        const { data: notification, error: notifError } = await supabase
          .from('notifications')
          .insert([{
            user_id: recipientId,
            type: 'new_message',
            title: '新訊息',
            content: `${sender?.username || '使用者'}: ${messagePreview}`,
            related_id: roomId,
            link: `/chats/${roomId}`
          }])
          .select()
          .single();

        if (notifError) {
          console.error('創建通知失敗:', notifError);
          return;
        }

        // 4. 透過 Socket 推送通知給接收者
        io.to(`user-${recipientId}`).emit('new-notification', notification);
        
        console.log(`✅ 新訊息通知已發送給使用者 ${recipientId}`);
      }

    } catch (error) {
      console.error('發送訊息錯誤:', error);
      socket.emit('error', { message: '發送訊息失敗' });
    }
  });

  // 使用者斷線
  socket.on('disconnect', () => {
    console.log('使用者斷線:', socket.id);
  });
});

// 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/books', (req, res, next) => {
  req.io = io;  // 將 io 傳遞給 books 路由
  next();
}, require('./routes/books'));
app.use('/api/match', (req, res, next) => {
  req.io = io;  // 將 io 傳遞給 match 路由
  next();
}, require('./routes/match'));
app.use('/api/notifications', require('./routes/notifications'));

// 健康檢查
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// 啟動伺服器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`伺服器運行在 port ${PORT}`);
});

module.exports = { app, server, io };
