const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

// 尋找配對
router.get('/find-matches', auth, async (req, res) => {
  try {
    // 取得當前使用者的書籍
    const { data: myBooks, error: myBooksError } = await supabase
      .from('books')
      .select('title, author')
      .eq('user_id', req.userId);

    if (myBooksError) throw myBooksError;

    if (!myBooks || myBooks.length === 0) {
      return res.json({ matches: [] });
    }

    // 取得所有其他使用者
    const { data: otherUsers, error: usersError } = await supabase
      .from('users')
      .select('id, username')
      .neq('id', req.userId);

    if (usersError) throw usersError;

    // 取得所有其他使用者的書籍
    const { data: allBooks, error: allBooksError } = await supabase
      .from('books')
      .select('user_id, title, author')
      .neq('user_id', req.userId);

    if (allBooksError) throw allBooksError;

    // 計算配對
    const matches = otherUsers.map(user => {
      const userBooks = allBooks.filter(book => book.user_id === user.id);
      
      const commonBooks = myBooks.filter(myBook =>
        userBooks.some(theirBook => 
          myBook.title.toLowerCase() === theirBook.title.toLowerCase()
        )
      );

      return {
        userId: user.id,
        username: user.username,
        commonBooks: commonBooks.map(b => ({ title: b.title, author: b.author })),
        matchCount: commonBooks.length
      };
    }).filter(match => match.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount);

    res.json({ matches });
  } catch (error) {
    console.error('尋找配對錯誤:', error);
    res.status(400).json({ error: error.message });
  }
});

// 建立或取得聊天室
router.post('/chat-room', auth, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = req.userId;

    // 檢查是否已存在聊天室
    const { data: existingRooms, error: searchError } = await supabase
      .from('chat_room_participants')
      .select('chat_room_id')
      .eq('user_id', currentUserId);

    if (searchError) throw searchError;

    let chatRoomId = null;

    if (existingRooms && existingRooms.length > 0) {
      const roomIds = existingRooms.map(r => r.chat_room_id);
      
      const { data: targetRooms } = await supabase
        .from('chat_room_participants')
        .select('chat_room_id')
        .eq('user_id', targetUserId)
        .in('chat_room_id', roomIds);

      if (targetRooms && targetRooms.length > 0) {
        chatRoomId = targetRooms[0].chat_room_id;
      }
    }

    // 如果沒有現有聊天室，創建新的
    if (!chatRoomId) {
      // 創建聊天室
      const { data: newRoom, error: roomError } = await supabase
        .from('chat_rooms')
        .insert([{}])
        .select()
        .single();

      if (roomError) throw roomError;
      chatRoomId = newRoom.id;

      // 添加參與者
      const { error: participantsError } = await supabase
        .from('chat_room_participants')
        .insert([
          { chat_room_id: chatRoomId, user_id: currentUserId },
          { chat_room_id: chatRoomId, user_id: targetUserId }
        ]);

      if (participantsError) throw participantsError;

      // 計算並儲存共同書籍
      const { data: myBooks } = await supabase
        .from('books')
        .select('title, author')
        .eq('user_id', currentUserId);

      const { data: theirBooks } = await supabase
        .from('books')
        .select('title, author')
        .eq('user_id', targetUserId);

      const commonBooks = myBooks.filter(myBook =>
        theirBooks.some(theirBook => 
          myBook.title.toLowerCase() === theirBook.title.toLowerCase()
        )
      );

      if (commonBooks.length > 0) {
        await supabase
          .from('chat_room_books')
          .insert(
            commonBooks.map(book => ({
              chat_room_id: chatRoomId,
              title: book.title,
              author: book.author
            }))
          );
      }
    }

    // 取得完整的聊天室資訊
    const chatRoom = await getChatRoomDetails(chatRoomId);
    res.json({ chatRoom });
  } catch (error) {
    console.error('建立聊天室錯誤:', error);
    res.status(400).json({ error: error.message });
  }
});

// 取得使用者的所有聊天室
router.get('/chat-rooms', auth, async (req, res) => {
  try {
    // 取得使用者參與的聊天室
    const { data: participations, error: partError } = await supabase
      .from('chat_room_participants')
      .select('chat_room_id')
      .eq('user_id', req.userId);

    if (partError) throw partError;

    if (!participations || participations.length === 0) {
      return res.json({ chatRooms: [] });
    }

    const roomIds = participations.map(p => p.chat_room_id);

    // 取得所有聊天室的詳細資訊
    const chatRooms = await Promise.all(
      roomIds.map(roomId => getChatRoomDetails(roomId))
    );

    res.json({ chatRooms });
  } catch (error) {
    console.error('取得聊天室錯誤:', error);
    res.status(400).json({ error: error.message });
  }
});

// 取得特定聊天室
router.get('/chat-room/:roomId', auth, async (req, res) => {
  try {
    // 驗證使用者是否為參與者
    const { data: participation } = await supabase
      .from('chat_room_participants')
      .select('id')
      .eq('chat_room_id', req.params.roomId)
      .eq('user_id', req.userId)
      .single();

    if (!participation) {
      return res.status(404).json({ error: '找不到聊天室' });
    }

    const chatRoom = await getChatRoomDetails(req.params.roomId);
    res.json({ chatRoom });
  } catch (error) {
    console.error('取得聊天室詳情錯誤:', error);
    res.status(400).json({ error: error.message });
  }
});

// 輔助函數：取得聊天室完整資訊
async function getChatRoomDetails(roomId) {
  // 取得參與者
  const { data: participants } = await supabase
    .from('chat_room_participants')
    .select(`
      user_id,
      users (id, username)
    `)
    .eq('chat_room_id', roomId);

  // 取得配對書籍
  const { data: matchedBooks } = await supabase
    .from('chat_room_books')
    .select('title, author')
    .eq('chat_room_id', roomId);

  // 取得訊息
  const { data: messages } = await supabase
    .from('messages')
    .select(`
      id,
      content,
      created_at,
      sender:users!messages_sender_id_fkey (id, username)
    `)
    .eq('chat_room_id', roomId)
    .order('created_at', { ascending: true });

  return {
    id: roomId,
    participants: participants.map(p => p.users),
    matchedBooks: matchedBooks || [],
    messages: messages || []
  };
}

module.exports = router;
