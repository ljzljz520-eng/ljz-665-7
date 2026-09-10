/* 医疗推车档案 - 前端逻辑 */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  token: localStorage.getItem('mc_token') || '',
  user: JSON.parse(localStorage.getItem('mc_user') || 'null'),
  currentCart: null,
};

const STATUS_LABEL = { in_use: '使用中', idle: '闲置', repair: '维修中', scrapped: '已报废' };
const ACTION_LABEL = {
  CREATE: '建档', UPDATE: '编辑档案', STERILIZE: '消毒登记',
  STATUS_CHANGE: '状态变更', PHOTO_UPLOAD: '上传照片', DELETE: '删除档案'
};

// ---------- 基础请求 ----------
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch('/api' + url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error(data.message || '登录已失效'); }
  if (!res.ok) throw new Error(data.message || `请求失败(${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 登录 / 登出 ----------
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { username: $('#loginUser').value.trim(), password: $('#loginPass').value }
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('mc_token', data.token);
    localStorage.setItem('mc_user', JSON.stringify(data.user));
    enterApp();
    toast('登录成功', 'ok');
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

function logout() {
  state.token = ''; state.user = null;
  localStorage.removeItem('mc_token'); localStorage.removeItem('mc_user');
  $('#appView').hidden = true; $('#loginView').style.display = 'flex';
}
$('#btnLogout').addEventListener('click', logout);

function enterApp() {
  $('#loginView').style.display = 'none';
  $('#appView').hidden = false;
  $('#userName').textContent = `${state.user.name}（${state.user.username}）`;
  $('#userRole').textContent = state.user.role_label;
  const canWrite = ['nurse', 'admin'].includes(state.user.role);
  $('#btnCreate').style.display = canWrite ? '' : 'none';
  loadList();
  checkDb();
  setInterval(checkDb, 15000);
}

async function checkDb() {
  try {
    const d = await api('/auth/health');
    const el = $('#dbStatus');
    el.textContent = '🟢 数据库已连接';
    el.classList.toggle('bad', d.code !== 0);
  } catch {
    const el = $('#dbStatus');
    el.textContent = '🔴 数据库连接异常';
    el.classList.add('bad');
  }
}

// ---------- 列表 ----------
async function loadList() {
  const params = new URLSearchParams();
  if ($('#fKeyword').value.trim()) params.set('keyword', $('#fKeyword').value.trim());
  if ($('#fDept').value) params.set('department', $('#fDept').value);
  if ($('#fStatus').value) params.set('status', $('#fStatus').value);
  const { data, departments } = await api('/carts?' + params.toString());

  const deptSel = $('#fDept');
  const cur = deptSel.value;
  deptSel.innerHTML = '<option value="">全部科室</option>' +
    departments.map(d => `<option ${d === cur ? 'selected' : ''}>${esc(d)}</option>`).join('');
  $('#deptList').innerHTML = departments.map(d => `<option value="${esc(d)}">`).join('');

  const canWrite = ['nurse', 'admin'].includes(state.user.role);
  $('#cartTbody').innerHTML = data.map(c => {
    const kit = c.medkit_config || [];
    const tags = kit.slice(0, 2).map(k => `<span class="tag">${esc(k)}</span>`).join('')
      + (kit.length > 2 ? `<span class="tag more">+${kit.length - 2}</span>` : '');
    return `<tr class="${c.status === 'scrapped' ? 'row-locked' : ''}">
      <td><b>${esc(c.cart_no)}</b>${c.status === 'scrapped' ? ' 🔒' : ''}</td>
      <td>${esc(c.department)}</td>
      <td>${esc(c.responsible_nurse)}</td>
      <td><div class="tags">${tags || '<span class="muted">—</span>'}</div></td>
      <td class="muted">${esc(c.sterilized_at || '未登记')}</td>
      <td><span class="status ${c.status}">${c.status_label}</span></td>
      <td class="muted">${esc(c.updated_at)}</td>
      <td>
        <button class="btn sm" onclick="openDetail(${c.id})">详情</button>
        ${canWrite && c.status !== 'scrapped' ? `<button class="btn sm" onclick="openForm(${c.id})">编辑</button>` : ''}
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">暂无符合条件的档案</td></tr>';
}
$('#btnSearch').addEventListener('click', loadList);
$('#fKeyword').addEventListener('keydown', e => e.key === 'Enter' && loadList());
['#fDept', '#fStatus'].forEach(s => $(s).addEventListener('change', loadList));

// ---------- 新建/编辑表单 ----------
$('#btnCreate').addEventListener('click', () => openForm());

function closeModal(id) { $(id).hidden = true; }
$$('[data-close]').forEach(b => b.addEventListener('click', e =>
  e.closest('.modal-mask').hidden = true));

async function openForm(id) {
  $('#cartForm').reset();
  $('#cartId').value = id || '';
  $('#formTitle').textContent = id ? '编辑推车档案' : '新建推车档案';
  $('#statusField').style.display = id ? 'none' : '';
  $('#fStatusForm').value = 'in_use';
  $('#scrapLockTip').hidden = true;

  if (id) {
    const { data } = await api('/carts/' + id);
    if (data.status === 'scrapped') {
      toast('报废车档案已锁定，不可编辑', 'err');
      openDetail(id);
      return;
    }
    $('#fCartNo').value = data.cart_no;
    $('#fDepartment').value = data.department;
    $('#fNurse').value = data.responsible_nurse;
    $('#fSterilized').value = (data.sterilized_at || '').replace(' ', 'T').slice(0, 16);
    $('#fKit').value = (data.medkit_config || []).join('\n');
    $('#fRemark').value = data.remark || '';
  }
  $('#formModal').hidden = false;
}

$('#cartForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#cartId').value;
  const body = {
    cart_no: $('#fCartNo').value.trim(),
    department: $('#fDepartment').value.trim(),
    responsible_nurse: $('#fNurse').value.trim(),
    sterilized_at: $('#fSterilized').value ? $('#fSterilized').value.replace('T', ' ') + ':00' : '',
    medkit_config: $('#fKit').value.split('\n').map(s => s.trim()).filter(Boolean),
    remark: $('#fRemark').value.trim(),
    status: $('#fStatusForm').value,
  };
  try {
    if (id) {
      await api('/carts/' + id, { method: 'PUT', body });
      toast('档案已更新', 'ok');
    } else {
      await api('/carts', { method: 'POST', body });
      toast('建档成功', 'ok');
    }
    closeModal('#formModal');
    loadList();
  } catch (err) { toast(err.message, 'err'); }
});

// ---------- 详情 ----------
window.openDetail = openDetail;
window.openForm = openForm;

async function openDetail(id) {
  const { data } = await api('/carts/' + id);
  state.currentCart = data;
  const scrapped = data.status === 'scrapped';
  const role = state.user.role;
  const canWrite = ['nurse', 'admin'].includes(role);

  $('#dTitle').textContent = `推车档案 · ${data.cart_no}`;
  $('#dBadges').innerHTML = `<span class="status ${data.status}">${data.status_label}</span>`
    + (scrapped ? ' <span class="status scrapped">🔒 永久锁定</span>' : '');
  $('#dNo').textContent = data.cart_no;
  $('#dDept').textContent = data.department;
  $('#dNurse').textContent = data.responsible_nurse;
  $('#dSter').textContent = data.sterilized_at || '未登记';
  $('#dCreated').textContent = data.created_at;
  $('#dUpdated').textContent = data.updated_at;
  $('#dKit').innerHTML = (data.medkit_config || [])
    .map(k => `<li>${esc(k)}</li>`).join('') || '<li class="muted">无配置</li>';
  $('#dRemark').textContent = data.remark || '';
  $('#dRemark').style.display = data.remark ? '' : 'none';

  // 照片
  $('#photoGrid').innerHTML = data.photos.map(p => `
    <div class="photo-card">
      <img src="${esc(p.url)}" alt="${esc(p.caption)}" onclick="window.open('${esc(p.url)}')">
      <p>${esc(p.caption || '无说明')}<br><span style="opacity:.7">${esc(p.created_at)}</span></p>
    </div>`).join('') || '<p class="muted">暂无照片</p>';

  // 历史操作
  $('#logBox').innerHTML = data.logs.map(l => {
    let detail = '';
    try {
      const obj = JSON.parse(l.detail || '{}');
      detail = renderDetail(l.action, obj);
    } catch { detail = esc(l.detail); }
    return `<div class="log-item">
      <span class="t">${esc(l.created_at)}</span>
      <span class="u"><span class="act ${l.action}">${ACTION_LABEL[l.action] || l.action}</span>${esc(l.username)}</span>
      <pre>${detail}</pre>
    </div>`;
  }).join('') || '<p class="muted" style="padding:12px">暂无操作记录</p>';

  // 按角色 + 状态控制按钮
  const actions = $('#dActions');
  actions.style.opacity = canWrite ? '' : '.55';
  ['btnSterilize','btnRepair','btnIdle','btnInUse','btnScrap','btnUpload','btnEdit'].forEach(b =>
    $('#' + b).disabled = !canWrite || scrapped);
  $('#btnDelete').disabled = role !== 'admin';
  $('#btnInUse').textContent = data.status === 'in_use' ? '当前使用中' : '启用/使用中';
  $('#photoInput').disabled = !canWrite || scrapped;
  if (!canWrite) $$('#dActions .btn, .photo-bar .btn').forEach(b => b.title = '只读账号无权操作');
  if (scrapped) $$('#dActions .btn:not(#btnDelete)').forEach(b => b.title = '已报废，档案锁定');

  $('#detailModal').hidden = false;
}

function renderDetail(action, o) {
  if (action === 'STATUS_CHANGE') {
    return esc(`${STATUS_LABEL[o.before] || o.before} → ${STATUS_LABEL[o.after] || o.after}`)
      + (o.reason ? `\n原因：${esc(o.reason)}` : '');
  }
  if (action === 'STERILIZE') return esc(`消毒时间：${o.after || '—'}（上次：${o.before || '无'}）`);
  if (action === 'PHOTO_UPLOAD') return esc(`照片：${o.url}${o.caption ? '｜' + o.caption : ''}`);
  if (action === 'CREATE') return esc(`科室：${o.department}｜护士：${o.responsible_nurse}\n药箱：${(o.kit || []).join('、')}`);
  if (action === 'DELETE') return esc(`删除档案：${o.cart_no}（${o.department}）`);
  if (action === 'UPDATE') {
    const diffs = [];
    const fields = { cart_no: '编号', department: '科室', responsible_nurse: '责任护士', sterilized_at: '消毒时间', remark: '备注' };
    for (const [k, label] of Object.entries(fields)) {
      if ((o.before?.[k] ?? '') !== (o.after?.[k] ?? '')) {
        diffs.push(`${label}: ${o.before?.[k] || '空'} → ${o.after?.[k] || '空'}`);
      }
    }
    if (JSON.stringify(o.before?.medkit_config || []) !== JSON.stringify(o.after?.medkit_config || [])) {
      diffs.push(`药箱配置:\n  ${(o.before?.medkit_config || []).join('、') || '空'}\n  → ${(o.after?.medkit_config || []).join('、')}`);
    }
    return esc(diffs.join('\n') || '无字段变化');
  }
  return esc(JSON.stringify(o, null, 2));
}

// ---------- 详情页操作 ----------
$('#btnEdit').addEventListener('click', () => openForm(state.currentCart.id));

$('#btnSterilize').addEventListener('click', async () => {
  const v = prompt('请输入消毒日期时间（留空取当前时间）\n格式 YYYY-MM-DD HH:MM:SS',
    new Date().toISOString().slice(0, 19).replace('T', ' '));
  if (v === null) return;
  try {
    const r = await api(`/carts/${state.currentCart.id}/sterilize`, {
      method: 'POST', body: { sterilized_at: v }
    });
    toast(r.message, 'ok');
    openDetail(state.currentCart.id);
  } catch (e) { toast(e.message, 'err'); }
});

async function changeStatus(status, reason = '') {
  try {
    const r = await api(`/carts/${state.currentCart.id}/status`, {
      method: 'PATCH', body: { status, reason }
    });
    toast(r.message, 'ok');
    openDetail(state.currentCart.id);
    loadList();
  } catch (e) { toast(e.message, 'err'); }
}
$('#btnRepair').addEventListener('click', () => changeStatus('repair'));
$('#btnIdle').addEventListener('click', () => changeStatus('idle'));
$('#btnInUse').addEventListener('click', () => {
  if (state.currentCart.status !== 'in_use') changeStatus('in_use');
});
$('#btnScrap').addEventListener('click', () => {
  if (state.user.role !== 'admin') {
    toast('报废操作仅管理员可执行', 'err'); return;
  }
  const reason = prompt('⚠️ 报废后该车将永久锁定，任何人都无法重新启用或编辑。\n请填写报废原因（确认请输入原因）：');
  if (reason === null || !reason.trim()) {
    if (reason !== null) toast('已取消：需填写报废原因', 'err');
    return;
  }
  if (!confirm('最后确认：确定报废该车？此操作不可恢复！')) return;
  changeStatus('scrapped', reason.trim());
});

$('#btnDelete').addEventListener('click', async () => {
  if (!confirm(`确定删除档案 ${state.currentCart.cart_no}？仅管理员可执行，照片与历史日志将一并清除。`)) return;
  try {
    const r = await api(`/carts/${state.currentCart.id}`, { method: 'DELETE' });
    toast(r.message, 'ok');
    closeModal('#detailModal');
    loadList();
  } catch (e) { toast(e.message, 'err'); }
});

// ---------- 照片 ----------
$('#btnUpload').addEventListener('click', () => {
  if (!['nurse', 'admin'].includes(state.user.role)) return toast('只读账号无权上传', 'err');
  if (state.currentCart.status === 'scrapped') return toast('报废车档案锁定，不能上传照片', 'err');
  $('#photoInput').click();
});
$('#photoInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('photo', file);
  fd.append('caption', $('#photoCaption').value.trim());
  try {
    const r = await api(`/carts/${state.currentCart.id}/photos`, { method: 'POST', body: fd });
    toast(r.message, 'ok');
    $('#photoCaption').value = '';
    e.target.value = '';
    openDetail(state.currentCart.id);
  } catch (err) { toast(err.message, 'err'); }
});

// ---------- 启动 ----------
if (state.token && state.user) {
  // 校验 token 是否仍有效
  api('/auth/me').then(enterApp).catch(() => logout());
} else {
  $('#loginView').style.display = 'flex';
}
