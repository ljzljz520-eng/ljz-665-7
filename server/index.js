/**
 * 医疗推车档案模块 - 服务入口
 * 启动：npm start  (默认 http://localhost:3000)
 */
const path = require('path');
const express = require('express');
require('./db'); // 连接 + 建表 + 种子
const authRoutes = require('./routes/auth');
const cartRoutes = require('./routes/carts');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 简单的请求日志（便于演示时观察鉴权过程）
app.use((req, _res, next) => {
  const auth = req.headers.authorization ? 'Bearer ***' : '无Token';
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}  认证:${auth}`);
  next();
});

// API
app.use('/api/auth', authRoutes);
app.use('/api/carts', cartRoutes);

// 静态资源：前端 & 上传文件
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 统一错误处理（含 multer 等）
app.use((err, _req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  const message = err.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 5MB'
    : err.message || '服务器内部错误';
  if (status >= 500) console.error('[ERROR]', err);
  res.status(status).json({ code: status, message });
});

app.listen(PORT, () => {
  console.log('---------------------------------------------------------');
  console.log(` 医疗推车档案模块已启动： http://localhost:${PORT}`);
  console.log(' 演示账号：');
  console.log('   admin/admin123    管理员（可报废/删除，报废后不可恢复）');
  console.log('   nurse1/nurse123   责任护士（建档/编辑/消毒/照片/状态）');
  console.log('   viewer1/viewer123 巡查员（仅查看）');
  console.log('---------------------------------------------------------');
});
