'use strict';

/* ========================================================================
   MÁY KIẾM XU — logic trò chơi nhấp để kiếm xu
   ======================================================================== */

// ---------- Dữ liệu nâng cấp ----------
var CLICK_UPGRADES = [
  { id: 'gloves',  name: 'Găng Tay Vàng',      icon: '🧤', baseCost: 50,    effect: 1   },
  { id: 'hammer',  name: 'Búa Kim Loại',       icon: '🔨', baseCost: 300,   effect: 5   },
  { id: 'robot',   name: 'Tay Robot',          icon: '🦾', baseCost: 1500,  effect: 20  },
  { id: 'laser',   name: 'Laser Nhấp',         icon: '⚡', baseCost: 8000,  effect: 100 },
  { id: 'quantum', name: 'Siêu Nhấp Lượng Tử', icon: '💫', baseCost: 40000, effect: 500 }
];

var AUTO_UPGRADES = [
  { id: 'mini',    name: 'Máy Đúc Xu Mini',    icon: '⚙️', baseCost: 100,   effect: 1   },
  { id: 'medium',  name: 'Máy Đúc Xu Cỡ Vừa',  icon: '🏭', baseCost: 600,   effect: 5   },
  { id: 'factory', name: 'Nhà Máy Xu',         icon: '🏗️', baseCost: 3000,  effect: 25  },
  { id: 'mint',    name: 'Trung Tâm Đúc Tiền', icon: '🏦', baseCost: 15000, effect: 120 },
  { id: 'ai',      name: 'Siêu Máy In Xu AI',  icon: '🤖', baseCost: 75000, effect: 600 }
];

var COST_MULT = 1.15;
var SAVE_KEY = 'may_kiem_xu_save_v1';
var AUTOSAVE_INTERVAL_MS = 3000;
var TICK_INTERVAL_MS = 200;
var MAX_OFFLINE_SECONDS = 12 * 3600;

var dirty = false;
var lastTickTime = Date.now();

// ---------- Trạng thái ----------
function defaultState() {
  var clickLevels = {};
  var autoLevels = {};
  CLICK_UPGRADES.forEach(function (u) { clickLevels[u.id] = 0; });
  AUTO_UPGRADES.forEach(function (u) { autoLevels[u.id] = 0; });
  return {
    xu: 0,
    totalEarned: 0,
    totalClicks: 0,
    clickLevels: clickLevels,
    autoLevels: autoLevels,
    createdAt: Date.now(),
    lastSeen: Date.now()
  };
}

function loadState() {
  try {
    var raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultState();
    var parsed = JSON.parse(raw);
    var base = defaultState();
    var merged = Object.assign(base, parsed);
    merged.clickLevels = Object.assign(base.clickLevels, parsed.clickLevels || {});
    merged.autoLevels = Object.assign(base.autoLevels, parsed.autoLevels || {});
    if (typeof merged.xu !== 'number' || !isFinite(merged.xu) || merged.xu < 0) merged.xu = 0;
    if (typeof merged.totalEarned !== 'number' || !isFinite(merged.totalEarned) || merged.totalEarned < 0) merged.totalEarned = merged.xu;
    if (typeof merged.totalClicks !== 'number' || !isFinite(merged.totalClicks) || merged.totalClicks < 0) merged.totalClicks = 0;
    if (typeof merged.createdAt !== 'number' || !isFinite(merged.createdAt)) merged.createdAt = Date.now();
    if (typeof merged.lastSeen !== 'number' || !isFinite(merged.lastSeen)) merged.lastSeen = Date.now();
    return merged;
  } catch (e) {
    console.warn('Không đọc được dữ liệu đã lưu, bắt đầu ván mới:', e);
    return defaultState();
  }
}

var state = loadState();

function saveState() {
  try {
    state.lastSeen = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    dirty = false;
    pulseSaveIndicator(false);
    return true;
  } catch (e) {
    console.error('Lỗi khi lưu dữ liệu:', e);
    pulseSaveIndicator(true);
    showToast('⚠️ Không thể lưu dữ liệu vào máy này');
    return false;
  }
}

// ---------- Tính toán ----------
function getCostForLevel(upgrade, level) {
  return Math.ceil(upgrade.baseCost * Math.pow(COST_MULT, level));
}

function getXuPerClick() {
  var total = 1;
  CLICK_UPGRADES.forEach(function (u) {
    total += u.effect * state.clickLevels[u.id];
  });
  return total;
}

function getXuPerSecond() {
  var total = 0;
  AUTO_UPGRADES.forEach(function (u) {
    total += u.effect * state.autoLevels[u.id];
  });
  return total;
}

function formatXu(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) n = 0;
  return Math.floor(n).toLocaleString('vi-VN');
}

function formatUsd(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) n = 0;
  return n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDuration(totalSeconds) {
  totalSeconds = Math.max(0, Math.floor(totalSeconds));
  if (totalSeconds < 60) return totalSeconds + ' giây';
  var totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return totalMinutes + ' phút';
  var totalHours = Math.floor(totalMinutes / 60);
  var remMinutes = totalMinutes % 60;
  if (totalHours < 24) return remMinutes > 0 ? (totalHours + ' giờ ' + remMinutes + ' phút') : (totalHours + ' giờ');
  var days = Math.floor(totalHours / 24);
  var remHours = totalHours % 24;
  return remHours > 0 ? (days + ' ngày ' + remHours + ' giờ') : (days + ' ngày');
}

// ---------- Mua nâng cấp ----------
function buyUpgrade(list, levelsObj, id) {
  var upgrade = list.find(function (u) { return u.id === id; });
  if (!upgrade) return false;
  var level = levelsObj[id];
  var cost = getCostForLevel(upgrade, level);
  if (state.xu < cost) return false;
  state.xu -= cost;
  levelsObj[id] = level + 1;
  dirty = true;
  saveState();
  return true;
}

// ---------- Nhấp & tự động ----------
function handleClick() {
  var gained = getXuPerClick();
  state.xu += gained;
  state.totalEarned += gained;
  state.totalClicks += 1;
  dirty = true;
  spawnFloatingNumber(gained);
  bounceCoin();
  renderBalance();
}

function tick() {
  var now = Date.now();
  var deltaSec = (now - lastTickTime) / 1000;
  lastTickTime = now;
  var perSec = getXuPerSecond();
  if (perSec > 0 && deltaSec > 0) {
    var gained = perSec * deltaSec;
    state.xu += gained;
    state.totalEarned += gained;
    dirty = true;
    renderAll();
  }
}

function applyOfflineEarnings() {
  var now = Date.now();
  var lastSeen = state.lastSeen || now;
  var deltaSec = (now - lastSeen) / 1000;
  if (deltaSec < 5) return;
  deltaSec = Math.min(deltaSec, MAX_OFFLINE_SECONDS);
  var perSec = getXuPerSecond();
  if (perSec <= 0) return;
  var gained = perSec * deltaSec;
  if (gained < 1) return;
  state.xu += gained;
  state.totalEarned += gained;
  dirty = true;
  showWelcomeBack(gained, deltaSec);
}

// ---------- Hiệu ứng ----------
function spawnFloatingNumber(amount) {
  var container = document.getElementById('floatingNumbers');
  var el = document.createElement('div');
  el.className = 'floating-number';
  el.textContent = '+' + formatXu(amount);
  var jitter = Math.round((Math.random() - 0.5) * 70);
  el.style.left = 'calc(50% + ' + jitter + 'px)';
  container.appendChild(el);
  el.addEventListener('animationend', function () { el.remove(); });
  setTimeout(function () { if (el.parentNode) el.remove(); }, 1500);
}

function bounceCoin() {
  var el = document.getElementById('clickMachine');
  el.classList.remove('bounce');
  void el.offsetWidth;
  el.classList.add('bounce');
}

function pulseCard(card) {
  if (!card) return;
  card.classList.remove('just-bought');
  void card.offsetWidth;
  card.classList.add('just-bought');
}

function pulseSaveIndicator(isError) {
  var dot = document.querySelector('.save-dot');
  if (!dot) return;
  dot.classList.toggle('error', !!isError);
  dot.classList.remove('pulse');
  void dot.offsetWidth;
  dot.classList.add('pulse');
}

var toastTimeout = null;
function showToast(text) {
  var toast = document.getElementById('saveToast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(function () { toast.classList.remove('show'); }, 2200);
}

// ---------- Hiển thị ----------
function adjustCounterFontSize() {
  var el = document.getElementById('xuAmount');
  var len = el.textContent.length;
  if (len > 11) el.style.fontSize = '1.3rem';
  else if (len > 8) el.style.fontSize = '1.7rem';
  else el.style.fontSize = '';
}

function renderBalance() {
  document.getElementById('xuAmount').textContent = formatXu(state.xu);
  document.getElementById('usdAmount').textContent = formatUsd(state.xu * 0.01);
  var perSec = getXuPerSecond();
  var perSecDisplay = document.getElementById('xuPerSecondDisplay');
  perSecDisplay.hidden = perSec <= 0;
  if (perSec > 0) {
    document.getElementById('xuPerSecondAmount').textContent = formatXu(perSec);
  }
  document.getElementById('clickPowerDisplay').textContent = '+' + formatXu(getXuPerClick());
  adjustCounterFontSize();
}

function renderUpgradeList(containerId, list, levelsObj, category) {
  var container = document.getElementById(containerId);
  var suffix = category === 'click' ? ' xu mỗi lần nhấp' : ' xu mỗi giây';
  container.innerHTML = list.map(function (u) {
    var level = levelsObj[u.id];
    var cost = getCostForLevel(u, level);
    var affordable = state.xu >= cost;
    return (
      '<div class="upgrade-card cat-' + category + (affordable ? '' : ' locked') + '" data-card-id="' + u.id + '">' +
        '<div class="upgrade-icon">' + u.icon + '</div>' +
        '<div class="upgrade-info">' +
          '<div class="upgrade-name">' + u.name +
            (level > 0 ? '<span class="upgrade-level">Lv.' + level + '</span>' : '') +
          '</div>' +
          '<div class="upgrade-desc">+' + formatXu(u.effect) + suffix + '</div>' +
        '</div>' +
        '<button class="upgrade-buy-btn" type="button" data-id="' + u.id + '" data-category="' + category + '"' + (affordable ? '' : ' disabled') + '>' +
          '<span class="cost">' + formatXu(cost) + '</span>' +
          '<span class="cost-label">xu</span>' +
        '</button>' +
      '</div>'
    );
  }).join('');
}

function renderUpgrades() {
  renderUpgradeList('clickUpgradeList', CLICK_UPGRADES, state.clickLevels, 'click');
  renderUpgradeList('autoUpgradeList', AUTO_UPGRADES, state.autoLevels, 'auto');
}

function renderStats() {
  var playSeconds = (Date.now() - state.createdAt) / 1000;
  var rows = [
    ['Tổng xu đã kiếm', formatXu(state.totalEarned)],
    ['Tổng số lần nhấp', formatXu(state.totalClicks)],
    ['Xu mỗi lần nhấp', '+' + formatXu(getXuPerClick())],
    ['Xu tự động / giây', '+' + formatXu(getXuPerSecond())],
    ['Thời gian chơi', formatDuration(playSeconds)]
  ];
  document.getElementById('statsList').innerHTML = rows.map(function (r) {
    return '<div class="stat-row"><span>' + r[0] + '</span><strong>' + r[1] + '</strong></div>';
  }).join('');
}

function renderAll() {
  renderBalance();
  renderUpgrades();
  renderStats();
}

// ---------- Modal chào mừng trở lại ----------
function showWelcomeBack(gained, deltaSec) {
  document.getElementById('welcomeMessage').textContent =
    'Trong lúc bạn vắng mặt (' + formatDuration(deltaSec) + '), máy đã tự động kiếm được ' + formatXu(gained) + ' xu cho bạn!';
  document.getElementById('welcomeModal').hidden = false;
}

// ========================================================================
// Gắn sự kiện
// ========================================================================
function onUpgradeListClick(e) {
  var btn = e.target.closest('.upgrade-buy-btn');
  if (!btn || btn.disabled) return;
  var id = btn.dataset.id;
  var category = btn.dataset.category;
  var list = category === 'click' ? CLICK_UPGRADES : AUTO_UPGRADES;
  var levelsObj = category === 'click' ? state.clickLevels : state.autoLevels;
  var ok = buyUpgrade(list, levelsObj, id);
  if (ok) {
    renderAll();
    pulseCard(document.querySelector('.upgrade-card[data-card-id="' + id + '"]'));
  }
}

function initEvents() {
  document.getElementById('clickMachine').addEventListener('click', handleClick);

  document.getElementById('clickUpgradeList').addEventListener('click', onUpgradeListClick);
  document.getElementById('autoUpgradeList').addEventListener('click', onUpgradeListClick);

  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  document.getElementById('resetBtn').addEventListener('click', function () {
    document.getElementById('resetModal').hidden = false;
  });
  document.getElementById('cancelResetBtn').addEventListener('click', function () {
    document.getElementById('resetModal').hidden = true;
  });
  document.getElementById('confirmResetBtn').addEventListener('click', function () {
    state = defaultState();
    dirty = true;
    saveState();
    renderAll();
    document.getElementById('resetModal').hidden = true;
    showToast('🔄 Đã chơi lại từ đầu');
  });

  document.getElementById('closeWelcomeModal').addEventListener('click', function () {
    document.getElementById('welcomeModal').hidden = true;
  });
}

// ========================================================================
// Khởi động
// ========================================================================
function init() {
  applyOfflineEarnings();
  initEvents();
  renderAll();
  lastTickTime = Date.now();
  setInterval(tick, TICK_INTERVAL_MS);
  setInterval(function () { if (dirty) saveState(); }, AUTOSAVE_INTERVAL_MS);
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && dirty) saveState();
  });
  window.addEventListener('pagehide', function () { if (dirty) saveState(); });
  window.addEventListener('beforeunload', function () { if (dirty) saveState(); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
