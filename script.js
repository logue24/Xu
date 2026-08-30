(function () {
  'use strict';

  var STORAGE_KEY = 'xuMachineState';
  var COOLDOWN_MS = 20000;
  var MAX_HISTORY = 20;
  var STREAK_BONUS_PER_DAY = 20;
  var STREAK_BONUS_CAP = 200;
  var BASE_CHECKIN_REWARD = 100;

  function defaultState() {
    return {
      balance: 0,
      totalEarned: 0,
      lastCheckInDate: null,
      streak: 0,
      claimCount: 0,
      cooldownEndTs: 0,
      tasks: { firstCheckIn: false, claim5: false, reach500: false },
      history: []
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      var base = defaultState();
      var merged = Object.assign(base, parsed);
      merged.tasks = Object.assign(base.tasks, parsed.tasks || {});
      if (!Array.isArray(merged.history)) merged.history = [];
      return merged;
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable; app still works for this session */
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
  var srAnnounce = document.getElementById('srBalanceAnnounce');
  var taskEls = {
    firstCheckIn: document.getElementById('taskFirstCheckin'),
    claim5: document.getElementById('taskClaim5'),
    reach500: document.getElementById('taskReach500')
  };

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

    var reward = Math.floor(Math.random() * 21) + 10;
    state.claimCount += 1;
    state.cooldownEndTs = Date.now() + COOLDOWN_MS;
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

  function doReset() {
    var ok = window.confirm('Bạn có chắc muốn đặt lại toàn bộ dữ liệu? Số xu và lịch sử sẽ mất hết.');
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

  render({ animate: false });
  updateClaimButton();
})();
