const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

// 尋找配對的共用邏輯
async function findMatches(userId) {
  const { data: userBooks, error: booksError } = await supabase
    .from('books')
    .select('title, author')
    .eq('user_id', userId);

  if (booksError) throw booksError;

  if (!userBooks || userBooks.length === 0) {
    return [];
  }

  const matches = new Map();

  for (const book of userBooks) {
    const { data: matchedUsers, error: matchError } = await supabase
      .from('books')
      .select(`
        user_id,
        title,
        author,
        users (
          id,
          username,
          email
        )
      `)
      .eq('title', book.title)
      .eq('author', book.author)
      .neq('user_id', userId);

    if (matchError) throw matchError;

    if (matchedUsers) {
      matchedUsers.forEach(match => {
        const matchUserId = match.user_id;
        if (!matches.has(matchUserId)) {
          matches.set(matchUserId, {
            userId: matchUserId,
            username: match.users.username,
            email: match.users.email,
            commonBooks: [],
            matchCount: 0
          });
        }
        
        matches.get(matchUserId).commonBooks.push({
          title: match.title,
          author: match.author
        });
        matches.get(matchUserId).matchCount++;
      });
    }
  }

  const matchArray = Array.from(matches.values())
    .sort((a, b) => b.matchCount - a.matchCount);

  return matchArray;
}

// 尋找配對 - 原有路徑
router.get('/find', auth, async (req, res) => {
  try {
    const matches = await findMatches(req.userId);
    res.json({ matches });
  } catch (error) {
    console.error('尋找配對失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

// 尋找配對 - 新路徑（前端使用）
router.get('/find-matches', auth, async (req, res) => {
  try {
    const matches = await findMatches(req.userId);
    res.json({ matches });
  } catch (error) {
    console.error('尋找配對失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

// 建立或取得聊天室
router.post('/chat-room', auth, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const userId = req.userId;

    if (!targetUserId) {
      return res.status(400).json({ error: '缺少目標使用者 ID' });
    }

    if (targetUserId === userId) {
      return res.status(400).json({ error: '無法與自己建立聊天室' });
    }

    const { data: existingRooms, error: checkError } = await supabase
      .from('chat_room_participants')
      .select('chat_room_id')
      .eq('user_id', userId);

    if (checkError) throw checkError;

    if (existingRooms && existingRooms.length > 0) {
      const roomIds = existingRooms.map(r => r.chat_room_id);
      
      const { data: targetRooms, error: targetError } = await supabase
        .from('chat_room_participants')
        .select('chat_room_id')
        .eq('user_id', targetUserId)
        .in('chat_room_id', roomIds);

      if (targetError) throw targetError;

      if (targetRooms && targetRooms.length > 0) {
        const existingRoomId = targetRooms[0].chat_room_id;
        
        const { data: existingRoom, error: roomError } = await supabase
          .from('chat_rooms')
          .select(`
            *,
            participants:chat_room_participants(
              user_id,
              users(id, username, email)
            ),
            matched_books:chat_room_matched_books(
              book:books(title, author)
            )
          `)
          .eq('id', existingRoomId)
          .single();

        if (roomError) throw roomError;

        return res.json({
          message: '聊天室已存在',
          chatRoom: existingRoom
        });
      }
    }

    const { data: userBooks } = await supabase
      .from('books')
      .select('id, title, author')
      .eq('user_id', userId);

    const { data: targetBooks } = await supabase
      .from('books')
      .select('id, title, author')
      .eq('user_id', targetUserId);

    const commonBooks = userBooks?.filter(userBook =>
      targetBooks?.some(targetBook =>
        targetBook.title === userBook.title && targetBook.author === userBook.author
      )
    ) || [];

    const { data: chatRoom, error: createError } = await supabase
      .from('chat_rooms')
      .insert([{}])
      .select()
      .single();

    if (createError) throw createError;

    const { error: participantsError } = await supabase
      .from('chat_room_participants')
      .insert([
        { chat_room_id: chatRoom.id, user_id: userId },
        { chat_room_id: chatRoom.id, user_id: targetUserId }
      ]);

    if (participantsError) throw participantsError;

    if (commonBooks.length > 0) {
      const matchedBooksData = commonBooks.map(book => ({
        chat_room_id: chatRoom.id,
        book_id: book.id
      }));

      await supabase
        .from('chat_room_matched_books')
        .insert(matchedBooksData);
    }

    const { data: fullChatRoom, error: fullRoomError } = await supabase
      .from('chat_rooms')
      .select(`
        *,
        participants:chat_room_participants(
          user_id,
          users(id, username, email)
        ),
        matched_books:chat_room_matched_books(
          book:books(title, author)
        )
      `)
      .eq('id', chatRoom.id)
      .single();

    if (fullRoomError) throw fullRoomError;

    const { data: currentUser } = await supabase
      .from('users')
      .select('username')
      .eq('id', userId)
      .single();

    const { data: notification } = await supabase
      .from('notifications')
      .insert([{
        user_id: targetUserId,
        type: 'chat_opened',
        title: '新的聊天室',
        content: `${currentUser?.username || '使用者'} 開啟了與您的聊天室`,
        related_id: chatRoom.id,
        link: `/chats/${chatRoom.id}`
      }])
      .select()
      .single();

    if (notification && req.io) {
      req.io.to(`user-${targetUserId}`).emit('new-notification', notification);
      console.log(`✅ 聊天室通知已發送給使用者 ${targetUserId}`);
    }

    res.json({
      message: '聊天室已建立',
      chatRoom: fullChatRoom
    });

  } catch (error) {
    console.error('建立聊天室失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

// 取得聊天室詳情
router.get('/chat-room/:roomId', auth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.userId;

    const { data: participant, error: checkError } = await supabase
      .from('chat_room_participants')
      .select('*')
      .eq('chat_room_id', roomId)
      .eq('user_id', userId)
      .single();

    if (checkError || !participant) {
      return res.status(403).json({ error: '無權訪問此聊天室' });
    }

    const { data: chatRoom, error: roomError } = await supabase
      .from('chat_rooms')
      .select(`
        *,
        participants:chat_room_participants(
          user_id,
          users(id, username, email)
        ),
        matched_books:chat_room_matched_books(
          book:books(title, author)
        ),
        messages(
          id,
          content,
          created_at,
          sender:users(id, username)
        )
      `)
      .eq('id', roomId)
      .single();

    if (roomError) throw roomError;

    if (chatRoom.messages) {
      chatRoom.messages.sort((a, b) => 
        new Date(a.created_at) - new Date(b.created_at)
      );
    }

    res.json({ chatRoom });
  } catch (error) {
    console.error('取得聊天室失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

// 取得使用者的所有聊天室
router.get('/chat-rooms', auth, async (req, res) => {
  try {
    const userId = req.userId;

    const { data: userRooms, error: roomsError } = await supabase
      .from('chat_room_participants')
      .select('chat_room_id')
      .eq('user_id', userId);

    if (roomsError) throw roomsError;

    if (!userRooms || userRooms.length === 0) {
      return res.json({ chatRooms: [] });
    }

    const roomIds = userRooms.map(r => r.chat_room_id);

    const { data: chatRooms, error: detailsError } = await supabase
      .from('chat_rooms')
      .select(`
        *,
        participants:chat_room_participants(
          user_id,
          users(id, username, email)
        ),
        matched_books:chat_room_matched_books(
          book:books(title, author)
        ),
        messages(
          id,
          content,
          created_at,
          sender:users(id, username)
        )
      `)
      .in('id', roomIds)
      .order('updated_at', { ascending: false });

    if (detailsError) throw detailsError;

    const chatRoomsWithLastMessage = chatRooms?.map(room => {
      const lastMessage = room.messages && room.messages.length > 0
        ? room.messages.sort((a, b) => 
            new Date(b.created_at) - new Date(a.created_at)
          )[0]
        : null;

      return {
        ...room,
        lastMessage
      };
    }) || [];

    res.json({ chatRooms: chatRoomsWithLastMessage });
  } catch (error) {
    console.error('取得聊天室列表失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
