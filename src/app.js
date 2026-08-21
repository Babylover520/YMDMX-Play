(function () {
  "use strict";

  var SAVE_KEY = "yimin-adventure-v1-save";
  var PREF_KEY = "yimin-adventure-v1-prefs";
  var HISTORY_KEY = "yimin-adventure-v1-history";
  var HISTORY_LIMIT = 10;
  var MOVE_SPEED_MULTIPLIER = 0.8;
  var data = window.GAME_DATA;
  var engine = null;
  var busy = false;
  var fastMode = false;
  var soundEnabled = true;
  var currentModalResolve = null;
  var uiLog = [];
  var audioContext = null;
  var spectatorFastForward = false;
  var lastDialogueTurnByPlayer = {};
  var eventNoticeActive = false;

  function byId(id) { return document.getElementById(id); }
  function money(value) { return Math.max(0, Number(value) || 0).toLocaleString("zh-CN"); }
  function compactMoney(value) {
    var amount = Math.max(0, Number(value) || 0);
    if (amount >= 100000) {
      return Math.round(amount / 10000).toLocaleString("zh-CN") + "万币";
    }
    if (amount >= 10000) {
      return (Math.round(amount / 1000) / 10).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + "万币";
    }
    return money(amount) + "币";
  }
  function wait(ms) { return new Promise(function (resolve) { window.setTimeout(resolve, ms); }); }
  function getPlayer(state, id) { return state.players.find(function (player) { return player.id === id; }); }
  function currentPlayer(state) { return state.players[state.currentPlayerIndex]; }
  function consumptionRateLabel(round) {
    if (round <= 20) return "1 / 3 概率消费";
    if (round <= 40) return "1 / 2 概率消费";
    if (round <= 60) return "2 / 3 概率消费";
    return "每次必消费";
  }
  function lifePressureAmount(round, activePlayerCount) {
    var bands = data.config.terminalPressureBands || [];
    var baseFee = 0;
    for (var i = 0; i < bands.length; i += 1) {
      var band = bands[i];
      if (round >= band.minRound && (band.maxRound == null || round <= band.maxRound)) {
        baseFee = band.base + band.step * (round - band.minRound);
        break;
      }
    }
    var multipliers = data.config.terminalPressureMultipliers || {};
    return Math.max(0, Math.round(baseFee * Number(multipliers[activePlayerCount] || 0)));
  }
  function lifePressureLabel(round, activePlayerCount) {
    var startRound = Number(data.config.terminalPressureStartRound || 41);
    if (round < startRound) return "压力" + startRound + "轮起";
    return "压力" + money(lifePressureAmount(round, activePlayerCount)) +
      "→" + money(lifePressureAmount(round + 1, activePlayerCount));
  }
  function firstDefined() {
    for (var i = 0; i < arguments.length; i += 1) {
      if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    }
    return 0;
  }

  var elements = {};
  var tileElements = new Map();

  function cacheElements() {
    [
      "start-screen", "new-game-button", "continue-game-button", "history-button", "history-count", "care-mode-toggle",
      "game-screen", "round-number", "turn-player-name", "turn-status", "island-title", "game-hint",
      "speed-toggle", "restart-button", "sound-toggle", "player-list", "active-player-count",
      "companion-note", "board", "board-tiles", "dice", "dice-value", "roll-button",
      "current-cash", "current-net-worth", "current-card-count", "quick-cards-button", "quick-card-count",
      "active-status-list", "board-announcement", "event-result-region", "money-feedback-region",
      "side-panel", "panel-toggle", "tab-events", "tab-cards", "tab-assets", "event-log",
      "event-log-list", "card-panel", "card-list", "hand-count", "hand-owner-name", "tab-card-count",
      "asset-panel", "asset-owner-name", "asset-net-worth", "asset-cash", "asset-deposit", "asset-interest",
      "asset-interest-earned", "asset-properties-value", "property-count", "property-list",
      "log-count", "modal-layer", "game-modal", "modal-close", "modal-icon", "modal-kicker",
      "modal-title", "modal-body", "modal-actions", "bank-action-container",
      "property-action-container", "toast-region", "screen-reader-status", "player-card-template"
    ].forEach(function (id) { elements[id] = byId(id); });
  }

  function boardPosition(index, boardSize) {
    var cornerStart = 86;
    var sideLength = Math.max(2, boardSize / 4);
    var step = 72 / (sideLength - 1);
    if (index === 0) return { x: 0, y: cornerStart, rotation: 0, edge: "corner", corner: true };
    if (index < sideLength) return { x: 0, y: cornerStart - index * step, rotation: 0, edge: "left", corner: false };
    if (index === sideLength) return { x: 0, y: 0, rotation: 0, edge: "corner", corner: true };
    if (index < sideLength * 2) return { x: 14 + (index - sideLength - 1) * step, y: 0, rotation: 0, edge: "top", corner: false };
    if (index === sideLength * 2) return { x: cornerStart, y: 0, rotation: 0, edge: "corner", corner: true };
    if (index < sideLength * 3) return { x: cornerStart, y: 14 + (index - sideLength * 2 - 1) * step, rotation: 0, edge: "right", corner: false };
    if (index === sideLength * 3) return { x: cornerStart, y: cornerStart, rotation: 0, edge: "corner", corner: true };
    return { x: cornerStart - (index - sideLength * 3) * step, y: cornerStart, rotation: 0, edge: "bottom", corner: false };
  }

  function mobileBoardPosition(index) {
    // A symmetric 5 x 12 pixel heart keeps the 10 / 4 / 4 / 4 / 10 column count.
    var route = [
      [2, 11, "tip"], [1, 10, "lower-left"], [1, 9, "lower-left"],
      [0, 9, "outer-left"], [0, 8, "outer-left"], [0, 7, "outer-left"],
      [0, 6, "outer-left"], [0, 5, "outer-left"], [0, 4, "outer-left"],
      [0, 3, "outer-left"], [0, 2, "outer-left"], [0, 1, "left-lobe"],
      [0, 0, "left-lobe"], [1, 0, "upper-left"], [1, 1, "inner-left"],
      [2, 1, "notch"], [2, 2, "notch-tip"], [3, 1, "inner-right"],
      [3, 0, "upper-right"], [4, 0, "right-lobe"], [4, 1, "right-lobe"],
      [4, 2, "outer-right"], [4, 3, "outer-right"], [4, 4, "outer-right"],
      [4, 5, "outer-right"], [4, 6, "outer-right"], [4, 7, "outer-right"],
      [4, 8, "outer-right"], [4, 9, "outer-right"], [3, 9, "lower-right"],
      [3, 10, "lower-right"], [2, 10, "tip"]
    ];
    var position = route[index];
    return {
      x: position[0] * (100 / 5),
      y: position[1] * (100 / 12),
      segment: position[2]
    };
  }

  function buildBoard() {
      elements["board-tiles"].textContent = "";
      tileElements.clear();
      elements.board.setAttribute("aria-label", data.board.length + " 格伊敏大冒险棋盘");
      data.board.forEach(function (tile) {
        var position = boardPosition(tile.index, data.board.length);
      var mobilePosition = mobileBoardPosition(tile.index);
      var cell = document.createElement("div");
      cell.className = "board-tile tile-" + tile.type;
      cell.dataset.type = tile.type === "gameMoment" ? "game" : tile.type;
      cell.dataset.tileId = tile.id;
      cell.style.setProperty("--tile-x", position.x.toFixed(2) + "%");
      cell.style.setProperty("--tile-y", position.y.toFixed(2) + "%");
      cell.style.setProperty("--mobile-tile-x", mobilePosition.x.toFixed(3) + "%");
      cell.style.setProperty("--mobile-tile-y", mobilePosition.y.toFixed(3) + "%");
      cell.style.setProperty("--tile-rotation", position.rotation + "deg");
      cell.dataset.edge = position.edge;
      cell.dataset.mobileSegment = mobilePosition.segment;
      if (tile.type === "start" || tile.type === "bank" || tile.type === "review" || tile.propertyId === "cinema" || tile.propertyId === "mall") {
        cell.dataset.landmark = "true";
      }
      if (position.corner) cell.dataset.corner = "true";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", "第 " + tile.index + " 格 " + tile.name);
      cell.title = tile.name;

      var icon = document.createElement("span");
      icon.className = "tile-icon";
      icon.textContent = tile.emoji;
      icon.setAttribute("aria-hidden", "true");
      var name = document.createElement("span");
      name.className = "tile-name";
      name.textContent = tile.shortLabel || tile.name;
      var index = document.createElement("span");
      index.className = "tile-index";
      index.textContent = String(tile.index);
      var owner = document.createElement("span");
      owner.className = "tile-owner";
      var level = document.createElement("span");
      level.className = "tile-level";
      var tokens = document.createElement("span");
      tokens.className = "token-stack";
      cell.append(icon, name, index, owner, level, tokens);
      elements["board-tiles"].appendChild(cell);
      tileElements.set(tile.id, cell);
    });
  }

  function propertyValueFor(state, playerId) {
    return state.board.reduce(function (sum, tile) {
      return sum + (tile.ownerId === playerId ? Math.floor((tile.totalInvested || 0) * data.config.propertySaleRate) : 0);
    }, 0);
  }

  function collectibleRevenueFor(state, playerId) {
    return state.board.reduce(function (sum, tile) {
      return sum + (tile.ownerId === playerId ? Math.round((tile.currentTurnover || 0) * 0.5) : 0);
    }, 0);
  }

  function netWorthFor(state, player) {
    return player.money + player.bankPrincipal + player.bankInterest + propertyValueFor(state, player.id) + collectibleRevenueFor(state, player.id);
  }

  function render(state) {
    if (!state) return;
    var active = currentPlayer(state);
    var yimin = getPlayer(state, "yimin") || state.players[0];
    var round = Math.floor(state.globalTurn / state.players.length) + 1;
    var activePlayerCount = state.players.filter(function (player) { return !player.bankrupt; }).length;
    var canFastForward = yimin.bankrupt && !state.ended;
    var roundLabel = "第" + round + "轮 · " + activePlayerCount + "人 · " + lifePressureLabel(round, activePlayerCount);
    elements["round-number"].textContent = roundLabel;
    elements["round-number"].dataset.shortLabel = "第" + round + "轮 · " + activePlayerCount + "人";
    elements["round-number"].setAttribute("aria-label", roundLabel);
    elements["round-number"].title = round < Number(data.config.terminalPressureStartRound || 41)
      ? "生活压力将在第 " + Number(data.config.terminalPressureStartRound || 41) + " 轮开始"
      : "生活压力：本轮 " + money(lifePressureAmount(round, activePlayerCount)) + "，下一轮 " + money(lifePressureAmount(round + 1, activePlayerCount));
    elements["turn-player-name"].textContent = active.name;
    elements["island-title"].textContent = state.ended ? "本局结算" : canFastForward ? "观战结算" : active.isHuman ? active.name + "的回合" : active.name + " 行动中";
    elements["turn-status"].textContent = state.ended
      ? "这一局已经完成"
      : canFastForward
        ? "伊敏进入观战"
        : active.statuses.skipTurns > 0
          ? "暂停中，本回合无法行动"
          : active.isHuman
            ? "轮到你出发啦"
            : active.name + " 正在行动";
    elements["game-hint"].textContent = state.ended ? "看看大家带回了多少快乐。" : canFastForward ? "点击快速结算，看看最后由谁留在场上。" : active.isHuman ? "本轮停在他人地产：" + consumptionRateLabel(round) + "。" : "AI 伙伴会自己完成购买、升级和事件选择。";
    elements["current-cash"].textContent = money(yimin.money);
    elements["current-net-worth"].textContent = money(netWorthFor(state, yimin));
    var handSize = Array.isArray(yimin.hand) ? yimin.hand.length : 0;
    var handLabel = handSize + " / " + data.config.handLimit;
    elements["current-card-count"].textContent = handLabel;
    elements["quick-card-count"].textContent = handLabel;
    elements["tab-card-count"].textContent = handLabel;
    elements["active-player-count"].textContent = String(activePlayerCount);
    elements["companion-note"].textContent = state.settings && state.settings.careMode === false
      ? "伙伴鼓励已关闭，AI 会安静地认真经营。"
      : "伙伴鼓励已开启，AI 会在关键事件后送上几句陪伴。";
    elements["roll-button"].disabled = eventNoticeActive || busy || state.ended || (!canFastForward && (!active.isHuman || active.bankrupt || active.statuses.skipTurns > 0));
    elements["roll-button"].querySelector("span:last-child").textContent = state.ended ? "查看结算" : canFastForward ? "快速结算" : active.statuses.skipTurns > 0 ? "暂停一回合" : "掷骰子";
    renderPlayers(state);
    renderBoardState(state);
    renderAssets(state, yimin);
    renderCards(state, yimin);
    renderActiveStatuses(yimin);
    renderLogs();
  }

  function renderPlayers(state) {
    var list = elements["player-list"];
    list.textContent = "";
    state.players.forEach(function (player) {
      var item = document.createElement("li");
      item.className = "player-card";
      item.dataset.playerId = player.id;
      item.style.setProperty("--player-color", player.color);
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.setAttribute("aria-label", "查看" + player.name + "的资产");
      if (state.players[state.currentPlayerIndex].id === player.id) item.classList.add("is-current");
      if (player.bankrupt) item.classList.add("is-bankrupt");

      var avatar = document.createElement("span");
      avatar.className = "player-avatar";
      avatar.textContent = player.avatar;
      avatar.style.backgroundColor = player.color;
      avatar.setAttribute("aria-hidden", "true");
      var main = document.createElement("div");
      main.className = "player-card-main";
      var nameRow = document.createElement("div");
      nameRow.className = "player-name-row";
      var name = document.createElement("strong");
      name.className = "player-name";
      name.textContent = player.name;
      var persona = document.createElement("span");
      persona.className = "player-personality";
      persona.textContent = player.persona;
      nameRow.append(name, persona);
      var cash = document.createElement("span");
      cash.className = "player-cash";
      cash.textContent = compactMoney(player.money);
      cash.title = money(player.money) + " 快乐币";
      cash.setAttribute("aria-label", money(player.money) + " 快乐币");
      var progress = document.createElement("div");
      progress.className = "player-progress";
      progress.setAttribute("aria-hidden", "true");
      var progressBar = document.createElement("span");
      progressBar.style.width = Math.min(100, (netWorthFor(state, player) / 6000) * 100) + "%";
      progress.appendChild(progressBar);
      main.append(nameRow, cash, progress);
      var status = document.createElement("span");
      status.className = "player-status";
      status.textContent = player.bankrupt ? "已破产" : player.statuses.skipTurns ? "暂停" : player.statuses.forcedConsumption ? "必买 " + player.statuses.forcedConsumption : "";
      item.append(avatar, main, status);
      item.addEventListener("click", function () { openPlayerAssets(player.id); });
      item.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPlayerAssets(player.id);
        }
      });
      list.appendChild(item);
    });
  }

  function renderBoardState(state) {
    state.board.forEach(function (tile) {
      var cell = tileElements.get(tile.id);
      if (!cell) return;
      cell.classList.toggle("is-current-tile", currentPlayer(state).position === tile.index);
      var ownerBadge = cell.querySelector(".tile-owner");
      var levelBadge = cell.querySelector(".tile-level");
      var tokenStack = cell.querySelector(".token-stack");
      var tileName = cell.querySelector(".tile-name");
      if (tileName) tileName.textContent = tile.shortLabel || tile.name;
      tokenStack.textContent = "";
      if (tile.ownerId) {
        var owner = getPlayer(state, tile.ownerId);
        cell.classList.add("has-owner");
        cell.dataset.ownerId = tile.ownerId;
        cell.style.setProperty("--owner-color", owner ? owner.color : "#52796f");
        ownerBadge.textContent = owner ? owner.avatar : "店";
        ownerBadge.style.backgroundColor = owner ? owner.color : "";
        ownerBadge.title = owner ? owner.name + "的地产" : "已经营";
        ownerBadge.setAttribute("aria-label", owner ? owner.name + "的地产" : "已经营");
        levelBadge.textContent = "Lv." + tile.level;
        cell.setAttribute("aria-label", "第 " + tile.index + " 格 " + tile.name + "，" + (owner ? owner.name + "的地产" : "已经营") + "，等级 " + tile.level);
      } else {
        cell.classList.remove("has-owner");
        delete cell.dataset.ownerId;
        cell.style.removeProperty("--owner-color");
        ownerBadge.textContent = "";
        ownerBadge.removeAttribute("style");
        ownerBadge.removeAttribute("aria-label");
        levelBadge.textContent = "";
        cell.setAttribute("aria-label", "第 " + tile.index + " 格 " + tile.name);
      }
      var occupants = state.players.filter(function (player) { return !player.bankrupt && player.position === tile.index; });
      cell.classList.toggle("has-tokens", occupants.length > 0);
      occupants.forEach(function (player) {
        var token = document.createElement("span");
        token.className = "token";
        token.textContent = player.avatar;
        token.style.backgroundColor = player.color;
        token.title = player.name;
        tokenStack.appendChild(token);
      });
    });
  }

  function renderAssets(state, player) {
    var owned = state.board.filter(function (tile) { return tile.ownerId === player.id; });
    var interestCap = firstDefined(data.config.bankInterestCap, 2000);
    elements["asset-owner-name"].textContent = player.name + "的资产";
    elements["asset-net-worth"].textContent = money(netWorthFor(state, player));
    elements["asset-cash"].textContent = money(player.money);
    elements["asset-deposit"].textContent = money(player.bankPrincipal);
    elements["asset-interest"].textContent = money(player.bankInterest);
    elements["asset-interest-earned"].textContent = money(player.bankInterestEarned) + " / " + money(interestCap);
    elements["asset-properties-value"].textContent = money(propertyValueFor(state, player.id));
    elements["property-count"].textContent = owned.length + " 处";
    elements["property-list"].textContent = "";
    if (!owned.length) {
      var empty = document.createElement("p");
      empty.className = "empty-copy";
      empty.textContent = "买下第一处地产后，会在这里看到它。";
      elements["property-list"].appendChild(empty);
      return;
    }
    owned.forEach(function (tile) {
      var property = data.properties[tile.propertyId];
      var value = Math.floor(tile.totalInvested * data.config.propertySaleRate);
      var row = document.createElement("article");
      row.className = "property-item";
      var text = document.createElement("div");
      var title = document.createElement("strong");
      title.textContent = property.emoji + " " + tile.name + " · Lv." + tile.level;
      var detail = document.createElement("p");
      var turnover = firstDefined(tile.currentTurnover, tile.turnover, tile.businessBalance, 0);
      var collectible = firstDefined(tile.collectibleRevenue, Math.round(turnover * 0.5));
      detail.textContent = "可领取 " + money(collectible) + " · 出售可得 " + money(value);
      text.append(title, detail);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "property-action-button";
      var canSellHere = currentPlayer(state).id === player.id && player.position === tile.index;
      button.textContent = canSellHere ? "出售" : "需停留";
      button.title = canSellHere ? "出售该地产" : "本人停在这处地产时才能主动出售";
      button.disabled = busy || state.ended || !canSellHere;
      button.addEventListener("click", function () { sellProperty(tile.id, tile.name, value); });
      row.append(text, button);
      elements["property-list"].appendChild(row);
    });
  }

  function renderCards(state, player) {
    var hand = Array.isArray(player.hand) ? player.hand : [];
    elements["hand-owner-name"].textContent = player.name + "的手牌";
    elements["hand-count"].textContent = hand.length + " / " + data.config.handLimit;
    elements["card-list"].textContent = "";
    if (!hand.length) {
      var empty = document.createElement("p");
      empty.className = "empty-copy";
      empty.textContent = "抽到的卡牌会放在这里。";
      elements["card-list"].appendChild(empty);
      return;
    }
    var available = engine ? engine.getAvailableActions().playableCards : [];
    hand.forEach(function (cardEntry, handIndex) {
      var cardId = typeof cardEntry === "string" ? cardEntry : cardEntry && cardEntry.id;
      var card = data.cards[cardId];
      if (!card) return;
      var row = document.createElement("article");
      row.className = "card-item";
      var icon = document.createElement("span");
      icon.className = "card-item-icon";
      icon.textContent = card.category === "positive" ? "♥" : "!";
      var text = document.createElement("div");
      var title = document.createElement("strong");
      title.textContent = card.name;
      var detail = document.createElement("p");
      detail.textContent = card.text;
      text.append(title, detail);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "card-use-button";
      button.textContent = card.timing === "turn" ? "使用" : card.timing === "reaction" ? "待触发" : "自动";
      button.disabled = busy || !available.includes(cardId);
      button.addEventListener("click", function () { useCard(cardId, handIndex); });
      row.append(icon, text, button);
      elements["card-list"].appendChild(row);
    });
  }

  function renderActiveStatuses(player) {
    var status = player.statuses || {};
    var chips = [];
    var hand = Array.isArray(player.hand) ? player.hand : [];
    function cardCount(cardId) { return hand.filter(function (entry) { return (typeof entry === "string" ? entry : entry && entry.id) === cardId; }).length; }
    if (status.skipTurns) chips.push(["暂停 ×" + status.skipTurns, "negative"]);
    if (status.forcedConsumption) chips.push(["强制消费 ×" + status.forcedConsumption, "negative"]);
    if (status.deliveryOrder) chips.push(["外卖免单 +100", "positive"]);
    if (cardCount("consume")) chips.push(["消费卡待生效", "positive"]);
    if (cardCount("fullHealth")) chips.push(["满血卡 ×" + cardCount("fullHealth"), "positive"]);
    if (cardCount("immunity")) chips.push(["免惩卡 ×" + cardCount("immunity"), "positive"]);
    if (cardCount("reflect")) chips.push(["反弹卡 ×" + cardCount("reflect"), "positive"]);
    elements["active-status-list"].textContent = "";
    if (!chips.length) chips.push(["状态正常", "clear"]);
    chips.slice(0, 2).forEach(function (entry) {
      var chip = document.createElement("span");
      chip.className = "status-chip is-" + entry[1];
      chip.textContent = entry[0];
      elements["active-status-list"].appendChild(chip);
    });
  }

  function playerAssetStatuses(player) {
    var status = player.statuses || {};
    var entries = [];
    if (player.bankrupt) entries.push(["已破产", "negative"]);
    if (status.skipTurns) entries.push(["暂停 ×" + status.skipTurns, "negative"]);
    if (status.forcedConsumption) entries.push(["停在他人地产强制消费 ×" + status.forcedConsumption, "negative"]);
    if (status.deliveryOrder) entries.push(["外卖免单并收入 100 待触发", "positive"]);
    if (player.bankPendingPrincipal) entries.push(["新存本金 " + money(player.bankPendingPrincipal) + " 下次到访计息", "clear"]);
    if (!entries.length) entries.push(["状态正常", "clear"]);
    return entries;
  }

  function addLog(text, tone, playerId) {
    uiLog.unshift({ text: text, tone: tone || "neutral", playerId: playerId || null, time: new Date() });
    if (uiLog.length > 40) uiLog.length = 40;
    renderLogs();
  }

  function renderLogs() {
    var list = elements["event-log-list"];
    list.textContent = "";
    elements["log-count"].textContent = String(uiLog.length);
    if (!uiLog.length) {
      var empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "第一条冒险动态会出现在这里。";
      list.appendChild(empty);
      return;
    }
    uiLog.forEach(function (entry) {
      var item = document.createElement("li");
      item.className = "event-log-item is-" + entry.tone;
      var time = document.createElement("time");
      time.textContent = entry.time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      var text = document.createElement("span");
      text.textContent = entry.text;
      item.append(time, text);
      list.appendChild(item);
    });
  }

  function reasonLabel(reason) {
    var labels = {
      startLanding: "温暖小窝", startPassed: "温暖小窝", startReward: "温暖小窝",
      safeReward: "休息时间", propertyConsumption: "地产消费", businessRevenue: "领取营收", cityInspection: "城管检查",
      bankDeposit: "银行存款", bankWithdraw: "银行取现", bankEmergencyWithdrawal: "紧急提取利息",
      collision: "撞人赔偿", collisionCompensation: "撞人赔偿", deliveryReward: "外卖收入",
      gameMomentRefusal: "拒绝游戏", investmentCardWin: "投资卡", investmentCardLoss: "投资卡",
      lotteryCard: "彩票卡", generousCard: "好人卡", charmingCard: "迷人卡",
      yiminReview: "伊敏测评", maintenanceFee: "生活压力费", lifePressure: "生活压力费",
      buyProperty: "购买地产", propertyPurchase: "购买地产", upgradeProperty: "升级地产",
      propertyUpgrade: "升级地产", propertySale: "出售地产", forcedSale: "紧急出售地产",
      collisionFee: "撞人赔偿"
    };
    if (reason && data.lifeEvents && data.lifeEvents[reason]) return data.lifeEvents[reason].name;
    return labels[reason] || (reason ? String(reason).replace(/([A-Z])/g, " $1").trim() : "余额变化");
  }

  function eventTone(event) {
    var card = event.cardId ? data.cards[event.cardId] : null;
    if (card && ["cardDrawn", "cardAdded", "cardUsed", "cardDiscarded"].includes(event.type)) return card.category === "negative" ? "negative" : "positive";
    if (event.type === "lifeEvent" && event.lifeEventId && data.lifeEvents[event.lifeEventId]) {
      return ["fine", "randomFine", "percentFine", "skip"].includes(data.lifeEvents[event.lifeEventId].effect) ? "negative" : "positive";
    }
    if (event.type === "scratchCardResolved") return Number(event.amount) < 0 ? "negative" : "positive";
    if (event.type === "gameMomentConfirmationResolved") return event.confirmed ? "positive" : "negative";
    if (event.type === "moneyChanged") return Number(event.delta) < 0 ? "negative" : "positive";
    if (["propertyBought", "propertyUpgraded", "businessRevenue", "startPassed", "startLanded", "reviewReward", "companionRescue", "bankInterestAccrued", "cardDrawn", "cardUsed", "deliveryCompleted", "bonusTurnGranted", "penaltyBlocked", "gameFailureBlocked"].includes(event.type)) return "positive";
    if (["turnSkipped", "maintenanceFeeCharged", "playerBankrupt", "error", "cardDiscarded", "gameMomentRefused", "penaltyReflected", "gameFailureReflected", "skipAdded", "bankEmergencyWithdrawal"].includes(event.type)) return "negative";
    return "neutral";
  }

  function eventMessage(event, state) {
    var player = event.playerId ? getPlayer(state, event.playerId) : null;
    var owner = event.ownerId ? getPlayer(state, event.ownerId) : null;
    var tile = event.tileId ? state.board.find(function (item) { return item.id === event.tileId; }) : null;
    var card = event.cardId ? data.cards[event.cardId] : null;
    var playerName = player ? player.name : "玩家";
    var property = event.propertyId ? data.properties[event.propertyId] : tile && tile.propertyId ? data.properties[tile.propertyId] : null;
    var propertyName = event.propertyName || event.newName || (tile ? tile.name : null) || (property ? property.name : "地产");
    switch (event.type) {
      case "turnStarted": return playerName + " 开始行动";
      case "turnSkipped": return playerName + " 暂停一回合";
      case "diceRolled": return event.reason === "propertyConsumption" ? playerName + " 的消费骰是 " + event.value : playerName + " 掷出了 " + event.value;
      case "startPassed": return Number(event.amount) > 0 ? playerName + " 停在温暖小窝，获得 " + money(event.amount) + " 快乐币" : null;
      case "startLanded": return playerName + " 停在温暖小窝，获得 " + money(event.amount) + " 快乐币";
      case "moneyChanged": return playerName + "因「" + reasonLabel(event.reason) + "」" + (Number(event.delta) >= 0 ? "获得 " : "扣除 ") + money(Math.abs(Number(event.delta) || 0)) + "，现有 " + money(event.balance);
      case "propertyBought": return playerName + " 买下了「" + propertyName + "」，支付 " + money(firstDefined(event.amount, event.price)) + " 快乐币";
      case "propertyUpgraded": return playerName + " 将「" + propertyName + "」升级到 Lv." + event.level + (firstDefined(event.amount, event.price) ? "，支付 " + money(firstDefined(event.amount, event.price)) : "");
      case "propertySold": return playerName + " 出售「" + propertyName + "」，获得 " + money(event.amount);
      case "propertySaleRejected": return playerName + " 需要停在「" + propertyName + "」才能主动出售";
      case "businessRevenue": return playerName + " 停在自己的「" + propertyName + "」，领取营收 " + money(event.amount);
      case "propertyConsumed": return playerName + " 在 " + (owner ? owner.name : "地主") + " 的「" + propertyName + "」消费了 " + money(event.amount);
      case "consumptionWaived": return playerName + " 免除了「" + propertyName + "」的本次消费";
      case "consumptionChecked": return event.consumed === false || event.triggered === false ? playerName + " 停在「" + propertyName + "」，本次没有产生消费" : null;
      case "deliveryOrderReceived": return playerName + " 接到外卖单：下一次停在店铺可免单并赚 100";
      case "deliveryCompleted": return playerName + " 完成外卖配送，获得 " + money(firstDefined(event.amount, 100));
      case "bankInterestAccrued": return Number(event.amount) > 0 ? playerName + " 本次结息 " + money(event.amount) + "，待取利息共 " + money(firstDefined(event.totalInterest, event.interest)) : playerName + " 本次没有新增利息，累计已获 " + money(event.interestEarned) + " / " + money(firstDefined(event.interestCap, data.config.bankInterestCap));
      case "bankDeposit": return playerName + " 存入银行 " + money(event.amount) + "，本金共 " + money(event.principal);
      case "bankWithdraw": return playerName + " 从银行取出 " + money(event.amount);
      case "bankEmergencyWithdrawal": return playerName + " 紧急提取银行利息 " + money(event.amount);
      case "bankPrincipalMatured": return playerName + " 上次存入的 " + money(event.amount) + " 已开始参与计息";
      case "bankNoAction": return playerName + " 本次停留银行未进行操作";
      case "cardDrawn": return playerName + " 抽到了「" + (card ? card.name : "一张卡") + "」";
      case "cardAdded": return null;
      case "cardUsed": return playerName + " 使用了「" + (card ? card.name : "卡牌") + "」" + (event.targetId && getPlayer(state, event.targetId) ? "，目标是 " + getPlayer(state, event.targetId).name : "");
      case "cardDiscarded": return playerName + " 的手牌已满，丢弃了「" + (card ? card.name : "一张卡") + "」";
      case "scratchCardResolved": return playerName + " 刮开「" + (card ? card.name : "卡牌") + "」，" + (Number(event.amount) >= 0 ? "获得 " : "损失 ") + money(Math.abs(Number(event.amount) || 0)) + " 快乐币";
      case "lifeEvent": return playerName + " 遇到了「" + (event.name || (tile && tile.name) || "生活彩蛋") + "」" + (event.text ? "：" + event.text : "");
      case "idleMoment": return playerName + " 在发呆时刻放空了一会儿";
      case "safeResolved": return playerName + " 在休息时间领取 300 快乐币" + (event.pauseRemaining > 0 ? "，并暂停一回合" : "，暂停已被满血卡抵消");
      case "adventure": return playerName + " 的冒险结果：" + ({ forward: "前进 3 格", consumeCard: "获得消费卡", back: "后退 2 格", fine: "罚款 100" }[event.outcome] || "特殊事件");
      case "cityInspectionProperty": {
        var inspectedOwner = getPlayer(state, event.ownerId);
        return (inspectedOwner ? inspectedOwner.name : "地主") + " 的「" + propertyName + "」本期营业额 " + money(event.periodTurnover) +
          "，管理费 " + money(event.expectedFee) + "（营业额扣 " + money(event.fromTurnover) + "，现金扣 " + money(event.fromCash) + "）";
      }
      case "cityInspection": return "城管检查完成，已按本检查周期营业额逐项结算管理费";
      case "reviewReward": return playerName + " 完成伊敏测评，获得 " + money(event.amount);
      case "collisionCompensated": return playerName + " 向 " + ((getPlayer(state, event.recipientId) || {}).name || "前一位玩家") + " 赔偿 " + money(event.amount);
      case "collision": return playerName + " 与 " + ((getPlayer(state, event.otherPlayerId || event.recipientId) || {}).name || "前一位玩家") + " 相遇，" + ((event.action || event.choice) === "back" ? "选择后退 " + firstDefined(event.backSteps, 3) + " 格" : "赔偿 " + money(firstDefined(event.amount, event.compensation, event.fee)));
      case "skipAdded": return playerName + " 增加 " + money(event.turns || 1) + " 次暂停";
      case "penaltyBlocked": return playerName + " 使用免惩卡，抵消了 " + money(event.amount) + " 的罚款";
      case "penaltyReflected": return playerName + " 将 " + money(event.amount) + " 的罚款反弹给了 " + ((getPlayer(state, event.targetId) || {}).name || "其他玩家");
      case "gameFailureBlocked": return playerName + " 使用免惩卡，抵消小游戏失败惩罚";
      case "gameFailureReflected": return playerName + " 将小游戏失败惩罚反弹给了 " + ((getPlayer(state, event.targetId) || {}).name || "其他玩家");
      case "gameMomentStarted": return playerName + " 开始「" + ((data.gameMoments[event.gameMomentId] || {}).name || "游戏互动") + "」";
      case "gameMomentCompleted": return playerName + " 完成了「" + ((data.gameMoments[event.gameMomentId] || {}).name || "游戏互动") + "」";
      case "gameMomentConfirmationResolved": return event.confirmed
        ? playerName + " 的任务已获得至少 3 人确认"
        : playerName + " 的任务未通过确认" + (event.systemRoll ? "，系统骰为 " + event.systemRoll + " 点" : "");
      case "gameMomentRefused": return playerName + " 拒绝游戏，扣除 " + money(event.amount) + "，接下来 3 次停在他人地产强制消费";
      case "diceDuelRound": return "掷骰子对决：" + (event.rolls || []).map(function (entry) {
        var roller = getPlayer(state, entry.playerId);
        return (roller ? roller.name : "玩家") + " " + entry.value + " 点";
      }).join("，");
      case "rpsRound": {
        var moveNames = { rock: "石头", paper: "布", scissors: "剪刀" };
        var opponent = getPlayer(state, event.opponentId);
        return playerName + " 出" + (moveNames[event.playerMove] || event.playerMove) + "，" + (opponent ? opponent.name : "对手") + " 出" + (moveNames[event.opponentMove] || event.opponentMove);
      }
      case "rpsResolved": {
        var winner = getPlayer(state, event.winnerId);
        var loser = getPlayer(state, event.loserId);
        return "石头剪刀布结束，" + (winner ? winner.name : "胜方") + " 获胜，" + (loser ? loser.name : "败方") + " 后退 5 格";
      }
      case "bonusTurnGranted": return playerName + " 获得一次额外行动";
      case "companionRescue": return "伙伴护住了伊敏，这局还有转机";
      case "maintenanceFeeIncreased": return "生活压力上升，下一轮每名存活玩家需支付 " + money(event.nextFee);
      case "maintenanceFeeCharged": return playerName + " 支付生活压力费 " + money(event.amount);
      case "playerBankrupt": return player.name + " 暂时告别了本局";
      case "gameEnded": return "本局结束，" + (getPlayer(state, event.winnerId) || {}).name + " 排在第一";
      case "error": return "结算遇到问题：" + event.message;
      default:
        if (event.message) return event.message;
        if (/penalty|fee|charge/i.test(event.type) && event.amount !== undefined) return playerName + " 支付 " + money(event.amount) + " 快乐币";
        if (/reward|income|revenue/i.test(event.type) && event.amount !== undefined) return playerName + " 获得 " + money(event.amount) + " 快乐币";
        return null;
    }
  }

  async function showEventNotice(config) {
    if (!config || !config.title || !elements["event-result-region"]) return;
    while (eventNoticeActive) await wait(20);
    eventNoticeActive = true;
    var region = elements["event-result-region"];
    var lockTargets = [
      elements["game-screen"].querySelector(".game-toolbar"),
      elements["player-list"],
      elements["board"],
      elements["side-panel"]
    ].filter(Boolean).map(function (target) {
      return { target: target, inert: Boolean(target.inert) };
    });
    lockTargets.forEach(function (entry) { entry.target.inert = true; });
    elements["game-screen"].classList.add("is-event-paused");
    elements["game-screen"].setAttribute("aria-busy", "true");
    region.classList.add("is-active");

    var backdrop = document.createElement("span");
    backdrop.className = "event-pause-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    var notice = document.createElement("article");
    notice.className = "event-result-card is-" + (config.tone || "neutral") + (config.card ? " is-card-reveal" : "") + (config.pause ? " is-turn-pause" : "");
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-label", config.title + (config.body ? "。" + config.body : ""));
    var icon = document.createElement("span");
    icon.className = "event-result-icon";
    icon.textContent = config.icon || (config.tone === "positive" ? "+" : config.tone === "negative" ? "−" : "·");
    icon.setAttribute("aria-hidden", "true");
    var copy = document.createElement("span");
    copy.className = "event-result-copy";
    var title = document.createElement("strong");
    title.textContent = config.title;
    var body = document.createElement("span");
    body.textContent = config.body || "";
    copy.append(title, body);
    var timer = document.createElement("span");
    timer.className = "event-result-timer";
    timer.setAttribute("aria-hidden", "true");
    notice.append(icon, copy, timer);
    document.body.appendChild(backdrop);
    region.replaceChildren(notice);
    elements["screen-reader-status"].textContent = config.title + (config.body ? "。" + config.body : "") + "。3 秒后继续";

    try {
      await wait(3000);
      notice.classList.add("is-leaving");
      await wait(180);
    } finally {
      backdrop.remove();
      region.replaceChildren();
      region.classList.remove("is-active");
      elements["game-screen"].classList.remove("is-event-paused");
      elements["game-screen"].removeAttribute("aria-busy");
      lockTargets.forEach(function (entry) { entry.target.inert = entry.inert; });
      eventNoticeActive = false;
    }
  }

  function noticeForEvent(event, state, message, tone) {
    var player = event.playerId ? getPlayer(state, event.playerId) : null;
    var card = event.cardId ? data.cards[event.cardId] : null;
    if (event.type === "turnSkipped") {
      return {
        title: (player ? player.name : "玩家") + "暂停一回合",
        body: event.remaining > 0 ? "本回合不行动，还剩 " + event.remaining + " 次暂停。下一位玩家将继续。" : "本回合不行动，下一位玩家将继续。",
        icon: "停",
        tone: "pause",
        pause: true
      };
    }
    if (event.type === "cardDrawn") {
      return { title: (player ? player.name + "抽到 " : "抽到 ") + (card ? card.name : "一张卡"), body: card ? card.text : message, icon: "◇", tone: tone, card: true };
    }
    if (event.type === "cardUsed") return { title: (card ? card.name : "卡牌") + "已生效", body: message, icon: "◇", tone: tone, card: true };
    if (event.type === "cardDiscarded" && player && player.isHuman) return { title: "手牌已满", body: message, icon: "◇", tone: "negative", card: true };
    if (event.type === "scratchCardResolved") return { title: event.result === "win" ? "刮奖成功" : "投资结果揭晓", body: message, icon: "◇", tone: tone, card: true };
    if (event.type === "propertyBought") return { title: "地产购买成功", body: message, icon: "店", tone: tone };
    if (event.type === "propertyUpgraded") return { title: "地产升级成功", body: message, icon: "↑", tone: tone };
    if (event.type === "businessRevenue" && player && player.isHuman) return { title: "领取地产营收", body: message, icon: "+", tone: "positive" };
    if (event.type === "propertyConsumed" && (player && player.isHuman || event.ownerId === "yimin")) return { title: "发生地产消费", body: message, icon: "¥", tone: player && player.isHuman ? "negative" : "positive" };
    if (event.type === "consumptionChecked" && player && player.isHuman && (event.consumed === false || event.triggered === false)) return { title: "这次没有消费", body: message, icon: "·", tone: "neutral" };
    if (event.type === "lifeEvent" && player && player.isHuman) return { title: event.name || "生活彩蛋", body: message, icon: "✦", tone: tone };
    if (["bankInterestAccrued", "bankDeposit", "bankWithdraw", "bankEmergencyWithdrawal"].includes(event.type) && player && player.isHuman) {
      return { title: event.type === "bankInterestAccrued" ? "银行结息" : event.type === "bankDeposit" ? "存款成功" : event.type === "bankWithdraw" ? "取现成功" : "紧急提取利息", body: message, icon: "¥", tone: event.type === "bankEmergencyWithdrawal" ? "negative" : "positive" };
    }
    if (event.type === "reviewReward" && player && player.isHuman) return { title: "伊敏测评奖励", body: message, icon: "★", tone: "positive" };
    if (["deliveryOrderReceived", "deliveryCompleted"].includes(event.type) && player && player.isHuman) return { title: event.type === "deliveryCompleted" ? "外卖完成" : "接到外卖单", body: message, icon: "送", tone: "positive" };
    if (["startLanded", "safeResolved", "adventure", "idleMoment", "skipAdded"].includes(event.type) && player && player.isHuman && !(event.type === "skipAdded" && ["safe", "fate"].includes(event.reason))) {
      var eventTitles = { startLanded: "回到温暖小窝", safeResolved: "休息时间", adventure: "冒险结果", idleMoment: "发呆时刻", skipAdded: "暂停状态" };
      return { title: eventTitles[event.type], body: message, icon: event.type === "skipAdded" ? "!" : "✦", tone: tone };
    }
    if (["diceDuelRound", "rpsResolved"].includes(event.type) && player && player.isHuman) return { title: event.type === "diceDuelRound" ? "掷骰子对决" : "猜拳结果", body: message, icon: "★", tone: "neutral" };
    if (event.type === "gameMomentConfirmationResolved" && player && player.isHuman) return { title: event.confirmed ? "任务确认通过" : "任务确认未通过", body: message, icon: event.confirmed ? "✓" : "!", tone: event.confirmed ? "positive" : "negative" };
    if (event.type === "moneyChanged" && player && player.isHuman && Number(event.delta) < 0 && !["buyProperty", "propertyPurchase", "upgradeProperty", "propertyUpgrade", "bankDeposit", "propertyConsumption", "collisionFee"].includes(event.reason)) {
      return { title: "快乐币扣除", body: message, icon: "−", tone: "negative" };
    }
    if (["playerBankrupt", "gameEnded", "companionRescue", "cityInspection"].includes(event.type)) return { title: event.type === "gameEnded" ? "本局结束" : event.type === "playerBankrupt" ? "玩家破产" : event.type === "cityInspection" ? "城管检查" : "伙伴救援", body: message, icon: "!", tone: tone };
    return null;
  }

  function showMoneyFeedback(event, state) {
    var delta = Number(event.delta) || 0;
    if (!delta) return;
    var player = getPlayer(state, event.playerId);
    var label = (delta > 0 ? "+" : "−") + money(Math.abs(delta));
    var pop = document.createElement("span");
    pop.className = "money-pop is-" + (delta > 0 ? "positive" : "negative");
    pop.textContent = label;
    var target = elements["player-list"].querySelector('[data-player-id="' + event.playerId + '"]');
    (target || elements["money-feedback-region"]).appendChild(pop);
    elements["screen-reader-status"].textContent = (player ? player.name : "玩家") + "快乐币" + label;
    window.setTimeout(function () { pop.remove(); }, 1300);
  }

  async function onEngineEvent(event, state) {
    if (spectatorFastForward && !["playerBankrupt", "maintenanceFeeIncreased", "gameEnded", "error"].includes(event.type)) return;
    var sourcePlayer = event.playerId ? getPlayer(state, event.playerId) : null;
    var suppressBankruptActivity = sourcePlayer && sourcePlayer.bankrupt &&
      !["playerBankrupt", "gameEnded", "error"].includes(event.type);
    if (suppressBankruptActivity) {
      render(state);
      return;
    }
    if (event.type === "diceRolled") {
      await animateDice(event.value);
      playTone(500 + event.value * 45, 0.05);
    }
    render(state);
    if (event.type === "moneyChanged") showMoneyFeedback(event, state);
    var message = eventMessage(event, state);
    if (message) {
      var tone = eventTone(event);
      addLog(message, tone, event.playerId);
      var notice = noticeForEvent(event, state, message, tone);
      if (notice) await showEventNotice(notice);
    }
    maybeCompanionLine(event, state);
    if (event.type === "gameEnded") {
      localStorage.removeItem(SAVE_KEY);
      var finalRanking = event.ranking || engine.getRanking();
      saveMatchHistory(finalRanking, state);
      await showRanking(finalRanking);
    }
  }

  function maybeCompanionLine(event, state) {
    if (state.settings && state.settings.careMode === false) return;
    if (!["propertyBought", "businessRevenue", "propertyConsumed", "companionRescue"].includes(event.type)) return;
    if (Math.random() > 0.35 && event.type !== "companionRescue") return;
    var currentTurn = Number(state.globalTurn) || 0;
    var candidates = state.players.filter(function (player) {
      var lastTurn = lastDialogueTurnByPlayer[player.id];
      return !player.isHuman && !player.bankrupt && (lastTurn == null || currentTurn - lastTurn >= 2);
    });
    var source = event.donorId
      ? candidates.find(function (player) { return player.id === event.donorId; })
      : candidates[Math.floor(Math.random() * candidates.length)];
    if (!source) return;
    var lines = data.dialogue[source.id];
    var category = event.type === "propertyBought"
      ? "buy"
      : event.type === "companionRescue" || event.playerId === "yimin" && event.type === "propertyConsumed"
        ? "yiminDown"
        : "pass";
    if (!lines || !lines[category]) return;
    var line = lines[category][Math.floor(Math.random() * lines[category].length)];
    lastDialogueTurnByPlayer[source.id] = currentTurn;
    addLog(source.name + "：" + line, "dialogue", source.id);
  }

  async function onEngineDelay(kind) {
    if (spectatorFastForward) return;
    var timing = fastMode
      ? { moveStep: Math.round(55 / MOVE_SPEED_MULTIPLIER), event: 80 }
      : { moveStep: Math.round(180 / MOVE_SPEED_MULTIPLIER), event: 220 };
    await wait(timing[kind] || (fastMode ? 30 : 80));
  }

  function modalChoice(config) {
    return new Promise(function (resolve) {
      currentModalResolve = resolve;
      elements["modal-icon"].textContent = config.icon || "!";
      elements["modal-kicker"].textContent = config.kicker || "需要你的选择";
      elements["modal-title"].textContent = config.title || "选一个吧";
      elements["modal-body"].textContent = "";
      var body = document.createElement("p");
      body.textContent = config.body || "";
      elements["modal-body"].appendChild(body);
      if (config.extra) elements["modal-body"].appendChild(config.extra);
      elements["modal-actions"].textContent = "";
      (config.actions || []).forEach(function (action) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        if (action.variant) button.dataset.variant = action.variant;
        button.addEventListener("click", function () { closeModal(action.value); });
        elements["modal-actions"].appendChild(button);
      });
      elements["modal-layer"].hidden = false;
      window.setTimeout(function () { elements["game-modal"].focus(); }, 0);
    });
  }

  function closeModal(value) {
    elements["modal-layer"].hidden = true;
    if (currentModalResolve) {
      var resolve = currentModalResolve;
      currentModalResolve = null;
      resolve(value);
    }
  }

  async function onEngineChoice(request, state) {
    var player = getPlayer(state, request.playerId) || currentPlayer(state);
    if (!player.isHuman && request.type !== "rescue") return undefined;
    var property = request.propertyId ? data.properties[request.propertyId] : null;
    if (request.type === "safeReward") {
      return "money";
    }
    if (request.type === "buyProperty") {
      return modalChoice({ icon: property.emoji, title: "买下「" + property.name + "」", body: "标价 " + money(request.price) + "，购买后还剩 " + money(request.balance - request.price) + " 快乐币。", actions: [
        { label: "买下它", value: "buy" }, { label: "暂时不要", value: "skip", variant: "secondary" }
      ] });
    }
    if (request.type === "upgradeProperty") {
      var nextPropertyName = property.levelNames && property.levelNames[request.nextLevel - 1] || property.name;
      return modalChoice({ icon: property.emoji, title: "升级为「" + nextPropertyName + "」", body: "花费 " + money(request.price) + "，从 Lv." + request.level + " 升到 Lv." + request.nextLevel + "。", actions: [
        { label: "立即升级", value: "upgrade" }, { label: "保留现金", value: "skip", variant: "secondary" }
      ] });
    }
    if (request.type === "collision") {
      var other = getPlayer(state, request.otherPlayerId);
      var collisionFee = firstDefined(request.amount, request.compensation, request.fee, 100);
      var backSteps = firstDefined(request.backSteps, request.steps, 3);
      var collisionActions = [{ label: "赔偿 " + money(collisionFee), value: "pay" }];
      if (!request.mandatory) collisionActions.push({ label: "后退 " + backSteps + " 格", value: "back", variant: "secondary" });
      return modalChoice({ icon: "!", title: "和 " + (other ? other.name : "前一位玩家") + " 撞到一起", body: request.mandatory ? "本次为强制赔偿。" : "可以赔偿，也可以选择后退。", actions: collisionActions });
    }
    if (request.type === "bank") return bankChoice(request);
    if (request.type === "skipRecovery") {
      return modalChoice({ icon: "♥", title: "要使用满血卡吗？", body: "使用后可以解除这次暂停，马上继续行动。", actions: [
        { label: "使用满血卡", value: "use" }, { label: "休息一回合", value: "skip", variant: "secondary" }
      ] });
    }
    if (request.type === "gameMoment" && request.gameMomentId === "rps") {
      return modalChoice({ icon: "✂", title: "石头剪刀布", body: "选好以后同时揭晓。", actions: [
        { label: "石头", value: { move: "rock" } }, { label: "剪刀", value: { move: "scissors" }, variant: "secondary" }, { label: "布", value: { move: "paper" }, variant: "secondary" }
      ] });
    }
    if (request.type === "scratchCard") {
      var scratchCard = data.cards[request.cardId];
      return modalChoice({ icon: "◇", kicker: scratchCard ? scratchCard.name : "刮奖时刻", title: request.cardId === "investment" ? "揭晓投资结果" : "刮开幸运奖券", body: "点击后立即揭晓结果。", actions: [
        { label: "现在刮开", value: "reveal" }
      ] });
    }
    if (request.type === "gameMoment") {
      var moment = data.gameMoments[request.gameMomentId];
      return modalChoice({ icon: "★", kicker: moment ? moment.name : "游戏时刻", title: request.prompt || "完成这次小游戏", body: "完成后点击确认；不方便完成也可以拒绝，并接受既定惩罚。", actions: [
        { label: "完成任务", value: "complete" }, { label: "这次拒绝", value: "refuse", variant: "danger" }
      ] });
    }
    if (request.type === "skipReaction") {
      return modalChoice({ icon: "♥", title: "使用免惩卡吗？", body: "使用后可以抵消这次暂停。", actions: [
        { label: "使用免惩卡", value: "use" }, { label: "接受暂停", value: "accept", variant: "secondary" }
      ] });
    }
    if (request.type === "penaltyReaction") {
      var reactionActions = [{ label: "接受扣款", value: "none", variant: "secondary" }];
      if (request.options.includes("immunity")) reactionActions.unshift({ label: "使用免惩卡", value: "immunity" });
      if (request.options.includes("reflect")) request.targets.forEach(function (targetId) {
        var target = getPlayer(state, targetId);
        reactionActions.push({ label: "反弹给" + target.name, value: { cardId: "reflect", targetId: targetId }, variant: "secondary" });
      });
      return modalChoice({ icon: "!", title: "要抵消这次惩罚吗？", body: "本次将扣除 " + money(request.amount) + " 快乐币。", actions: reactionActions });
    }
    if (request.type === "sellForPayment") return sellForPaymentChoice(request);
    if (request.type === "rescue") {
      return modalChoice({ icon: "♥", kicker: "护短模式", title: "伙伴来帮伊敏了", body: "选择现金救助，或领取一张能化解当前困难的卡牌。救助后 3 回合地产收入会减少 30%。", actions: [
        { label: "需要现金", value: "cash" }, { label: "需要道具卡", value: "card", variant: "secondary" }
      ] });
    }
    if (request.type === "punishTarget" || request.type === "reflectTarget") {
      var candidates = state.players.filter(function (item) { return item.id !== request.playerId && !item.bankrupt; });
      return modalChoice({ icon: "!", title: "选择一名玩家", body: "这张卡的效果会作用在你选中的伙伴身上。", actions: candidates.map(function (candidate, index) {
        return { label: candidate.name, value: candidate.id, variant: index ? "secondary" : "" };
      }) });
    }
    if (request.type === "discardCard") {
      return modalChoice({ icon: "◇", title: "手牌已满", body: "选择一张卡牌丢弃。", actions: (request.hand || request.options || []).map(function (cardId) {
        return { label: data.cards[cardId].name, value: cardId, variant: "secondary" };
      }) });
    }
    return undefined;
  }

  function bankChoice(request) {
    var state = engine ? engine.getState() : null;
    var player = state ? getPlayer(state, request.playerId) : null;
    var interestRate = Number(firstDefined(request.interestRate, data.config.bankInterestRate, 0.05));
    var interestCap = Number(firstDefined(request.interestCap, data.config.bankInterestCap, 2000));
    var cumulativeInterest = Number(firstDefined(request.cumulativeInterest, request.interestEarned, player && player.bankInterestEarned, 0));
    var nextBase = Number(firstDefined(request.nextInterestBase, Number(request.principal || 0) + Number(request.interest || 0)));
    var settleInterest = Number(firstDefined(request.nextInterest, Math.min(Math.max(0, interestCap - cumulativeInterest), Math.round(nextBase * interestRate))));
    var options = Array.isArray(request.options) ? request.options : ["deposit", "withdraw", "none"];
    var wrap = document.createElement("div");
    wrap.className = "modal-form";
    var overview = document.createElement("dl");
    overview.className = "bank-overview";
    [
      ["现金", money(request.balance)],
      ["银行本金", money(request.principal)],
      ["待取利息", money(request.interest)],
      ["累计已获利息", money(cumulativeInterest) + " / " + money(interestCap)],
      ["本次可结利息", "+" + money(settleInterest)]
    ].forEach(function (entry) {
      var row = document.createElement("div");
      var term = document.createElement("dt");
      var value = document.createElement("dd");
      term.textContent = entry[0];
      value.textContent = entry[1];
      row.append(term, value);
      overview.appendChild(row);
    });
    var label = document.createElement("label");
    label.textContent = "金额（100 的倍数）";
    var input = document.createElement("input");
    input.type = "number";
    input.min = "100";
    input.step = "100";
    input.value = String(Math.min(500, request.balance || request.principal + request.interest || 0));
    label.appendChild(input);
    wrap.append(overview, label);
    return new Promise(function (resolve) {
      currentModalResolve = resolve;
      elements["modal-icon"].textContent = "¥";
      elements["modal-kicker"].textContent = "世界银行";
      elements["modal-title"].textContent = "存取快乐币";
      elements["modal-body"].textContent = "";
      var info = document.createElement("p");
      info.textContent = "只有停在世界银行才能操作；本次新存入的金额从下次停留开始计息。";
      elements["modal-body"].append(info, wrap);
      elements["modal-actions"].textContent = "";
      var choices = [];
      if (options.includes("deposit")) choices.push({ label: "存入", action: "deposit" });
      if (options.includes("withdraw")) choices.push({ label: "取出", action: "withdraw", variant: "secondary" });
      if (options.includes("settle")) choices.push({ label: "结算利息", action: "settle", amount: 0, variant: "secondary" });
      choices.push({ label: "暂不操作", action: "none", amount: 0, variant: "secondary" });
      choices.forEach(function (choice) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = choice.label;
        if (choice.variant) button.dataset.variant = choice.variant;
        button.addEventListener("click", function () {
          closeModal({ action: choice.action, amount: choice.amount === 0 || choice.action === "none" ? 0 : Math.max(0, Math.floor(Number(input.value) / 100) * 100) });
        });
        elements["modal-actions"].appendChild(button);
      });
      elements["modal-layer"].hidden = false;
      window.setTimeout(function () { input.focus(); }, 0);
    });
  }

  function sellForPaymentChoice(request) {
    var actions = request.properties.map(function (item) {
      var tile = engine.getState().board.find(function (candidate) { return candidate.id === item.tileId; });
      var name = tile ? data.properties[tile.propertyId].name : "地产";
      return { label: "卖出 " + name + "（" + money(item.saleValue) + "）", value: item.tileId, variant: "secondary" };
    });
    return modalChoice({ icon: "¥", title: "需要变现资产", body: "当前还差 " + money(request.shortfall) + " 快乐币，请选择一处地产出售。", actions: actions });
  }

  async function animateDice(value) {
    elements.dice.classList.add("is-rolling");
    for (var i = 0; i < (fastMode ? 3 : 7); i += 1) {
      elements["dice-value"].textContent = String(1 + Math.floor(Math.random() * 6));
      await wait(fastMode ? 35 : 55);
    }
    elements["dice-value"].textContent = String(value);
    elements.dice.dataset.value = String(value);
    elements.dice.setAttribute("aria-label", "骰子点数 " + value);
    elements.dice.classList.remove("is-rolling");
  }

  function toast(text, tone) {
    var node = document.createElement("div");
    node.className = "toast " + (tone ? "is-" + tone : "");
    node.textContent = text;
    elements["toast-region"].appendChild(node);
    window.setTimeout(function () { node.remove(); }, 2800);
  }

  function playTone(frequency, duration) {
    if (!soundEnabled) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      var oscillator = audioContext.createOscillator();
      var gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.035, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch (_) { /* Sound is optional. */ }
  }

  function saveGame() {
    if (!engine || engine.isGameOver()) return;
    try { localStorage.setItem(SAVE_KEY, engine.serialize()); } catch (_) { /* Local save is best-effort. */ }
    updateContinueButton();
  }

  function readMatchHistory() {
    try {
      var history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(history) ? history.filter(function (record) {
        return record && record.id && Array.isArray(record.ranking);
      }).slice(0, HISTORY_LIMIT) : [];
    } catch (_) {
      return [];
    }
  }

  function updateHistoryButton() {
    var count = readMatchHistory().length;
    elements["history-count"].textContent = count ? "最近 " + count + " 局" : "尚无记录";
  }

  function saveMatchHistory(ranking, state) {
    if (!Array.isArray(ranking) || !ranking.length || !state) return;
    var yimin = ranking.find(function (entry) { return entry.playerId === "yimin" || entry.isHuman; });
    var record = {
      id: state.id || "match-" + Date.now(),
      completedAt: new Date().toISOString(),
      difficulty: state.settings && state.settings.difficulty || "normal",
      careMode: !state.settings || state.settings.careMode !== false,
      winner: {
        playerId: ranking[0].playerId,
        name: ranking[0].name,
        netWorth: ranking[0].netWorth
      },
      yiminRank: yimin ? yimin.rank : null,
      yiminNetWorth: yimin ? yimin.netWorth : 0,
      ranking: ranking.map(function (entry) {
        return {
          rank: entry.rank,
          playerId: entry.playerId,
          name: entry.name,
          netWorth: entry.netWorth,
          title: entry.title
        };
      })
    };
    try {
      var history = readMatchHistory().filter(function (entry) { return entry.id !== record.id; });
      history.unshift(record);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
      updateHistoryButton();
    } catch (_) { /* History is best-effort, like the current save. */ }
  }

  function difficultyLabel(value) {
    return value === "easy" ? "轻松" : value === "hard" ? "聪明" : "普通";
  }

  function buildPlayerAssetView(state, player) {
    var wrap = document.createElement("div");
    wrap.className = "player-asset-inspector";
    var overview = document.createElement("dl");
    overview.className = "asset-summary asset-summary-modal";
    [
      ["现金", money(player.money)],
      ["银行本金", money(player.bankPrincipal)],
      ["待取利息", money(player.bankInterest)],
      ["累计利息", money(player.bankInterestEarned)],
      ["地产估值", money(propertyValueFor(state, player.id))],
      ["待领营收", money(collectibleRevenueFor(state, player.id))],
      ["总资产", money(netWorthFor(state, player))]
    ].forEach(function (entry) {
      var row = document.createElement("div");
      var term = document.createElement("dt");
      var value = document.createElement("dd");
      term.textContent = entry[0];
      value.textContent = entry[1];
      row.append(term, value);
      overview.appendChild(row);
    });
    wrap.appendChild(overview);

    var statusHeading = document.createElement("h3");
    statusHeading.textContent = "当前状态";
    wrap.appendChild(statusHeading);
    var statusList = document.createElement("div");
    statusList.className = "asset-inspector-status-list";
    playerAssetStatuses(player).forEach(function (entry) {
      var chip = document.createElement("span");
      chip.className = "status-chip is-" + entry[1];
      chip.textContent = entry[0];
      statusList.appendChild(chip);
    });
    wrap.appendChild(statusList);

    var owned = state.board.filter(function (tile) { return tile.ownerId === player.id; });
    var heading = document.createElement("h3");
    heading.textContent = "地产 " + owned.length + " 处";
    wrap.appendChild(heading);
    var list = document.createElement("div");
    list.className = "asset-inspector-list";
    if (!owned.length) {
      var empty = document.createElement("p");
      empty.className = "empty-copy";
      empty.textContent = "还没有地产。";
      list.appendChild(empty);
    } else {
      owned.forEach(function (tile) {
        var property = data.properties[tile.propertyId] || {};
        var tier = data.propertyTiers[property.tier || tile.propertyId] || {};
        var level = Math.max(1, Number(tile.level) || 1);
        var row = document.createElement("div");
        row.className = "asset-inspector-property";
        var header = document.createElement("div");
        header.className = "asset-inspector-property-header";
        var name = document.createElement("strong");
        var turnover = firstDefined(tile.currentTurnover, tile.turnover, tile.businessBalance, 0);
        name.textContent = (property.emoji || "店") + " " + (tile.name || property.name) + " · Lv." + level;
        var levelState = document.createElement("span");
        levelState.textContent = level >= 4 ? "已满级" : "可升级";
        header.append(name, levelState);

        var nextUpgrade = level < 4 && Array.isArray(tier.upgradeCosts)
          ? money(tier.upgradeCosts[level - 1])
          : "已满级";
        var consumeAmount = Array.isArray(tier.consume) ? tier.consume[level - 1] : 0;
        var metrics = [
          ["购买价", money(tier.buyPrice)],
          ["下级升级价", nextUpgrade],
          ["当前级消费额", money(consumeAmount)],
          ["当前营业额", money(turnover)],
          ["检查周期营业额", money(tile.inspectionTurnover)],
          ["全局累计营业额", money(tile.lifetimeTurnover)],
          ["当前可领取营收", money(Math.round(turnover * 0.5))]
        ];
        var metricList = document.createElement("dl");
        metricList.className = "property-inspector-metrics";
        metrics.forEach(function (entry) {
          var metric = document.createElement("div");
          var term = document.createElement("dt");
          var value = document.createElement("dd");
          term.textContent = entry[0];
          value.textContent = entry[1];
          metric.append(term, value);
          metricList.appendChild(metric);
        });
        row.append(header, metricList);
        list.appendChild(row);
      });
    }
    wrap.appendChild(list);

    var hand = Array.isArray(player.hand) ? player.hand : [];
    var cards = document.createElement("p");
    cards.className = "asset-inspector-cards";
    cards.textContent = "手牌 " + hand.length + " / " + data.config.handLimit + (hand.length ? "：" + hand.map(function (entry) {
      var cardId = typeof entry === "string" ? entry : entry && entry.id;
      return data.cards[cardId] ? data.cards[cardId].name : "未知卡牌";
    }).join("、") : "");
    wrap.appendChild(cards);
    return wrap;
  }

  async function openPlayerAssets(playerId) {
    if (!engine || currentModalResolve) return;
    if (busy) {
      toast("这步结算完成后就能查看资产", "neutral");
      return;
    }
    var state = engine.getState();
    var player = getPlayer(state, playerId);
    if (!player) return;
    await modalChoice({
      icon: player.avatar, kicker: player.isHuman ? "我的资产" : "伙伴资产",
      title: player.name, body: player.bankrupt ? "本局已破产，以下是离场前的最终状态。" : "资产只读查看",
      extra: buildPlayerAssetView(state, player), actions: [{ label: "关闭", value: "close", variant: "secondary" }]
    });
  }

  function formatHistoryTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未记录";
    return date.toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    });
  }

  function buildHistoryList(history) {
    var list = document.createElement("div");
    list.className = "match-history-list";
    if (!history.length) {
      var empty = document.createElement("p");
      empty.className = "match-history-empty";
      empty.textContent = "完成第一局后，排名会留在这里。";
      list.appendChild(empty);
      return list;
    }

    history.forEach(function (record, index) {
      var entry = document.createElement("details");
      entry.className = "match-history-entry";
      if (index === 0) entry.open = true;
      var summary = document.createElement("summary");
      var heading = document.createElement("span");
      heading.className = "match-history-heading";
      var winner = document.createElement("strong");
      winner.textContent = record.winner.name + " 获得第一名";
      var timestamp = document.createElement("time");
      timestamp.dateTime = record.completedAt;
      timestamp.textContent = formatHistoryTime(record.completedAt);
      heading.append(winner, timestamp);
      var yiminRank = document.createElement("span");
      yiminRank.className = "match-history-rank";
      yiminRank.textContent = record.yiminRank ? "伊敏第 " + record.yiminRank + " 名" : "伊敏未入榜";
      summary.append(heading, yiminRank);

      var meta = document.createElement("div");
      meta.className = "match-history-meta";
      [
        ["难度", difficultyLabel(record.difficulty)],
        ["鼓励", record.careMode ? "开启" : "关闭"],
        ["伊敏资产", money(record.yiminNetWorth)]
      ].forEach(function (item) {
        var cell = document.createElement("span");
        var label = document.createElement("small");
        var value = document.createElement("strong");
        label.textContent = item[0];
        value.textContent = item[1];
        cell.append(label, value);
        meta.appendChild(cell);
      });

      var ranking = document.createElement("ol");
      ranking.className = "match-history-ranking";
      record.ranking.forEach(function (player) {
        var row = document.createElement("li");
        var name = document.createElement("span");
        var assets = document.createElement("strong");
        name.textContent = player.rank + ". " + player.name;
        assets.textContent = money(player.netWorth);
        row.append(name, assets);
        ranking.appendChild(row);
      });
      entry.append(summary, meta, ranking);
      list.appendChild(entry);
    });
    return list;
  }

  async function showMatchHistory() {
    var history = readMatchHistory();
    var actions = history.length ? [
      { label: "清空战绩", value: "clear", variant: "danger" },
      { label: "关闭", value: "close", variant: "secondary" }
    ] : [{ label: "知道了", value: "close", variant: "secondary" }];
    var choice = await modalChoice({
      icon: "★", kicker: "冒险纪念册", title: history.length ? "最近 " + history.length + " 局" : "还没有历史战绩",
      body: history.length ? "点击一局可以查看完整排名。" : "", extra: buildHistoryList(history), actions: actions
    });
    if (choice !== "clear") return;
    var confirmed = await modalChoice({
      icon: "×", kicker: "清空历史", title: "清空全部战绩？",
      body: "最近的对局记录会被永久删除，但不会影响当前游戏存档。", actions: [
        { label: "确认清空", value: true, variant: "danger" },
        { label: "保留战绩", value: false, variant: "secondary" }
      ]
    });
    if (!confirmed) return;
    try { localStorage.removeItem(HISTORY_KEY); } catch (_) { /* Ignore inaccessible storage. */ }
    updateHistoryButton();
    toast("历史战绩已清空", "positive");
  }

  function updateContinueButton() {
    var hasSave = false;
    try {
      var serialized = localStorage.getItem(SAVE_KEY);
      if (serialized) {
        var parsed = JSON.parse(serialized);
        hasSave = parsed.version === data.version && Array.isArray(parsed.board) && parsed.board.length === data.config.boardSize;
        if (!hasSave) localStorage.removeItem(SAVE_KEY);
      }
    } catch (_) {
      hasSave = false;
      try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* Ignore inaccessible storage. */ }
    }
    elements["continue-game-button"].disabled = !hasSave;
  }

  function readSetup() {
    var difficulty = document.querySelector('input[name="difficulty"]:checked');
    var playerNames = data.players.map(function (preset) {
      var input = document.querySelector('[data-player-name="' + preset.id + '"]');
      return String(input && input.value || preset.name).trim().slice(0, 12) || preset.name;
    });
    return { difficulty: difficulty ? difficulty.value : "normal", careMode: elements["care-mode-toggle"].checked, playerNames: playerNames };
  }

  function migrateSave(serialized) {
    var parsed = JSON.parse(serialized);
    if (parsed.version !== data.version || !Array.isArray(parsed.board) || parsed.board.length !== data.config.boardSize) {
      throw new Error("Incompatible board save");
    }
    parsed.settings = parsed.settings || {};
    delete parsed.settings.turnsPerPlayer;
    parsed.maxTurns = null;
    return JSON.stringify(parsed);
  }

  function createEngine() {
    engine = new window.YiminGameEngine({
      seed: Date.now(),
      hooks: { emit: onEngineEvent, choose: onEngineChoice, delay: onEngineDelay }
    });
  }

  async function startNewGame() {
    if (busy) return;
    busy = true;
    createEngine();
    var setup = readSetup();
    engine.newGame({ seed: Date.now(), playerName: setup.playerNames[0], playerNames: setup.playerNames, difficulty: setup.difficulty, careMode: setup.careMode });
    if (engine.state && Array.isArray(engine.state.players)) {
      engine.state.players.forEach(function (player, index) { player.name = setup.playerNames[index] || player.name; });
    }
    uiLog = [];
    eventNoticeActive = false;
    elements["event-result-region"].textContent = "";
    elements["event-result-region"].classList.remove("is-active");
    elements["game-screen"].classList.remove("is-event-paused");
    elements["game-screen"].removeAttribute("aria-busy");
    lastDialogueTurnByPlayer = {};
    elements["start-screen"].hidden = true;
    addLog(setup.playerNames[0] + "和三位伙伴出发啦", "positive", "yimin");
    render(engine.getState());
    saveGame();
    busy = false;
    render(engine.getState());
  }

  async function continueGame() {
    var serialized = null;
    try { serialized = localStorage.getItem(SAVE_KEY); } catch (_) { serialized = null; }
    if (!serialized) return;
    busy = true;
    createEngine();
    try {
      engine.load(migrateSave(serialized));
      uiLog = [];
      lastDialogueTurnByPlayer = {};
      elements["start-screen"].hidden = true;
      addLog("欢迎回来，冒险从这里继续", "positive", "yimin");
      render(engine.getState());
      saveGame();
      busy = false;
      await runAiUntilHuman();
    } catch (error) {
      localStorage.removeItem(SAVE_KEY);
      busy = false;
      toast("存档无法读取，已为你准备新游戏", "negative");
      updateContinueButton();
    }
  }

  async function fastForwardRemainingGame() {
    if (!engine || busy || engine.isGameOver()) return;
    busy = true;
    spectatorFastForward = true;
    addLog("伊敏进入观战，正在快速结算伙伴们的剩余对局", "dialogue", "yimin");
    render(engine.getState());
    var guard = 0;
    try {
      while (!engine.isGameOver() && guard < 5000) {
        await engine.playTurn();
        guard += 1;
        if (guard % 40 === 0) {
          saveGame();
          render(engine.getState());
          await wait(0);
        }
      }
      if (!engine.isGameOver()) toast("快速结算尚未完成，可以再次继续", "negative");
    } catch (error) {
      toast("快速结算遇到问题，请重新打开本局", "negative");
      console.error(error);
    } finally {
      spectatorFastForward = false;
      busy = false;
      if (engine) {
        saveGame();
        render(engine.getState());
      }
    }
  }

  async function playHumanTurn() {
    if (!engine || busy) return;
    var state = engine.getState();
    if (state.ended) return showRanking(engine.getRanking());
    var yimin = getPlayer(state, "yimin") || state.players[0];
    if (yimin.bankrupt) return fastForwardRemainingGame();
    if (!currentPlayer(state).isHuman) return;
    if (currentPlayer(state).statuses.skipTurns > 0) return runAiUntilHuman();
    busy = true;
    render(state);
    try {
      await engine.playTurn();
      saveGame();
      await runAiUntilHuman();
    } catch (error) {
      toast("这个回合没有结算完成，请重新开始本局", "negative");
      console.error(error);
    } finally {
      busy = false;
      render(engine.getState());
    }
  }

  async function runAiUntilHuman() {
    var safety = 0;
    while (engine && !engine.isGameOver() && safety < 60) {
      var state = engine.getState();
      var active = currentPlayer(state);
      var pausedHuman = active.isHuman && !active.bankrupt && active.statuses.skipTurns > 0;
      if (active.isHuman && !pausedHuman) break;
      busy = true;
      render(state);
      await wait(pausedHuman ? 160 : fastMode ? 90 : 340);
      await engine.playTurn();
      saveGame();
      safety += 1;
    }
    busy = false;
    if (engine) render(engine.getState());
  }

  async function useCard(cardId) {
    if (!engine || busy) return;
    busy = true;
    try {
      var used = await engine.useCard(cardId);
      if (!used) toast("这张卡现在还不能使用", "negative");
      saveGame();
      render(engine.getState());
    } catch (error) {
      toast("卡牌没有成功使用", "negative");
    } finally {
      busy = false;
      render(engine.getState());
    }
  }

  async function sellProperty(tileId, name, value) {
    if (!engine || busy) return;
    var choice = await modalChoice({ icon: "¥", title: "出售「" + name + "」", body: "出售后获得 " + money(value) + " 快乐币，地产会恢复为无主 Lv.1。", actions: [
      { label: "确认出售", value: true, variant: "danger" }, { label: "保留地产", value: false, variant: "secondary" }
    ] });
    if (!choice) return;
    busy = true;
    await engine.sellProperty(tileId, "yimin", "voluntary");
    saveGame();
    busy = false;
    render(engine.getState());
  }

  async function showRanking(ranking) {
    var wrap = document.createElement("div");
    wrap.className = "ranking-list";
    ranking.forEach(function (entry) {
      var row = document.createElement("p");
      row.textContent = entry.rank + ". " + entry.name + " · " + entry.title + " · " + money(entry.netWorth);
      wrap.appendChild(row);
    });
    await modalChoice({ icon: "★", kicker: "本局结算", title: ranking[0].name + " 获得第一名", body: "这一圈的快乐已经全部装进口袋。", extra: wrap, actions: [
      { label: "再玩一局", value: "again" }, { label: "留在结算", value: "stay", variant: "secondary" }
    ] }).then(function (value) {
      if (value === "again") window.setTimeout(function () { busy = false; startNewGame(); }, 0);
    });
  }

  function activatePanelTab(buttonId, openPanel) {
    if (eventNoticeActive) return;
    var tabs = [
      { button: elements["tab-events"], panel: elements["event-log"] },
      { button: elements["tab-cards"], panel: elements["card-panel"] },
      { button: elements["tab-assets"], panel: elements["asset-panel"] }
    ];
    var selected = tabs.find(function (tab) { return tab.button.id === buttonId; }) || tabs[0];
    tabs.forEach(function (candidate) {
      var active = candidate === selected;
      candidate.button.classList.toggle("is-active", active);
      candidate.button.setAttribute("aria-selected", String(active));
      candidate.panel.classList.toggle("is-active", active);
      candidate.panel.hidden = !active;
    });
    elements["quick-cards-button"].setAttribute("aria-expanded", String(Boolean(openPanel && selected.button.id === "tab-cards")));
    if (openPanel) {
      elements["side-panel"].classList.add("is-open");
      elements["panel-toggle"].setAttribute("aria-expanded", "true");
      var label = elements["panel-toggle"].querySelector(".visually-hidden");
      if (label) label.textContent = "收起游戏信息";
    }
  }

  function setupTabs() {
    var tabs = [elements["tab-events"], elements["tab-cards"], elements["tab-assets"]];
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () { activatePanelTab(tab.id, true); });
    });
  }

  function bindEvents() {
    elements["new-game-button"].addEventListener("click", startNewGame);
    elements["continue-game-button"].addEventListener("click", continueGame);
    elements["history-button"].addEventListener("click", showMatchHistory);
    elements["roll-button"].addEventListener("click", playHumanTurn);
    elements["quick-cards-button"].addEventListener("click", function () { activatePanelTab("tab-cards", true); });
    document.querySelectorAll("[data-player-name]").forEach(function (input) {
      input.addEventListener("change", savePreferences);
    });
    elements["speed-toggle"].addEventListener("change", function () { fastMode = this.checked; savePreferences(); });
    elements["sound-toggle"].addEventListener("click", function () {
      if (eventNoticeActive) return;
      soundEnabled = !soundEnabled;
      this.setAttribute("aria-pressed", String(!soundEnabled));
      this.setAttribute("aria-label", soundEnabled ? "关闭声音" : "开启声音");
      this.querySelector("span").textContent = soundEnabled ? "♪" : "×";
      savePreferences();
    });
    elements["restart-button"].addEventListener("click", async function () {
      if (eventNoticeActive) return;
      var restart = await modalChoice({ icon: "↻", title: "重新开始这局？", body: "当前进度会被新的冒险覆盖。", actions: [
        { label: "重新开始", value: true, variant: "danger" }, { label: "继续当前游戏", value: false, variant: "secondary" }
      ] });
      if (restart) startNewGame();
    });
    elements["modal-close"].addEventListener("click", function () { closeModal(undefined); });
    elements["panel-toggle"].addEventListener("click", function () {
      if (eventNoticeActive) return;
      var open = !elements["side-panel"].classList.contains("is-open");
      elements["side-panel"].classList.toggle("is-open", open);
      this.setAttribute("aria-expanded", String(open));
      elements["quick-cards-button"].setAttribute("aria-expanded", String(open && !elements["card-panel"].hidden));
      var label = this.querySelector(".visually-hidden");
      if (label) label.textContent = open ? "收起游戏信息" : "展开游戏信息";
    });
    document.addEventListener("keydown", function (event) {
      if (eventNoticeActive) {
        if (["Space", "Enter", "Escape"].includes(event.code) || event.key === "Escape") event.preventDefault();
        return;
      }
      if (event.key === "Escape" && !elements["modal-layer"].hidden) closeModal(undefined);
      var target = event.target;
      var isInteractive = target && target.closest && target.closest("button, input, select, textarea, a, [contenteditable='true'], [role='tab']");
      if (event.code === "Space" && !isInteractive && elements["start-screen"].hidden && elements["modal-layer"].hidden && !elements["roll-button"].disabled) {
        event.preventDefault();
        playHumanTurn();
      }
    });
    setupTabs();
  }

  function savePreferences() {
    var names = {};
    document.querySelectorAll("[data-player-name]").forEach(function (input) { names[input.dataset.playerName] = input.value; });
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ fastMode: fastMode, soundEnabled: soundEnabled, playerNames: names })); } catch (_) { /* optional */ }
  }

  function loadPreferences() {
    try {
      var prefs = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      fastMode = Boolean(prefs.fastMode);
      soundEnabled = prefs.soundEnabled !== false;
      if (prefs.playerNames) document.querySelectorAll("[data-player-name]").forEach(function (input) {
        if (prefs.playerNames[input.dataset.playerName]) input.value = prefs.playerNames[input.dataset.playerName];
      });
    } catch (_) { fastMode = false; soundEnabled = true; }
    elements["speed-toggle"].checked = fastMode;
    elements["sound-toggle"].setAttribute("aria-pressed", String(!soundEnabled));
  }

  function init() {
    if (!window.GAME_DATA || !window.YiminGameEngine) {
      document.body.textContent = "游戏资源没有加载完整，请刷新页面。";
      return;
    }
    cacheElements();
    buildBoard();
    bindEvents();
    loadPreferences();
    updateContinueButton();
    updateHistoryButton();
    createEngine();
    render(engine.getState());
  }

  document.addEventListener("DOMContentLoaded", init);
})();
