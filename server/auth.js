/**
 * 认证与授权（可演示）
 * - JWT Bearer Token 认证
 * - 基于角色的访问控制：viewer（只读）/ nurse（护士，可维护+消毒+照片）/ admin（管理员，可报废/删除）
 * - 关键规则：状态为 scrapped（报废）的推车不允许重新启用/编辑
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'demo-secret-medical-cart-2026';
const JWT_EXPIRES = '8h';

const ROLE_LABEL = { viewer: '巡查员(只读)', nurse: '责任护士', admin: '管理员' };

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, name: user.display_name, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

// 解析并校验 Token，挂到 req.user
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ code: 401, message: '未提供认证令牌，请先登录' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ code: 401, message: '令牌无效或已过期，请重新登录' });
  }
}

// 角色要求：requireRole('admin') / requireRole('nurse','admin')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ code: 401, message: '未认证' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        code: 403,
        message: `权限不足：该操作需要 [${roles.map(r => ROLE_LABEL[r] || r).join(' 或 ')}] 权限，当前为「${ROLE_LABEL[req.user.role]}」`
      });
    }
    next();
  };
}

module.exports = { signToken, authenticate, requireRole, JWT_SECRET, ROLE_LABEL };
