const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

// 新增書籍
router.post('/', auth, async (req, res) => {
  try {
    const { title, author } = req.body;

    if (!title || !author) {
      return res.status(400).json({ error: '請提供書名和作者' });
    }

    const { data: book, error } = await supabase
      .from('books')
      .insert([
        { 
          user_id: req.userId, 
          title, 
          author 
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ 
      message: '書籍新增成功',
      book
    });
  } catch (error) {
    console.error('新增書籍錯誤:', error);
    res.status(400).json({ error: error.message });
  }
});

// 取得使用者的所有書籍
router.get('/', auth, async (req, res) => {
  try {
    const { data: books, error } = await supabase
      .from('books')
      .select('id, title, author, added_at')
      .eq('user_id', req.userId)
      .order('added_at', { ascending: false });

    if (error) throw error;

    res.json({ books: books || [] });
  } catch (error) {
    console.error('取得書籍錯誤:', error);
    res.status(400).json({ error: error.message });
  }
});

// 刪除書籍
router.delete('/:bookId', auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('books')
      .delete()
      .eq('id', req.params.bookId)
      .eq('user_id', req.userId);

    if (error) throw error;

    res.json({ message: '書籍刪除成功' });
  } catch (error) {
    console.error('刪除書籍錯誤:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
