(function () {
  "use strict";

  var SAVE_KEY = "yimin-adventure-v1-save";
  var PREF_KEY = "yimin-adventure-v1-prefs";
  var HISTORY_KEY = "yimin-adventure-v1-history";
  var HISTORY_LIMIT = 10;
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

  function byId(id) { return document.getElementById(id); }
  function money(value) { return Math.max(0, Number(value) || 0).toLocaleString("zh-CN"); }
  function wait(ms) { return new Promise(function (resolve) { window.setTimeout(resolve, ms); }); }
  function getPlayer(state, id) { return state.players.find(function (player) { return player.id === id; }); }
  function currentPlayer(state) { return state.players[state.currentPlayerIndex]; }

  var elements = {};
  var tileElements = new Map();

  function cacheElements() {
    [
      "start-screen", "new-game-button", "continue-game-button", "history-button", "history-count", "care-mode-toggle",
      "game-screen", "round-number", "turn-player-name", "turn-status", "island-title", "game-hint",
      "speed-toggle", "restart-button", "sound-toggle", "player-list", "active-player-count",
      "companion-note", "board", "board-tiles", "dice", "dice-value", "roll-button",
      "current-cash", "current-net-worth", "current-card-count", "board-announcement",
      "side-panel", "panel-toggle", "tab-events", "tab-cards", "tab-assets", "event-log",
      "event-log-list", "card-panel", "card-list", "hand-count", "asset-panel", "asset-cash",
      "asset-deposit", "asset-properties-value", "asset-debt", "property-count", "property-list",
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
      if (tile.type === "start" || tile.type === "bank" || tile.type === "review" || tile.name === "星光影院" || tile.name === "梦想商场") {
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

  function netWorthFor(state, player) {
    return player.money + player.bankPrincipal + player.bankInterest + propertyValueFor(state, player.id);
  }

  function render(state) {
    if (!state) return;
    var active = currentPlayer(state);
    var yimin = getPlayer(state, "yimin") || state.players[0];
    var round = Math.floor(state.globalTurn / state.players.length) + 1;
    var activePlayerCount = state.players.filter(function (player) { return !player.bankrupt; }).length;
    var canFastForward = yimin.bankrupt && !state.ended;
    elements["round-number"].textContent = "第 " + round + " 轮 · " + activePlayerCount + " 人在场";
    elements["turn-player-name"].textContent = active.name;
    elements["island-title"].textContent = state.ended ? "本局结算" : canFastForward ? "观战结算" : active.isHuman ? "伊敏的回合" : active.name + " 行动中";
    elements["turn-status"].textContent = state.ended ? "这一局已经完成" : canFastForward ? "伊敏进入观战" : active.isHuman ? "轮到你出发啦" : active.name + " 正在行动";
    elements["game-hint"].textContent = state.ended ? "看看大家带回了多少快乐。" : canFastForward ? "点击快速结算，看看最后由谁留在场上。" : active.isHuman ? "停在他人的地产时，有 1 / 3 概率产生消费。" : "AI 伙伴会自己完成购买、升级和事件选择。";
    elements["current-cash"].textContent = money(yimin.money);
    elements["current-net-worth"].textContent = money(netWorthFor(state, yimin));
    elements["current-card-count"].textContent = yimin.hand.length + " / " + data.config.handLimit;
    elements["active-player-count"].textContent = String(activePlayerCount);
    elements["companion-note"].textContent = state.settings && state.settings.careMode === false
      ? "公平模式已开启，AI 会按相同规则认真经营。"
      : "陪伴模式已开启，伙伴们会在关键时刻照顾伊敏。";
    elements["roll-button"].disabled = busy || state.ended || (!canFastForward && (!active.isHuman || active.bankrupt));
    elements["roll-button"].querySelector("span:last-child").textContent = state.ended ? "查看结算" : canFastForward ? "快速结算" : active.statuses.skipTurns > 0 ? "结算暂停" : "掷骰子";
    renderPlayers(state);
    renderBoardState(state);
    renderAssets(state, yimin);
    renderCards(state, yimin);
    renderLogs();
  }

  function renderPlayers(state) {
    var list = elements["player-list"];
    list.textContent = "";
    state.players.forEach(function (player) {
      var item = document.createElement("li");
      item.className = "player-card";
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
      cash.textContent = money(player.money) + " 币";
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
      tokenStack.textContent = "";
      if (tile.ownerId) {
        var owner = getPlayer(state, tile.ownerId);
        ownerBadge.textContent = owner ? owner.avatar : "店";
        ownerBadge.style.backgroundColor = owner ? owner.color : "";
        ownerBadge.title = owner ? owner.name + "的地产" : "已经营";
        levelBadge.textContent = "Lv." + tile.level;
      } else {
        ownerBadge.textContent = "";
        ownerBadge.removeAttribute("style");
        levelBadge.textContent = "";
      }
      state.players.filter(function (player) { return !player.bankrupt && player.position === tile.index; }).forEach(function (player) {
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
    elements["asset-cash"].textContent = money(player.money);
    elements["asset-deposit"].textContent = money(player.bankPrincipal + player.bankInterest);
    elements["asset-properties-value"].textContent = money(propertyValueFor(state, player.id));
    elements["asset-debt"].textContent = "0";
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
      title.textContent = property.emoji + " " + property.name + " · Lv." + tile.level;
      var detail = document.createElement("p");
      detail.textContent = "出售可得 " + money(value) + " 快乐币";
      text.append(title, detail);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "property-action-button";
      button.textContent = "出售";
      button.disabled = busy || state.ended;
      button.addEventListener("click", function () { sellProperty(tile.id, property.name, value); });
      row.append(text, button);
      elements["property-list"].appendChild(row);
    });
  }

  function renderCards(state, player) {
    elements["hand-count"].textContent = player.hand.length + " / " + data.config.handLimit;
    elements["card-list"].textContent = "";
    if (!player.hand.length) {
      var empty = document.createElement("p");
      empty.className = "empty-copy";
      empty.textContent = "抽到的卡牌会放在这里。";
      elements["card-list"].appendChild(empty);
      return;
    }
    var available = engine ? engine.getAvailableActions().playableCards : [];
    player.hand.forEach(function (cardId, handIndex) {
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
      button.textContent = "使用";
      button.disabled = busy || !available.includes(cardId);
      button.addEventListener("click", function () { useCard(cardId, handIndex); });
      row.append(icon, text, button);
      elements["card-list"].appendChild(row);
    });
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

  function eventMessage(event, state) {
    var player = event.playerId ? getPlayer(state, event.playerId) : null;
    var owner = event.ownerId ? getPlayer(state, event.ownerId) : null;
    var tile = event.tileId ? state.board.find(function (item) { return item.id === event.tileId; }) : null;
    var card = event.cardId ? data.cards[event.cardId] : null;
    switch (event.type) {
      case "turnStarted": return player.name + " 开始行动";
      case "turnSkipped": return player.name + " 暂停一回合";
      case "diceRolled": return event.reason === "propertyConsumption" ? player.name + " 的消费骰是 " + event.value : player.name + " 掷出了 " + event.value;
      case "startPassed": return player.name + " 经过温暖小窝，获得 " + money(event.amount);
      case "propertyBought": return player.name + " 买下了 " + data.properties[event.propertyId].name;
      case "propertyUpgraded": return data.properties[event.propertyId].name + " 升到 Lv." + event.level;
      case "propertySold": return player.name + " 出售地产，获得 " + money(event.amount);
      case "businessRevenue": return player.name + " 经过自己的 " + tile.name + "，收取营业流水 " + money(event.amount);
      case "propertyConsumed": return player.name + " 在 " + owner.name + " 的 " + tile.name + " 消费了 " + money(event.amount);
      case "consumptionWaived": return player.name + " 免除了 " + tile.name + " 的本次消费";
      case "deliveryOrderReceived": return player.name + " 接到一张外卖单";
      case "deliveryCompleted": return player.name + " 完成外卖配送，获得 100";
      case "bankInterestAccrued": return player.name + " 的银行利息增加 " + money(event.amount);
      case "bankDeposit": return player.name + " 存入银行 " + money(event.amount);
      case "bankWithdraw": return player.name + " 从银行取出 " + money(event.amount);
      case "cardDrawn": return player.name + " 抽到了 " + (card ? card.name : "一张卡");
      case "cardUsed": return player.name + " 使用了 " + (card ? card.name : "卡牌");
      case "lifeEvent": return player.name + " 遇到了「" + (event.name || (tile && tile.name) || "生活彩蛋") + "」";
      case "cityInspection": return "城管检查来了，领先的店铺暂停营业";
      case "reviewReward": return player.name + " 完成伊敏测评，获得 " + money(event.amount);
      case "companionRescue": return "伙伴护住了伊敏，这局还有转机";
      case "maintenanceFeeIncreased": return "长期经营成本上涨，下一轮维护费为 " + money(event.nextFee);
      case "maintenanceFeeCharged": return player.name + " 支付经营维护费 " + money(event.amount);
      case "playerBankrupt": return player.name + " 暂时告别了本局";
      case "gameEnded": return "本局结束，" + (getPlayer(state, event.winnerId) || {}).name + " 排在第一";
      case "error": return "结算遇到问题：" + event.message;
      default: return null;
    }
  }

  async function onEngineEvent(event, state) {
    if (spectatorFastForward && !["playerBankrupt", "maintenanceFeeIncreased", "gameEnded", "error"].includes(event.type)) return;
    if (event.type === "diceRolled") {
      await animateDice(event.value);
      playTone(500 + event.value * 45, 0.05);
    }
    render(state);
    var message = eventMessage(event, state);
    if (message) {
      var tone = ["propertyBought", "businessRevenue", "startPassed", "reviewReward", "companionRescue"].includes(event.type) ? "positive" : ["turnSkipped", "maintenanceFeeCharged", "playerBankrupt", "error"].includes(event.type) ? "negative" : "neutral";
      addLog(message, tone, event.playerId);
      if (["propertyBought", "propertyConsumed", "companionRescue", "maintenanceFeeIncreased", "gameEnded"].includes(event.type)) toast(message, tone);
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
    var timing = fastMode ? { moveStep: 55, event: 80 } : { moveStep: 180, event: 220 };
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
      return modalChoice({ icon: "♥", title: "休息一下", body: "领取 300 快乐币，还是抽一张卡？", actions: [
        { label: "领取 300", value: "money" }, { label: "抽一张卡", value: "card", variant: "secondary" }
      ] });
    }
    if (request.type === "buyProperty") {
      return modalChoice({ icon: property.emoji, title: "买下「" + property.name + "」", body: "标价 " + money(request.price) + "，购买后还剩 " + money(request.balance - request.price) + " 快乐币。", actions: [
        { label: "买下它", value: "buy" }, { label: "暂时不要", value: "skip", variant: "secondary" }
      ] });
    }
    if (request.type === "upgradeProperty") {
      return modalChoice({ icon: property.emoji, title: "升级「" + property.name + "」", body: "花费 " + money(request.price) + "，从 Lv." + request.level + " 升到 Lv." + request.nextLevel + "。", actions: [
        { label: "立即升级", value: "upgrade" }, { label: "保留现金", value: "skip", variant: "secondary" }
      ] });
    }
    if (request.type === "collision") {
      var other = getPlayer(state, request.otherPlayerId);
      return modalChoice({ icon: "!", title: "和 " + other.name + " 撞到一起", body: "支付 100 快乐币，或者后退 2 格并继续结算。", actions: [
        { label: "支付 100", value: "pay" }, { label: "后退 2 格", value: "back", variant: "secondary" }
      ] });
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
    var wrap = document.createElement("div");
    wrap.className = "modal-form";
    var label = document.createElement("label");
    label.textContent = "金额（100 的倍数）";
    var input = document.createElement("input");
    input.type = "number";
    input.min = "100";
    input.step = "100";
    input.value = String(Math.min(500, request.balance || request.principal + request.interest || 0));
    label.appendChild(input);
    wrap.appendChild(label);
    return new Promise(function (resolve) {
      currentModalResolve = resolve;
      elements["modal-icon"].textContent = "¥";
      elements["modal-kicker"].textContent = "世界银行";
      elements["modal-title"].textContent = "存取快乐币";
      elements["modal-body"].textContent = "";
      var info = document.createElement("p");
      info.textContent = "现金 " + money(request.balance) + " · 本金 " + money(request.principal) + " · 利息 " + money(request.interest);
      elements["modal-body"].append(info, wrap);
      elements["modal-actions"].textContent = "";
      [
        { label: "存入", action: "deposit" },
        { label: "取出", action: "withdraw", variant: "secondary" },
        { label: "暂不操作", action: "none", variant: "secondary" }
      ].forEach(function (choice) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = choice.label;
        if (choice.variant) button.dataset.variant = choice.variant;
        button.addEventListener("click", function () {
          closeModal({ action: choice.action, amount: choice.action === "none" ? 0 : Math.max(0, Math.floor(Number(input.value) / 100) * 100) });
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
        ["陪玩", record.careMode ? "开启" : "关闭"],
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
    return { difficulty: difficulty ? difficulty.value : "normal", careMode: elements["care-mode-toggle"].checked };
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
    engine.newGame({ seed: Date.now(), playerName: "伊敏", difficulty: setup.difficulty, careMode: setup.careMode });
    uiLog = [];
    lastDialogueTurnByPlayer = {};
    elements["start-screen"].hidden = true;
    addLog("伊敏和三位伙伴出发啦", "positive", "yimin");
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
    while (engine && !engine.isGameOver() && !currentPlayer(engine.getState()).isHuman && safety < 12) {
      busy = true;
      render(engine.getState());
      await wait(fastMode ? 90 : 340);
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

  function setupTabs() {
    var tabs = [
      { button: elements["tab-events"], panel: elements["event-log"] },
      { button: elements["tab-cards"], panel: elements["card-panel"] },
      { button: elements["tab-assets"], panel: elements["asset-panel"] }
    ];
    tabs.forEach(function (tab) {
      tab.button.addEventListener("click", function () {
        tabs.forEach(function (candidate) {
          var active = candidate === tab;
          candidate.button.classList.toggle("is-active", active);
          candidate.button.setAttribute("aria-selected", String(active));
          candidate.panel.classList.toggle("is-active", active);
          candidate.panel.hidden = !active;
        });
      });
    });
  }

  function bindEvents() {
    elements["new-game-button"].addEventListener("click", startNewGame);
    elements["continue-game-button"].addEventListener("click", continueGame);
    elements["history-button"].addEventListener("click", showMatchHistory);
    elements["roll-button"].addEventListener("click", playHumanTurn);
    elements["speed-toggle"].addEventListener("change", function () { fastMode = this.checked; savePreferences(); });
    elements["sound-toggle"].addEventListener("click", function () {
      soundEnabled = !soundEnabled;
      this.setAttribute("aria-pressed", String(!soundEnabled));
      this.setAttribute("aria-label", soundEnabled ? "关闭声音" : "开启声音");
      this.querySelector("span").textContent = soundEnabled ? "♪" : "×";
      savePreferences();
    });
    elements["restart-button"].addEventListener("click", async function () {
      var restart = await modalChoice({ icon: "↻", title: "重新开始这局？", body: "当前进度会被新的冒险覆盖。", actions: [
        { label: "重新开始", value: true, variant: "danger" }, { label: "继续当前游戏", value: false, variant: "secondary" }
      ] });
      if (restart) startNewGame();
    });
    elements["modal-close"].addEventListener("click", function () { closeModal(undefined); });
    elements["panel-toggle"].addEventListener("click", function () {
      var open = !elements["side-panel"].classList.contains("is-open");
      elements["side-panel"].classList.toggle("is-open", open);
      this.setAttribute("aria-expanded", String(open));
      var label = this.querySelector(".visually-hidden");
      if (label) label.textContent = open ? "收起游戏信息" : "展开游戏信息";
    });
    document.addEventListener("keydown", function (event) {
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
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ fastMode: fastMode, soundEnabled: soundEnabled })); } catch (_) { /* optional */ }
  }

  function loadPreferences() {
    try {
      var prefs = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      fastMode = Boolean(prefs.fastMode);
      soundEnabled = prefs.soundEnabled !== false;
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
