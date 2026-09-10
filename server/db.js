/**
 * 数据库连接层
 * 使用 better-sqlite3（同步 API，演示事务与并发控制简单直观）
 * 数据库文件：data/carts.db
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'carts.db');

// —— 建立连接（单例）——
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');   // 并发更稳
db.pragma('foreign_keys = ON');    // 开启外键约束

console.log(`[DB] 已连接 SQLite：${DB_PATH}`);

// —— 建表 ——
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('viewer','nurse','admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS carts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_no          TEXT NOT NULL UNIQUE,          -- 推车编号
  department       TEXT NOT NULL,                 -- 科室
  medkit_config    TEXT NOT NULL DEFAULT '[]',    -- 药箱配置(JSON 数组)
  responsible_nurse TEXT NOT NULL,                -- 责任护士
  sterilized_at    TEXT,                          -- 最近消毒日期
  status           TEXT NOT NULL DEFAULT 'in_use'
                   CHECK (status IN ('in_use','idle','repair','scrapped')),
  remark           TEXT DEFAULT '',
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id    INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  caption    TEXT DEFAULT '',
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id     INTEGER REFERENCES carts(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  username    TEXT NOT NULL,
  action      TEXT NOT NULL,        -- CREATE/UPDATE/STERILIZE/STATUS_CHANGE/PHOTO_UPLOAD/DELETE
  detail      TEXT DEFAULT '',       -- JSON 描述（变更前后值）
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_photos_cart ON photos(cart_id);
CREATE INDEX IF NOT EXISTS idx_logs_cart ON audit_logs(cart_id);
`);

// —— 种子数据：演示账号 + 示例推车 ——
const seed = () => {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount > 0) {
    console.log('[DB] 数据已存在，跳过种子。');
    return;
  }
  const hash = (p) => bcrypt.hashSync(p, 10);
  const insertUser = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role) VALUES (?,?,?,?)`
  );
  const users = [
    ['admin',  '系统管理员', hash('admin123'),  'admin'],
    ['nurse1', '张护士',     hash('nurse123'),  'nurse'],
    ['viewer1','李巡查',     hash('viewer123'), 'viewer'],
  ];
  const userIds = {};
  for (const [u, n, h, r] of users) {
    const info = insertUser.run(u, n, h, r);
    userIds[u] = info.lastInsertRowid;
  }

  const insertCart = db.prepare(`
    INSERT INTO carts (cart_no, department, medkit_config, responsible_nurse,
                       sterilized_at, status, remark, created_by)
    VALUES (?,?,?,?,?,?,?,?)
  `);
  const kit = (arr) => JSON.stringify(arr);
  const carts = [
    ['TC-001', '急诊科', kit(['急救药品箱A','除颤仪配套箱','气道管理箱','输液处置箱']),
     '张护士', '2026-09-08 09:20', 'in_use', '急诊抢救区常用推车', userIds.nurse1],
    ['TC-002', '内科病区', kit(['口服药配送箱','血糖监测箱']),
     '王护士', '2026-09-05 14:00', 'idle', '库房待命', userIds.nurse1],
    ['TC-003', '手术室', kit(['麻醉药品箱(双锁)','无菌器械箱','术后清点箱']),
     '赵护士', '2026-09-09 07:40', 'repair', '万向轮故障，维修中', userIds.admin],
    ['TC-009', '儿科', kit(['儿童急救箱','雾化药品箱']),
     '张护士', '2025-12-01 10:00', 'scrapped', '箱体锈蚀严重，已于 2026-01 报废，禁止启用', userIds.admin],
  ];
  const insertLog = db.prepare(
    `INSERT INTO audit_logs (cart_id, user_id, username, action, detail) VALUES (?,?,?,?,?)`
  );
  for (const c of carts) {
    const info = insertCart.run(...c);
    insertLog.run(info.lastInsertRowid, userIds.admin, 'admin', 'CREATE',
      JSON.stringify({ cart_no: c[0], department: c[1] }));
  }
  // 给报废车补一条报废记录，方便演示锁定
  const scrapped = db.prepare("SELECT id FROM carts WHERE cart_no='TC-009'").get();
  if (scrapped) {
    insertLog.run(scrapped.id, userIds.admin, 'admin', 'STATUS_CHANGE',
      JSON.stringify({ before: 'repair', after: 'scrapped', reason: '箱体锈蚀，达到报废年限' }));
  }
  console.log('[DB] 种子数据写入完成（3 个演示账号 + 4 台示例推车）。');
};

seed();

// 健康检查用
const ping = () => db.prepare('SELECT 1 AS ok').get().ok === 1;

module.exports = { db, ping };

// 允许 `node server/db.js --seed-only` 单独初始化
if (require.main === module && process.argv.includes('--seed-only')) {
  console.log('[DB] 初始化/种子完成，退出。');
}
