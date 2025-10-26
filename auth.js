const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

// 註冊
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // 檢查使用者是否已存在
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .or(`email.eq.${email},username.eq.${username}`)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: '使用者名稱或信箱已被使用' });
    }

    // 加密密碼
    const passwordHash = await bcrypt.hash(password, 10);

    // 創建使用者
    const { data: user, error } = await supabase
      .from('users')
      .insert([
        { username, email, password_hash: passwordHash }
      ])
      .select()
      .single();

    if (error) throw error;

    // 生成 JWT token
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      token
    });
  } catch (error) {
    console.error('註冊錯誤:', error);
    res.status(400).json({ error: error.message || '註冊失敗' });
  }
});

// 登入
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // 查找使用者
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, password_hash')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: '信箱或密碼錯誤' });
    }

    // 驗證密碼
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: '信箱或密碼錯誤' });
    }

    // 生成 JWT token
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      token
    });
  } catch (error) {
    console.error('登入錯誤:', error);
    res.status(400).json({ error: error.message || '登入失敗' });
  }
});

// 取得目前使用者資訊
router.get('/me', auth, async (req, res) => {
  try {
    // 取得使用者資訊和書籍
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, username, email')
      .eq('id', req.userId)
      .single();

    if (userError) throw userError;

    const { data: books, error: booksError } = await supabase
      .from('books')
      .select('id, title, author, added_at')
      .eq('user_id', req.userId)
      .order('added_at', { ascending: false });

    if (booksError) throw booksError;

    res.json({
      user: {
        ...user,
        books: books || []
      }
    });
  } catch (error) {
    console.error('取得使用者資訊錯誤:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
