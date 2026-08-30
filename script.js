(function () {
  'use strict';

  var STORAGE_KEY = 'xuMachineState';
  var BASE_COOLDOWN_MS = 20000;
  var MIN_COOLDOWN_MS = 5000;
  var MAX_HISTORY = 20;
  var STREAK_BONUS_PER_DAY = 20;
  var STREAK_BONUS_CAP = 200;
  var BASE_CHECKIN_REWARD = 100;

  var PACKAGES = {
    bronze: { name: 'Gói Đồng', price: 10000, xu: 300, cooldownCut: 3000, claimBonus: 5 },
    silver: { name: 'Gói Bạc', price: 25000, xu: 800, cooldownCut: 5000, claimBonus: 10 },
    gold: { name: 'Gói Vàng', price: 50000, xu: 2000, cooldownCut: 7000, claimBonus: 15 }
  };

  function defaultState() {
    return {
      balance: 0,
      totalEarned: 0,
      lastCheckInDate: null,
      streak: 0,
      claimCount: 0,
      cooldownEndTs: 0,
      tasks: { firstCheckIn: false, claim5: false, reach500: false },
      upgrades: { bronze: false, silver: false, gold: false },
      history: []
    };
  }

  function mergeWithDefaults(parsed) {
    var base = defaultState();
    var merged = Object.assign(base, parsed);
    merged.tasks = Object.assign(base.tasks, parsed.tasks || {});
    merged.upgrades = Object.assign(base.upgrades, parsed.upgrades || {});
    if (!Array.isArray(merged.history)) merged.history = [];
    return merged;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return mergeWithDefaults(JSON.parse(raw));
    } catch (e) {
      return defaultState();
    }
  }

  var storageWarningShown = false;

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      if (!storageWarningShown) {
        storageWarningShown = true;
        if (storageWarningEl) storageWarningEl.style.display = 'block';
      }
    }
  }

  function formatDateLocal(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function formatTimeLocal(ts) {
    var d = new Date(ts);
    var h = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + mi;
  }

  function formatNumber(n) {
    return n.toLocaleString('vi-VN');
  }

  var state = loadState();
  var displayedBalance = 0;
  var countRAF = null;
  var claimInterval = null;

  var odometerEl = document.getElementById('odometer');
  var vndEquivEl = document.getElementById('vndEquiv');
  var streakDisplayEl = document.getElementById('streakDisplay');
  var checkinBtn = document.getElementById('checkinBtn');
  var checkinBtnText = document.getElementById('checkinBtnText');
  var claimBtn = document.getElementById('claimBtn');
  var claimBtnText = document.getElementById('claimBtnText');
  var coinTray = document.getElementById('coinTray');
  var historyList = document.getElementById('historyList');
  var historyEmpty = document.getElementById('historyEmpty');
  var resetBtn = document.getElementById('resetBtn');
  var exportBtn = document.getElementById('exportBtn');
  var importBtn = document.getElementById('importBtn');
  var importFileInput = document.getElementById('importFileInput');
  var storageWarningEl = document.getElementById('storageWarning');
  var srAnnounce = document.getElementById('srBalanceAnnounce');
  var taskEls = {
    firstCheckIn: document.getElementById('taskFirstCheckin'),
    claim5: document.getElementById('taskClaim5'),
    reach500: document.getElementById('taskReach500')
  };
  var shopEls = {
    bronze: document.getElementById('pkgBronze'),
    silver: document.getElementById('pkgSilver'),
    gold: document.getElementById('pkgGold')
  };
  var buyBtns = {
    bronze: document.getElementById('pkgBronzeBuyBtn'),
    silver: document.getElementById('pkgSilverBuyBtn'),
    gold: document.getElementById('pkgGoldBuyBtn')
  };

  function getCooldownMs() {
    var cut = 0;
    if (state.upgrades.bronze) cut += PACKAGES.bronze.cooldownCut;
    if (state.upgrades.silver) cut += PACKAGES.silver.cooldownCut;
    if (state.upgrades.gold) cut += PACKAGES.gold.cooldownCut;
    return Math.max(BASE_COOLDOWN_MS - cut, MIN_COOLDOWN_MS);
  }

  function getClaimBonus() {
    var bonus = 0;
    if (state.upgrades.bronze) bonus += PACKAGES.bronze.claimBonus;
    if (state.upgrades.silver) bonus += PACKAGES.silver.claimBonus;
    if (state.upgrades.gold) bonus += PACKAGES.gold.claimBonus;
    return bonus;
  }

  function animateCount(from, to) {
    if (countRAF) cancelAnimationFrame(countRAF);
    var duration = 500;
    var startTime = performance.now();
    var maxFrames = 240; // hard safety cap (~4s at 60fps) so this always terminates
    var frames = 0;
    function step(now) {
      frames += 1;
      var elapsed = now - startTime;
      var t = Math.min(elapsed / duration, 1);
      if (frames >= maxFrames) t = 1;
      var eased = 1 - Math.pow(1 - t, 3);
      var value = Math.round(from + (to - from) * eased);
      odometerEl.textContent = formatNumber(value);
      if (t < 1) {
        countRAF = requestAnimationFrame(step);
      } else {
        odometerEl.textContent = formatNumber(to);
        countRAF = null;
      }
    }
    countRAF = requestAnimationFrame(step);
  }

  function setTaskState(el, done) {
    if (!el) return;
    el.classList.toggle('is-done', done);
    var status = el.querySelector('.task-status');
    if (status) status.textContent = done ? '(đã hoàn thành)' : '';
  }

  function renderShop() {
    Object.keys(PACKAGES).forEach(function (key) {
      var card = shopEls[key];
      var btn = buyBtns[key];
      var owned = state.upgrades[key];
      if (card) card.classList.toggle('is-owned', owned);
      if (btn) {
        btn.disabled = owned;
        btn.textContent = owned ? 'Đã sở hữu' : 'Mua';
      }
    });
  }

  function renderHistory() {
    historyList.innerHTML = '';
    if (!state.history.length) {
      historyEmpty.style.display = 'block';
      return;
    }
    historyEmpty.style.display = 'none';
    state.history.forEach(function (entry) {
      var li = document.createElement('li');
      li.className = 'receipt-row';

      var time = document.createElement('span');
      time.className = 'receipt-time';
      time.textContent = formatTimeLocal(entry.ts);

      var label = document.createElement('span');
      label.className = 'receipt-label';
      label.textContent = entry.label;

      var amount = document.createElement('span');
      amount.className = 'receipt-amount';
      amount.textContent = '+' + entry.amount + ' xu';

      li.appendChild(time);
      li.appendChild(label);
      li.appendChild(amount);
      historyList.appendChild(li);
    });
  }

  function render(opts) {
    opts = opts || {};

    if (opts.animate && state.balance !== displayedBalance) {
      animateCount(displayedBalance, state.balance);
    } else {
      odometerEl.textContent = formatNumber(state.balance);
    }
    displayedBalance = state.balance;

    vndEquivEl.textContent = formatNumber(Math.floor(state.balance / 10));
    streakDisplayEl.textContent = 'Chuỗi điểm danh: ' + state.streak + ' ngày';

    var today = formatDateLocal(new Date());
    if (state.lastCheckInDate === today) {
      checkinBtn.disabled = true;
      checkinBtnText.textContent = 'Đã Điểm Danh Hôm Nay';
    } else {
      checkinBtn.disabled = false;
      checkinBtnText.textContent = 'Điểm Danh Hôm Nay';
    }

    setTaskState(taskEls.firstCheckIn, state.tasks.firstCheckIn);
    setTaskState(taskEls.claim5, state.tasks.claim5);
    setTaskState(taskEls.reach500, state.tasks.reach500);

    renderShop();
    renderHistory();

    if (opts.announce) {
      srAnnounce.textContent = 'Số dư hiện tại: ' + formatNumber(state.balance) +
        ' xu, tương đương ' + formatNumber(Math.floor(state.balance / 10)) + ' đồng.';
    }
  }

  function addHistory(label, amount) {
    state.history.unshift({ ts: Date.now(), label: label, amount: amount });
    if (state.history.length > MAX_HISTORY) {
      state.history.length = MAX_HISTORY;
    }
  }

  function gainXu(amount, label) {
    state.balance += amount;
    state.totalEarned += amount;
    addHistory(label, amount);
  }

  function checkMilestoneTask() {
    if (!state.tasks.reach500 && state.balance >= 500) {
      state.tasks.reach500 = true;
      gainXu(50, 'Hoàn thành nhiệm vụ: Đạt mốc 500 xu');
    }
  }

  function spawnCoinDrop() {
    var coin = document.createElement('span');
    coin.className = 'falling-coin';
    coin.textContent = '🪙';
    coin.style.left = (40 + Math.random() * 20) + '%';
    coin.style.animationDelay = (Math.random() * 0.15) + 's';
    coinTray.appendChild(coin);
    setTimeout(function () {
      if (coin.parentNode) coin.parentNode.removeChild(coin);
    }, 1200);
  }

  function showFloatingGain(amount, btnEl) {
    var pop = document.createElement('span');
    pop.className = 'gain-pop';
    pop.textContent = '+' + amount + ' xu';
    btnEl.appendChild(pop);
    setTimeout(function () {
      if (pop.parentNode) pop.parentNode.removeChild(pop);
    }, 900);
  }

  function doCheckIn() {
    var today = formatDateLocal(new Date());
    if (state.lastCheckInDate === today) return;

    var y = new Date();
    y.setDate(y.getDate() - 1);
    var yesterday = formatDateLocal(y);

    if (state.lastCheckInDate === yesterday) {
      state.streak += 1;
    } else {
      state.streak = 1;
    }
    state.lastCheckInDate = today;

    var bonus = Math.min((state.streak - 1) * STREAK_BONUS_PER_DAY, STREAK_BONUS_CAP);
    var reward = BASE_CHECKIN_REWARD + bonus;
    gainXu(reward, 'Điểm danh (chuỗi ' + state.streak + ' ngày)');

    if (!state.tasks.firstCheckIn) {
      state.tasks.firstCheckIn = true;
      gainXu(50, 'Hoàn thành nhiệm vụ: Điểm danh lần đầu');
    }
    checkMilestoneTask();

    saveState();
    render({ animate: true, announce: true });
    spawnCoinDrop();
    showFloatingGain(reward, checkinBtn);
  }

  function updateClaimButton() {
    var remainingMs = state.cooldownEndTs - Date.now();
    if (remainingMs > 0) {
      claimBtn.disabled = true;
      claimBtnText.textContent = 'Chờ ' + Math.ceil(remainingMs / 1000) + 's';
      if (!claimInterval) {
        claimInterval = setInterval(updateClaimButton, 250);
      }
    } else {
      claimBtn.disabled = false;
      claimBtnText.textContent = 'Nhận Xu';
      if (claimInterval) {
        clearInterval(claimInterval);
        claimInterval = null;
      }
    }
  }

  function doClaim() {
    if (Date.now() < state.cooldownEndTs) return;

    var reward = Math.floor(Math.random() * 21) + 10 + getClaimBonus();
    state.claimCount += 1;
    state.cooldownEndTs = Date.now() + getCooldownMs();
    gainXu(reward, 'Nhận xu');

    if (state.claimCount >= 5 && !state.tasks.claim5) {
      state.tasks.claim5 = true;
      gainXu(100, 'Hoàn thành nhiệm vụ: Nhận xu 5 lần');
    }
    checkMilestoneTask();

    saveState();
    render({ animate: true, announce: true });
    spawnCoinDrop();
    showFloatingGain(reward, claimBtn);
    updateClaimButton();
  }

  function doPurchase(key) {
    var pkg = PACKAGES[key];
    if (!pkg || state.upgrades[key]) return;

    var ok = window.confirm(
      'Đây là gói nâng cấp mô phỏng (demo) trong ứng dụng — chưa kết nối cổng thanh toán thật nên sẽ KHÔNG có khoản tiền nào bị trừ.\n\n' +
      'Xác nhận "mua" ' + pkg.name + ' (' + formatNumber(pkg.price) + ' ₫) để nhận +' + pkg.xu + ' xu và nâng cấp máy?'
    );
    if (!ok) return;

    state.upgrades[key] = true;
    gainXu(pkg.xu, 'Mua ' + pkg.name + ' (demo, ' + formatNumber(pkg.price) + '₫)');
    checkMilestoneTask();

    saveState();
    render({ animate: true, announce: true });
    spawnCoinDrop();
  }

  function doExport() {
    try {
      var dataStr = JSON.stringify(state, null, 2);
      var blob = new Blob([dataStr], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'may-kiem-xu-sao-luu-' + formatDateLocal(new Date()) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert('Không thể tạo file sao lưu. Vui lòng thử lại.');
    }
  }

  function doImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var merged;
      try {
        merged = mergeWithDefaults(JSON.parse(reader.result));
      } catch (e) {
        window.alert('File sao lưu không hợp lệ hoặc bị hỏng.');
        return;
      }
      var ok = window.confirm('Khôi phục sẽ THAY THẾ toàn bộ dữ liệu hiện tại bằng dữ liệu trong file sao lưu (' +
        formatNumber(merged.balance) + ' xu). Tiếp tục?');
      if (!ok) return;

      state = merged;
      displayedBalance = 0;
      if (claimInterval) {
        clearInterval(claimInterval);
        claimInterval = null;
      }
      saveState();
      render({ animate: true, announce: true });
      updateClaimButton();
      window.alert('Khôi phục dữ liệu thành công.');
    };
    reader.onerror = function () {
      window.alert('Không thể đọc file. Vui lòng thử lại.');
    };
    reader.readAsText(file);
  }

  function doReset() {
    var ok = window.confirm('Bạn có chắc muốn đặt lại toàn bộ dữ liệu? Số xu, nâng cấp và lịch sử sẽ mất hết. Hãy dùng "Sao Lưu" trước nếu muốn giữ lại.');
    if (!ok) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
    state = defaultState();
    displayedBalance = 0;
    if (claimInterval) {
      clearInterval(claimInterval);
      claimInterval = null;
    }
    render({ animate: false, announce: true });
    updateClaimButton();
  }

  checkinBtn.addEventListener('click', doCheckIn);
  claimBtn.addEventListener('click', doClaim);
  resetBtn.addEventListener('click', doReset);
  exportBtn.addEventListener('click', doExport);
  importBtn.addEventListener('click', function () { importFileInput.click(); });
  importFileInput.addEventListener('change', function (e) {
    doImportFile(e.target.files[0]);
    e.target.value = '';
  });
  if (buyBtns.bronze) buyBtns.bronze.addEventListener('click', function () { doPurchase('bronze'); });
  if (buyBtns.silver) buyBtns.silver.addEventListener('click', function () { doPurchase('silver'); });
  if (buyBtns.gold) buyBtns.gold.addEventListener('click', function () { doPurchase('gold'); });

  window.addEventListener('beforeunload', saveState);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveState();
  });

  render({ animate: false });
  updateClaimButton();
})();
