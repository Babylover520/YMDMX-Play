(function (root) {
  "use strict";

  var propertyTiers = {
    low: {
      id: "low",
      name: "轻松小店",
      buyPrice: 500,
      upgradeCosts: [200, 400, 600],
      consume: [100, 200, 300, 450],
      revenue: [280, 420, 600, 850]
    },
    mid: {
      id: "mid",
      name: "人气店铺",
      buyPrice: 800,
      upgradeCosts: [400, 600, 900],
      consume: [200, 350, 500, 700],
      revenue: [410, 650, 950, 1350]
    },
    high: {
      id: "high",
      name: "梦想产业",
      buyPrice: 1200,
      upgradeCosts: [500, 900, 1300],
      consume: [300, 450, 650, 850],
      revenue: [620, 1000, 1450, 2100]
    }
  };

  var properties = {
    milkTea: { id: "milkTea", name: "奶茶铺", tier: "low", emoji: "🥤" },
    bookstore: { id: "bookstore", name: "治愈书店", tier: "mid", emoji: "📚" },
    snack: { id: "snack", name: "快乐小吃摊", tier: "low", emoji: "🍢" },
    wellness: { id: "wellness", name: "养生馆", tier: "high", emoji: "🍵" },
    dessert: { id: "dessert", name: "甜品屋", tier: "low", emoji: "🍰" },
    pet: { id: "pet", name: "宠物乐园", tier: "mid", emoji: "🐾" },
    fruit: { id: "fruit", name: "鲜果铺", tier: "low", emoji: "🍓" },
    lodging: { id: "lodging", name: "云朵民宿", tier: "high", emoji: "🏡" },
    cinema: { id: "cinema", name: "星光影院", tier: "mid", emoji: "🎬" },
    mall: { id: "mall", name: "梦想商场", tier: "high", emoji: "🛍️" }
  };

  var lifeEvents = {
    trafficLight: { id: "trafficLight", name: "闯红灯", text: "着急赶路，被开了一张罚单。", effect: "fine", amount: 200 },
    compliment: { id: "compliment", name: "被夸好看", text: "心情一好，请大家喝了点东西。", effect: "randomFine", amounts: [100, 200, 300, 400, 500] },
    failedInvestment: { id: "failedInvestment", name: "投资失败", text: "一次不太成功的理财尝试。", effect: "percentFine", rate: 0.3 },
    lottery: { id: "lottery", name: "彩票中奖", text: "好运刚好落到你的口袋里。", effect: "lottery" },
    novel: { id: "novel", name: "通宵看小说", text: "结局很好看，黑眼圈也很真实。", effect: "fine", amount: 200 },
    carried: { id: "carried", name: "被带飞", text: "靠谱队友把这一局稳稳接住。", effect: "gain", amount: 500 },
    shopping: { id: "shopping", name: "逛街买买买", text: "快乐是真的，账单也是真的。", effect: "fine", amount: 500 },
    milkTeaGift: { id: "milkTeaGift", name: "收到奶茶", text: "甜度刚好，今天也刚好。", effect: "gain", amount: 100 }
  };

  var gameMoments = {
    truth: {
      id: "truth",
      name: "真心话",
      prompts: [
        "最近一次忍不住偷笑是因为什么？",
        "说一件朋友做过、你一直记得的小事。",
        "最近最想奖励自己的东西是什么？",
        "最近哪一顿饭让你觉得特别满足？",
        "如果今天可以多出两个小时，你会拿来做什么？",
        "最近发现自己变厉害的一件事是什么？",
        "说一个最近循环播放的歌或视频。",
        "哪一种天气最容易让你心情变好？",
        "如果可以立刻学会一项技能，你会选什么？",
        "最近有什么小事让你觉得很幸运？",
        "你最喜欢大家怎么称呼你？",
        "说一个你百吃不厌的食物。",
        "最近一次给自己点赞是因为什么？",
        "如果现在出发旅行，你最想先去哪里？",
        "哪一部作品是你愿意再看一遍的？",
        "你心目中最舒服的周末是什么样？",
        "最近有没有一个想坚持的小习惯？",
        "如果能拥有一家小店，你想开什么店？",
        "说一个能快速让你开心起来的小办法。",
        "你最喜欢朋友身上的哪一种品质？",
        "哪一种香味会让你觉得很安心？",
        "最近拍到的照片里，你最喜欢哪一张？",
        "如果今天有一个主题色，你会选什么颜色？",
        "小时候最喜欢的一种零食是什么？",
        "如果可以给明天的自己留一句话，你会说什么？"
      ]
    },
    dare: {
      id: "dare",
      name: "大冒险",
      prompts: [
        "用播音腔夸自己三句话。",
        "模仿一个常用表情包五秒钟。",
        "给在场每个人送上一句不重复的夸奖。",
        "用三种不同语气说‘今天会有好运’。",
        "摆一个你觉得最可爱的拍照姿势。",
        "用十秒钟演出‘刚刚中了大奖’。",
        "哼一小段大家都熟悉的旋律。",
        "用一句话为今天的聚会取一个电影名。",
        "闭眼画一颗爱心，再向大家展示作品。",
        "用手势比画一种食物，让大家来猜。",
        "模仿一种手机提示音，直到有人猜中。",
        "给自己颁一个有趣的小奖，并发表获奖感言。",
        "用天气预报的语气播报现在的气氛。",
        "用五个词编一个迷你故事。",
        "摆出三个连续动作，让下一位玩家照着做。",
        "用一句广告词推荐你最喜欢的零食。",
        "用夸张的慢动作喝一口水。",
        "给大家表演一个无声的开心表情。",
        "用一句押韵的话祝下一位玩家好运。",
        "假装自己是导游，介绍眼前这个房间。",
        "用三秒钟设计一个专属胜利动作。",
        "选择一种动物，用动作演出来让大家猜。",
        "把自己的名字编进一句可爱的口号里。",
        "用一句话给当前排名做一段趣味解说。",
        "任选身边一件物品，为它设计一句宣传语。"
      ]
    },
    diceDuel: { id: "diceDuel", name: "比骰子", prompts: [] },
    rps: { id: "rps", name: "石头剪刀布", prompts: [] }
  };

  var cards = {
    fullHealth: { id: "fullHealth", name: "满血卡", category: "positive", timing: "skipReaction", effect: "cancelSkip", text: "解除一次跳过行动状态。" },
    lazy: { id: "lazy", name: "摆烂卡", category: "negative", timing: "draw", effect: "skipSelf", text: "抽到后立即跳过下一次行动。" },
    punish: { id: "punish", name: "惩罚卡", category: "negative", timing: "turn", effect: "skipTarget", text: "选择一名其他玩家，使其跳过下一次行动。" },
    progress: { id: "progress", name: "进步卡", category: "positive", timing: "beforeRoll", effect: "moveThree", text: "本回合直接前进 3 格，不再掷主骰。" },
    luck: { id: "luck", name: "好运卡", category: "positive", timing: "beforeRoll", effect: "extraRoll", text: "第一次移动后再掷一次骰。" },
    immunity: { id: "immunity", name: "免惩卡", category: "positive", timing: "reaction", effect: "cancelPenalty", text: "抵消一次系统罚款、跳过行动或游戏失败惩罚。" },
    consume: { id: "consume", name: "消费卡", category: "positive", timing: "turn", effect: "shieldConsumption", text: "免除下一次他人经营地产消费。" },
    bully: { id: "bully", name: "霸王卡", category: "positive", timing: "turn", effect: "redirectConsumption", text: "下一次消费由现金最高的其他玩家代付。" },
    lottery: { id: "lottery", name: "彩票卡", category: "positive", timing: "turn", effect: "lottery", text: "获得 1,000、2,000 或 3,000 快乐币。" },
    investment: { id: "investment", name: "投资卡", category: "positive", timing: "turn", effect: "investment", text: "一半机会 +2,000，一半机会 -1,000。", maxDrawsPerPlayer: 1 },
    salary: { id: "salary", name: "加薪卡", category: "positive", timing: "turn", effect: "doubleStart", text: "下次经过起点时，起点奖励翻倍。" },
    generous: { id: "generous", name: "好人卡", category: "negative", timing: "turn", effect: "giveAll", text: "给每名其他未破产玩家 200 快乐币。" },
    charming: { id: "charming", name: "迷人卡", category: "positive", timing: "turn", effect: "takeAll", text: "每名其他未破产玩家向你支付 200 快乐币。" },
    reflect: { id: "reflect", name: "反弹卡", category: "positive", timing: "reaction", effect: "reflectPenalty", text: "把一次系统罚款或游戏失败惩罚反弹给指定玩家。" }
  };

  var board = [
    { id: "tile-0", index: 0, type: "start", name: "温暖小窝", emoji: "🏠" },
    { id: "tile-1", index: 1, type: "property", propertyId: "milkTea", name: properties.milkTea.name, emoji: properties.milkTea.emoji },
    { id: "tile-2", index: 2, type: "life", lifeEventId: "trafficLight", name: lifeEvents.trafficLight.name, emoji: "🚦" },
    { id: "tile-3", index: 3, type: "safe", name: "休息时间", emoji: "🌿" },
    { id: "tile-4", index: 4, type: "property", propertyId: "bookstore", name: properties.bookstore.name, emoji: properties.bookstore.emoji },
    { id: "tile-5", index: 5, type: "gameMoment", gameMomentIds: ["truth", "dare"], name: "真心话或大冒险", emoji: "🎭" },
    { id: "tile-6", index: 6, type: "life", lifeEventId: "compliment", name: lifeEvents.compliment.name, emoji: "✨" },
    { id: "tile-7", index: 7, type: "property", propertyId: "snack", name: properties.snack.name, emoji: properties.snack.emoji },
    { id: "tile-8", index: 8, type: "idle", name: "发呆时刻", emoji: "☁️" },
    { id: "tile-9", index: 9, type: "bank", name: "世界银行", emoji: "🏦" },
    { id: "tile-10", index: 10, type: "property", propertyId: "wellness", name: properties.wellness.name, emoji: properties.wellness.emoji },
    { id: "tile-11", index: 11, type: "delivery", name: "外卖配送", emoji: "🛵" },
    { id: "tile-12", index: 12, type: "property", propertyId: "dessert", name: properties.dessert.name, emoji: properties.dessert.emoji },
    { id: "tile-13", index: 13, type: "cityInspection", name: "城管检查", emoji: "📋" },
    { id: "tile-14", index: 14, type: "life", lifeEventId: "failedInvestment", name: lifeEvents.failedInvestment.name, emoji: "📉" },
    { id: "tile-15", index: 15, type: "safe", name: "休息时间", emoji: "🌿" },
    { id: "tile-16", index: 16, type: "property", propertyId: "pet", name: properties.pet.name, emoji: properties.pet.emoji },
    { id: "tile-17", index: 17, type: "adventure", name: "冒险时间", emoji: "🧭" },
    { id: "tile-18", index: 18, type: "life", lifeEventId: "lottery", name: lifeEvents.lottery.name, emoji: "🎟️" },
    { id: "tile-19", index: 19, type: "property", propertyId: "fruit", name: properties.fruit.name, emoji: properties.fruit.emoji },
    { id: "tile-20", index: 20, type: "gameMoment", gameMomentIds: ["diceDuel", "rps"], name: "掷骰子或猜拳", emoji: "🎲" },
    { id: "tile-21", index: 21, type: "life", lifeEventId: "novel", name: lifeEvents.novel.name, emoji: "📖" },
    { id: "tile-22", index: 22, type: "bank", name: "世界银行", emoji: "🏦" },
    { id: "tile-23", index: 23, type: "property", propertyId: "lodging", name: properties.lodging.name, emoji: properties.lodging.emoji },
    { id: "tile-24", index: 24, type: "life", lifeEventId: "carried", name: lifeEvents.carried.name, emoji: "🏆" },
    { id: "tile-25", index: 25, type: "fate", name: "命运时刻", emoji: "🔮" },
    { id: "tile-26", index: 26, type: "property", propertyId: "cinema", name: properties.cinema.name, emoji: properties.cinema.emoji },
    { id: "tile-27", index: 27, type: "life", lifeEventId: "shopping", name: lifeEvents.shopping.name, emoji: "🛍️" },
    { id: "tile-28", index: 28, type: "property", propertyId: "mall", name: properties.mall.name, emoji: properties.mall.emoji },
    { id: "tile-29", index: 29, type: "jail", name: "游戏连跪", emoji: "🎮" },
    { id: "tile-30", index: 30, type: "review", name: "伊敏测评", emoji: "⭐" },
    { id: "tile-31", index: 31, type: "life", lifeEventId: "milkTeaGift", name: lifeEvents.milkTeaGift.name, emoji: "🧋" }
  ];

  var mobileTileLabels = [
    "温暖小窝", "奶茶小铺", "红灯罚单", "休息时间", "治愈书店",
    "真心冒险", "被夸好看", "快乐小摊", "发呆时刻", "世界银行",
    "养生小馆", "外卖配送", "甜品小屋", "城管检查", "投资失败",
    "休息时间", "宠物乐园", "冒险时间", "彩票中奖", "鲜果小铺",
    "骰子猜拳", "通宵追书", "世界银行", "云朵民宿", "队友带飞",
    "命运时刻", "星光影院", "逛街买买", "梦想商场", "游戏连跪",
    "伊敏测评", "收到奶茶"
  ];

  board.forEach(function (tile) {
    tile.shortLabel = mobileTileLabels[tile.index];
  });

  var tileTypes = {
    start: { name: "温暖小窝", color: "#ef6a74" },
    property: { name: "经营地产", color: "#f4b84a" },
    life: { name: "生活模拟", color: "#7bbf9d" },
    safe: { name: "休息时间", color: "#76b7d9" },
    idle: { name: "发呆时刻", color: "#c8cad0" },
    bank: { name: "世界银行", color: "#477a67" },
    delivery: { name: "外卖配送", color: "#f29a57" },
    adventure: { name: "冒险时间", color: "#d26b52" },
    fate: { name: "命运时刻", color: "#8d71c4" },
    gameMoment: { name: "游戏时刻", color: "#e47ba3" },
    cityInspection: { name: "城管检查", color: "#6e7785" },
    review: { name: "伊敏测评", color: "#e0a527" },
    jail: { name: "游戏连跪", color: "#4b4b55" }
  };

  var players = [
    { id: "yimin", name: "伊敏", isHuman: true, persona: "主角", color: "#ef6a74", avatar: "敏" },
    { id: "guoguo", name: "果果", isHuman: false, persona: "软萌", color: "#4f9f83", avatar: "果" },
    { id: "kuku", name: "酷酷", isHuman: false, persona: "装酷", color: "#5279b8", avatar: "酷" },
    { id: "tiantian", name: "甜甜", isHuman: false, persona: "甜妹", color: "#d06c9a", avatar: "甜" }
  ];

  var dialogue = {
    guoguo: {
      buy: [
        "这家店看起来很可爱，我先收下啦。",
        "小店加入收藏，认真经营起来。",
        "这里让人很安心，我想把它照顾好。",
        "先轻轻买下，再慢慢变成宝藏店铺。",
        "门牌挂好啦，欢迎大家以后来玩。",
        "感觉和这家店很有缘，就决定是它啦。",
        "给它添点花花草草，一定会更可爱。",
        "今天又拥有一个小小的快乐据点。",
        "这间店归我守护啦，我会努力经营的。"
      ],
      pass: [
        "稳稳走，慢慢赚。",
        "不着急，好运正在前面排队。",
        "这一格很普通，心情还是软乎乎的。",
        "先看看风景，下一站再认真发挥。",
        "快乐币慢慢攒，快乐可不能少。",
        "轻轻松松走一圈，也很好呀。",
        "今天的路线看起来很温柔。",
        "每一步都算数，继续向前走啦。",
        "让我悄悄期待下一次掷骰子。"
      ],
      yiminDown: [
        "没关系，下一步说不定就是好运。",
        "伊敏别急，我把今天的好运分你一点。",
        "先喘口气，快乐币还会慢慢回来哒。",
        "这一格只是小插曲，我们继续玩。",
        "没事没事，下一把一定更顺。",
        "给你一个云朵抱抱，烦恼先放旁边。",
        "暂时落后也很可爱，慢慢追就好啦。",
        "我已经替你预约下一份好运了。",
        "我们都在呢，继续放心往前走吧。"
      ]
    },
    kuku: {
      buy: [
        "位置不错。眼光而已。",
        "地段可以，拿下。",
        "别误会，我只是刚好看中了。",
        "投资完成，计划之内。",
        "这家店有潜力，我先替它保管。",
        "嗯，品味不错，和我很搭。",
        "买了。接下来让数据说话。",
        "这个位置值得出手，判断没错。",
        "店归我了，低调庆祝一下。"
      ],
      pass: [
        "局势还在掌握中。",
        "普通一步，不影响整体判断。",
        "继续走，真正的机会还在后面。",
        "骰子挺有个性，我记住了。",
        "先让你们放松一下。",
        "这一格没动作，正好观察局势。",
        "节奏不错，继续。",
        "表面平静，其实我在计算。",
        "不慌，这局才刚刚热起来。"
      ],
      yiminDown: [
        "咳，这点小事，不算输。",
        "伊敏稳住，这只是暂时的数字变化。",
        "下一轮拿回来就行，很简单。",
        "别皱眉，我看局面还远没到糟糕的时候。",
        "先记一笔，等好运来还。",
        "输了这一小步，不等于输了整局。",
        "放心，还有我们在场。",
        "调整一下节奏，反击马上开始。",
        "这局对你还挺有意思，继续就对了。"
      ]
    },
    tiantian: {
      buy: [
        "新店开张，今天也要甜甜的。",
        "叮咚，甜甜的新店正式营业啦。",
        "这里以后就是快乐补给站。",
        "买下来，再给它加满甜度。",
        "我宣布，这家店今天开始走可爱路线。",
        "新店到手，先送大家一份开业好心情。",
        "这家店一看就很有旺旺的感觉。",
        "选址成功，下一步是把招牌点亮。",
        "快乐地图上又多了一颗小星星。"
      ],
      pass: [
        "好运正在路上呀。",
        "这一格先轻轻路过，下一格再闪亮登场。",
        "不管走到哪一格，都要保持甜度。",
        "骰子说今天适合慢慢玩。",
        "转一圈收集风景，也是在赢呀。",
        "下一站会不会有惊喜呢？",
        "我听见好运在前面喊我们啦。",
        "轻松前进，快乐加一。",
        "这一程很顺眼，继续出发。"
      ],
      yiminDown: [
        "先抱一下，快乐币还会再来。",
        "伊敏不难过，甜甜给你加一勺好运。",
        "刚才那格不算数，心情分还是满分。",
        "快乐币少一点没关系，快乐不能少。",
        "下一轮一定给你安排一个亮晶晶的结果。",
        "先喝一口水，我们漂亮地继续。",
        "这只是剧情需要，主角马上就会翻盘。",
        "我负责给你打气，你负责继续掷骰子。",
        "好运可能迟到一点，但它认得伊敏。"
      ]
    }
  };

  root.GAME_DATA = {
    version: 2,
    config: {
      mode: "companion",
      boardSize: board.length,
      playerCount: 4,
      initialMoney: 2000,
      handLimit: 5,
      actionChainCap: 8,
      insolvencyGraceActions: 240,
      insolvencyPressureStep: 200,
      startReward: 500,
      safeMoneyReward: 300,
      collisionFee: 100,
      collisionBackSteps: 2,
      bankInterestRate: 0.05,
      bankInterestCap: 2000,
      propertySaleRate: 0.7,
      forcedConsumptionLayers: 3,
      taskRefusalRate: 0.1,
      taskRefusalMin: 100,
      taskRefusalMax: 1000,
      rescueProtectionTurns: 3,
      rescueIncomeMultiplier: 0.7,
      logLimit: 160
    },
    board: board,
    tileTypes: tileTypes,
    propertyTiers: propertyTiers,
    properties: properties,
    lifeEvents: lifeEvents,
    gameMoments: gameMoments,
    cards: cards,
    cardPools: {
      positive: Object.keys(cards).filter(function (id) { return cards[id].category === "positive"; }),
      negative: Object.keys(cards).filter(function (id) { return cards[id].category === "negative"; }),
      positiveWeight: 0.6,
      negativeWeight: 0.4,
      negativeCardWeights: { lazy: 0.5, generous: 0.4, punish: 0.1 }
    },
    lottery: [
      { amount: 1000, weight: 0.6 },
      { amount: 2000, weight: 0.3 },
      { amount: 3000, weight: 0.1 }
    ],
    players: players,
    dialogue: dialogue
  };
})(typeof window !== "undefined" ? window : globalThis);
