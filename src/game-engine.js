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
      }
      return next;
    });

    var humanName = String(options.playerName || "伊敏").trim().slice(0, 12) || "伊敏";
    var players = DATA.players.map(function (preset, index) {
      return {
        id: preset.id,
        name: index === 0 ? humanName : preset.name,
        isHuman: preset.isHuman,
        persona: preset.persona,
        color: preset.color,
        avatar: preset.avatar,
        money: DATA.config.initialMoney,
        bankPrincipal: 0,
        bankInterest: 0,
        bankInterestEarned: 0,
        position: 0,
        hand: [],
        bankrupt: false,
        eliminatedAt: null,
        normalTurns: 0,
        bonusTurns: 0,
        statuses: {
          skipTurns: 0,
          forcedConsumption: 0,
          deliveryOrder: false,
          consumptionShield: 0,
          bully: 0,
          doubleStart: 0,
          incomeFreezeTurns: 0,
          protectionTurns: 0,
          progressReady: false,
          luckReady: false
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
          rescues: 0,
          negativeEvents: 0,
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
      log: [],
      companion: {
        rescueUsed: false,
        waterGivenBy: [],
        yiminNegativeRoundStreak: 0,
        yiminHadNegativeThisRound: false
      },
      economyPressure: {
        actionsWithoutBankruptcy: 0,
        level: 0
      }
    };
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
    parsed.economyPressure = parsed.economyPressure || { actionsWithoutBankruptcy: 0, level: 0 };
    parsed.economyPressure.actionsWithoutBankruptcy = Math.max(0, asInt(parsed.economyPressure.actionsWithoutBankruptcy, 0));
    parsed.economyPressure.level = Math.max(0, asInt(parsed.economyPressure.level, 0));
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
      player.bankInterest = Math.max(0, asInt(player.bankInterest, 0));
    });
    this.state = parsed;
    this._rngState = toSeed(parsed.rngState || parsed.seed);
    this.state.rngState = this._rngState;
    this._turnContext = null;
    return this.getState();
  };

  YiminGameEngine.prototype.getNetWorth = function (playerOrId) {
    var player = typeof playerOrId === "object" ? playerOrId : this._player(playerOrId);
    if (!player) return 0;
    var propertyValue = this.state.board.reduce(function (sum, tile) {
      if (tile.type !== "property" || tile.ownerId !== player.id) return sum;
      return sum + Math.floor(tile.totalInvested * DATA.config.propertySaleRate);
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
      return card && card.timing !== "reaction" && card.timing !== "skipReaction";
    });
    return {
      canPlayTurn: !this._busy && !player.bankrupt,
      canRoll: !this._busy && !player.bankrupt && player.statuses.skipTurns === 0,
      playableCards: playableCards,
      canBuy: this._canBuyProperty(player, this.state.board[player.position]),
      canUpgrade: this._canUpgradeProperty(player, this.state.board[player.position]),
      sellableProperties: this.state.board.filter(function (tile) { return tile.ownerId === player.id; }).map(function (tile) { return tile.id; }),
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
    this._turnContext = {
      playerId: player.id,
      movementChains: 0,
      progressUsed: false,
      luckUsed: false,
      playerWasBankruptAtStart: player.bankrupt,
      bankruptcyOccurred: false,
      freezeActiveAtStart: player.statuses.incomeFreezeTurns > 0,
      protectionActiveAtStart: player.statuses.protectionTurns > 0
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
        var recovered = await this._tryCancelSkip(player);
        if (!recovered) {
          player.statuses.skipTurns = Math.max(0, player.statuses.skipTurns - 1);
          await this._emit({ type: "turnSkipped", playerId: player.id, remaining: player.statuses.skipTurns });
          await this._finishTurn(player);
          return this.getState();
        }
      }

      this.state.phase = "beforeRoll";
      if (!player.isHuman) await this._runAiPreTurnCards(player);

      if (player.statuses.progressReady) {
        player.statuses.progressReady = false;
        this._turnContext.progressUsed = true;
        await this._movePlayer(player, 3, "progressCard");
      } else {
        var roll = await this._roll(player, "move");
        await this._movePlayer(player, roll, "dice");
      }

      if (!player.bankrupt && player.statuses.luckReady) {
        player.statuses.luckReady = false;
        this._turnContext.luckUsed = true;
        var extraRoll = await this._roll(player, "luckCard");
        await this._movePlayer(player, extraRoll, "luckCard");
      }

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
    var index = player.hand.indexOf("fullHealth");
    if (index < 0) return false;
    var use = !player.isHuman;
    if (player.isHuman) {
      var response = await this._choose({
        type: "skipRecovery",
        playerId: player.id,
        cardId: "fullHealth",
        options: ["use", "skip"]
      }, "skip");
      use = response === "use" || response === true;
    }
    if (!use) return false;
    player.hand.splice(index, 1);
    player.stats.cardsUsed += 1;
    player.statuses.skipTurns = Math.max(0, player.statuses.skipTurns - 1);
    await this._emit({ type: "cardUsed", playerId: player.id, cardId: "fullHealth", effect: "cancelSkip" });
    return true;
  };

  YiminGameEngine.prototype._finishTurn = async function (player) {
    if (this._turnContext && this._turnContext.freezeActiveAtStart) {
      player.statuses.incomeFreezeTurns = Math.max(0, player.statuses.incomeFreezeTurns - 1);
    }
    if (this._turnContext && this._turnContext.protectionActiveAtStart) {
      player.statuses.protectionTurns = Math.max(0, player.statuses.protectionTurns - 1);
    }

    var activeBeforePressure = this.state.players.filter(function (candidate) { return !candidate.bankrupt; });
    if (this.state.turnKind === "normal" && activeBeforePressure.length > 1 && !player.bankrupt && this.state.economyPressure.level > 0) {
      await this._applyInsolvencyPressure(player);
    }

    await this._emit({ type: "turnEnded", playerId: player.id, turnKind: this.state.turnKind });

    if (this.state.turnKind === "normal") {
      player.normalTurns += 1;
      this.state.globalTurn += 1;
      this.state.regularNextPlayerIndex = (this.state.currentPlayerIndex + 1) % this.state.players.length;
      if (!this._turnContext.bankruptcyOccurred && !this._turnContext.playerWasBankruptAtStart) {
        this.state.economyPressure.actionsWithoutBankruptcy += 1;
      }
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
    var pressure = this.state.economyPressure;
    if (pressure.actionsWithoutBankruptcy < DATA.config.insolvencyGraceActions) return;
    pressure.level += 1;
    await this._emit({
      type: "maintenanceFeeIncreased",
      level: pressure.level,
      nextFee: pressure.level * DATA.config.insolvencyPressureStep,
      actionsWithoutBankruptcy: pressure.actionsWithoutBankruptcy
    });
  };

  YiminGameEngine.prototype._applyInsolvencyPressure = async function (player) {
    var level = this.state.economyPressure.level;
    if (level <= 0 || player.bankrupt) return { paid: 0, waived: false };
    var amount = level * DATA.config.insolvencyPressureStep;
    await this._emit({ type: "maintenanceFeeCharged", playerId: player.id, level: level, amount: amount });
    return this._mandatoryCharge(player, amount, "经营维护费", { kind: "insolvencyPressure", allowRescueCard: true });
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

  YiminGameEngine.prototype._movePlayer = async function (player, steps, reason) {
    if (!steps || player.bankrupt) return;
    if (!this._turnContext) {
      this._turnContext = { playerId: player.id, movementChains: 0, freezeActiveAtStart: false, protectionActiveAtStart: false };
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
      var landedTile = this.state.board[player.position];
      await this._emit({ type: "playerLanded", playerId: player.id, tileId: landedTile.id, tileType: landedTile.type });
      await this._resolveLanding(player, landedTile);
      if (!player.bankrupt && player.position === landedTile.index) await this._resolveCollision(player, landedTile);
    }
  };

  YiminGameEngine.prototype._resolvePassedTile = async function (player, tile, direction, reason, isLandingStep) {
    await this._emit({ type: "tilePassed", playerId: player.id, tileId: tile.id, tileType: tile.type, reason: reason || "move" });
    if (tile.type === "start" && direction > 0) {
      var multiplier = player.statuses.doubleStart > 0 ? 2 : 1;
      if (multiplier === 2) player.statuses.doubleStart -= 1;
      var reward = DATA.config.startReward * multiplier;
      player.stats.laps += 1;
      await this._gainMoney(player, reward, "startReward");
      await this._emit({ type: "startPassed", playerId: player.id, amount: reward, doubled: multiplier === 2 });
      return;
    }
    if (tile.type === "bank") {
      await this._accrueBankInterest(player, tile);
      return;
    }
    if (tile.type === "delivery") {
      player.statuses.deliveryOrder = true;
      await this._emit({ type: "deliveryOrderReceived", playerId: player.id, tileId: tile.id });
      return;
    }
    if (tile.type === "property") await this._resolvePropertyPass(player, tile, isLandingStep);
  };

  YiminGameEngine.prototype._resolveLanding = async function (player, tile) {
    if (player.bankrupt) return;
    this.state.phase = "resolvingTile";
    await this._emit({ type: "tileResolved", playerId: player.id, tileId: tile.id, tileType: tile.type, name: tile.name });
    switch (tile.type) {
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
    var property = DATA.properties[tile.propertyId];
    return player.money >= DATA.propertyTiers[property.tier].buyPrice;
  };

  YiminGameEngine.prototype._canUpgradeProperty = function (player, tile) {
    if (!player || player.bankrupt || !tile || tile.type !== "property" || tile.ownerId !== player.id || tile.level >= 4) return false;
    var property = DATA.properties[tile.propertyId];
    var tier = DATA.propertyTiers[property.tier];
    return player.money >= tier.upgradeCosts[tile.level - 1];
  };

  YiminGameEngine.prototype.buyProperty = async function (tileId, playerId) {
    var player = this._player(playerId) || this.state.players[this.state.currentPlayerIndex];
    var tile = tileId ? this.state.board.find(function (candidate) { return candidate.id === tileId; }) : this.state.board[player.position];
    if (!this._canBuyProperty(player, tile) || player.position !== tile.index) return false;
    var property = DATA.properties[tile.propertyId];
    var price = DATA.propertyTiers[property.tier].buyPrice;
    await this._takeMoney(player, price, "propertyPurchase");
    tile.ownerId = player.id;
    tile.level = 1;
    tile.totalInvested = price;
    player.stats.propertiesBought += 1;
    await this._emit({ type: "propertyBought", playerId: player.id, tileId: tile.id, propertyId: tile.propertyId, amount: price, level: 1 });
    return true;
  };

  YiminGameEngine.prototype.upgradeProperty = async function (tileId, playerId) {
    var player = this._player(playerId) || this.state.players[this.state.currentPlayerIndex];
    var tile = tileId ? this.state.board.find(function (candidate) { return candidate.id === tileId; }) : this.state.board[player.position];
    if (!this._canUpgradeProperty(player, tile) || player.position !== tile.index) return false;
    var property = DATA.properties[tile.propertyId];
    var tier = DATA.propertyTiers[property.tier];
    var cost = tier.upgradeCosts[tile.level - 1];
    await this._takeMoney(player, cost, "propertyUpgrade");
    tile.level += 1;
    tile.totalInvested += cost;
    player.stats.upgrades += 1;
    await this._emit({ type: "propertyUpgraded", playerId: player.id, tileId: tile.id, propertyId: tile.propertyId, amount: cost, level: tile.level });
    return true;
  };

  YiminGameEngine.prototype.sellProperty = async function (tileId, playerId, reason) {
    var player = this._player(playerId) || this.state.players[this.state.currentPlayerIndex];
    var tile = this.state.board.find(function (candidate) { return candidate.id === tileId; });
    if (!tile || tile.type !== "property" || tile.ownerId !== player.id) return 0;
    var value = Math.floor(tile.totalInvested * DATA.config.propertySaleRate);
    tile.ownerId = null;
    tile.level = 1;
    tile.totalInvested = 0;
    await this._gainMoney(player, value, reason || "propertySale");
    await this._emit({ type: "propertySold", playerId: player.id, tileId: tile.id, propertyId: tile.propertyId, amount: value, reason: reason || "voluntary" });
    return value;
  };

  YiminGameEngine.prototype._resolvePropertyLanding = async function (player, tile) {
    if (!tile.ownerId) {
      var property = DATA.properties[tile.propertyId];
      var price = DATA.propertyTiers[property.tier].buyPrice;
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

    if (tile.ownerId === player.id && tile.level < 4) {
      var propertyData = DATA.properties[tile.propertyId];
      var tier = DATA.propertyTiers[propertyData.tier];
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
    }
  };

  YiminGameEngine.prototype._resolvePropertyPass = async function (player, tile, isLandingStep) {
    if (!tile.ownerId) return;
    var owner = this._player(tile.ownerId);
    if (!owner || owner.bankrupt) return;
    var property = DATA.properties[tile.propertyId];
    var tier = DATA.propertyTiers[property.tier];

    if (owner.id === player.id) {
      var revenue = tier.revenue[tile.level - 1];
      if (player.statuses.incomeFreezeTurns > 0) {
        await this._emit({ type: "propertyIncomeFrozen", playerId: player.id, tileId: tile.id, incomeType: "business", amount: revenue });
      } else {
        if (player.id === "yimin" && player.statuses.protectionTurns > 0) revenue = Math.floor(revenue * DATA.config.rescueIncomeMultiplier);
        await this._gainMoney(player, revenue, "businessRevenue");
        player.stats.businessIncome += revenue;
        await this._emit({ type: "businessRevenue", playerId: player.id, tileId: tile.id, amount: revenue, level: tile.level });
      }
      if (player.statuses.deliveryOrder) await this._completeDelivery(player, tile);
      return;
    }


    if (!isLandingStep) {
      await this._emit({ type: "otherPropertyPassed", playerId: player.id, ownerId: owner.id, tileId: tile.id });
      return;
    }

    if (player.statuses.deliveryOrder) {
      await this._completeDelivery(player, tile);
      await this._emit({ type: "consumptionWaived", playerId: player.id, ownerId: owner.id, tileId: tile.id, source: "delivery" });
      return;
    }

    if (owner.statuses.incomeFreezeTurns > 0) {
      await this._emit({ type: "propertyIncomeFrozen", playerId: owner.id, visitorId: player.id, tileId: tile.id, incomeType: "consumption" });
      return;
    }

    var forced = player.statuses.forcedConsumption > 0;
    var consumptionRoll = forced ? null : await this._roll(player, "propertyConsumption");
    var shouldConsume = forced || consumptionRoll === 1 || consumptionRoll === 6;
    await this._emit({
      type: "consumptionChecked",
      playerId: player.id,
      ownerId: owner.id,
      tileId: tile.id,
      roll: consumptionRoll,
      forced: forced,
      consumed: shouldConsume
    });
    if (!shouldConsume) return;

    if (player.statuses.consumptionShield > 0) {
      player.statuses.consumptionShield -= 1;
      await this._emit({ type: "consumptionWaived", playerId: player.id, ownerId: owner.id, tileId: tile.id, source: "consumeCard" });
      return;
    }

    var amount = tier.consume[tile.level - 1];
    var forcedLayerConsumed = true;
    if (player.statuses.bully > 0) {
      player.statuses.bully -= 1;
      await this._resolveBullyConsumption(player, owner, tile, amount);
    } else {
      var result = await this._mandatoryTransfer(player, owner, amount, "propertyConsumption", { tileId: tile.id });
      if (result.waived) forcedLayerConsumed = false;
      if (!result.waived) {
        player.stats.consumptionPaid += result.paid;
        owner.stats.consumptionIncome += result.paid;
        await this._emit({ type: "propertyConsumed", playerId: player.id, ownerId: owner.id, tileId: tile.id, amount: result.paid, expectedAmount: amount, level: tile.level });
      }
    }
    if (forced && forcedLayerConsumed && player.statuses.forcedConsumption > 0) player.statuses.forcedConsumption -= 1;
  };

  YiminGameEngine.prototype._completeDelivery = async function (player, tile) {
    player.statuses.deliveryOrder = false;
    await this._gainMoney(player, 100, "deliveryReward");
    await this._emit({ type: "deliveryCompleted", playerId: player.id, tileId: tile.id, amount: 100 });
  };

  YiminGameEngine.prototype._resolveBullyConsumption = async function (player, owner, tile, amount) {
    var candidates = this.state.players.filter(function (candidate) { return !candidate.bankrupt; });
    candidates.sort(function (a, b) {
      if (b.money !== a.money) return b.money - a.money;
      return DATA.players.findIndex(function (preset) { return preset.id === a.id; }) - DATA.players.findIndex(function (preset) { return preset.id === b.id; });
    });
    var richest = candidates[0];
    if (!richest || richest.id === player.id) {
      var reward = Math.floor(amount * 0.5);
      await this._gainMoney(player, reward, "bullyReward");
      await this._emit({ type: "bullyResolved", playerId: player.id, ownerId: owner.id, tileId: tile.id, payerId: null, amount: 0, reward: reward });
      return;
    }
    var result = await this._mandatoryTransfer(richest, owner, amount, "bullyConsumption", { tileId: tile.id, beneficiaryId: player.id });
    if (!result.waived) owner.stats.consumptionIncome += result.paid;
    await this._emit({ type: "bullyResolved", playerId: player.id, ownerId: owner.id, tileId: tile.id, payerId: richest.id, amount: result.paid, reward: 0 });
  };

  YiminGameEngine.prototype._resolveSafe = async function (player, tile) {
    var choice;
    if (player.isHuman) {
      choice = await this._choose({ type: "safeReward", playerId: player.id, tileId: tile.id, options: ["money", "card"], amount: DATA.config.safeMoneyReward }, "money");
    } else {
      choice = player.hand.length < 2 ? "card" : "money";
    }
    if (choice === "card") await this.drawCard(player.id, "safe");
    else await this._gainMoney(player, DATA.config.safeMoneyReward, "safeReward");
    await this._emit({ type: "safeResolved", playerId: player.id, tileId: tile.id, choice: choice === "card" ? "card" : "money" });
  };

  YiminGameEngine.prototype._accrueBankInterest = async function (player, tile) {
    if (player.bankPrincipal <= 0) return 0;
    var available = Math.max(0, DATA.config.bankInterestCap - player.bankInterestEarned);
    var interest = Math.min(available, Math.floor(player.bankPrincipal * DATA.config.bankInterestRate));
    if (!interest) return 0;
    player.bankInterest += interest;
    player.bankInterestEarned += interest;
    await this._emit({ type: "bankInterestAccrued", playerId: player.id, tileId: tile.id, amount: interest, principal: player.bankPrincipal, totalInterest: player.bankInterest });
    return interest;
  };

  YiminGameEngine.prototype.bankDeposit = async function (amount, playerId) {
    var player = this._player(playerId) || this.state.players[this.state.currentPlayerIndex];
    var tile = this.state.board[player.position];
    if (!tile || tile.type !== "bank" || player.bankrupt) return 0;
    amount = clamp(asInt(amount, 0), 0, player.money);
    if (!amount) return 0;
    await this._takeMoney(player, amount, "bankDeposit");
    player.bankPrincipal += amount;
    await this._emit({ type: "bankDeposit", playerId: player.id, amount: amount, principal: player.bankPrincipal });
    return amount;
  };

  YiminGameEngine.prototype.bankWithdraw = async function (amount, playerId) {
    var player = this._player(playerId) || this.state.players[this.state.currentPlayerIndex];
    var tile = this.state.board[player.position];
    if (!tile || tile.type !== "bank" || player.bankrupt) return 0;
    var available = player.bankPrincipal + player.bankInterest;
    amount = clamp(asInt(amount, available), 0, available);
    if (!amount) return 0;
    var fromInterest = Math.min(player.bankInterest, amount);
    player.bankInterest -= fromInterest;
    player.bankPrincipal -= amount - fromInterest;
    await this._gainMoney(player, amount, "bankWithdraw");
    await this._emit({ type: "bankWithdraw", playerId: player.id, amount: amount, principal: player.bankPrincipal, interest: player.bankInterest });
    return amount;
  };

  YiminGameEngine.prototype._resolveBankLanding = async function (player, tile) {
    var response;
    if (player.isHuman) {
      response = await this._choose({
        type: "bank",
        playerId: player.id,
        tileId: tile.id,
        balance: player.money,
        principal: player.bankPrincipal,
        interest: player.bankInterest,
        options: ["deposit", "withdraw", "none"]
      }, { action: "none", amount: 0 });
    } else if (player.money > 1800) {
      response = { action: "deposit", amount: Math.floor((player.money - 1200) / 100) * 100 };
    } else if (player.money < 500 && player.bankPrincipal + player.bankInterest > 0) {
      response = { action: "withdraw", amount: Math.min(800, player.bankPrincipal + player.bankInterest) };
    } else {
      response = { action: "none", amount: 0 };
    }
    if (typeof response === "string") response = { action: response, amount: 0 };
    response = response || { action: "none", amount: 0 };
    if (response.action === "deposit") await this.bankDeposit(response.amount, player.id);
    if (response.action === "withdraw") await this.bankWithdraw(response.amount, player.id);
  };

  YiminGameEngine.prototype._resolveCollision = async function (player, tile) {
    if (tile.type === "safe") return;
    var occupants = this.state.players.filter(function (candidate) {
      return candidate.id !== player.id && !candidate.bankrupt && candidate.position === player.position;
    });
    if (!occupants.length) return;
    var recipient = occupants[0];
    var choice;
    if (player.isHuman) {
      choice = await this._choose({
        type: "collision",
        playerId: player.id,
        otherPlayerId: recipient.id,
        tileId: tile.id,
        fee: DATA.config.collisionFee,
        backSteps: DATA.config.collisionBackSteps,
        options: ["pay", "back"]
      }, player.money >= DATA.config.collisionFee ? "pay" : "back");
    } else {
      choice = player.money >= 600 ? "pay" : "back";
    }
    await this._emit({ type: "collision", playerId: player.id, otherPlayerId: recipient.id, tileId: tile.id, choice: choice });
    if (choice === "back") {
      await this._movePlayer(player, -DATA.config.collisionBackSteps, "collision");
    } else {
      await this._mandatoryTransfer(player, recipient, DATA.config.collisionFee, "collisionFee", { tileId: tile.id });
    }
  };

  YiminGameEngine.prototype._ensureFunds = async function (player, amount, context) {
    if (player.money >= amount) return { ready: true, waived: false };

    await this._withdrawBankForPayment(player, amount - player.money);
    if (player.money >= amount) return { ready: true, waived: false };

    var rescue = await this._attemptCompanionRescue(player, amount, context || {});
    if (rescue.waived) return { ready: true, waived: true };
    if (player.money >= amount) return { ready: true, waived: false };

    var guard = 0;
    while (player.money < amount && guard < DATA.config.boardSize) {
      var owned = this._ownedProperties(player.id);
      if (!owned.length) break;
      owned.sort(function (a, b) {
        var aValue = Math.floor(a.totalInvested * DATA.config.propertySaleRate);
        var bValue = Math.floor(b.totalInvested * DATA.config.propertySaleRate);
        return aValue - bValue || a.index - b.index;
      });
      var selectedId = owned[0].id;
      if (player.isHuman) {
        var response = await this._choose({
          type: "sellForPayment",
          playerId: player.id,
          required: amount,
          shortfall: Math.max(0, amount - player.money),
          properties: owned.map(function (tile) {
            return { tileId: tile.id, propertyId: tile.propertyId, level: tile.level, saleValue: Math.floor(tile.totalInvested * DATA.config.propertySaleRate) };
          })
        }, selectedId);
        if (response === false || response === "decline") break;
        if (typeof response === "object" && response) response = response.tileId;
        if (owned.some(function (tile) { return tile.id === response; })) selectedId = response;
      }
      await this.sellProperty(selectedId, player.id, "forcedSale");
      guard += 1;
    }
    return { ready: player.money >= amount, waived: false };
  };

  YiminGameEngine.prototype._withdrawBankForPayment = async function (player, shortfall) {
    var available = player.bankPrincipal + player.bankInterest;
    var amount = Math.min(Math.max(0, asInt(shortfall, 0)), available);
    if (!amount) return 0;
    var fromInterest = Math.min(player.bankInterest, amount);
    player.bankInterest -= fromInterest;
    player.bankPrincipal -= amount - fromInterest;
    player.money += amount;
    await this._emit({
      type: "bankEmergencyWithdrawal",
      playerId: player.id,
      amount: amount,
      principal: player.bankPrincipal,
      interest: player.bankInterest,
      balance: player.money
    });
    await this._emit({ type: "moneyChanged", playerId: player.id, delta: amount, balance: player.money, reason: "bankEmergencyWithdrawal" });
    return amount;
  };

  YiminGameEngine.prototype._attemptCompanionRescue = async function (player, amount, context) {
    if (player.id !== "yimin" || this.state.mode !== "companion" || (this.state.settings && this.state.settings.careMode === false) || this.state.companion.rescueUsed) return { waived: false };
    var donors = this.state.players.filter(function (candidate) { return !candidate.isHuman && !candidate.bankrupt && candidate.money > 0; });
    donors.sort(function (a, b) { return b.money - a.money; });
    var donor = donors[0];
    var shortfall = Math.max(0, amount - player.money);
    var cashCap = Math.floor(this.getNetWorth(player) * 0.2);
    var cashAmount = donor ? Math.min(shortfall, cashCap, donor.money) : 0;
    var canCardWaive = context.allowRescueCard !== false;
    var rescueCardId = context.kind === "propertyConsumption" || context.kind === "bullyConsumption" ? "consume" : "immunity";
    if (cashAmount <= 0 && !canCardWaive) return { waived: false };

    var choice = cashAmount > 0 ? "cash" : "card";
    if (player.isHuman) {
      choice = await this._choose({
        type: "rescue",
        playerId: player.id,
        donorId: donor ? donor.id : null,
        required: amount,
        shortfall: shortfall,
        cashAmount: cashAmount,
        cardId: rescueCardId,
        options: cashAmount > 0 && canCardWaive ? ["cash", "card"] : cashAmount > 0 ? ["cash"] : ["card"]
      }, choice);
    }
    if (choice === "cash" && cashAmount <= 0) choice = "card";
    if (choice === "card" && !canCardWaive) choice = "cash";

    this.state.companion.rescueUsed = true;
    player.statuses.protectionTurns = Math.max(player.statuses.protectionTurns, DATA.config.rescueProtectionTurns);
    player.stats.rescues += 1;
    if (choice === "cash" && donor && cashAmount > 0) {
      await this._takeMoney(donor, cashAmount, "companionRescueTransfer");
      await this._gainMoney(player, cashAmount, "companionRescue");
      await this._emit({ type: "companionRescue", playerId: player.id, donorId: donor.id, mode: "cash", amount: cashAmount, protectionTurns: DATA.config.rescueProtectionTurns });
      return { waived: false };
    }
    var cardId = rescueCardId;
    await this._emit({ type: "cardGranted", playerId: player.id, cardId: cardId, source: "companionRescue", immediatelyUsed: true });
    await this._emit({ type: "companionRescue", playerId: player.id, donorId: donor ? donor.id : null, mode: "card", cardId: cardId, amount: 0, protectionTurns: DATA.config.rescueProtectionTurns });
    return { waived: true };
  };

  YiminGameEngine.prototype._mandatoryTransfer = async function (payer, payee, amount, reason, context) {
    amount = Math.max(0, asInt(amount, 0));
    context = Object.assign({ kind: reason }, context || {});
    var funding = await this._ensureFunds(payer, amount, context);
    if (funding.waived) {
      await this._emit({ type: "paymentWaived", playerId: payer.id, recipientId: payee ? payee.id : null, amount: amount, reason: reason, source: "companionRescue" });
      return { paid: 0, waived: true };
    }
    var paid = await this._takeMoney(payer, amount, reason);
    if (payee && paid) {
      payee.money += paid;
      await this._emit({ type: "moneyChanged", playerId: payee.id, delta: paid, balance: payee.money, reason: reason + "Received", fromPlayerId: payer.id });
    }
    if (paid < amount) await this._markBankrupt(payer, reason, amount - paid);
    return { paid: paid, waived: false };
  };

  YiminGameEngine.prototype._mandatoryCharge = async function (player, amount, reason, context) {
    amount = Math.max(0, asInt(amount, 0));
    context = Object.assign({ kind: "systemPenalty" }, context || {});
    var funding = await this._ensureFunds(player, amount, context);
    if (funding.waived) {
      await this._emit({ type: "paymentWaived", playerId: player.id, amount: amount, reason: reason, source: "companionRescue" });
      return { paid: 0, waived: true };
    }
    var paid = await this._takeMoney(player, amount, reason);
    player.stats.penaltiesPaid += paid;
    if (paid < amount) await this._markBankrupt(player, reason, amount - paid);
    return { paid: paid, waived: false };
  };

  YiminGameEngine.prototype._markBankrupt = async function (player, reason, unpaid) {
    if (player.bankrupt) return;
    player.money = Math.max(0, player.money);
    player.bankPrincipal = 0;
    player.bankInterest = 0;
    player.hand = [];
    player.bankrupt = true;
    player.eliminatedAt = this.state.globalTurn;
    if (this._turnContext) this._turnContext.bankruptcyOccurred = true;
    if (this.state.economyPressure) {
      this.state.economyPressure.actionsWithoutBankruptcy = 0;
      this.state.economyPressure.level = 0;
    }
    Object.keys(player.statuses).forEach(function (key) {
      player.statuses[key] = typeof player.statuses[key] === "boolean" ? false : 0;
    });
    this.state.board.forEach(function (tile) {
      if (tile.type === "property" && tile.ownerId === player.id) {
        tile.ownerId = null;
        tile.level = 1;
        tile.totalInvested = 0;
      }
    });
    await this._emit({ type: "playerBankrupt", playerId: player.id, reason: reason || "insolvent", unpaid: Math.max(0, asInt(unpaid, 0)) });
  };

  YiminGameEngine.prototype._aiShouldBuy = function (player, tile) {
    var property = DATA.properties[tile.propertyId];
    var tier = DATA.propertyTiers[property.tier];
    var difficulty = this.state.settings && this.state.settings.difficulty || "normal";
    var hard = difficulty === "hard" || difficulty === "challenging" || difficulty === "高手";
    var easy = difficulty === "easy" || difficulty === "relaxed" || difficulty === "gentle" || difficulty === "轻松";
    var reserve = property.tier === "high" ? (hard ? 900 : easy ? 1500 : 1200) : (hard ? 450 : easy ? 850 : 600);
    return player.money - tier.buyPrice >= reserve;
  };

  YiminGameEngine.prototype._aiShouldUpgrade = async function (player, tile) {
    var property = DATA.properties[tile.propertyId];
    var tier = DATA.propertyTiers[property.tier];
    var cost = tier.upgradeCosts[tile.level - 1];
    var difficulty = this.state.settings && this.state.settings.difficulty || "normal";
    var hard = difficulty === "hard" || difficulty === "challenging" || difficulty === "高手";
    var easy = difficulty === "easy" || difficulty === "relaxed" || difficulty === "gentle" || difficulty === "轻松";
    var reserve = hard ? 600 : easy ? 1050 : 800;
    if (player.money - cost < reserve) return false;
    var streak = this.state.companion.yiminNegativeRoundStreak;
    var alreadyHelped = this.state.companion.waterGivenBy.indexOf(player.id) >= 0;
    if (this.state.mode === "companion" && (!this.state.settings || this.state.settings.careMode !== false) && streak >= 2 && !alreadyHelped) {
      this.state.companion.waterGivenBy.push(player.id);
      await this.drawCard(player.id, "companionWater");
      await this._emit({ type: "companionWater", playerId: player.id, yiminNegativeRoundStreak: streak, skippedUpgradeTileId: tile.id });
      return false;
    }
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
    var pool = (positive ? DATA.cardPools.positive : DATA.cardPools.negative).filter(function (cardId) {
      var definition = DATA.cards[cardId];
      var drawn = player.stats.cardDrawsById[cardId] || 0;
      return !definition.maxDrawsPerPlayer || drawn < definition.maxDrawsPerPlayer;
    });
    if (!pool.length) pool = (positive ? DATA.cardPools.negative : DATA.cardPools.positive).slice();
    var cardId = this._pick(pool);
    await this._giveCard(player, cardId, source || "draw");
    return cardId;
  };

  YiminGameEngine.prototype._giveCard = async function (player, cardId, source) {
    var card = DATA.cards[cardId];
    if (!card || player.bankrupt) return false;
    player.stats.cardsDrawn += 1;
    player.stats.cardDrawsById[cardId] = (player.stats.cardDrawsById[cardId] || 0) + 1;
    await this._emit({ type: "cardDrawn", playerId: player.id, cardId: cardId, source: source || "draw" });

    if (card.effect === "skipSelf") {
      await this._addSkip(player, 1, "lazyCard");
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
    if (card.timing === "reaction" || card.timing === "skipReaction") return false;
    if (card.effect === "moveThree" && player.statuses.progressReady) return false;
    if (card.effect === "extraRoll" && player.statuses.luckReady) return false;
    if (card.effect === "skipTarget") {
      var eligible = this.state.players.filter(function (candidate) {
        return candidate.id !== player.id && !candidate.bankrupt && candidate.statuses.skipTurns === 0;
      });
      if (!eligible.length) return false;
      var targetId = options.targetId;
      if (!this._validTarget(player, targetId) || this._player(targetId).statuses.skipTurns > 0) {
        if (player.isHuman) {
          targetId = await this._choose({ type: "punishTarget", playerId: player.id, cardId: cardId, options: eligible.map(function (candidate) { return candidate.id; }) }, eligible[0].id);
        } else {
          eligible.sort(function (a, b) { return b.money - a.money; });
          targetId = eligible[0].id;
        }
      }
      options.targetId = targetId;
    }

    player.hand.splice(index, 1);
    player.stats.cardsUsed += 1;
    await this._emit({ type: "cardUsed", playerId: player.id, cardId: cardId, effect: card.effect, targetId: options.targetId || null });

    switch (card.effect) {
      case "skipTarget":
        await this._addSkip(this._player(options.targetId), 1, "punishCard");
        break;
      case "moveThree":
        player.statuses.progressReady = true;
        break;
      case "extraRoll":
        player.statuses.luckReady = true;
        break;
      case "shieldConsumption":
        player.statuses.consumptionShield += 1;
        break;
      case "redirectConsumption":
        player.statuses.bully += 1;
        break;
      case "lottery":
        await this._gainMoney(player, this._weightedLottery(), "lotteryCard");
        break;
      case "investment":
        if (this._random() < 0.5) await this._gainMoney(player, 2000, "investmentCardWin");
        else await this._applySystemPenalty(player, 1000, "investmentCardLoss", { allowReaction: true });
        break;
      case "doubleStart":
        player.statuses.doubleStart += 1;
        break;
      case "giveAll":
        await this._resolveGenerousCard(player);
        break;
      case "takeAll":
        await this._resolveCharmingCard(player);
        break;
      default:
        break;
    }
    return true;
  };

  YiminGameEngine.prototype._resolveGenerousCard = async function (player) {
    var others = this.state.players.filter(function (candidate) { return candidate.id !== player.id && !candidate.bankrupt; });
    for (var i = 0; i < others.length && player.money > 0; i += 1) {
      var amount = Math.min(200, player.money);
      await this._takeMoney(player, amount, "generousCard");
      others[i].money += amount;
      await this._emit({ type: "moneyChanged", playerId: others[i].id, delta: amount, balance: others[i].money, reason: "generousCardReceived", fromPlayerId: player.id });
    }
  };

  YiminGameEngine.prototype._resolveCharmingCard = async function (player) {
    var others = this.state.players.filter(function (candidate) { return candidate.id !== player.id && !candidate.bankrupt; });
    for (var i = 0; i < others.length; i += 1) {
      var amount = Math.min(200, others[i].money);
      await this._takeMoney(others[i], amount, "charmingCard");
      player.money += amount;
      if (amount) await this._emit({ type: "moneyChanged", playerId: player.id, delta: amount, balance: player.money, reason: "charmingCardReceived", fromPlayerId: others[i].id });
    }
  };

  YiminGameEngine.prototype._runAiPreTurnCards = async function (player) {
    var immediate = ["lottery", "investment", "salary", "charming"];
    for (var i = 0; i < immediate.length; i += 1) {
      if (player.hand.indexOf(immediate[i]) >= 0) {
        if (immediate[i] !== "investment" || player.money >= 1000) await this.useCard(immediate[i], { playerId: player.id });
        break;
      }
    }
    if (player.hand.indexOf("consume") >= 0 && player.statuses.consumptionShield === 0) {
      await this.useCard("consume", { playerId: player.id });
    } else if (player.hand.indexOf("bully") >= 0 && player.statuses.bully === 0) {
      await this.useCard("bully", { playerId: player.id });
    }
    if (player.hand.indexOf("punish") >= 0 && this._random() < 0.3) await this.useCard("punish", { playerId: player.id });
    if (player.hand.indexOf("progress") >= 0 && this._random() < 0.3) await this.useCard("progress", { playerId: player.id });
    if (player.hand.indexOf("luck") >= 0 && this._random() < 0.4) await this.useCard("luck", { playerId: player.id });
    if (player.hand.indexOf("generous") >= 0 && player.money >= 2600 && player.persona === "甜妹") await this.useCard("generous", { playerId: player.id });
  };

  YiminGameEngine.prototype._addSkip = async function (player, turns, reason) {
    if (!player || player.bankrupt) return false;
    var immunityIndex = player.hand.indexOf("immunity");
    var blocked = false;
    if (immunityIndex >= 0) {
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
      await this._emit({ type: "cardUsed", playerId: player.id, cardId: "immunity", effect: "cancelSkip", reason: reason });
      return false;
    }
    player.statuses.skipTurns += Math.max(1, asInt(turns, 1));
    this._noteNegative(player, reason || "skip");
    await this._emit({ type: "skipAdded", playerId: player.id, turns: turns, total: player.statuses.skipTurns, reason: reason || "skip" });
    return true;
  };

  YiminGameEngine.prototype._resolveLifeEvent = async function (player, tile) {
    var event = DATA.lifeEvents[tile.lifeEventId];
    if (!event) return;
    await this._emit({ type: "lifeEvent", playerId: player.id, tileId: tile.id, lifeEventId: event.id, name: event.name, text: event.text });
    switch (event.effect) {
      case "fine":
        await this._applySystemPenalty(player, event.amount, event.id, { allowReaction: true });
        break;
      case "randomFine":
        await this._applySystemPenalty(player, this._pick(event.amounts), event.id, { allowReaction: true });
        break;
      case "gain":
        await this._gainMoney(player, event.amount, event.id);
        break;
      case "percentFine":
        await this._applySystemPenalty(player, Math.floor(player.money * event.rate), event.id, { allowReaction: true });
        break;
      case "lottery":
        await this._gainMoney(player, this._weightedLottery(), event.id);
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
      var aiTargets = this.state.players.filter(function (candidate) { return candidate.id !== player.id && !candidate.bankrupt && candidate.id !== "yimin"; });
      if (!aiTargets.length) aiTargets = this.state.players.filter(function (candidate) { return candidate.id !== player.id && !candidate.bankrupt; });
      aiTargets.sort(function (a, b) { return b.money - a.money; });
      response = { cardId: "reflect", targetId: aiTargets.length ? aiTargets[0].id : null };
    } else if (hasImmunity) {
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
    var totals = {};
    this.state.players.forEach(function (player) { totals[player.id] = 0; });
    this.state.board.forEach(function (propertyTile) {
      if (propertyTile.type === "property" && propertyTile.ownerId) totals[propertyTile.ownerId] += propertyTile.level;
    });
    var max = Math.max.apply(Math, Object.keys(totals).map(function (id) { return totals[id]; }));
    if (max <= 0) {
      await this._emit({ type: "cityInspection", playerId: landingPlayer.id, tileId: tile.id, affectedPlayerIds: [], maxLevelSum: 0 });
      return;
    }
    var affected = this.state.players.filter(function (player) { return !player.bankrupt && totals[player.id] === max; });
    var self = this;
    affected.forEach(function (player) {
      var appliedTurns = self._turnContext && self._turnContext.freezeActiveAtStart && self._turnContext.playerId === player.id ? 2 : 1;
      player.statuses.incomeFreezeTurns = Math.max(player.statuses.incomeFreezeTurns, appliedTurns);
    });
    await this._emit({ type: "cityInspection", playerId: landingPlayer.id, tileId: tile.id, affectedPlayerIds: affected.map(function (player) { return player.id; }), maxLevelSum: max });
  };

  YiminGameEngine.prototype._resolveReview = async function (player, tile) {
    var owned = this.state.board.filter(function (candidate) { return candidate.type === "property" && candidate.ownerId; });
    var amount = 300;
    var referenceTileId = null;
    if (owned.length) {
      var maxLevel = Math.max.apply(Math, owned.map(function (candidate) { return candidate.level; }));
      var highest = owned.filter(function (candidate) { return candidate.level === maxLevel; });
      highest.sort(function (a, b) {
        var aProperty = DATA.properties[a.propertyId];
        var bProperty = DATA.properties[b.propertyId];
        var aRevenue = DATA.propertyTiers[aProperty.tier].revenue[a.level - 1];
        var bRevenue = DATA.propertyTiers[bProperty.tier].revenue[b.level - 1];
        return bRevenue - aRevenue || a.index - b.index;
      });
      var reference = highest[0];
      var property = DATA.properties[reference.propertyId];
      amount = DATA.propertyTiers[property.tier].revenue[reference.level - 1];
      referenceTileId = reference.id;
    }
    await this._gainMoney(player, amount, "yiminReview");
    await this._emit({ type: "reviewReward", playerId: player.id, tileId: tile.id, amount: amount, referenceTileId: referenceTileId });
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
      else await this._emit({ type: "gameMomentCompleted", playerId: player.id, gameMomentId: moment.id });
      return;
    }
    if (moment.id === "diceDuel") await this._resolveDiceDuel(player);
    if (moment.id === "rps") await this._resolveRps(player);
  };

  YiminGameEngine.prototype._applyGameFailure = async function (player, reason) {
    var amount = clamp(Math.floor(player.money * DATA.config.taskRefusalRate), DATA.config.taskRefusalMin, DATA.config.taskRefusalMax);
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
