const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

// 取得使用者的所有書籍
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

// 新增書籍
router.post('/', auth, async (req, res) => {
  try {
    const { title, author, genre } = req.body;
    const userId = req.userId;

    // 驗證必填欄位
    if (!title || !author) {
      return res.status(400).json({ error: '書名和作者為必填欄位' });
    }

    // 檢查是否已經新增過這本書
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

    // 新增書籍
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

    // ===== 新增：檢查新配對並創建通知 =====
    
    // 1. 找出有相同書籍的其他使用者
    const { data: matches } = await supabase
      .from('books')
      .select('user_id, users(username)')
      .eq('title', title)
      .eq('author', author)
      .neq('user_id', userId);

    // 2. 取得當前使用者資訊
    const { data: currentUser } = await supabase
      .from('users')
      .select('username')
      .eq('id', userId)
      .single();

    let newMatchesCount = 0;

    // 3. 為每個配對的使用者創建通知
    if (matches && matches.length > 0) {
      for (const match of matches) {
        const matchUserId = match.user_id;
        newMatchesCount++;

        // 創建通知給配對的使用者
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

        // 推送通知
        if (notification && req.io) {
          req.io.to(`user-${matchUserId}`).emit('new-notification', notification);
          console.log(`✅ 配對通知已發送給使用者 ${matchUserId}`);
        }

        // 同時也為當前使用者創建通知
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

        // 推送給自己
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

// 刪除書籍
router.delete('/:bookId', auth, async (req, res) => {
  try {
    const { bookId } = req.params;

    // 確認書籍屬於當前使用者
    const { data: book } = await supabase
      .from('books')
      .select('*')
      .eq('id', bookId)
      .eq('user_id', req.userId)
      .single();

    if (!book) {
      return res.status(404).json({ error: '書籍不存在或無權刪除' });
    }

    // 刪除書籍
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
```

**Commit message**: `階段2：新增新配對通知 - books.js`

---

## ✅ 操作步驟總結

### 對於每個檔案：

1. 在 GitHub 打開檔案
2. 點擊鉛筆圖示 ✏️ 編輯
3. **Ctrl+A 全選**
4. **Delete 刪除**
5. **貼上我提供的新內容**
6. Commit message 填入我建議的訊息
7. 點擊 **"Commit changes"**

### 順序：

1. ✅ 先改 `server.js`
2. ✅ 再改 `routes/match.js`
3. ✅ 最後改 `routes/books.js`

---

## 🚀 完成後

### 1. 等待 Render 部署

- 前往 Render Dashboard
- 查看部署狀態
- 等待變成 "Live"（約 2-3 分鐘）

### 2. 查看 Logs

確認沒有錯誤：
```
✅ 伺服器運行在 port 10000
✅ 使用者連線: xxx User ID: xxx
✅ 使用者 xxx 加入個人通知房間
