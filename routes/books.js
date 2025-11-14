const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('books')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ books: data || [] });
  } catch (error) {
    console.error('取得書籍失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { title, author, genre } = req.body;
    const userId = req.userId;

    if (!title || !author) {
      return res.status(400).json({ error: '書名和作者為必填欄位' });
    }

    const { data: existingBook } = await supabase
      .from('books')
      .select('*')
      .eq('user_id', userId)
      .eq('title', title)
      .eq('author', author)
      .single();

    if (existingBook) {
      return res.status(400).json({ error: '您已經新增過這本書了' });
    }

    const { data: newBook, error } = await supabase
      .from('books')
      .insert([{
        user_id: userId,
        title,
        author,
        genre: genre || null
      }])
      .select()
      .single();

    if (error) throw error;

    const { data: matches } = await supabase
      .from('books')
      .select('user_id, users(username)')
      .eq('title', title)
      .eq('author', author)
      .neq('user_id', userId);

    const { data: currentUser } = await supabase
      .from('users')
      .select('username')
      .eq('id', userId)
      .single();

    let newMatchesCount = 0;

    if (matches && matches.length > 0) {
      for (const match of matches) {
        const matchUserId = match.user_id;
        newMatchesCount++;

        const { data: notification } = await supabase
          .from('notifications')
          .insert([{
            user_id: matchUserId,
            type: 'new_match',
            title: '新的配對',
            content: `${currentUser?.username || '使用者'} 也擁有《${title}》，你們可以開始聊天了！`,
            related_id: userId,
            link: `/matches`
          }])
          .select()
          .single();

        if (notification && req.io) {
          req.io.to(`user-${matchUserId}`).emit('new-notification', notification);
          console.log(`✅ 配對通知已發送給使用者 ${matchUserId}`);
        }

        const { data: selfNotification } = await supabase
          .from('notifications')
          .insert([{
            user_id: userId,
            type: 'new_match',
            title: '找到配對',
            content: `您與 ${match.users?.username || '使用者'} 都擁有《${title}》`,
            related_id: matchUserId,
            link: `/matches`
          }])
          .select()
          .single();

        if (selfNotification && req.io) {
          req.io.to(`user-${userId}`).emit('new-notification', selfNotification);
        }
      }

      console.log(`✅ 找到 ${newMatchesCount} 個新配對`);
    }

    res.json({
      message: '書籍新增成功',
      book: newBook,
      newMatches: newMatchesCount
    });

  } catch (error) {
    console.error('新增書籍失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:bookId', auth, async (req, res) => {
  try {
    const { bookId } = req.params;

    const { data: book } = await supabase
      .from('books')
      .select('*')
      .eq('id', bookId)
      .eq('user_id', req.userId)
      .single();

    if (!book) {
      return res.status(404).json({ error: '書籍不存在或無權刪除' });
    }

    const { error } = await supabase
      .from('books')
      .delete()
      .eq('id', bookId)
      .eq('user_id', req.userId);

    if (error) throw error;

    res.json({ message: '書籍已刪除' });
  } catch (error) {
    console.error('刪除書籍失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
