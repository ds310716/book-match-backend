const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

// 取得使用者的通知列表
router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({ 
      notifications: data || [],
      unreadCount: data ? data.filter(n => !n.is_read).length : 0
    });
  } catch (error) {
    console.error('取得通知失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

// 取得未讀數量
router.get('/unread-count', auth, async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId)
      .eq('is_read', false);

    if (error) throw error;

    res.json({ unreadCount: count || 0 });
  } catch (error) {
    console.error('取得未讀數量失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

// 標記單一通知為已讀
router.put('/:notificationId/read', auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.notificationId)
      .eq('user_id', req.userId);

    if (error) throw error;

    res.json({ message: '已標記為已讀' });
  } catch (error) {
    console.error('標記已讀失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

// 標記全部為已讀
router.put('/read-all', auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.userId)
      .eq('is_read', false);

    if (error) throw error;

    res.json({ message: '已標記全部為已讀' });
  } catch (error) {
    console.error('標記全部已讀失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

// 刪除單一通知
router.delete('/:notificationId', auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', req.params.notificationId)
      .eq('user_id', req.userId);

    if (error) throw error;

    res.json({ message: '通知已刪除' });
  } catch (error) {
    console.error('刪除通知失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

// 刪除所有已讀通知
router.delete('/read/all', auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('user_id', req.userId)
      .eq('is_read', true);

    if (error) throw error;

    res.json({ message: '已刪除所有已讀通知' });
  } catch (error) {
    console.error('刪除已讀通知失敗:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
