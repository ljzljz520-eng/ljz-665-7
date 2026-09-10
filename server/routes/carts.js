/**
 * 医疗推车档案接口
 * 权限矩阵：
 *   GET 列表/详情            viewer / nurse / admin
 *   新建/编辑/消毒/上传照片   nurse / admin
 *   置为报废                 admin（且任何人都无法把报废车改回）
 *   删除                     admin
 * 业务红线：status = scrapped 的推车禁止编辑、禁止消毒、禁止上传、禁止改回任何状态。
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db } = require('../db');
const { authenticate, requireRole } = require('../auth');

const router = express.Router();
router.use(authenticate); // 本模块所有接口均需登录

const VALID_STATUS = ['in_use', 'idle', 'repair', 'scrapped'];
const STATUS_LABEL = { in_use: '使用中', idle: '闲置', repair: '维修中', scrapped: '已报废' };

// —— 工具 ——
const writeLog = db.prepare(
  `INSERT INTO audit_logs (cart_id, user_id, username, action, detail)
   VALUES (?,?,?,?,?)`
);
const log = (cartId, user, action, detailObj) =>
  writeLog.run(cartId, user.sub, user.username, action, JSON.stringify(detailObj || {}));

function findCart(id) {
  return db.prepare('SELECT * FROM carts WHERE id = ?').get(id);
}
// 报废红线检查
function guardScrapped(cart) {
  if (cart && cart.status === 'scrapped') {
    const err = new Error('该车已报废，档案已锁定，不能编辑、消毒、上传照片或重新启用');
    err.status = 409;
    throw err;
  }
}
function parseKit(input) {
  let kit = input;
  if (typeof input === 'string') {
    try { kit = JSON.parse(input); } catch { kit = input.split(/[\n,，;；]+/); }
  }
  if (!Array.isArray(kit)) throw Object.assign(new Error('药箱配置必须是数组'), { status: 400 });
  kit = kit.map(x => String(x).trim()).filter(Boolean);
  return kit;
}

// —— 照片上传配置 ——
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `cart_${req.params.id}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype))
});

// ============ 列表（支持按科室/状态/编号搜索）============
router.get('/', (req, res) => {
  const { department, status, keyword } = req.query;
  const where = [];
  const params = [];
  if (department) { where.push('department = ?'); params.push(department); }
  if (status && VALID_STATUS.includes(status)) { where.push('status = ?'); params.push(status); }
  if (keyword) { where.push('(cart_no LIKE ? OR responsible_nurse LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
  const sql = `SELECT * FROM carts ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY id DESC`;
  const rows = db.prepare(sql).all(...params).map(r => ({
    ...r,
    medkit_config: JSON.parse(r.medkit_config),
    status_label: STATUS_LABEL[r.status]
  }));
  const departments = db.prepare('SELECT DISTINCT department FROM carts ORDER BY 1').all().map(r => r.department);
  res.json({ code: 0, data: rows, departments });
});

// ============ 详情（含照片与历史操作）============
router.get('/:id', (req, res) => {
  const cart = findCart(req.params.id);
  if (!cart) return res.status(404).json({ code: 404, message: '推车不存在' });
  cart.medkit_config = JSON.parse(cart.medkit_config);
  cart.status_label = STATUS_LABEL[cart.status];
  const photos = db.prepare('SELECT * FROM photos WHERE cart_id = ? ORDER BY id DESC').all(cart.id);
  const logs = db.prepare(
    `SELECT * FROM audit_logs WHERE cart_id = ? ORDER BY id DESC LIMIT 200`
  ).all(cart.id);
  res.json({ code: 0, data: { ...cart, photos, logs } });
});

// ============ 新建 ============
router.post('/', requireRole('nurse', 'admin'), (req, res, next) => {
  try {
    const { cart_no, department, responsible_nurse, sterilized_at, status = 'in_use', remark = '' } = req.body;
    if (!cart_no || !department || !responsible_nurse) {
      return res.status(400).json({ code: 400, message: '推车编号、科室、责任护士为必填项' });
    }
    if (!VALID_STATUS.includes(status)) {
      return res.status(400).json({ code: 400, message: '状态非法' });
    }
    const kit = parseKit(req.body.medkit_config ?? []);
    const exists = db.prepare('SELECT id FROM carts WHERE cart_no = ?').get(cart_no);
    if (exists) return res.status(409).json({ code: 409, message: `推车编号 ${cart_no} 已存在` });

    const info = db.prepare(`
      INSERT INTO carts (cart_no, department, medkit_config, responsible_nurse,
                         sterilized_at, status, remark, created_by)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(cart_no, department, JSON.stringify(kit), responsible_nurse,
           sterilized_at || null, status, remark, req.user.sub);
    log(info.lastInsertRowid, req.user, 'CREATE', { cart_no, department, responsible_nurse, kit, status });
    res.status(201).json({ code: 0, message: '建档成功', data: { id: info.lastInsertRowid } });
  } catch (e) { next(e); }
});

// ============ 编辑（报废车整体锁定）============
router.put('/:id', requireRole('nurse', 'admin'), (req, res, next) => {
  try {
    const cart = findCart(req.params.id);
    if (!cart) return res.status(404).json({ code: 404, message: '推车不存在' });
    guardScrapped(cart); // 红线

    const { cart_no, department, responsible_nurse, sterilized_at, status, remark } = req.body;
    if (!cart_no || !department || !responsible_nurse) {
      return res.status(400).json({ code: 400, message: '推车编号、科室、责任护士为必填项' });
    }
    // 编辑接口不允许借道改状态（状态走专用接口），保持原状态
    const kit = parseKit(req.body.medkit_config ?? []);
    if (db.prepare('SELECT id FROM carts WHERE cart_no = ? AND id != ?').get(cart_no, cart.id)) {
      return res.status(409).json({ code: 409, message: `推车编号 ${cart_no} 已被其他档案占用` });
    }
    const before = {
      cart_no: cart.cart_no, department: cart.department,
      responsible_nurse: cart.responsible_nurse, sterilized_at: cart.sterilized_at,
      medkit_config: JSON.parse(cart.medkit_config), remark: cart.remark
    };
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE carts SET cart_no=?, department=?, medkit_config=?, responsible_nurse=?,
                         sterilized_at=?, remark=?, updated_at=datetime('now','localtime')
        WHERE id=?`
      ).run(cart_no, department, JSON.stringify(kit), responsible_nurse,
            sterilized_at || null, remark ?? '', cart.id);
    });
    tx();
    log(cart.id, req.user, 'UPDATE', {
      before,
      after: { cart_no, department, responsible_nurse, sterilized_at: sterilized_at || null, medkit_config: kit, remark: remark ?? '' }
    });
    res.json({ code: 0, message: '档案已更新' });
  } catch (e) { next(e); }
});

// ============ 消毒登记 ============
router.post('/:id/sterilize', requireRole('nurse', 'admin'), (req, res, next) => {
  try {
    const cart = findCart(req.params.id);
    if (!cart) return res.status(404).json({ code: 404, message: '推车不存在' });
    guardScrapped(cart);
    const at = (req.body.sterilized_at || '').trim();
    if (!at) return res.status(400).json({ code: 400, message: '请填写消毒日期时间' });
    db.prepare(`UPDATE carts SET sterilized_at=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(at, cart.id);
    log(cart.id, req.user, 'STERILIZE', { before: cart.sterilized_at, after: at });
    res.json({ code: 0, message: `消毒登记成功：${at}` });
  } catch (e) { next(e); }
});

// ============ 状态变更（报废不可逆）============
router.patch('/:id/status', requireRole('nurse', 'admin'), (req, res, next) => {
  try {
    const cart = findCart(req.params.id);
    if (!cart) return res.status(404).json({ code: 404, message: '推车不存在' });
    const { status, reason = '' } = req.body;
    if (!VALID_STATUS.includes(status)) {
      return res.status(400).json({ code: 400, message: '目标状态非法' });
    }
    // 红线 1：已报废，任何人（含管理员）都不能改回
    if (cart.status === 'scrapped') {
      return res.status(409).json({
        code: 409,
        message: `该车已报废并永久锁定，不能重新启用（当前：${STATUS_LABEL.scrapped}）`
      });
    }
    // 红线 2：报废是敏感操作，仅管理员
    if (status === 'scrapped' && req.user.role !== 'admin') {
      return res.status(403).json({
        code: 403,
        message: '报废操作仅管理员可执行；执行后该车将永久无法重新启用'
      });
    }
    if (status === cart.status) {
      return res.status(400).json({ code: 400, message: `车辆当前已是「${STATUS_LABEL[status]}」` });
    }
    db.prepare(`UPDATE carts SET status=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(status, cart.id);
    log(cart.id, req.user, 'STATUS_CHANGE', { before: cart.status, after: status, reason });
    res.json({ code: 0, message: `状态已变更：${STATUS_LABEL[cart.status]} → ${STATUS_LABEL[status]}` });
  } catch (e) { next(e); }
});

// ============ 上传照片 ============
router.post('/:id/photos', requireRole('nurse', 'admin'),
  (req, res, next) => {
    const cart = findCart(req.params.id);
    if (!cart) return res.status(404).json({ code: 404, message: '推车不存在' });
    if (cart.status === 'scrapped') {
      return res.status(409).json({ code: 409, message: '报废车档案锁定，不能上传照片' });
    }
    next();
  },
  upload.single('photo'),
  (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ code: 400, message: '未收到图片（支持 jpg/png/gif/webp，≤5MB）' });
      const url = `/uploads/${req.file.filename}`;
      const caption = (req.body.caption || '').trim();
      const info = db.prepare('INSERT INTO photos (cart_id, url, caption, uploaded_by) VALUES (?,?,?,?)')
        .run(req.params.id, url, caption, req.user.sub);
      log(req.params.id, req.user, 'PHOTO_UPLOAD', { url, caption });
      res.status(201).json({ code: 0, message: '照片上传成功', data: { id: info.lastInsertRowid, url } });
    } catch (e) { next(e); }
  }
);

// ============ 删除档案（仅管理员）============
router.delete('/:id', requireRole('admin'), (req, res) => {
  const cart = findCart(req.params.id);
  if (!cart) return res.status(404).json({ code: 404, message: '推车不存在' });
  db.prepare('DELETE FROM carts WHERE id=?').run(cart.id); // 级联删除照片与日志
  log(null, req.user, 'DELETE', { cart_no: cart.cart_no, department: cart.department });
  res.json({ code: 0, message: `档案 ${cart.cart_no} 已删除` });
});

module.exports = router;
