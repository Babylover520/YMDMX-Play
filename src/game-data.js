(function (root) {
  "use strict";

  var propertyTiers = {
    milkTea: { id: "milkTea", name: "奶茶系列", buyPrice: 800, upgradeCosts: [450, 700, 1000], consume: [200, 350, 550, 850] },
    fruit: { id: "fruit", name: "水果", buyPrice: 850, upgradeCosts: [500, 750, 1050], consume: [220, 380, 600, 900] },
    snack: { id: "snack", name: "小吃", buyPrice: 900, upgradeCosts: [500, 800, 1100], consume: [240, 410, 650, 980] },
    dessert: { id: "dessert", name: "甜品", buyPrice: 950, upgradeCosts: [550, 850, 1200], consume: [260, 450, 700, 1050] },
    bookstore: { id: "bookstore", name: "书店", buyPrice: 1000, upgradeCosts: [600, 900, 1250], consume: [280, 480, 750, 1150] },
    pet: { id: "pet", name: "宠物", buyPrice: 1100, upgradeCosts: [650, 1000, 1350], consume: [320, 530, 820, 1250] },
    cinema: { id: "cinema", name: "影院", buyPrice: 1200, upgradeCosts: [700, 1100, 1500], consume: [360, 590, 900, 1350] },
    wellness: { id: "wellness", name: "养生", buyPrice: 1300, upgradeCosts: [750, 1200, 1650], consume: [400, 650, 1000, 1500] },
    lodging: { id: "lodging", name: "住宿", buyPrice: 1400, upgradeCosts: [800, 1300, 1800], consume: [440, 720, 1100, 1650] },
    mall: { id: "mall", name: "商场", buyPrice: 1500, upgradeCosts: [850, 1400, 1950], consume: [480, 790, 1200, 1800] }
  };

  var properties = {
    milkTea: {
      id: "milkTea", name: "推车奶茶", seriesName: "奶茶系列", tier: "milkTea", emoji: "🥤",
      levelNames: ["推车奶茶", "奶茶小店", "连锁奶茶", "知名奶茶"],
      flavor: "买了杯 QQ 捏捏好吃到咩扑茶，付款 {amount} 快乐币。"
    },
    bookstore: {
      id: "bookstore", name: "街角书摊", seriesName: "书店", tier: "bookstore", emoji: "📚",
      levelNames: ["街角书摊", "独立书店", "连锁书吧", "市图书馆"],
      flavor: "买了本小说，付款 {amount} 快乐币。"
    },
    snack: {
      id: "snack", name: "夜市小摊", seriesName: "小吃", tier: "snack", emoji: "🍢",
      levelNames: ["夜市小摊", "苍蝇馆子", "美食连锁", "米其林"],
      flavor: "买了份蒜香排骨，付款 {amount} 快乐币。"
    },
    wellness: {
      id: "wellness", name: "按摩店", seriesName: "养生", tier: "wellness", emoji: "🍵",
      levelNames: ["按摩店", "温泉汤池", "高端会所", "康养圣地"],
      flavor: "体验了一次精油 spa，付款 {amount} 快乐币。"
    },
    dessert: {
      id: "dessert", name: "手作甜品", seriesName: "甜品", tier: "dessert", emoji: "🍰",
      levelNames: ["手作甜品", "网红甜品", "连锁烘焙", "超级糖果"],
      flavor: "买了份定制小蛋糕，付款 {amount} 快乐币。"
    },
    pet: {
      id: "pet", name: "流浪猫窝", seriesName: "宠物", tier: "pet", emoji: "🐾",
      levelNames: ["流浪猫窝", "宠物小店", "萌宠乐园", "动物世界"],
      flavor: "与宠物共度美好时光，门票 {amount} 快乐币。"
    },
    fruit: {
      id: "fruit", name: "水果摊", seriesName: "水果", tier: "fruit", emoji: "🍓",
      levelNames: ["水果摊", "水果店", "连锁果店", "品牌果商"],
      flavor: "买了个 {item}，付款 {amount} 快乐币。",
      items: ["草莓", "芒果", "西瓜", "葡萄", "水蜜桃"]
    },
    lodging: {
      id: "lodging", name: "青年旅社", seriesName: "住宿", tier: "lodging", emoji: "🏡",
      levelNames: ["青年旅社", "特色民宿", "连锁酒店", "私家庄园"],
      flavor: "与朋友住宿 1 次，付款 {amount} 快乐币。"
    },
    cinema: {
      id: "cinema", name: "马戏团", seriesName: "影院", tier: "cinema", emoji: "🎬",
      levelNames: ["马戏团", "露天影院", "连锁影院", "影视王国"],
      flavor: "看了场电影，付款 {amount} 快乐币。"
    },
    mall: {
      id: "mall", name: "挑货郎", seriesName: "商场", tier: "mall", emoji: "🛍️",
      levelNames: ["挑货郎", "解忧货铺", "连锁超市", "超级商场"],
      flavor: "买了 {item}，付款 {amount} 快乐币。",
      items: ["发卡", "香薰", "帆布包", "手机壳", "小摆件"]
    }
  };

  var lifeEvents = {
    trafficLight: { id: "trafficLight", name: "闯红灯了", text: "过马路闯红灯了，被罚款 200 快乐币。", effect: "fine", amount: 200 },
    compliment: { id: "compliment", name: "被夸好看", text: "被一个小朋友夸好看，脸红的时候被他偷走 {amount} 快乐币。", effect: "randomFine", amounts: [100, 200, 300, 400, 500] },
    flowers: { id: "flowers", name: "收到鲜花", text: "路边卖鲜花的老板送了你一束鲜花，很开心，+300 快乐币。", effect: "gain", amount: 300 },
    failedInvestment: { id: "failedInvestment", name: "投资被骗", text: "被朋友忽悠一起投资，项目失败，损失 30% 快乐币。", effect: "percentFine", rate: 0.3 },
    lottery: { id: "lottery", name: "彩票中奖", text: "买彩票中奖了，增加 {amount} 快乐币。", effect: "lottery" },
    novel: { id: "novel", name: "通宵看书", text: "通宵看小说没睡觉，精神状态下降，减少 200 快乐币。", effect: "fine", amount: 200 },
    carried: { id: "carried", name: "王者连胜", text: "搭子喊你上线打王者，被带飞了，+500 快乐币。", effect: "gain", amount: 500 },
    shopping: { id: "shopping", name: "闺闺血拼", text: "闺闺约你出门逛街买买买，扣除当前现金的 10%。", effect: "percentFine", rate: 0.1 },
    lateGame: { id: "lateGame", name: "熬夜游戏", text: "熬夜单排体力下降，暂停一会。", effect: "skip", turns: 1 },
    milkTeaGift: { id: "milkTeaGift", name: "奶茶请客", text: "暗恋的人给你点奶茶，很开心，快乐币增加 100。", effect: "gain", amount: 100 }
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
    diceDuel: { id: "diceDuel", name: "掷骰子", prompts: [] },
    rps: { id: "rps", name: "石头剪刀布", prompts: [] }
  };

  var cards = {
    fullHealth: { id: "fullHealth", name: "满血卡", category: "positive", timing: "skipReaction", effect: "cancelSkip", text: "解除一次跳过行动状态。" },
    lazy: { id: "lazy", name: "摆烂卡", category: "negative", timing: "draw", effect: "skipSelf", text: "抽到后立即跳过下一次行动。" },
    punish: { id: "punish", name: "惩罚卡", category: "negative", timing: "draw", effect: "skipTarget", text: "抽到后立即选择一名其他玩家，使其暂停下一次行动。" },
    luck: { id: "luck", name: "好运卡", category: "positive", timing: "draw", effect: "extraRoll", text: "周末睡到自然醒，精力充沛，可多一次掷骰子机会。" },
    immunity: { id: "immunity", name: "免惩卡", category: "positive", timing: "reaction", effect: "cancelPenalty", text: "抵消一次系统罚款、跳过行动或游戏失败惩罚。" },
    consume: { id: "consume", name: "消费卡", category: "positive", timing: "automatic", effect: "shieldConsumption", text: "抵消下一次真正触发的他人地产消费。" },
    lottery: { id: "lottery", name: "彩票卡", category: "positive", timing: "draw", effect: "lottery", text: "立即刮奖，获得 1,000、2,000 或 3,000 快乐币。" },
    investment: { id: "investment", name: "投资卡", category: "positive", timing: "draw", effect: "investment", text: "立即揭晓：一半机会 +2,000，一半机会 -1,000。", maxDrawsPerPlayer: 1 },
    generous: { id: "generous", name: "好人卡", category: "negative", timing: "draw", effect: "giveAll", text: "立即给每名其他未破产玩家 200 快乐币。" },
    charming: { id: "charming", name: "迷人卡", category: "positive", timing: "draw", effect: "takeAll", text: "立即由每名其他未破产玩家向你支付 200 快乐币。" },
    reflect: { id: "reflect", name: "反弹卡", category: "positive", timing: "reaction", effect: "reflectPenalty", text: "把一次系统罚款或游戏失败惩罚反弹给指定玩家。" }
  };

  var board = [
    { id: "tile-0", index: 0, type: "start", name: "温暖小窝", emoji: "🏠" },
    { id: "tile-1", index: 1, type: "property", propertyId: "milkTea", name: properties.milkTea.name, emoji: properties.milkTea.emoji },
    { id: "tile-2", index: 2, type: "life", lifeEventId: "trafficLight", name: lifeEvents.trafficLight.name, emoji: "🚦" },
    { id: "tile-3", index: 3, type: "life", lifeEventId: "flowers", name: lifeEvents.flowers.name, emoji: "💐" },
    { id: "tile-4", index: 4, type: "property", propertyId: "bookstore", name: properties.bookstore.name, emoji: properties.bookstore.emoji },
    { id: "tile-5", index: 5, type: "gameMoment", gameMomentIds: ["truth", "dare", "diceDuel", "rps"], name: "游戏互动", emoji: "🎭" },
    { id: "tile-6", index: 6, type: "life", lifeEventId: "compliment", name: lifeEvents.compliment.name, emoji: "✨" },
    { id: "tile-7", index: 7, type: "property", propertyId: "snack", name: properties.snack.name, emoji: properties.snack.emoji },
    { id: "tile-8", index: 8, type: "idle", name: "发呆时刻", emoji: "☁️" },
    { id: "tile-9", index: 9, type: "bank", name: "世界银行", emoji: "🏦" },
    { id: "tile-10", index: 10, type: "property", propertyId: "wellness", name: properties.wellness.name, emoji: properties.wellness.emoji },
    { id: "tile-11", index: 11, type: "delivery", name: "去送外卖", emoji: "🛵" },
    { id: "tile-12", index: 12, type: "property", propertyId: "dessert", name: properties.dessert.name, emoji: properties.dessert.emoji },
    { id: "tile-13", index: 13, type: "cityInspection", name: "城管检查", emoji: "📋" },
    { id: "tile-14", index: 14, type: "life", lifeEventId: "failedInvestment", name: lifeEvents.failedInvestment.name, emoji: "📉" },
    { id: "tile-15", index: 15, type: "safe", name: "休息时间", emoji: "🌿" },
    { id: "tile-16", index: 16, type: "property", propertyId: "pet", name: properties.pet.name, emoji: properties.pet.emoji },
    { id: "tile-17", index: 17, type: "adventure", name: "冒险时间", emoji: "🧭" },
    { id: "tile-18", index: 18, type: "life", lifeEventId: "lottery", name: lifeEvents.lottery.name, emoji: "🎟️" },
    { id: "tile-19", index: 19, type: "property", propertyId: "fruit", name: properties.fruit.name, emoji: properties.fruit.emoji },
    { id: "tile-20", index: 20, type: "gameMoment", gameMomentIds: ["truth", "dare", "diceDuel", "rps"], name: "游戏互动", emoji: "🎲" },
    { id: "tile-21", index: 21, type: "life", lifeEventId: "novel", name: lifeEvents.novel.name, emoji: "📖" },
    { id: "tile-22", index: 22, type: "life", lifeEventId: "lateGame", name: lifeEvents.lateGame.name, emoji: "🌙" },
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
    "温暖小窝", "推车奶茶", "闯红灯了", "收到鲜花", "街角书摊",
    "游戏互动", "被夸好看", "夜市小摊", "发呆时刻", "世界银行",
    "按摩店", "去送外卖", "手作甜品", "城管检查", "投资被骗",
    "休息时间", "流浪猫窝", "冒险时间", "彩票中奖", "水果摊",
    "游戏互动", "通宵看书", "熬夜游戏", "青年旅社", "王者连胜",
    "命运时刻", "马戏团", "闺闺血拼", "挑货郎", "游戏连跪",
    "伊敏测评", "奶茶请客"
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
    delivery: { name: "去送外卖", color: "#f29a57" },
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
    version: 3,
    config: {
      mode: "companion",
      boardSize: board.length,
      playerCount: 4,
      initialMoney: 2000,
      handLimit: 5,
      actionChainCap: 8,
      startReward: 500,
      safeMoneyReward: 300,
      collisionBaseFee: 200,
      collisionBackSteps: 3,
      bankInterestRate: 0.05,
      bankInterestCap: 2000,
      propertySaleRate: 0.7,
      forcedConsumptionLayers: 3,
      taskRefusalRate: 0.1,
      terminalPressureStartRound: 41,
      terminalPressureBands: [
        { minRound: 41, maxRound: 60, base: 50, step: 15 },
        { minRound: 61, maxRound: 80, base: 350, step: 20 },
        { minRound: 81, maxRound: null, base: 750, step: 25 }
      ],
      terminalPressureMultipliers: { 4: 1, 3: 0.45, 2: 0.13 },
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
      negativeWeight: 0.4
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
