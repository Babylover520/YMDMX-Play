(function (root) {
  "use strict";

  if (!root.GAME_DATA) {
    throw new Error("game-data.js must be loaded before game-engine.js");
  }

  var DATA = root.GAME_DATA;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function asInt(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : fallback;
  }

  function roundMoney(value) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function toSeed(value) {
    var seed = asInt(value, 0) >>> 0;
    return seed || 0x6d2b79f5;
  }

  function YiminGameEngine(options) {
    options = options || {};
    this._hasEmitHook = typeof options.hooks?.emit === "function";
    this._hasChooseHook = typeof options.hooks?.choose === "function";
    this._hasDelayHook = typeof options.hooks?.delay === "function";
    this.hooks = {
      emit: this._hasEmitHook ? options.hooks.emit : async function () {},
      choose: this._hasChooseHook ? options.hooks.choose : async function () { return undefined; },
      delay: this._hasDelayHook ? options.hooks.delay : async function () {}
    };
    this._externalRng = typeof options.rng === "function" ? options.rng : null;
    this._initialSeed = toSeed(options.seed == null ? 20260806 : options.seed);
    this._rngState = this._initialSeed;
    this._busy = false;
    this._turnContext = null;
    this.newGame({
      seed: this._initialSeed,
      playerName: options.playerName,
      playerNames: options.playerNames,
      difficulty: options.difficulty,
      careMode: options.careMode
    });
  }

  YiminGameEngine.prototype.setHooks = function (hooks) {
    hooks = hooks || {};
    if (typeof hooks.emit === "function") { this.hooks.emit = hooks.emit; this._hasEmitHook = true; }
    if (typeof hooks.choose === "function") { this.hooks.choose = hooks.choose; this._hasChooseHook = true; }
    if (typeof hooks.delay === "function") { this.hooks.delay = hooks.delay; this._hasDelayHook = true; }
    return this;
  };

  YiminGameEngine.prototype.newGame = function (options) {
    options = options || {};
    this._initialSeed = toSeed(options.seed == null ? this._initialSeed : options.seed);
    this._rngState = this._initialSeed;
    this._busy = false;
    this._turnContext = null;

    var board = DATA.board.map(function (tile) {
      var next = clone(tile);
      if (next.type === "property") {
        next.ownerId = null;
        next.level = 1;
        next.totalInvested = 0;
        next.currentTurnover = 0;
        next.inspectionTurnover = 0;
        next.lifetimeTurnover = 0;
      }
      return next;
    });

    var suppliedNames = options.playerNames || {};
    var humanName = String(options.playerName || (Array.isArray(suppliedNames) ? suppliedNames[0] : suppliedNames.yimin) || "伊敏").trim().slice(0, 12) || "伊敏";
    var players = DATA.players.map(function (preset, index) {
      var suppliedName = Array.isArray(suppliedNames) ? suppliedNames[index] : suppliedNames[preset.id];
      var playerName = String(index === 0 ? humanName : suppliedName || preset.name).trim().slice(0, 12) || preset.name;
      return {
        id: preset.id,
        name: playerName,
        isHuman: preset.isHuman,
        persona: preset.persona,
        color: preset.color,
        avatar: preset.avatar,
        money: DATA.config.initialMoney,
        bankPrincipal: 0,
        bankPendingPrincipal: 0,
        bankInterest: 0,
        bankInterestEarned: 0,
        bankVisitId: 0,
        bankActionVisitId: -1,
        position: 0,
        positionEntrySequence: 0,
        collisionCount: 0,
        collisionPaidInCycle: false,
        hand: [],
        bankrupt: false,
        eliminatedAt: null,
        normalTurns: 0,
        bonusTurns: 0,
        statuses: {
          skipTurns: 0,
          forcedConsumption: 0,
          deliveryOrder: false
        },
        stats: {
          laps: 0,
          cardsDrawn: 0,
          cardsUsed: 0,
          propertiesBought: 0,
          upgrades: 0,
          consumptionPaid: 0,
          consumptionIncome: 0,
          businessIncome: 0,
          systemIncome: 0,
          penaltiesPaid: 0,
          negativeEvents: 0,
          collisions: 0,
          collisionCompensations: 0,
          propertyRevenueCollected: 0,
          inspectionFeesPaid: 0,
          pressurePaid: 0,
          cardDrawsById: {}
        }
      };
    });

    this.state = {
      version: DATA.version,
      id: "yimin-v1-" + this._initialSeed,
      mode: "companion",
      settings: {
        difficulty: options.difficulty || "normal",
        careMode: options.careMode !== false
      },
      seed: this._initialSeed,
      rngState: this._rngState,
      board: board,
      players: players,
      currentPlayerIndex: 0,
      regularNextPlayerIndex: 1,
      turnKind: "normal",
      globalTurn: 0,
      maxTurns: null,
      phase: "ready",
      ended: false,
      endReason: null,
      winnerId: null,
      bonusQueue: [],
      bonusTurnsGranted: 0,
      eventSequence: 0,
      landingSequence: 0,
      bankVisitSequence: 0,
      log: [],
      companion: {
        rescueUsed: false,
        waterGivenBy: [],
        yiminNegativeRoundStreak: 0,
        yiminHadNegativeThisRound: false
      },
      economyPressure: {
        round: 1,
        activePlayerCount: DATA.config.playerCount,
        baseFee: 0,
        currentFee: 0,
        nextRoundFee: 0
      }
    };
    this._syncPressureState(1, DATA.config.playerCount);
    return this.getState();
  };

  YiminGameEngine.prototype.getState = function () {
    return clone(this.state);
  };

  YiminGameEngine.prototype.getCurrentPlayer = function () {
    return this.state ? clone(this.state.players[this.state.currentPlayerIndex]) : null;
  };

  YiminGameEngine.prototype.getPlayer = function (playerId) {
    var player = this._player(playerId);
    return player ? clone(player) : null;
  };

  YiminGameEngine.prototype.isGameOver = function () {
    return Boolean(this.state && this.state.ended);
  };

  YiminGameEngine.prototype.serialize = function () {
    if (!this.state) throw new Error("No game to save");
    this.state.rngState = this._rngState >>> 0;
    return JSON.stringify(this.state);
  };

  YiminGameEngine.prototype.load = function (serialized) {
    if (this._busy) throw new Error("Cannot load while a turn is resolving");
    var parsed = typeof serialized === "string" ? JSON.parse(serialized) : clone(serialized);
    if (!parsed || parsed.version !== DATA.version) throw new Error("Unsupported save version");
    if (!Array.isArray(parsed.board) || parsed.board.length !== DATA.config.boardSize) throw new Error("Invalid board in save");
    if (!Array.isArray(parsed.players) || parsed.players.length !== DATA.config.playerCount) throw new Error("Invalid players in save");
    parsed.settings = parsed.settings || {};
    delete parsed.settings.turnsPerPlayer;
    parsed.maxTurns = null;
    parsed.economyPressure = parsed.economyPressure || {};
    var activeOnLoad = parsed.players.filter(function (player) { return !player.bankrupt; });
    var resumeFromOldTurnLimit = parsed.endReason === "turnLimit" && parsed.ended && activeOnLoad.length > 1;
    if (activeOnLoad.length > 1 && parsed.ended) {
      parsed.ended = false;
      parsed.endReason = null;
      parsed.winnerId = null;
      parsed.phase = "ready";
      if (resumeFromOldTurnLimit) {
        var resumeBonusId = null;
        while (parsed.bonusQueue && parsed.bonusQueue.length && !resumeBonusId) {
          var queuedId = parsed.bonusQueue.shift();
          if (parsed.players.some(function (player) { return player.id === queuedId && !player.bankrupt; })) resumeBonusId = queuedId;
        }
        if (resumeBonusId) {
          parsed.currentPlayerIndex = parsed.players.findIndex(function (player) { return player.id === resumeBonusId; });
          parsed.turnKind = "bonus";
        } else {
          var resumeIndex = asInt(parsed.regularNextPlayerIndex, (parsed.currentPlayerIndex + 1) % parsed.players.length);
          parsed.currentPlayerIndex = ((resumeIndex % parsed.players.length) + parsed.players.length) % parsed.players.length;
          parsed.turnKind = "normal";
        }
      }
    } else if (activeOnLoad.length > 1 && parsed.endReason === "turnLimit") {
      parsed.endReason = null;
      parsed.winnerId = null;
      parsed.phase = "ready";
    } else if (activeOnLoad.length <= 1) {
      parsed.ended = true;
      parsed.endReason = "lastPlayer";
      parsed.winnerId = activeOnLoad.length === 1 ? activeOnLoad[0].id : null;
      parsed.phase = "ended";
    }
    parsed.players.forEach(function (player) {
      player.money = Math.max(0, asInt(player.money, 0));
      player.bankPrincipal = Math.max(0, asInt(player.bankPrincipal, 0));
      player.bankPendingPrincipal = Math.max(0, asInt(player.bankPendingPrincipal, 0));
      player.bankInterest = Math.max(0, asInt(player.bankInterest, 0));
      player.bankInterestEarned = Math.max(0, asInt(player.bankInterestEarned, 0));
      player.bankVisitId = Math.max(0, asInt(player.bankVisitId, 0));
      player.bankActionVisitId = asInt(player.bankActionVisitId, -1);
      player.positionEntrySequence = Math.max(0, asInt(player.positionEntrySequence, 0));
      player.collisionCount = Math.max(0, asInt(player.collisionCount, 0));
      player.collisionPaidInCycle = Boolean(player.collisionPaidInCycle);
      player.statuses = player.statuses || {};
      player.statuses.skipTurns = Math.max(0, asInt(player.statuses.skipTurns, 0));
      player.statuses.forcedConsumption = Math.max(0, asInt(player.statuses.forcedConsumption, 0));
      player.statuses.deliveryOrder = Boolean(player.statuses.deliveryOrder);
      player.hand = Array.isArray(player.hand) ? player.hand.filter(function (cardId) { return Boolean(DATA.cards[cardId]); }) : [];
      player.stats = player.stats || {};
      player.stats.cardDrawsById = player.stats.cardDrawsById || {};
    });
    parsed.board.forEach(function (tile) {
      if (tile.type !== "property") return;
      tile.level = clamp(asInt(tile.level, 1), 1, 4);
      tile.totalInvested = Math.max(0, asInt(tile.totalInvested, 0));
      tile.currentTurnover = Math.max(0, asInt(tile.currentTurnover, 0));
      tile.inspectionTurnover = Math.max(0, asInt(tile.inspectionTurnover, 0));
      tile.lifetimeTurnover = Math.max(0, asInt(tile.lifetimeTurnover, 0));
      var property = DATA.properties[tile.propertyId];
      if (property) {
        tile.name = property.levelNames[tile.level - 1];
        tile.shortLabel = tile.name;
      }
    });
    parsed.landingSequence = Math.max(asInt(parsed.landingSequence, 0), parsed.players.reduce(function (max, player) { return Math.max(max, player.positionEntrySequence); }, 0));
    parsed.bankVisitSequence = Math.max(asInt(parsed.bankVisitSequence, 0), parsed.players.reduce(function (max, player) { return Math.max(max, player.bankVisitId); }, 0));
    this.state = parsed;
    this._rngState = toSeed(parsed.rngState || parsed.seed);
    this.state.rngState = this._rngState;
    this._syncPressureState(this._getTableRound(), activeOnLoad.length);
    this._turnContext = null;
    return this.getState();
  };

  YiminGameEngine.prototype.getNetWorth = function (playerOrId) {
    var player = typeof playerOrId === "object" ? playerOrId : this._player(playerOrId);
    if (!player) return 0;
    var propertyValue = this.state.board.reduce(function (sum, tile) {
      if (tile.type !== "property" || tile.ownerId !== player.id) return sum;
      return sum + roundMoney(tile.totalInvested * DATA.config.propertySaleRate) + roundMoney((tile.currentTurnover || 0) * 0.5);
    }, 0);
    return Math.max(0, player.money + player.bankPrincipal + player.bankInterest + propertyValue);
  };

  YiminGameEngine.prototype.getRanking = function () {
    var self = this;
    return this.state.players.map(function (player, index) {
      return {
        playerId: player.id,
        name: player.name,
        isHuman: player.isHuman,
        bankrupt: player.bankrupt,
        netWorth: self.getNetWorth(player),
        money: player.money,
        propertyCount: self.state.board.filter(function (tile) { return tile.ownerId === player.id; }).length,
        originalIndex: index
      };
    }).sort(function (a, b) {
      if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
      if (b.netWorth !== a.netWorth) return b.netWorth - a.netWorth;
      return a.originalIndex - b.originalIndex;
    }).map(function (entry, index) {
      entry.rank = index + 1;
      entry.title = index === 0 ? "快乐大富翁" : index === 1 ? "经营小能手" : index === 2 ? "好运收藏家" : "松弛感选手";
      delete entry.originalIndex;
      return entry;
    });
  };

  YiminGameEngine.prototype.getAvailableActions = function () {
    if (!this.state || this.state.ended) return { canPlayTurn: false, playableCards: [] };
    var player = this.state.players[this.state.currentPlayerIndex];
    var playableCards = player.hand.filter(function (cardId) {
      var card = DATA.cards[cardId];
      return card && card.timing === "turn";
    });
    return {
      canPlayTurn: !this._busy && !player.bankrupt,
      canRoll: !this._busy && !player.bankrupt && player.statuses.skipTurns === 0,
      playableCards: playableCards,
      canBuy: this._canBuyProperty(player, this.state.board[player.position]),
      canUpgrade: this._canUpgradeProperty(player, this.state.board[player.position]),
      sellableProperties: this.state.board.filter(function (tile) { return tile.ownerId === player.id && tile.index === player.position; }).map(function (tile) { return tile.id; }),
      phase: this.state.phase,
      playerId: player.id,
      turnKind: this.state.turnKind
    };
  };

  YiminGameEngine.prototype._player = function (playerId) {
    if (!this.state) return null;
    return this.state.players.find(function (player) { return player.id === playerId; }) || null;
  };

  YiminGameEngine.prototype._random = function () {
    var value;
    if (this._externalRng) {
      value = Number(this._externalRng());
      if (!Number.isFinite(value)) value = 0;
      value = value - Math.floor(value);
    } else {
      var x = this._rngState >>> 0;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this._rngState = x >>> 0;
      this.state.rngState = this._rngState;
      value = this._rngState / 4294967296;
    }
    return clamp(value, 0, 0.9999999999999999);
  };

  YiminGameEngine.prototype._randomInt = function (min, max) {
    return min + Math.floor(this._random() * (max - min + 1));
  };

  YiminGameEngine.prototype._pick = function (items) {
    return items[this._randomInt(0, items.length - 1)];
  };

  YiminGameEngine.prototype._record = function (event) {
    var entry = Object.assign({
      id: ++this.state.eventSequence,
      globalTurn: this.state.globalTurn,
      turnKind: this.state.turnKind
    }, event);
    this.state.log.push(entry);
    if (this.state.log.length > DATA.config.logLimit) this.state.log.splice(0, this.state.log.length - DATA.config.logLimit);
    return entry;
  };

  YiminGameEngine.prototype._emit = async function (event) {
    var entry = this._record(event);
    if (!this._hasEmitHook) return entry;
    try {
      await this.hooks.emit(clone(entry), this.getState());
    } catch (error) {
      this._record({ type: "hookError", hook: "emit", message: String(error && error.message || error) });
    }
    return entry;
  };

  YiminGameEngine.prototype._choose = async function (request, fallback) {
    await this._emit({ type: "choiceRequested", request: clone(request), playerId: request.playerId || null });
    if (!this._hasChooseHook) return fallback;
    try {
      var response = await this.hooks.choose(clone(request), this.getState());
      return response === undefined || response === null ? fallback : response;
    } catch (error) {
      this._record({ type: "hookError", hook: "choose", message: String(error && error.message || error) });
      return fallback;
    }
  };

  YiminGameEngine.prototype._delay = async function (kind, payload) {
    if (!this._hasDelayHook) return;
    try {
      await this.hooks.delay(kind, clone(payload || {}), this.getState());
    } catch (error) {
      this._record({ type: "hookError", hook: "delay", message: String(error && error.message || error) });
    }
  };

  YiminGameEngine.prototype._roll = async function (player, reason) {
    var value = this._randomInt(1, 6);
    await this._emit({ type: "diceRolled", playerId: player.id, value: value, reason: reason || "move" });
    return value;
  };

  YiminGameEngine.prototype.playTurn = async function () {
    if (!this.state || this.state.ended) return this.getState();
    if (this._busy) throw new Error("A turn is already resolving");
    this._busy = true;
    var player = this.state.players[this.state.currentPlayerIndex];
    if (this.state.turnKind === "normal") this.state.bonusTurnsGranted = 0;
    this._turnContext = {
      playerId: player.id,
      movementChains: 0,
      luckChainActive: false,
      playerWasBankruptAtStart: player.bankrupt,
      bankruptcyOccurred: false
    };

    try {
      this.state.phase = "turnStart";
      await this._emit({
        type: "turnStarted",
        playerId: player.id,
        playerName: player.name,
        turnNumber: this.state.globalTurn + 1,
        turnKind: this.state.turnKind
      });

      if (player.bankrupt) {
        await this._emit({ type: "bankruptTurnSkipped", playerId: player.id });
        await this._finishTurn(player);
        return this.getState();
      }

      if (player.statuses.skipTurns > 0) {
        await this._tryCancelSkip(player);
        if (player.statuses.skipTurns > 0) {
          player.statuses.skipTurns = Math.max(0, player.statuses.skipTurns - 1);
          await this._emit({ type: "turnSkipped", playerId: player.id, remaining: player.statuses.skipTurns });
          await this._finishTurn(player);
          return this.getState();
        }
      }

      this.state.phase = "beforeRoll";
      var roll = await this._roll(player, "move");
      await this._movePlayer(player, roll, "dice");

      await this._finishTurn(player);
      return this.getState();
    } catch (error) {
      this.state.phase = this.state.ended ? "ended" : "ready";
      await this._emit({ type: "error", playerId: player.id, message: String(error && error.message || error) });
      throw error;
    } finally {
      this._busy = false;
      this._turnContext = null;
    }
  };

  YiminGameEngine.prototype.rollAndMove = function () {
    return this.playTurn();
  };

  YiminGameEngine.prototype.runAiTurns = async function (limit) {
    var max = clamp(asInt(limit, 12), 1, 60);
    var count = 0;
    while (!this.state.ended && count < max) {
      var player = this.state.players[this.state.currentPlayerIndex];
      if (player.isHuman && !player.bankrupt) break;
      await this.playTurn();
      count += 1;
    }
    return this.getState();
  };

  YiminGameEngine.prototype._tryCancelSkip = async function (player) {
    var used = 0;
    while (player.statuses.skipTurns > 0) {
      var index = player.hand.indexOf("fullHealth");
      if (index < 0) break;
      player.hand.splice(index, 1);
      player.stats.cardsUsed += 1;
      player.statuses.skipTurns -= 1;
      used += 1;
      await this._emit({ type: "cardUsed", playerId: player.id, cardId: "fullHealth", effect: "cancelSkip", remainingPauses: player.statuses.skipTurns, automatic: true });
    }
    return used;
  };

  YiminGameEngine.prototype._finishTurn = async function (player) {
    var activeBeforePressure = this.state.players.filter(function (candidate) { return !candidate.bankrupt; });
    var tableRound = this._getTableRound();
    if (this.state.turnKind === "normal" && activeBeforePressure.length > 1 && !player.bankrupt) {
      await this._applyInsolvencyPressure(player, tableRound, activeBeforePressure.length);
    }

    await this._emit({ type: "turnEnded", playerId: player.id, turnKind: this.state.turnKind });

    if (this.state.turnKind === "normal") {
      player.normalTurns += 1;
      this.state.globalTurn += 1;
      this.state.regularNextPlayerIndex = (this.state.currentPlayerIndex + 1) % this.state.players.length;
      if (this.state.globalTurn % this.state.players.length === 0) {
        this._completeRound();
        await this._advanceInsolvencyPressure();
      }
    } else {
      player.bonusTurns += 1;
    }

    var active = this.state.players.filter(function (candidate) { return !candidate.bankrupt; });
    if (active.length <= 1) {
      await this._endGame("lastPlayer");
      return;
    }

    var bonusId = null;
    while (this.state.bonusQueue.length && !bonusId) {
      var queued = this.state.bonusQueue.shift();
      var queuedPlayer = this._player(queued);
      if (queuedPlayer && !queuedPlayer.bankrupt) bonusId = queued;
    }
    if (bonusId) {
      this.state.currentPlayerIndex = this.state.players.findIndex(function (candidate) { return candidate.id === bonusId; });
      this.state.turnKind = "bonus";
    } else {
      this.state.currentPlayerIndex = this.state.regularNextPlayerIndex;
      this.state.turnKind = "normal";
    }
    this.state.phase = "ready";
  };

  YiminGameEngine.prototype._completeRound = function () {
    if (this.state.companion.yiminHadNegativeThisRound) {
      this.state.companion.yiminNegativeRoundStreak += 1;
    } else {
      this.state.companion.yiminNegativeRoundStreak = 0;
    }
    this.state.companion.yiminHadNegativeThisRound = false;
  };

  YiminGameEngine.prototype._advanceInsolvencyPressure = async function () {
    var activeCount = this.state.players.filter(function (player) { return !player.bankrupt; }).length;
    var round = this._getTableRound();
    var pressure = this._syncPressureState(round, activeCount);
    if (!pressure.currentFee && !pressure.nextRoundFee) return;
    await this._emit({
      type: "maintenanceFeeIncreased",
      round: round,
      baseFee: pressure.baseFee,
      currentFee: pressure.currentFee,
      nextFee: pressure.nextRoundFee,
      activePlayerCount: activeCount
    });
  };

  YiminGameEngine.prototype._getTableRound = function () {
    return Math.floor(this.state.globalTurn / DATA.config.playerCount) + 1;
  };

  YiminGameEngine.prototype._getLifePressure = function (round, activePlayerCount) {
    round = Math.max(1, asInt(round, 1));
    activePlayerCount = Math.max(1, asInt(activePlayerCount, DATA.config.playerCount));
    var bands = DATA.config.terminalPressureBands;
    var baseFee = 0;
    for (var i = 0; i < bands.length; i += 1) {
      var band = bands[i];
      if (round >= band.minRound && (band.maxRound == null || round <= band.maxRound)) {
        baseFee = band.base + band.step * (round - band.minRound);
        break;
      }
    }
    var multiplier = DATA.config.terminalPressureMultipliers[activePlayerCount] || 0;
    return { round: round, activePlayerCount: activePlayerCount, baseFee: baseFee, multiplier: multiplier, amount: roundMoney(baseFee * multiplier) };
  };

  YiminGameEngine.prototype._syncPressureState = function (round, activePlayerCount) {
    var current = this._getLifePressure(round, activePlayerCount);
    var next = this._getLifePressure(round + 1, activePlayerCount);
    this.state.economyPressure = {
      round: round,
      activePlayerCount: activePlayerCount,
      baseFee: current.baseFee,
      multiplier: current.multiplier,
      currentFee: current.amount,
      nextRoundFee: next.amount
    };
    return this.state.economyPressure;
  };

  YiminGameEngine.prototype._applyInsolvencyPressure = async function (player, round, activePlayerCount) {
    var pressure = this._syncPressureState(round, activePlayerCount);
    var amount = pressure.currentFee;
    if (!amount || player.bankrupt) return { paid: 0, waived: false };
    await this._emit({ type: "maintenanceFeeCharged", playerId: player.id, round: round, baseFee: pressure.baseFee, multiplier: pressure.multiplier, amount: amount });
    var result = await this._applySystemPenalty(player, amount, "lifePressure", { allowReaction: true });
    player.stats.pressurePaid = (player.stats.pressurePaid || 0) + result.paid;
    return result;
  };

  YiminGameEngine.prototype._queueBonusTurn = async function (playerId, source) {
    if (this.state.bonusTurnsGranted >= DATA.config.actionChainCap) {
      await this._emit({ type: "chainCapped", source: source || "bonusTurn", playerId: playerId });
      return false;
    }
    this.state.bonusQueue.push(playerId);
    this.state.bonusTurnsGranted += 1;
    await this._emit({ type: "bonusTurnGranted", playerId: playerId, source: source || "gameMoment" });
    return true;
  };

  YiminGameEngine.prototype._endGame = async function (reason) {
    if (this.state.ended) return;
    var active = this.state.players.filter(function (player) { return !player.bankrupt; });
    if (active.length > 1) {
      await this._emit({ type: "gameEndRejected", reason: reason || "manual", activePlayerCount: active.length });
      return false;
    }
    this.state.ended = true;
    this.state.endReason = "lastPlayer";
    this.state.phase = "ended";
    var ranking = this.getRanking();
    this.state.winnerId = ranking.length ? ranking[0].playerId : null;
    await this._emit({ type: "gameEnded", reason: this.state.endReason, winnerId: this.state.winnerId, ranking: ranking });
    return true;
  };

  YiminGameEngine.prototype.endGame = async function (reason) {
    await this._endGame(reason || "manual");
    return this.getState();
  };

  YiminGameEngine.prototype._movePlayer = async function (player, steps, reason, options) {
    options = options || {};
    if (!steps || player.bankrupt) return;
    if (!this._turnContext) {
      this._turnContext = { playerId: player.id, movementChains: 0, luckChainActive: false, bankruptcyOccurred: false };
    }
    if (this._turnContext.movementChains >= DATA.config.actionChainCap) {
      await this._emit({ type: "chainCapped", playerId: player.id, source: reason || "movement" });
      return;
    }
    this._turnContext.movementChains += 1;
    var direction = steps >= 0 ? 1 : -1;
    var distance = Math.abs(asInt(steps, 0));
    var resolvedTileIds = {};
    this.state.phase = "moving";

    for (var i = 0; i < distance && !player.bankrupt; i += 1) {
      var from = player.position;
      var to = (from + direction + DATA.config.boardSize) % DATA.config.boardSize;
      player.position = to;
      var tile = this.state.board[to];
      await this._emit({
        type: "moveStep",
        playerId: player.id,
        from: from,
        to: to,
        tileId: tile.id,
        direction: direction,
        reason: reason || "move",
        step: i + 1,
        totalSteps: distance
      });
      await this._delay("moveStep", { playerId: player.id, from: from, to: to });
      if (!resolvedTileIds[tile.id]) {
        resolvedTileIds[tile.id] = true;
        await this._resolvePassedTile(player, tile, direction, reason, i === distance - 1);
      }
    }

    if (!player.bankrupt) {
      var collisionWasSuppressed = Boolean(this._turnContext.collisionSuppressed);
      if (options.skipCollision) this._turnContext.collisionSuppressed = true;
      var landedTile = this.state.board[player.position];
      player.positionEntrySequence = ++this.state.landingSequence;
      await this._emit({ type: "playerLanded", playerId: player.id, tileId: landedTile.id, tileType: landedTile.type, entrySequence: player.positionEntrySequence });
      await this._resolveLanding(player, landedTile);
      if (!this._turnContext.collisionSuppressed && !player.bankrupt && player.position === landedTile.index) await this._resolveCollision(player, landedTile);
      this._turnContext.collisionSuppressed = collisionWasSuppressed;
    }
  };

  YiminGameEngine.prototype._resolvePassedTile = async function (player, tile, direction, reason, isLandingStep) {
    await this._emit({ type: "tilePassed", playerId: player.id, tileId: tile.id, tileType: tile.type, reason: reason || "move" });
    if (tile.type === "start" && direction > 0) {
      player.stats.laps += 1;
      await this._emit({ type: "startPassed", playerId: player.id, amount: 0, rewarded: false, isLandingStep: Boolean(isLandingStep) });
    }
    if (tile.type === "property" && !isLandingStep) {
      await this._emit({ type: "otherPropertyPassed", playerId: player.id, ownerId: tile.ownerId || null, tileId: tile.id, triggered: false });
    }
  };

  YiminGameEngine.prototype._resolveLanding = async function (player, tile) {
    if (player.bankrupt) return;
    this.state.phase = "resolvingTile";
    await this._emit({ type: "tileResolved", playerId: player.id, tileId: tile.id, tileType: tile.type, name: tile.name });
    switch (tile.type) {
      case "start":
        await this._gainMoney(player, DATA.config.startReward, "startReward");
        await this._emit({ type: "startLanded", playerId: player.id, tileId: tile.id, amount: DATA.config.startReward });
        break;
      case "property":
        await this._resolvePropertyLanding(player, tile);
        break;
      case "safe":
        await this._resolveSafe(player, tile);
        break;
      case "bank":
        await this._resolveBankLanding(player, tile);
        break;
      case "life":
        await this._resolveLifeEvent(player, tile);
        break;
      case "cityInspection":
        await this._resolveCityInspection(player, tile);
        break;
      case "review":
        await this._resolveReview(player, tile);
        break;
      case "adventure":
        await this._resolveAdventure(player, tile);
        break;
      case "delivery":
        player.statuses.deliveryOrder = true;
        await this._emit({ type: "deliveryOrderReceived", playerId: player.id, tileId: tile.id });
        break;
      case "fate":
        await this.drawCard(player.id, "fate");
        await this._addSkip(player, 1, "fate");
        break;
      case "gameMoment":
        await this._resolveGameMoment(player, tile);
        break;
      case "jail":
        await this._addSkip(player, 1, "jail");
        break;
      case "idle":
        await this._emit({ type: "idleMoment", playerId: player.id, tileId: tile.id });
        break;
      default:
        break;
    }
  };

  YiminGameEngine.prototype._gainMoney = async function (player, amount, reason) {
    amount = Math.max(0, asInt(amount, 0));
    if (!amount || player.bankrupt) return 0;
    player.money += amount;
    if (String(reason).indexOf("business") < 0 && String(reason).indexOf("consumption") < 0) {
      player.stats.systemIncome += amount;
    }
    await this._emit({ type: "moneyChanged", playerId: player.id, delta: amount, balance: player.money, reason: reason || "gain" });
    return amount;
  };

  YiminGameEngine.prototype._takeMoney = async function (player, amount, reason) {
    amount = Math.max(0, asInt(amount, 0));
    var paid = Math.min(player.money, amount);
    player.money -= paid;
    player.money = Math.max(0, player.money);
    if (paid) await this._emit({ type: "moneyChanged", playerId: player.id, delta: -paid, balance: player.money, reason: reason || "payment" });
    return paid;
  };

  YiminGameEngine.prototype._ownedProperties = function (playerId) {
    return this.state.board.filter(function (tile) { return tile.type === "property" && tile.ownerId === playerId; });
  };

  YiminGameEngine.prototype._canBuyProperty = function (player, tile) {
    if (!player || player.bankrupt || !tile || tile.type !== "property" || tile.ownerId) return false;
    return player.money >= this._propertyEconomy(tile).buyPrice;
  };

  YiminGameEngine.prototype._canUpgradeProperty = function (player, tile) {
    if (!player || player.bankrupt || !tile || tile.type !== "property" || tile.ownerId !== player.id || tile.level >= 4) return false;
    return player.money >= this._propertyEconomy(tile).upgradeCosts[tile.level - 1];
  };

  YiminGameEngine.prototype._propertyEconomy = function (tile) {
    var property = DATA.properties[tile.propertyId];
    return DATA.propertyTiers[property.tier];
  };

  YiminGameEngine.prototype._setPropertyLevelName = function (tile) {
    var property = DATA.properties[tile.propertyId];
    tile.name = property.levelNames[tile.level - 1];
    tile.shortLabel = tile.name;
    return tile.name;
  };

  YiminGameEngine.prototype.buyProperty = async function (tileId, playerId) {
    var player = this._player(playerId) || this.state.players[this.state.currentPlayerIndex];
    var tile = tileId ? this.state.board.find(function (candidate) { return candidate.id === tileId; }) : this.state.board[player.position];
    if (!this._canBuyProperty(player, tile) || player.position !== tile.index) return false;
    var property = DATA.properties[tile.propertyId];
    var price = this._propertyEconomy(tile).buyPrice;
    await this._takeMoney(player, price, "propertyPurchase");
    tile.ownerId = player.id;
    tile.level = 1;
    tile.totalInvested = price;
    tile.currentTurnover = 0;
    tile.inspectionTurnover = 0;
    tile.lifetimeTurnover = 0;
    this._setPropertyLevelName(tile);
    player.stats.propertiesBought += 1;
    await this._emit({ type: "propertyBought", playerId: player.id, tileId: tile.id, propertyId: tile.propertyId, propertyName: tile.name, amount: price, balance: player.money, level: 1 });
    return true;
  };

  YiminGameEngine.prototype.upgradeProperty = async function (tileId, playerId) {
    var player = this._player(playerId) || this.state.players[this.state.currentPlayerIndex];
    var tile = tileId ? this.state.board.find(function (candidate) { return candidate.id === tileId; }) : this.state.board[player.position];
    if (!this._canUpgradeProperty(player, tile) || player.position !== tile.index) return false;
    var property = DATA.properties[tile.propertyId];
    var tier = this._propertyEconomy(tile);
    var cost = tier.upgradeCosts[tile.level - 1];
    var oldName = tile.name;
    await this._takeMoney(player, cost, "propertyUpgrade");
    tile.level += 1;
    tile.totalInvested += cost;
    this._setPropertyLevelName(tile);
    player.stats.upgrades += 1;
    await this._emit({ type: "propertyUpgraded", playerId: player.id, tileId: tile.id, propertyId: tile.propertyId, oldName: oldName, newName: tile.name, amount: cost, balance: player.money, level: tile.level });
    return true;
  };

  YiminGameEngine.prototype.sellProperty = async function (tileId, playerId, reason) {
    var player = this._player(playerId) || this.state.players[this.state.currentPlayerIndex];
    var tile = this.state.board.find(function (candidate) { return candidate.id === tileId; });
    if (!tile || tile.type !== "property" || tile.ownerId !== player.id) return 0;
    if (reason !== "forcedSale" && player.position !== tile.index) {
      await this._emit({ type: "propertySaleRejected", playerId: player.id, tileId: tile.id, reason: "notLanded" });
      return 0;
    }
    if (tile.currentTurnover > 0) await this._collectPropertyRevenue(player, tile, reason === "forcedSale" ? "emergencySale" : "propertySale");
    var value = roundMoney(tile.totalInvested * DATA.config.propertySaleRate);
    var propertyName = tile.name;
    tile.ownerId = null;
    tile.level = 1;
    tile.totalInvested = 0;
    tile.currentTurnover = 0;
    tile.inspectionTurnover = 0;
    tile.lifetimeTurnover = 0;
    this._setPropertyLevelName(tile);
    await this._gainMoney(player, value, reason || "propertySale");
    await this._emit({ type: "propertySold", playerId: player.id, tileId: tile.id, propertyId: tile.propertyId, propertyName: propertyName, amount: value, balance: player.money, reason: reason || "voluntary" });
    return value;
  };

  YiminGameEngine.prototype._collectPropertyRevenue = async function (player, tile, source) {
    var gross = Math.max(0, asInt(tile.currentTurnover, 0));
    var payout = roundMoney(gross * 0.5);
    var operatingCost = Math.max(0, gross - payout);
    tile.currentTurnover = 0;
    if (payout) {
      await this._gainMoney(player, payout, "businessRevenue");
      player.stats.businessIncome += payout;
      player.stats.propertyRevenueCollected = (player.stats.propertyRevenueCollected || 0) + payout;
    }
    await this._emit({
      type: "businessRevenue",
      playerId: player.id,
      tileId: tile.id,
      propertyId: tile.propertyId,
      propertyName: tile.name,
      grossTurnover: gross,
      operatingCost: operatingCost,
      amount: payout,
      currentTurnover: 0,
      source: source || "ownerLanding",
      level: tile.level
    });
    return payout;
  };

  YiminGameEngine.prototype._propertyConsumptionProbability = function () {
    var round = this._getTableRound();
    if (round <= 20) return 1 / 3;
    if (round <= 40) return 1 / 2;
    if (round <= 60) return 2 / 3;
    return 1;
  };

  YiminGameEngine.prototype._propertyFlavor = function (property, tile, amount) {
    var item = "小东西";
    if (property.items && property.items.length) item = property.items[(tile.index + tile.lifetimeTurnover) % property.items.length];
    return property.flavor.replace("{item}", item).replace("{amount}", String(amount));
  };

  YiminGameEngine.prototype._resolvePropertyLanding = async function (player, tile) {
    var completedDelivery = false;
    if (player.statuses.deliveryOrder) {
      await this._completeDelivery(player, tile);
      completedDelivery = true;
    }
    if (!tile.ownerId) {
      var property = DATA.properties[tile.propertyId];
      var price = this._propertyEconomy(tile).buyPrice;
      if (player.money < price) return;
      var shouldBuy;
      if (player.isHuman) {
        var buyResponse = await this._choose({
          type: "buyProperty",
          playerId: player.id,
          tileId: tile.id,
          propertyId: tile.propertyId,
          price: price,
          balance: player.money,
          options: ["buy", "skip"]
        }, "skip");
        shouldBuy = buyResponse === true || buyResponse === "buy";
      } else {
        shouldBuy = this._aiShouldBuy(player, tile);
      }
      if (shouldBuy) await this.buyProperty(tile.id, player.id);
      return;
    }

    if (tile.ownerId === player.id) {
      await this._collectPropertyRevenue(player, tile, "ownerLanding");
      if (tile.level >= 4 || player.bankrupt) return;
      var propertyData = DATA.properties[tile.propertyId];
      var tier = this._propertyEconomy(tile);
      var cost = tier.upgradeCosts[tile.level - 1];
      if (player.money < cost) return;
      var shouldUpgrade;
      if (player.isHuman) {
        var upgradeResponse = await this._choose({
          type: "upgradeProperty",
          playerId: player.id,
          tileId: tile.id,
          propertyId: tile.propertyId,
          level: tile.level,
          nextLevel: tile.level + 1,
          price: cost,
          balance: player.money,
          options: ["upgrade", "skip"]
        }, "skip");
        shouldUpgrade = upgradeResponse === true || upgradeResponse === "upgrade";
      } else {
        shouldUpgrade = await this._aiShouldUpgrade(player, tile);
      }
      if (shouldUpgrade) await this.upgradeProperty(tile.id, player.id);
      return;
    }

    var owner = this._player(tile.ownerId);
    if (!owner || owner.bankrupt) return;
    var property = DATA.properties[tile.propertyId];

    if (completedDelivery) {
      await this._emit({ type: "consumptionWaived", playerId: player.id, ownerId: owner.id, tileId: tile.id, source: "delivery" });
      return;
    }

    var forced = player.statuses.forcedConsumption > 0;
    var probability = forced ? 1 : this._propertyConsumptionProbability();
    var probabilityRoll = forced ? null : this._random();
    var shouldConsume = forced || probabilityRoll < probability;
    await this._emit({
      type: "consumptionChecked",
      playerId: player.id,
      ownerId: owner.id,
      tileId: tile.id,
      probability: probability,
      probabilityRoll: probabilityRoll,
      round: this._getTableRound(),
      forced: forced,
      consumed: shouldConsume
    });
    if (!shouldConsume) return;

    var consumeCardIndex = player.hand.indexOf("consume");
    if (consumeCardIndex >= 0) {
      player.hand.splice(consumeCardIndex, 1);
      player.stats.cardsUsed += 1;
      await this._emit({ type: "cardUsed", playerId: player.id, cardId: "consume", effect: "shieldConsumption", tileId: tile.id, automatic: true });
      await this._emit({ type: "consumptionWaived", playerId: player.id, ownerId: owner.id, tileId: tile.id, source: "consumeCard" });
      if (forced && player.statuses.forcedConsumption > 0) player.statuses.forcedConsumption -= 1;
      return;
    }

    var tier = this._propertyEconomy(tile);
    var amount = tier.consume[tile.level - 1];
    var result = await this._mandatoryCharge(player, amount, "propertyConsumption", { kind: "propertyConsumption", countAsPenalty: false });
    if (!result.waived && result.paid > 0) {
      tile.currentTurnover += result.paid;
      tile.inspectionTurnover += result.paid;
      tile.lifetimeTurnover += result.paid;
      player.stats.consumptionPaid += result.paid;
      owner.stats.consumptionIncome += result.paid;
      await this._emit({
        type: "propertyConsumed",
        playerId: player.id,
        ownerId: owner.id,
        tileId: tile.id,
        propertyId: tile.propertyId,
        propertyName: tile.name,
        amount: result.paid,
        expectedAmount: amount,
        level: tile.level,
        currentTurnover: tile.currentTurnover,
        inspectionTurnover: tile.inspectionTurnover,
        lifetimeTurnover: tile.lifetimeTurnover,
        text: this._propertyFlavor(property, tile, result.paid)
      });
    }
    if (forced && player.statuses.forcedConsumption > 0) player.statuses.forcedConsumption -= 1;
  };

  YiminGameEngine.prototype._resolvePropertyPass = async function (player, tile, isLandingStep) {
    if (isLandingStep) await this._resolvePropertyLanding(player, tile);
    else await this._emit({ type: "otherPropertyPassed", playerId: player.id, ownerId: tile.ownerId || null, tileId: tile.id, triggered: false });
  };

  YiminGameEngine.prototype._completeDelivery = async function (player, tile) {
    player.statuses.deliveryOrder = false;
    await this._gainMoney(player, 100, "deliveryReward");
    await this._emit({ type: "deliveryCompleted", playerId: player.id, tileId: tile.id, amount: 100 });
  };

  YiminGameEngine.prototype._resolveSafe = async function (player, tile) {
    await this._gainMoney(player, DATA.config.safeMoneyReward, "safeReward");
    await this._addSkip(player, 1, "safe");
    await this._emit({ type: "safeResolved", playerId: player.id, tileId: tile.id, amount: DATA.config.safeMoneyReward, pauseRemaining: player.statuses.skipTurns });
  };

  YiminGameEngine.prototype._accrueBankInterest = async function (player, tile) {
    var available = Math.max(0, DATA.config.bankInterestCap - player.bankInterestEarned);
    var eligiblePrincipal = Math.max(0, player.bankPrincipal - player.bankPendingPrincipal);
    var interestBase = eligiblePrincipal + player.bankInterest;
    var interest = Math.min(available, roundMoney(interestBase * DATA.config.bankInterestRate));
    if (!interest) {
      await this._emit({ type: "bankInterestAccrued", playerId: player.id, tileId: tile.id, amount: 0, interestBase: interestBase, principal: player.bankPrincipal, pendingPrincipal: player.bankPendingPrincipal, interest: player.bankInterest, interestEarned: player.bankInterestEarned, interestCap: DATA.config.bankInterestCap });
      return 0;
    }
    player.bankInterest += interest;
    player.bankInterestEarned += interest;
    await this._emit({ type: "bankInterestAccrued", playerId: player.id, tileId: tile.id, amount: interest, interestBase: interestBase, principal: player.bankPrincipal, pendingPrincipal: player.bankPendingPrincipal, interest: player.bankInterest, totalInterest: player.bankInterest, interestEarned: player.bankInterestEarned, cumulativeInterest: player.bankInterestEarned, interestCap: DATA.config.bankInterestCap });
    return interest;
  };

  YiminGameEngine.prototype._bankInterestPreview = function (player) {
    var available = Math.max(0, DATA.config.bankInterestCap - player.bankInterestEarned);
    var base = Math.max(0, player.bankPrincipal - player.bankPendingPrincipal) + player.bankInterest;
    return Math.min(available, roundMoney(base * DATA.config.bankInterestRate));
  };

  YiminGameEngine.prototype._claimBankAction = function (player) {
    if (player.bankActionVisitId === player.bankVisitId) return false;
    player.bankActionVisitId = player.bankVisitId;
    return true;
  };

  YiminGameEngine.prototype.bankDeposit = async function (amount, playerId) {
    var player = this._player(playerId) || this.state.players[this.state.currentPlayerIndex];
    var tile = this.state.board[player.position];
    if (!tile || tile.type !== "bank" || player.bankrupt) return 0;
    amount = clamp(asInt(amount, 0), 0, player.money);
    if (!amount) return 0;
    if (!this._claimBankAction(player)) return 0;
    await this._takeMoney(player, amount, "bankDeposit");
    player.bankPrincipal += amount;
    player.bankPendingPrincipal += amount;
    await this._emit({ type: "bankDeposit", playerId: player.id, amount: amount, principal: player.bankPrincipal, pendingPrincipal: player.bankPendingPrincipal, balance: player.money, eligibleFromNextLanding: true });
    return amount;
  };

  YiminGameEngine.prototype.bankWithdraw = async function (amount, playerId) {
    var player = this._player(playerId) || this.state.players[this.state.currentPlayerIndex];
    var tile = this.state.board[player.position];
    if (!tile || tile.type !== "bank" || player.bankrupt) return 0;
    var available = player.bankPrincipal + player.bankInterest;
    amount = clamp(asInt(amount, available), 0, available);
    if (!amount) return 0;
    if (!this._claimBankAction(player)) return 0;
    var fromInterest = Math.min(player.bankInterest, amount);
    player.bankInterest -= fromInterest;
    var fromPrincipal = amount - fromInterest;
    player.bankPrincipal -= fromPrincipal;
    player.bankPendingPrincipal = Math.min(player.bankPendingPrincipal, player.bankPrincipal);
    await this._gainMoney(player, amount, "bankWithdraw");
    await this._emit({ type: "bankWithdraw", playerId: player.id, amount: amount, fromPrincipal: fromPrincipal, fromInterest: fromInterest, principal: player.bankPrincipal, pendingPrincipal: player.bankPendingPrincipal, interest: player.bankInterest, interestEarned: player.bankInterestEarned, balance: player.money });
    return amount;
  };

  YiminGameEngine.prototype.bankSettle = async function (playerId) {
    var player = this._player(playerId) || this.state.players[this.state.currentPlayerIndex];
    var tile = this.state.board[player.position];
    if (!tile || tile.type !== "bank" || player.bankrupt) return 0;
    if (!this._claimBankAction(player)) return 0;
    return this._accrueBankInterest(player, tile);
  };

  YiminGameEngine.prototype._resolveBankLanding = async function (player, tile) {
    var maturedPrincipal = player.bankPendingPrincipal;
    player.bankPendingPrincipal = 0;
    player.bankVisitId = ++this.state.bankVisitSequence;
    if (maturedPrincipal) await this._emit({ type: "bankPrincipalMatured", playerId: player.id, tileId: tile.id, amount: maturedPrincipal, principal: player.bankPrincipal });
    var nextInterest = this._bankInterestPreview(player);
    var response;
    if (player.isHuman) {
      response = await this._choose({
        type: "bank",
        playerId: player.id,
        tileId: tile.id,
        balance: player.money,
        principal: player.bankPrincipal,
        pendingPrincipal: player.bankPendingPrincipal,
        interest: player.bankInterest,
        interestEarned: player.bankInterestEarned,
        cumulativeInterest: player.bankInterestEarned,
        interestRate: DATA.config.bankInterestRate,
        interestCap: DATA.config.bankInterestCap,
        remainingInterestCap: Math.max(0, DATA.config.bankInterestCap - player.bankInterestEarned),
        nextInterestBase: Math.max(0, player.bankPrincipal - player.bankPendingPrincipal) + player.bankInterest,
        nextInterest: nextInterest,
        options: ["deposit", "withdraw", "settle", "none"]
      }, { action: "none", amount: 0 });
    } else if (player.money < 500 && player.bankPrincipal + player.bankInterest > 0) {
      response = { action: "withdraw", amount: Math.min(800, player.bankPrincipal + player.bankInterest) };
    } else if (nextInterest > 0) {
      response = { action: "settle", amount: 0 };
    } else if (player.money > 1800) {
      response = { action: "deposit", amount: Math.floor((player.money - 1200) / 100) * 100 };
    } else {
      response = { action: "none", amount: 0 };
    }
    if (typeof response === "string") response = { action: response, amount: 0 };
    response = response || { action: "none", amount: 0 };
    if (response.action === "deposit") await this.bankDeposit(response.amount, player.id);
    if (response.action === "withdraw") await this.bankWithdraw(response.amount, player.id);
    if (response.action === "settle") await this.bankSettle(player.id);
    if (response.action === "none") {
      player.bankActionVisitId = player.bankVisitId;
      await this._emit({ type: "bankNoAction", playerId: player.id, tileId: tile.id });
    }
  };

  YiminGameEngine.prototype._resolveCollision = async function (player, tile) {
    if (tile.type === "safe") return;
    var occupants = this.state.players.filter(function (candidate) {
      return candidate.id !== player.id && !candidate.bankrupt && candidate.position === player.position && candidate.positionEntrySequence < player.positionEntrySequence;
    });
    if (!occupants.length) return;
    occupants.sort(function (a, b) { return b.positionEntrySequence - a.positionEntrySequence; });
    var recipient = occupants[0];
    player.collisionCount += 1;
    player.stats.collisions = (player.stats.collisions || 0) + 1;
    var collisionInCycle = (player.collisionCount - 1) % 3 + 1;
    var cycle = Math.ceil(player.collisionCount / 3);
    if (collisionInCycle === 1) player.collisionPaidInCycle = false;
    var fee = DATA.config.collisionBaseFee * cycle;
    var mandatory = collisionInCycle === 3 && !player.collisionPaidInCycle;
    var choice;
    if (mandatory) {
      choice = "pay";
    } else if (player.isHuman) {
      choice = await this._choose({
        type: "collision",
        playerId: player.id,
        otherPlayerId: recipient.id,
        tileId: tile.id,
        collisionCount: player.collisionCount,
        collisionInCycle: collisionInCycle,
        cycle: cycle,
        mandatory: false,
        fee: fee,
        backSteps: DATA.config.collisionBackSteps,
        options: ["pay", "back"]
      }, player.money >= fee * 2 ? "pay" : "back");
    } else {
      choice = player.money >= fee * 2 ? "pay" : "back";
    }
    if (choice !== "pay" && choice !== "back") choice = mandatory ? "pay" : "back";
    await this._emit({ type: "collision", playerId: player.id, otherPlayerId: recipient.id, tileId: tile.id, choice: choice, collisionCount: player.collisionCount, collisionInCycle: collisionInCycle, cycle: cycle, mandatory: mandatory, fee: fee, backSteps: DATA.config.collisionBackSteps });
    if (choice === "back") {
      await this._movePlayer(player, -DATA.config.collisionBackSteps, "collisionBack", { skipCollision: true });
    } else {
      var result = await this._mandatoryTransfer(player, recipient, fee, "collisionFee", { tileId: tile.id, kind: "collisionFee" });
      player.collisionPaidInCycle = true;
      player.stats.collisionCompensations = (player.stats.collisionCompensations || 0) + result.paid;
      await this._emit({ type: "collisionCompensated", playerId: player.id, recipientId: recipient.id, tileId: tile.id, amount: result.paid, expectedAmount: fee, cycle: cycle, collisionCount: player.collisionCount });
    }
    if (collisionInCycle === 3) player.collisionPaidInCycle = false;
  };

  YiminGameEngine.prototype._ensureFunds = async function (player, amount, context) {
    if (player.money >= amount) return { ready: true, waived: false };

    var emergencyRevenue = await this._collectEmergencyPropertyRevenue(player);
    if (player.money >= amount) return { ready: true, waived: false, emergencyRevenue: emergencyRevenue };

    await this._withdrawBankForPayment(player, amount - player.money);
    if (player.money >= amount) return { ready: true, waived: false };

    var guard = 0;
    while (player.money < amount && guard < DATA.config.boardSize) {
      var owned = this._ownedProperties(player.id);
      if (!owned.length) break;
      var lowestLevel = Math.min.apply(Math, owned.map(function (tile) { return tile.level; }));
      var candidates = owned.filter(function (tile) { return tile.level === lowestLevel; });
      var selected = this._pick(candidates);
      await this._emit({ type: "forcedSaleSelected", playerId: player.id, tileId: selected.id, propertyId: selected.propertyId, level: selected.level, shortfall: Math.max(0, amount - player.money), candidateTileIds: candidates.map(function (tile) { return tile.id; }) });
      await this.sellProperty(selected.id, player.id, "forcedSale");
      guard += 1;
    }
    return { ready: player.money >= amount, waived: false };
  };

  YiminGameEngine.prototype._collectEmergencyPropertyRevenue = async function (player) {
    var owned = this._ownedProperties(player.id).slice().sort(function (a, b) { return a.index - b.index; });
    var total = 0;
    for (var i = 0; i < owned.length; i += 1) {
      if (owned[i].currentTurnover > 0) total += await this._collectPropertyRevenue(player, owned[i], "emergencyPayment");
    }
    if (total) await this._emit({ type: "emergencyPropertyRevenue", playerId: player.id, amount: total, balance: player.money });
    return total;
  };

  YiminGameEngine.prototype._withdrawBankForPayment = async function (player, shortfall) {
    var amount = Math.min(Math.max(0, asInt(shortfall, 0)), player.bankInterest);
    if (!amount) return 0;
    player.bankInterest -= amount;
    player.money += amount;
    await this._emit({
      type: "bankEmergencyWithdrawal",
      playerId: player.id,
      amount: amount,
      principal: player.bankPrincipal,
      interest: player.bankInterest,
      interestEarned: player.bankInterestEarned,
      balance: player.money
    });
    await this._emit({ type: "moneyChanged", playerId: player.id, delta: amount, balance: player.money, reason: "bankEmergencyWithdrawal" });
    return amount;
  };

  YiminGameEngine.prototype._mandatoryTransfer = async function (payer, payee, amount, reason, context) {
    amount = Math.max(0, asInt(amount, 0));
    context = Object.assign({ kind: reason }, context || {});
    var paid = await this._takeMoney(payer, Math.min(amount, payer.money), reason);
    var remaining = amount - paid;
    if (remaining > 0) {
      await this._ensureFunds(payer, remaining, context);
      var emergencyPaid = await this._takeMoney(payer, Math.min(remaining, payer.money), reason);
      paid += emergencyPaid;
      remaining -= emergencyPaid;
    }
    if (payee && paid) {
      payee.money += paid;
      await this._emit({ type: "moneyChanged", playerId: payee.id, delta: paid, balance: payee.money, reason: reason + "Received", fromPlayerId: payer.id });
    }
    if (remaining > 0) await this._markBankrupt(payer, reason, remaining);
    return { paid: paid, waived: false };
  };

  YiminGameEngine.prototype._mandatoryCharge = async function (player, amount, reason, context) {
    amount = Math.max(0, asInt(amount, 0));
    context = Object.assign({ kind: "systemPenalty" }, context || {});
    var paid = await this._takeMoney(player, Math.min(amount, player.money), reason);
    var remaining = amount - paid;
    if (remaining > 0) {
      await this._ensureFunds(player, remaining, context);
      var emergencyPaid = await this._takeMoney(player, Math.min(remaining, player.money), reason);
      paid += emergencyPaid;
      remaining -= emergencyPaid;
    }
    if (context.countAsPenalty !== false) player.stats.penaltiesPaid += paid;
    if (remaining > 0) await this._markBankrupt(player, reason, remaining);
    return { paid: paid, waived: false };
  };

  YiminGameEngine.prototype._markBankrupt = async function (player, reason, unpaid) {
    if (player.bankrupt) return;
    player.money = Math.max(0, player.money);
    player.bankPrincipal = 0;
    player.bankPendingPrincipal = 0;
    player.bankInterest = 0;
    player.bankInterestEarned = 0;
    player.hand = [];
    player.bankrupt = true;
    player.eliminatedAt = this.state.globalTurn;
    if (this._turnContext) this._turnContext.bankruptcyOccurred = true;
    Object.keys(player.statuses).forEach(function (key) {
      player.statuses[key] = typeof player.statuses[key] === "boolean" ? false : 0;
    });
    this.state.board.forEach(function (tile) {
      if (tile.type === "property" && tile.ownerId === player.id) {
        tile.ownerId = null;
        tile.level = 1;
        tile.totalInvested = 0;
        tile.currentTurnover = 0;
        tile.inspectionTurnover = 0;
        tile.lifetimeTurnover = 0;
        var property = DATA.properties[tile.propertyId];
        tile.name = property.levelNames[0];
        tile.shortLabel = tile.name;
      }
    });
    await this._emit({ type: "playerBankrupt", playerId: player.id, reason: reason || "insolvent", unpaid: Math.max(0, asInt(unpaid, 0)) });
  };

  YiminGameEngine.prototype._aiShouldBuy = function (player, tile) {
    var tier = this._propertyEconomy(tile);
    var round = this._getTableRound();
    var reserve = round <= 20 ? 500 : round <= 60 ? 650 : 800;
    return player.money - tier.buyPrice >= reserve;
  };

  YiminGameEngine.prototype._aiShouldUpgrade = async function (player, tile) {
    var tier = this._propertyEconomy(tile);
    var cost = tier.upgradeCosts[tile.level - 1];
    var round = this._getTableRound();
    var reserve = round <= 20 ? 650 : round <= 60 ? 800 : 1000;
    if (player.money - cost < reserve) return false;
    return true;
  };

  YiminGameEngine.prototype._noteNegative = function (player, reason) {
    player.stats.negativeEvents += 1;
    if (player.id === "yimin") this.state.companion.yiminHadNegativeThisRound = true;
    this._record({ type: "negativeEvent", playerId: player.id, reason: reason || "negative" });
  };

  YiminGameEngine.prototype._weightedLottery = function () {
    var roll = this._random();
    var total = 0;
    for (var i = 0; i < DATA.lottery.length; i += 1) {
      total += DATA.lottery[i].weight;
      if (roll < total) return DATA.lottery[i].amount;
    }
    return DATA.lottery[DATA.lottery.length - 1].amount;
  };

  YiminGameEngine.prototype.drawCard = async function (playerId, source) {
    var player = this._player(playerId) || this.state.players[this.state.currentPlayerIndex];
    if (!player || player.bankrupt) return null;
    var positive = this._random() < DATA.cardPools.positiveWeight;
    var luckBlocked = Boolean(this._turnContext && this._turnContext.luckChainActive);
    var pool = (positive ? DATA.cardPools.positive : DATA.cardPools.negative).filter(function (cardId) {
      var definition = DATA.cards[cardId];
      var drawn = player.stats.cardDrawsById[cardId] || 0;
      return !(luckBlocked && cardId === "luck") && (!definition.maxDrawsPerPlayer || drawn < definition.maxDrawsPerPlayer);
    });
    if (!pool.length) pool = (positive ? DATA.cardPools.negative : DATA.cardPools.positive).filter(function (cardId) { return !(luckBlocked && cardId === "luck"); });
    var cardId = this._pick(pool);
    await this._giveCard(player, cardId, source || "draw");
    return cardId;
  };

  YiminGameEngine.prototype._giveCard = async function (player, cardId, source) {
    var card = DATA.cards[cardId];
    if (!card || player.bankrupt) return false;
    player.stats.cardsDrawn += 1;
    player.stats.cardDrawsById[cardId] = (player.stats.cardDrawsById[cardId] || 0) + 1;
    var entersHand = ["fullHealth", "immunity", "consume", "reflect"].indexOf(cardId) >= 0;
    await this._emit({ type: "cardDrawn", playerId: player.id, cardId: cardId, source: source || "draw", immediatelyUsed: !entersHand, entersHand: entersHand });

    if (card.effect === "skipSelf") {
      player.stats.cardsUsed += 1;
      await this._emit({ type: "cardUsed", playerId: player.id, cardId: cardId, effect: card.effect, automatic: true });
      await this._addSkip(player, 1, "lazyCard");
      return true;
    }

    if (card.effect === "skipTarget") {
      var eligible = this.state.players.filter(function (candidate) { return candidate.id !== player.id && !candidate.bankrupt; });
      var targetId = eligible.length ? eligible[0].id : null;
      if (eligible.length && player.isHuman) {
        targetId = await this._choose({ type: "punishTarget", playerId: player.id, cardId: cardId, options: eligible.map(function (candidate) { return candidate.id; }) }, targetId);
      } else if (eligible.length) {
        var engine = this;
        eligible.sort(function (a, b) {
          return engine.getNetWorth(b) - engine.getNetWorth(a)
            || b.money - a.money
            || engine.state.players.indexOf(a) - engine.state.players.indexOf(b);
        });
        targetId = eligible[0].id;
      }
      var target = this._validTarget(player, targetId) || eligible[0];
      player.stats.cardsUsed += 1;
      await this._emit({ type: "cardUsed", playerId: player.id, cardId: cardId, effect: card.effect, targetId: target ? target.id : null, automatic: true });
      if (target) await this._addSkip(target, 1, "punishCard");
      return true;
    }

    if (card.effect === "extraRoll") {
      player.stats.cardsUsed += 1;
      await this._emit({ type: "cardUsed", playerId: player.id, cardId: cardId, effect: card.effect, automatic: true });
      if (!player.bankrupt) {
        if (!this._turnContext) this._turnContext = { playerId: player.id, movementChains: 0, luckChainActive: false, bankruptcyOccurred: false };
        this._turnContext.luckChainActive = true;
        try {
          var extraRoll = await this._roll(player, "luckCard");
          await this._movePlayer(player, extraRoll, "luckCard");
        } finally {
          this._turnContext.luckChainActive = false;
        }
      }
      return true;
    }

    if (card.effect === "lottery") {
      player.stats.cardsUsed += 1;
      await this._choose({ type: "scratchCard", playerId: player.id, cardId: cardId, options: ["reveal"] }, "reveal");
      var lotteryAmount = this._weightedLottery();
      await this._emit({ type: "cardUsed", playerId: player.id, cardId: cardId, effect: card.effect, automatic: true });
      await this._gainMoney(player, lotteryAmount, "lotteryCard");
      await this._emit({ type: "scratchCardResolved", playerId: player.id, cardId: cardId, amount: lotteryAmount, result: "win" });
      return true;
    }

    if (card.effect === "investment") {
      player.stats.cardsUsed += 1;
      await this._choose({ type: "scratchCard", playerId: player.id, cardId: cardId, options: ["reveal"] }, "reveal");
      var won = this._random() < 0.5;
      await this._emit({ type: "cardUsed", playerId: player.id, cardId: cardId, effect: card.effect, automatic: true });
      if (won) await this._gainMoney(player, 2000, "investmentCardWin");
      else await this._applySystemPenalty(player, 1000, "investmentCardLoss", { allowReaction: true });
      await this._emit({ type: "scratchCardResolved", playerId: player.id, cardId: cardId, amount: won ? 2000 : -1000, result: won ? "win" : "loss" });
      return true;
    }

    if (card.effect === "giveAll" || card.effect === "takeAll") {
      player.stats.cardsUsed += 1;
      await this._emit({ type: "cardUsed", playerId: player.id, cardId: cardId, effect: card.effect, automatic: true });
      if (card.effect === "giveAll") await this._resolveGenerousCard(player);
      else await this._resolveCharmingCard(player);
      return true;
    }

    if (player.hand.length >= DATA.config.handLimit) {
      var discard;
      if (player.isHuman) {
        discard = await this._choose({
          type: "discardCard",
          playerId: player.id,
          newCardId: cardId,
          hand: player.hand.slice(),
          options: player.hand.slice()
        }, player.hand[0]);
      } else {
        discard = player.hand[0];
      }
      var discardIndex = typeof discard === "number" ? clamp(asInt(discard, 0), 0, player.hand.length - 1) : player.hand.indexOf(discard);
      if (discardIndex < 0) discardIndex = 0;
      var discarded = player.hand.splice(discardIndex, 1)[0];
      await this._emit({ type: "cardDiscarded", playerId: player.id, cardId: discarded, reason: "handLimit" });
    }
    player.hand.push(cardId);
    await this._emit({ type: "cardAdded", playerId: player.id, cardId: cardId, handSize: player.hand.length });
    return true;
  };

  YiminGameEngine.prototype._validTarget = function (actor, targetId) {
    var target = this._player(targetId);
    return target && target.id !== actor.id && !target.bankrupt ? target : null;
  };

  YiminGameEngine.prototype.useCard = async function (cardId, options) {
    options = options || {};
    var player = this._player(options.playerId) || this.state.players[this.state.currentPlayerIndex];
    if (!player || player.bankrupt) return false;
    var index = player.hand.indexOf(cardId);
    var card = DATA.cards[cardId];
    if (index < 0 || !card) return false;
    return false;
  };

  YiminGameEngine.prototype._resolveGenerousCard = async function (player) {
    var others = this.state.players.filter(function (candidate) { return candidate.id !== player.id && !candidate.bankrupt; });
    for (var i = 0; i < others.length && !player.bankrupt; i += 1) {
      var result = await this._mandatoryTransfer(player, others[i], 200, "generousCard", { kind: "cardTransfer" });
      await this._emit({ type: "generousCardTransfer", playerId: player.id, recipientId: others[i].id, amount: result.paid, expectedAmount: 200 });
    }
  };

  YiminGameEngine.prototype._resolveCharmingCard = async function (player) {
    var others = this.state.players.filter(function (candidate) { return candidate.id !== player.id && !candidate.bankrupt; });
    for (var i = 0; i < others.length; i += 1) {
      var result = await this._mandatoryTransfer(others[i], player, 200, "charmingCard", { kind: "cardTransfer" });
      await this._emit({ type: "charmingCardTransfer", playerId: player.id, payerId: others[i].id, amount: result.paid, expectedAmount: 200 });
    }
  };

  YiminGameEngine.prototype._runAiPreTurnCards = async function (player) {
    return player;
  };

  YiminGameEngine.prototype._addSkip = async function (player, turns, reason) {
    if (!player || player.bankrupt) return false;
    turns = Math.max(1, asInt(turns, 1));
    var before = player.statuses.skipTurns;
    player.statuses.skipTurns += turns;
    this._noteNegative(player, reason || "skip");
    await this._emit({ type: "skipAdded", playerId: player.id, turns: turns, total: player.statuses.skipTurns, reason: reason || "skip" });

    await this._tryCancelSkip(player);
    var newLayersRemaining = Math.max(0, player.statuses.skipTurns - before);
    var immunityIndex = player.hand.indexOf("immunity");
    var blocked = false;
    if (newLayersRemaining > 0 && immunityIndex >= 0) {
      if (player.isHuman) {
        var response = await this._choose({ type: "skipReaction", playerId: player.id, reason: reason, cardId: "immunity", options: ["use", "accept"] }, "accept");
        blocked = response === "use" || response === true;
      } else {
        blocked = true;
      }
    }
    if (blocked) {
      player.hand.splice(immunityIndex, 1);
      player.stats.cardsUsed += 1;
      player.statuses.skipTurns = Math.max(before, player.statuses.skipTurns - 1);
      await this._emit({ type: "cardUsed", playerId: player.id, cardId: "immunity", effect: "cancelSkip", reason: reason });
      return player.statuses.skipTurns > before;
    }
    return player.statuses.skipTurns > before;
  };

  YiminGameEngine.prototype._resolveLifeEvent = async function (player, tile) {
    var event = DATA.lifeEvents[tile.lifeEventId];
    if (!event) return;
    var amount = 0;
    if (event.effect === "fine" || event.effect === "gain") amount = event.amount;
    if (event.effect === "randomFine") amount = this._pick(event.amounts);
    if (event.effect === "percentFine") amount = roundMoney(player.money * event.rate);
    if (event.effect === "lottery") amount = this._weightedLottery();
    var delta = event.effect === "fine" || event.effect === "randomFine" || event.effect === "percentFine" ? -amount : event.effect === "gain" || event.effect === "lottery" ? amount : 0;
    var text = event.text.replace("{amount}", String(amount));
    await this._emit({ type: "lifeEvent", playerId: player.id, tileId: tile.id, lifeEventId: event.id, name: event.name, text: text, amount: amount, delta: delta, rate: event.rate || null });
    switch (event.effect) {
      case "fine":
        await this._applySystemPenalty(player, amount, event.id, { allowReaction: true });
        break;
      case "randomFine":
        await this._applySystemPenalty(player, amount, event.id, { allowReaction: true });
        break;
      case "gain":
        await this._gainMoney(player, amount, event.id);
        break;
      case "percentFine":
        await this._applySystemPenalty(player, amount, event.id, { allowReaction: true });
        break;
      case "lottery":
        await this._gainMoney(player, amount, event.id);
        break;
      case "skip":
        await this._addSkip(player, event.turns || 1, event.id);
        break;
      default:
        break;
    }
  };

  YiminGameEngine.prototype._choosePenaltyReaction = async function (player, amount, reason, kind) {
    var hasImmunity = player.hand.indexOf("immunity") >= 0;
    var hasReflect = player.hand.indexOf("reflect") >= 0;
    if (!hasImmunity && !hasReflect) return { type: "none" };
    var response;
    if (player.isHuman) {
      var options = ["none"];
      if (hasImmunity) options.push("immunity");
      if (hasReflect) options.push("reflect");
      response = await this._choose({
        type: "penaltyReaction",
        playerId: player.id,
        amount: amount,
        reason: reason,
        penaltyKind: kind || "systemPenalty",
        options: options,
        targets: this.state.players.filter(function (candidate) { return candidate.id !== player.id && !candidate.bankrupt; }).map(function (candidate) { return candidate.id; })
      }, "none");
    } else if (hasReflect && amount >= 300) {
      var players = this.state.players;
      var aiTargets = players.filter(function (candidate) { return candidate.id !== player.id && !candidate.bankrupt; });
      aiTargets.sort(function (a, b) { return b.money - a.money || players.indexOf(a) - players.indexOf(b); });
      response = { cardId: "reflect", targetId: aiTargets.length ? aiTargets[0].id : null };
    } else if (hasImmunity && (kind !== "systemPenalty" || amount >= 200)) {
      response = "immunity";
    } else {
      response = "none";
    }

    if (response === "immunity" && hasImmunity) return { type: "immunity" };
    if (response === "reflect" && hasReflect) {
      var targetId = await this._choose({
        type: "reflectTarget",
        playerId: player.id,
        options: this.state.players.filter(function (candidate) { return candidate.id !== player.id && !candidate.bankrupt; }).map(function (candidate) { return candidate.id; })
      }, null);
      return { type: "reflect", targetId: targetId };
    }
    if (response && typeof response === "object" && response.cardId === "reflect" && hasReflect) {
      return { type: "reflect", targetId: response.targetId };
    }
    return { type: "none" };
  };

  YiminGameEngine.prototype._consumeReactionCard = async function (player, cardId, reason) {
    var index = player.hand.indexOf(cardId);
    if (index < 0) return false;
    player.hand.splice(index, 1);
    player.stats.cardsUsed += 1;
    await this._emit({ type: "cardUsed", playerId: player.id, cardId: cardId, effect: DATA.cards[cardId].effect, reason: reason });
    return true;
  };

  YiminGameEngine.prototype._applySystemPenalty = async function (player, amount, reason, options) {
    options = options || {};
    amount = Math.max(0, asInt(amount, 0));
    if (!amount || player.bankrupt) return { paid: 0, waived: false };
    if (options.allowReaction !== false) {
      var reaction = await this._choosePenaltyReaction(player, amount, reason, "systemPenalty");
      if (reaction.type === "immunity") {
        await this._consumeReactionCard(player, "immunity", reason);
        await this._emit({ type: "penaltyBlocked", playerId: player.id, amount: amount, reason: reason, source: "immunity" });
        return { paid: 0, waived: true };
      }
      if (reaction.type === "reflect") {
        var target = this._validTarget(player, reaction.targetId);
        if (target) {
          await this._consumeReactionCard(player, "reflect", reason);
          var reflected = await this._mandatoryCharge(target, amount, reason + "Reflected", { allowRescueCard: false });
          this._noteNegative(target, reason + "Reflected");
          await this._emit({ type: "penaltyReflected", playerId: player.id, targetId: target.id, amount: reflected.paid, expectedAmount: amount, reason: reason });
          return { paid: 0, waived: true, reflectedTo: target.id };
        }
      }
    }
    this._noteNegative(player, reason);
    return this._mandatoryCharge(player, amount, reason, { kind: "systemPenalty", allowRescueCard: true });
  };

  YiminGameEngine.prototype._resolveCityInspection = async function (landingPlayer, tile) {
    var properties = this.state.board.filter(function (propertyTile) { return propertyTile.type === "property" && propertyTile.ownerId; }).sort(function (a, b) { return a.index - b.index; });
    var plans = properties.map(function (propertyTile) {
      var periodTurnover = Math.max(0, asInt(propertyTile.inspectionTurnover, 0));
      var expectedFee = roundMoney(periodTurnover * 0.2);
      var fromTurnover = Math.min(propertyTile.currentTurnover, expectedFee);
      propertyTile.currentTurnover -= fromTurnover;
      propertyTile.inspectionTurnover = 0;
      return {
        propertyTile: propertyTile,
        tileId: propertyTile.id,
        propertyId: propertyTile.propertyId,
        propertyName: propertyTile.name,
        ownerId: propertyTile.ownerId,
        periodTurnover: periodTurnover,
        expectedFee: expectedFee,
        fromTurnover: fromTurnover,
        cashDue: expectedFee - fromTurnover
      };
    });
    var settlements = [];
    for (var i = 0; i < plans.length; i += 1) {
      var plan = plans[i];
      var owner = this._player(plan.ownerId);
      var cashResult = { paid: 0, waived: false };
      if (plan.cashDue > 0 && owner && !owner.bankrupt) cashResult = await this._applySystemPenalty(owner, plan.cashDue, "cityInspection", { allowReaction: true });
      if (owner) {
        owner.stats.inspectionFeesPaid = (owner.stats.inspectionFeesPaid || 0) + plan.fromTurnover + cashResult.paid;
      }
      var settlement = {
        tileId: plan.tileId,
        propertyId: plan.propertyId,
        propertyName: plan.propertyName,
        ownerId: plan.ownerId,
        periodTurnover: plan.periodTurnover,
        expectedFee: plan.expectedFee,
        fromTurnover: plan.fromTurnover,
        fromCash: cashResult.paid,
        waivedCash: Boolean(cashResult.waived),
        unpaid: cashResult.waived ? 0 : Math.max(0, plan.cashDue - cashResult.paid),
        currentTurnover: plan.propertyTile.currentTurnover
      };
      settlements.push(settlement);
      await this._emit(Object.assign({ type: "cityInspectionProperty", playerId: landingPlayer.id }, settlement));
    }
    await this._emit({ type: "cityInspection", playerId: landingPlayer.id, tileId: tile.id, affectedPlayerIds: settlements.map(function (entry) { return entry.ownerId; }).filter(Boolean), settlements: settlements });
  };

  YiminGameEngine.prototype._resolveReview = async function (player, tile) {
    var owned = this.state.board.filter(function (candidate) { return candidate.type === "property" && candidate.ownerId; });
    var amount = 300;
    var referenceTileId = null;
    var usedFallback = true;
    if (owned.length) {
      var maxLevel = Math.max.apply(Math, owned.map(function (candidate) { return candidate.level; }));
      var highest = owned.filter(function (candidate) { return candidate.level === maxLevel; });
      highest.sort(function (a, b) {
        var aRevenue = roundMoney(a.currentTurnover * 0.5);
        var bRevenue = roundMoney(b.currentTurnover * 0.5);
        return bRevenue - aRevenue || a.index - b.index;
      });
      var reference = highest[0];
      referenceTileId = reference.id;
      var referenceRevenue = roundMoney(reference.currentTurnover * 0.5);
      if (referenceRevenue > 0) {
        amount = referenceRevenue;
        usedFallback = false;
      }
    }
    await this._gainMoney(player, amount, "yiminReview");
    await this._emit({ type: "reviewReward", playerId: player.id, tileId: tile.id, amount: amount, referenceTileId: referenceTileId, usedFallback: usedFallback });
  };

  YiminGameEngine.prototype._resolveAdventure = async function (player, tile) {
    var outcomes = ["forward", "consumeCard", "back", "fine"];
    var outcome = this._pick(outcomes);
    await this._emit({ type: "adventure", playerId: player.id, tileId: tile.id, outcome: outcome });
    if (outcome === "forward") await this._movePlayer(player, 3, "adventureForward");
    if (outcome === "consumeCard") await this._giveCard(player, "consume", "adventure");
    if (outcome === "back") await this._movePlayer(player, -2, "adventureBack");
    if (outcome === "fine") await this._applySystemPenalty(player, 100, "adventureFine", { allowReaction: true });
  };

  YiminGameEngine.prototype._resolveGameMoment = async function (player, tile) {
    var momentId = tile.gameMomentId;
    if (Array.isArray(tile.gameMomentIds) && tile.gameMomentIds.length) {
      momentId = this._pick(tile.gameMomentIds);
    }
    var moment = DATA.gameMoments[momentId];
    if (!moment) return;
    await this._emit({ type: "gameMomentStarted", playerId: player.id, tileId: tile.id, gameMomentId: moment.id, name: moment.name });
    if (moment.id === "truth" || moment.id === "dare") {
      var prompt = this._pick(moment.prompts);
      var response = "complete";
      if (player.isHuman) {
        response = await this._choose({
          type: "gameMoment",
          playerId: player.id,
          gameMomentId: moment.id,
          prompt: prompt,
          options: ["complete", "refuse"]
        }, "complete");
      }
      await this._emit({ type: "gameMomentPrompt", playerId: player.id, gameMomentId: moment.id, prompt: prompt, response: response });
      if (response === "refuse" || response === false) await this._applyGameFailure(player, moment.id);
      else {
        var confirmed = await this._confirmGameMoment(player, moment.id);
        if (confirmed) await this._emit({ type: "gameMomentCompleted", playerId: player.id, gameMomentId: moment.id });
        else await this._applyGameFailure(player, moment.id);
      }
      return;
    }
    if (moment.id === "diceDuel") await this._resolveDiceDuel(player);
    if (moment.id === "rps") await this._resolveRps(player);
  };

  YiminGameEngine.prototype._confirmGameMoment = async function (player, gameMomentId) {
    var active = this.state.players.filter(function (candidate) { return !candidate.bankrupt; });
    var confirmations = [player.id];
    await this._emit({ type: "gameMomentConfirmationStarted", playerId: player.id, gameMomentId: gameMomentId, required: 3, timeoutSeconds: 120 });
    await this._emit({ type: "gameMomentConfirmed", playerId: player.id, confirmerId: player.id, gameMomentId: gameMomentId, count: confirmations.length, required: 3 });
    var companions = active.filter(function (candidate) { return candidate.id !== player.id && !candidate.isHuman; });
    for (var i = 0; i < companions.length && confirmations.length < 3; i += 1) {
      await this._delay("gameConfirmation", { playerId: player.id, confirmerId: companions[i].id, gameMomentId: gameMomentId });
      confirmations.push(companions[i].id);
      await this._emit({ type: "gameMomentConfirmed", playerId: player.id, confirmerId: companions[i].id, gameMomentId: gameMomentId, count: confirmations.length, required: 3 });
    }
    if (confirmations.length >= 3) {
      await this._emit({ type: "gameMomentConfirmationResolved", playerId: player.id, gameMomentId: gameMomentId, confirmed: true, confirmerIds: confirmations, source: "companionConfirmations" });
      return true;
    }
    var systemRoll = await this._roll(player, "gameConfirmationTimeout");
    var confirmed = systemRoll % 2 === 1;
    await this._emit({ type: "gameMomentConfirmationResolved", playerId: player.id, gameMomentId: gameMomentId, confirmed: confirmed, confirmerIds: confirmations, source: "timeoutDice", systemRoll: systemRoll });
    return confirmed;
  };

  YiminGameEngine.prototype._applyGameFailure = async function (player, reason) {
    var amount = roundMoney(player.money * DATA.config.taskRefusalRate);
    var reaction = await this._choosePenaltyReaction(player, amount, reason, "gameFailure");
    if (reaction.type === "immunity") {
      await this._consumeReactionCard(player, "immunity", reason);
      await this._emit({ type: "gameFailureBlocked", playerId: player.id, reason: reason, source: "immunity" });
      return;
    }
    if (reaction.type === "reflect") {
      var target = this._validTarget(player, reaction.targetId);
      if (target) {
        await this._consumeReactionCard(player, "reflect", reason);
        await this._mandatoryCharge(target, amount, reason + "Reflected", { kind: "gameFailure", allowRescueCard: false });
        target.statuses.forcedConsumption += DATA.config.forcedConsumptionLayers;
        this._noteNegative(target, reason + "Reflected");
        await this._emit({ type: "gameFailureReflected", playerId: player.id, targetId: target.id, amount: amount, forcedConsumption: DATA.config.forcedConsumptionLayers });
        return;
      }
    }
    this._noteNegative(player, reason);
    var charged = await this._mandatoryCharge(player, amount, "gameMomentRefusal", { kind: "gameFailure", allowRescueCard: true });
    if (!charged.waived && !player.bankrupt) player.statuses.forcedConsumption += DATA.config.forcedConsumptionLayers;
    await this._emit({ type: "gameMomentRefused", playerId: player.id, amount: charged.paid, expectedAmount: amount, forcedConsumption: charged.waived ? 0 : DATA.config.forcedConsumptionLayers });
  };

  YiminGameEngine.prototype._resolveDiceDuel = async function (landingPlayer) {
    var contenders = this.state.players.filter(function (player) { return !player.bankrupt; });
    var tied = contenders.slice();
    var winner = tied[0];
    for (var round = 1; round <= DATA.config.actionChainCap && tied.length > 1; round += 1) {
      var rolls = [];
      for (var i = 0; i < tied.length; i += 1) {
        rolls.push({ player: tied[i], value: await this._roll(tied[i], "diceDuel") });
      }
      var max = Math.max.apply(Math, rolls.map(function (entry) { return entry.value; }));
      tied = rolls.filter(function (entry) { return entry.value === max; }).map(function (entry) { return entry.player; });
      winner = tied[0];
      await this._emit({ type: "diceDuelRound", playerId: landingPlayer.id, round: round, rolls: rolls.map(function (entry) { return { playerId: entry.player.id, value: entry.value }; }), tiedPlayerIds: tied.map(function (player) { return player.id; }) });
    }
    if (winner) await this._queueBonusTurn(winner.id, "diceDuel");
  };

  YiminGameEngine.prototype._rpsMove = async function (player, opponentId) {
    var moves = ["rock", "paper", "scissors"];
    if (!player.isHuman) return this._pick(moves);
    var response = await this._choose({ type: "gameMoment", playerId: player.id, gameMomentId: "rps", opponentId: opponentId, options: moves }, { move: "rock" });
    var move = typeof response === "object" && response ? response.move : response;
    return moves.indexOf(move) >= 0 ? move : "rock";
  };

  YiminGameEngine.prototype._resolveRps = async function (player) {
    var opponents = this.state.players.filter(function (candidate) { return candidate.id !== player.id && !candidate.bankrupt; });
    if (!opponents.length) return;
    var opponent = opponents[(this.state.currentPlayerIndex + 1) % opponents.length] || opponents[0];
    var beats = { rock: "scissors", scissors: "paper", paper: "rock" };
    for (var round = 1; round <= DATA.config.actionChainCap; round += 1) {
      var playerMove = await this._rpsMove(player, opponent.id);
      var opponentMove = await this._rpsMove(opponent, player.id);
      await this._emit({ type: "rpsRound", playerId: player.id, opponentId: opponent.id, round: round, playerMove: playerMove, opponentMove: opponentMove });
      if (playerMove === opponentMove) continue;
      var loser = beats[playerMove] === opponentMove ? opponent : player;
      await this._emit({ type: "rpsResolved", playerId: player.id, opponentId: opponent.id, winnerId: loser.id === player.id ? opponent.id : player.id, loserId: loser.id });
      await this._movePlayer(loser, -5, "rpsLoss");
      return;
    }
    await this._emit({ type: "chainCapped", playerId: player.id, source: "rpsTies" });
  };

  YiminGameEngine.DATA = DATA;
  root.YiminGameEngine = YiminGameEngine;
})(typeof window !== "undefined" ? window : globalThis);
