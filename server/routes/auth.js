/**
 * 认证接口：登录 / 当前用户
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, ping } = require('../db');
const { signToken, authenticate, ROLE_LABEL } = require('../auth');

const router = express.Router();

// 登录：返回 JWT
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '请输入用户名和密码' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ code: 401, message: '用户名或密码错误' });
  }
  const token = signToken(user);
  res.json({
    code: 0,
    message: '登录成功',
    token,
    user: {
      id: user.id, username: user.username,
      name: user.display_name, role: user.role,
      role_label: ROLE_LABEL[user.role]
    }
  });
});

// 校验令牌 / 获取当前身份
router.get('/me', authenticate, (req, res) => {
  res.json({
    code: 0,
    user: {
      id: req.user.sub, username: req.user.username,
      name: req.user.name, role: req.user.role,
      role_label: ROLE_LABEL[req.user.role]
    }
  });
});

// 数据库连接健康检查（可演示连接是否正常）
router.get('/health', (req, res) => {
  const ok = ping();
  res.status(ok ? 200 : 503).json({
    code: ok ? 0 : 503,
    database: ok ? 'connected' : 'disconnected',
    time: new Date().toISOString()
  });
});

module.exports = router;
