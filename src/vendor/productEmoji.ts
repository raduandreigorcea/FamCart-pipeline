// Pick an emoji for a product from its name and maker.
//
// Two rules make this safe to extend:
//
// 1. Keywords match WHOLE WORDS, never substrings. "mar" (apple) must not match
//    "Margarina", "Marar" (dill), or the maker "Margaritar"; "bun" (bread roll)
//    must not match the maker "Bunica". All of those really did fire before.
//
// 2. The LONGEST matching keyword wins, so specificity beats position in this
//    list: "apa de gura" (mouthwash) outranks "apa" (water) no matter where its
//    rule sits. Equal-length keywords fall back to the order below — the few
//    places that relies on are called out inline.
//
// The maker is part of the haystack on purpose: sometimes it is the only signal
// ("Crema de Alune · Nutella" is chocolate, not peanuts). Whole-word matching is
// what makes that affordable.
//
// Romanian is inflected and matching is whole-word, so plurals and variants must
// be listed explicitly ("chifla" does not match "chifle").
const EMOJI_RULES = [
  // ─── Fruit ─────────────────────────────────────────────────────────────────
  { emoji: '🍎', keywords: ['mar', 'mere', 'apple', 'apples', 'gutui', 'gutuie', 'quince'] },
  { emoji: '🍐', keywords: ['para', 'pere', 'pear', 'pears'] },
  { emoji: '🍌', keywords: ['banana', 'banane'] },
  { emoji: '🍊', keywords: ['portocala', 'portocale', 'orange', 'oranges', 'mandarina', 'mandarine', 'clementina', 'clementine', 'tangerine'] },
  { emoji: '🍋', keywords: ['lamaie', 'lamai', 'lemon', 'lemons', 'lime', 'lime uri'] },
  { emoji: '🍉', keywords: ['pepene', 'pepene verde', 'watermelon', 'harbuz'] },
  { emoji: '🍈', keywords: ['pepene galben', 'melon', 'cantaloupe'] },
  { emoji: '🍍', keywords: ['ananas', 'pineapple'] },
  { emoji: '🥝', keywords: ['kiwi'] },
  { emoji: '🥭', keywords: ['mango', 'papaya'] },
  // Unicode has no plum or apricot; the peach stands in for the whole stone-fruit
  // family, as it did before.
  { emoji: '🍑', keywords: ['piersica', 'piersici', 'peach', 'peaches', 'nectarina', 'nectarine', 'caisa', 'caise', 'apricot', 'apricots', 'pruna', 'prune', 'plum', 'plums'] },
  { emoji: '🍒', keywords: ['cirese', 'cireasa', 'cherry', 'cherries', 'visine', 'visina'] },
  { emoji: '🍓', keywords: ['capsuna', 'capsuni', 'strawberry', 'strawberries', 'fragi', 'zmeura', 'raspberry'] },
  { emoji: '🫐', keywords: ['afine', 'goji', 'blueberry', 'blueberries', 'mure', 'blackberry', 'coacaze', 'currants', 'fructe de padure', 'forest fruits'] },
  // Dried fruit rides along with grapes: raisins are grapes, and figs and dates
  // have no emoji of their own.
  { emoji: '🍇', keywords: ['struguri', 'grape', 'grapes', 'stafide', 'raisins', 'smochine', 'figs', 'curmale', 'dates'] },
  { emoji: '🥥', keywords: ['cocos', 'coconut'] },
  { emoji: '🥑', keywords: ['avocado'] },

  // ─── Dairy & eggs ──────────────────────────────────────────────────────────
  { emoji: '🥚', keywords: ['ou', 'oua', 'egg', 'eggs'] },
  { emoji: '🥛', keywords: ['lapte', 'milk', 'iaurt', 'yogurt', 'yoghurt', 'chefir', 'kefir', 'sana', 'lapte batut', 'skyr', 'actimel', 'lapte vegetal', 'bautura vegetala', 'bautura de ovaz', 'bautura de soia', 'bautura de orez', 'bautura de migdale', 'oat drink', 'soy drink', 'rice drink', 'almond drink'] },
  { emoji: '🧀', keywords: ['branza', 'cascaval', 'telemea', 'cheese', 'mozzarella', 'parmezan', 'parmesan', 'gouda', 'cheddar', 'emmental', 'feta', 'ricotta', 'burduf', 'brie', 'camembert', 'urda', 'philadelphia'] },
  { emoji: '🧈', keywords: ['unt', 'butter', 'margarina', 'margarine', 'rama'] },

  // ─── Snacks ────────────────────────────────────────────────────────────────
  // Before the dairy rule below: "Chipsuri cu Smantana" ties on length between
  // "chipsuri" and "smantana", and chips is the product.
  //
  // Fries rather than a potato: Unicode has no crisps, and a raw potato is what
  // the vegetable rule already uses -- a bag of Lay's and a kilo of cartofi were
  // the same icon in the list. Fried potato is at least the right meal.
  { emoji: '🍟', keywords: ['chipsuri', 'chips', 'crisps', 'tortilla chips', 'nachos chips', 'fries', 'french fries', 'cartofi pai', 'cartofi prajiti'] },
  { emoji: '🥛', keywords: ['smantana', 'sour cream', 'crema de gatit', 'cooking cream', 'frisca', 'whipping cream'] },
  // Before the chocolate rule: "Inghetata cu Ciocolata" ties on length and the
  // product is ice cream.
  { emoji: '🍦', keywords: ['inghetata', 'ice cream', 'gelato'] },

  // ─── Bakery ────────────────────────────────────────────────────────────────
  { emoji: '🍞', keywords: ['paine', 'bread', 'toast', 'painici', 'lipii', 'chifla', 'chifle', 'bun', 'buns', 'franzela', 'lipie', 'tortilla', 'lavash', 'pesmet', 'breadcrumbs'] },
  { emoji: '🥖', keywords: ['bagheta', 'baguette'] },
  { emoji: '🥐', keywords: ['croissant', 'croisant', 'foietaj', 'puff pastry', 'aluat'] },
  { emoji: '🥨', keywords: ['pretzel', 'covrig', 'covrigi', 'covrigei', 'sticksuri', 'grisine'] },
  { emoji: '🍪', keywords: ['biscuit', 'biscuiti', 'cookie', 'cookies', 'napolitane', 'wafer', 'wafers', 'oreo', 'crackers', 'petit beurre', 'turta dulce'] },
  { emoji: '🍰', keywords: ['prajitura', 'cake', 'tort', 'desert', 'dessert', 'ecler', 'savarina', 'cheesecake', 'brownie', 'cozonac', 'chec', 'mucenici'] },
  { emoji: '🧁', keywords: ['muffin', 'briose', 'cupcake', 'drojdie', 'yeast', 'praf de copt', 'baking powder', 'zahar vanilat', 'bicarbonat'] },
  { emoji: '🍩', keywords: ['donut', 'donuts', 'gogosi', 'gogoasa'] },
  { emoji: '🥧', keywords: ['placinta', 'pie', 'strudel', 'tarta', 'tarte'] },

  // ─── Sweets ────────────────────────────────────────────────────────────────
  { emoji: '🍫', keywords: ['ciocolata', 'chocolate', 'cacao', 'nutella', 'crema de alune', 'kinder', 'nesquik'] },
  { emoji: '🍬', keywords: ['bomboane', 'candy', 'candies', 'jeleuri', 'jelly', 'lollipop', 'acadea', 'guma', 'guma de mestecat', 'chewing gum', 'halva', 'gelatina', 'fudge', 'zahar', 'sugar'] },
  { emoji: '🍯', keywords: ['miere', 'honey', 'gem', 'dulceata', 'jam', 'marmalade', 'sirop', 'syrup'] },
  { emoji: '🍿', keywords: ['popcorn', 'pufuleti'] },
  { emoji: '🥜', keywords: ['alune', 'arahide', 'peanuts', 'nuci', 'nuca', 'nuts', 'caju', 'cashews', 'migdale', 'almonds', 'fistic', 'pistachio', 'seminte', 'seeds', 'susan', 'sesame', 'unt de arahide', 'peanut butter'] },

  // ─── Meat & fish ───────────────────────────────────────────────────────────
  { emoji: '🥓', keywords: ['bacon', 'slanina', 'kaiser', 'kaizer', 'pancetta'] },
  { emoji: '🍗', keywords: ['pui', 'chicken', 'curcan', 'turkey', 'pulpe', 'aripioare', 'wings'] },
  { emoji: '🥩', keywords: ['vita', 'beef', 'porc', 'pork', 'miel', 'lamb', 'carne', 'carne tocata', 'minced meat', 'cotlet', 'ceafa', 'muschi', 'snitel'] },
  { emoji: '🌭', keywords: ['carnati', 'sausage', 'sausages', 'crenvursti', 'hot dog', 'cabanos', 'mustar', 'mustard'] },
  { emoji: '🍖', keywords: ['coaste', 'ribs', 'ciolan', 'jambon'] },
  { emoji: '🍢', keywords: ['mici', 'mititei', 'frigarui', 'skewer', 'kebab'] },
  { emoji: '🍔', keywords: ['burger', 'hamburger', 'meatballs', 'chiftele'] },
  { emoji: '🥪', keywords: ['sunca', 'ham', 'prosciutto', 'pastrama', 'mortadella', 'parizer', 'salam', 'sandwich'] },
  { emoji: '🐟', keywords: ['peste', 'fish', 'salata de icre', 'salata cu icre', 'somon', 'salmon', 'ton', 'ton in ulei', 'tuna', 'macrou', 'mackerel', 'pastrav', 'trout', 'sardine', 'hering', 'herring', 'cod', 'icre'] },
  { emoji: '🦐', keywords: ['creveti', 'shrimp', 'prawns', 'fructe de mare', 'seafood', 'midii', 'mussels', 'calamari', 'squid', 'caracatita', 'octopus'] },

  // ─── Staples ───────────────────────────────────────────────────────────────
  { emoji: '🍝', keywords: ['paste', 'pasta', 'spaghetti', 'penne', 'fusilli', 'tagliatelle', 'macaroane', 'lasagna', 'spaghete'] },
  { emoji: '🍜', keywords: ['taitei', 'noodles', 'supa instant', 'instant noodles', 'ramen'] },
  { emoji: '🍚', keywords: ['orez', 'rice', 'risotto', 'cous cous', 'cuscus', 'quinoa', 'bulgur'] },
  { emoji: '🫓', keywords: ['faina', 'flour', 'malai', 'cornmeal', 'gris', 'semolina'] },
  { emoji: '🥣', keywords: ['cereale', 'cereal', 'cornflakes', 'corn flakes', 'oat', 'ovaz', 'fulgi', 'musli', 'muzli', 'muesli', 'granola', 'terci', 'porridge', 'maioneza', 'mayo', 'mayonnaise', 'sos', 'sauce', 'dressing'] },
  { emoji: '🫘', keywords: ['fasole', 'beans', 'linte', 'lentils', 'naut', 'chickpeas', 'mazare', 'peas', 'tofu', 'chickpea', 'humus', 'hummus', 'soia', 'soia texturata', 'soy', 'textured soy'] },
  { emoji: '🥫', keywords: ['conserva', 'conserve', 'canned', 'borcan', 'jar', 'pate', 'pateu', 'pate de porc', 'pate de pui', 'crema de hrean', 'zacusca', 'compot'] },

  // ─── Vegetables ────────────────────────────────────────────────────────────
  { emoji: '🥔', keywords: ['cartof', 'cartofi', 'potato', 'potatoes', 'piure', 'telina', 'celery root', 'pastarnac', 'parsnip'] },
  { emoji: '🧅', keywords: ['ceapa', 'onion', 'onions', 'ceapa verde', 'green onion', 'praz', 'leek'] },
  { emoji: '🧄', keywords: ['usturoi', 'garlic'] },
  { emoji: '🥕', keywords: ['morcov', 'morcovi', 'carrot', 'carrots', 'sfecla', 'beet', 'beets', 'ridiche', 'ridichi', 'radish'] },
  { emoji: '🍅', keywords: ['rosie', 'rosii', 'tomato', 'tomatoes', 'bulion', 'passata', 'ketchup', 'pasta de tomate', 'tomate'] },
  { emoji: '🥒', keywords: ['castravete', 'castraveti', 'cucumber', 'cucumbers', 'cornichon', 'muraturi', 'dovlecel', 'dovlecei', 'zucchini', 'vinete', 'eggplant', 'aubergine'] },
  { emoji: '🥬', keywords: ['salata', 'lettuce', 'spanac', 'spinach', 'varza', 'cabbage', 'kale', 'rucola', 'arugula'] },
  { emoji: '🥦', keywords: ['broccoli', 'conopida', 'cauliflower'] },
  { emoji: '🌽', keywords: ['porumb', 'corn'] },
  { emoji: '🍄', keywords: ['ciuperci', 'ciuperca', 'mushroom', 'mushrooms', 'champignon'] },
  { emoji: '🫑', keywords: ['ardei', 'pepper', 'peppers', 'kapia', 'gogosar', 'gogosari', 'chili'] },
  { emoji: '🎃', keywords: ['dovleac', 'pumpkin'] },
  { emoji: '🥗', keywords: ['legume', 'vegetables', 'mixed veg'] },
  { emoji: '🌿', keywords: ['patrunjel', 'parsley', 'marar', 'dill', 'leustean', 'tarhon', 'tarragon', 'rozmarin', 'rosemary', 'menta', 'mint', 'salvie', 'sage'] },

  // ─── Oil, vinegar, seasoning ───────────────────────────────────────────────
  { emoji: '🫒', keywords: ['masline', 'olive', 'olives', 'ulei de masline', 'olive oil'] },
  { emoji: '🌻', keywords: ['ulei de floarea soarelui', 'sunflower oil', 'floarea soarelui'] },
  { emoji: '🫗', keywords: ['ulei', 'oil', 'otet', 'otet de mere', 'vinegar', 'sos de soia', 'soy sauce'] },
  { emoji: '🧂', keywords: ['sare', 'salt', 'condiment', 'condimente', 'spice', 'spices', 'piper', 'pepper corns', 'boia', 'paprika', 'oregano', 'busuioc', 'cimbru', 'thyme', 'curry', 'scortisoara', 'cinnamon', 'vegeta', 'baza pentru mancaruri', 'stock cube', 'cub'] },

  // ─── Prepared ──────────────────────────────────────────────────────────────
  { emoji: '🍕', keywords: ['pizza', 'focaccia'] },
  { emoji: '🌮', keywords: ['taco', 'tacos', 'nachos', 'quesadilla', 'burrito'] },
  { emoji: '🥟', keywords: ['coltunasi', 'dumplings', 'pelmeni', 'gyoza', 'ravioli', 'tortellini', 'sarmale'] },
  { emoji: '🍲', keywords: ['ciorba', 'soup', 'supa', 'stew', 'tocanita', 'tocana', 'bors'] },
  { emoji: '🍳', keywords: ['omleta', 'omelette', 'mic dejun', 'breakfast'] },

  // ─── Drinks ────────────────────────────────────────────────────────────────
  { emoji: '💧', keywords: ['apa', 'water', 'apa plata', 'apa minerala', 'sparkling water', 'still water'] },
  { emoji: '🧃', keywords: ['suc', 'juice', 'nectar', 'smoothie', 'limonada', 'lemonade'] },
  // Juice keeps its fruit ("Suc de Portocale" is nicer as 🍊 than as a carton),
  // but iced tea is not fruit — and "piersici" would outrank a bare "ice tea",
  // so the flavoured forms are spelled out to win on length.
  { emoji: '🥤', keywords: ['cola', 'fanta', 'sprite', 'soda', 'soft drink', 'pepsi', 'bautura carbogazoasa', 'ice tea', 'iced tea', 'ice tea piersici', 'ice tea lamaie', 'ice tea de piersici'] },
  { emoji: '⚡', keywords: ['energizant', 'energizanta', 'energy drink', 'red bull'] },
  { emoji: '☕', keywords: ['cafea', 'coffee', 'espresso', 'cappuccino', 'cappucino', 'latte', 'lungo', 'nescafe'] },
  { emoji: '🍵', keywords: ['ceai', 'tea', 'matcha', 'musetel', 'chamomile', 'ceai de menta', 'ceai de fructe de padure', 'earl grey', 'lady grey'] },
  { emoji: '🍺', keywords: ['bere', 'beer', 'lager', 'pilsner'] },
  { emoji: '🍷', keywords: ['vin', 'wine', 'merlot', 'cabernet', 'sauvignon', 'feteasca'] },
  { emoji: '🥂', keywords: ['prosecco', 'sampanie', 'champagne', 'cava'] },
  { emoji: '🍾', keywords: ['spumant', 'sparkling wine'] },
  { emoji: '🥃', keywords: ['whisky', 'vodka', 'gin', 'rom', 'tuica', 'palinca', 'lichior', 'liqueur'] },

  // ─── Frozen ────────────────────────────────────────────────────────────────
  { emoji: '🧊', keywords: ['gheata', 'ice', 'cuburi de gheata'] },

  // ─── Household ─────────────────────────────────────────────────────────────
  { emoji: '🧻', keywords: ['hartie igienica', 'toilet paper', 'servetele', 'napkins', 'prosoape de hartie', 'paper towels'] },
  { emoji: '🤧', keywords: ['batiste', 'tissues', 'servetele umede', 'wet wipes'] },
  { emoji: '🧼', keywords: ['sapun', 'soap', 'gel de dus', 'body wash', 'dezinfectant', 'sanitizer', 'clor'] },
  { emoji: '🧴', keywords: ['sampon', 'shampoo', 'balsam', 'conditioner', 'lotiune', 'lotion', 'crema', 'cream', 'deodorant', 'spuma', 'gel'] },
  { emoji: '🧺', keywords: ['detergent', 'detergent de rufe', 'balsam de rufe', 'laundry detergent', 'fabric softener', 'inalbitor', 'bleach'] },
  { emoji: '🍽️', keywords: ['detergent de vase', 'dish soap', 'masina de spalat vase', 'dishwasher', 'tablete'] },
  { emoji: '🪥', keywords: ['pasta de dinti', 'toothpaste', 'periuta', 'toothbrush', 'apa de gura', 'mouthwash', 'ata dentara', 'floss'] },
  { emoji: '🪒', keywords: ['aparate de ras', 'aparat de ras', 'razor', 'spuma de ras', 'shaving', 'lame'] },
  { emoji: '🧽', keywords: ['burete', 'bureti', 'sponge', 'sponges', 'laveta', 'lavete', 'cloth', 'manusi de menaj', 'rubber gloves'] },
  { emoji: '🪟', keywords: ['geamuri', 'window', 'solutie de geamuri', 'glass cleaner'] },
  { emoji: '🧹', keywords: ['matura', 'broom', 'mop', 'faras', 'praf de curatat', 'crema abraziva', 'abrasive'] },
  { emoji: '🗑️', keywords: ['saci de gunoi', 'saci menajeri', 'gunoi', 'garbage bags', 'trash bags'] },
  { emoji: '📦', keywords: ['folie alimentara', 'folie de aluminiu', 'cling film', 'aluminium foil', 'aluminum foil', 'hartie de copt', 'baking paper', 'pungi', 'bags'] },
  { emoji: '🕯️', keywords: ['odorizant', 'air freshener', 'lumanare', 'candle', 'betisoare parfumate'] },
  { emoji: '🦟', keywords: ['insecticid', 'insect', 'anti tantari', 'mosquito'] },
  { emoji: '🔥', keywords: ['chibrituri', 'matches', 'bricheta', 'lighter', 'carbune', 'charcoal'] },
  { emoji: '🔋', keywords: ['baterii', 'baterie', 'battery', 'batteries', 'acumulator'] },
  { emoji: '💡', keywords: ['bec', 'becuri', 'bulb', 'led', 'lanterna', 'flashlight'] },

  // ─── Personal & family ─────────────────────────────────────────────────────
  { emoji: '🩹', keywords: ['vata', 'cotton', 'betisoare de urechi', 'cotton buds', 'plasturi', 'plasture', 'bandage', 'pansament'] },
  { emoji: '💊', keywords: ['medicament', 'pastile', 'vitamine', 'vitamins', 'aspirina', 'paracetamol', 'supliment', 'vitamin', 'vitamina', 'magneziu', 'magnesium'] },
  { emoji: '🌸', keywords: ['absorbante', 'tampoane', 'sanitary pads', 'tampons'] },
  { emoji: '☀️', keywords: ['protectie solara', 'spf', 'sun cream', 'sunscreen'] },
  { emoji: '🍼', keywords: ['formula', 'baby milk', 'lapte praf', 'scutece', 'diapers', 'piure bebe', 'baby food', 'bebelusi'] },
  { emoji: '🐶', keywords: ['hrana caini', 'dog food', 'caini', 'dog treats'] },
  { emoji: '🐱', keywords: ['hrana pisici', 'cat food', 'pisici', 'cat treats', 'nisip pentru pisici', 'cat litter'] },
]

// Brands that are themselves a category, checked BEFORE the keyword table.
//
// A shopper reading "Pringles Sour Cream & Onion" sees crisps. The keyword
// table sees "sour cream", which is two characters longer than "pringles" and
// therefore wins, and the product renders as dairy. Length is the right
// tie-breaker between two product words and the wrong one between a product
// word and a brand — the brand names the thing, the rest describes its flavour.
// So brands win outright rather than competing on length.
//
// Only brands that make ONE kind of thing may go here. Retailers (Carrefour,
// Lidl, Kaufland) and conglomerates (Nestle, Mars) sell everything, and a brand
// whose name is also an ordinary word — ROM the chocolate bar, Star the crisps,
// Dorna which is both a water and a dairy — would fire on products it never
// made. When in doubt, leave it out and let the keywords decide.
const BRAND_RULES = [
  { emoji: '🍟', keywords: ['pringles', 'lays', 'lay s', 'doritos', 'cheetos', 'takis', 'chio', 'croco'] },
  { emoji: '🍫', keywords: ['milka', 'heidi', 'poiana', 'kandia', 'snickers', 'twix', 'bounty', 'kitkat', 'kit kat', 'toblerone', 'raffaello', 'ferrero', 'roshen', 'lindt', 'ritter sport', 'novatini'] },
  { emoji: '🍪', keywords: ['eugenia', 'belvita', 'toortitzi'] },
  { emoji: '🍬', keywords: ['haribo', 'mentos', 'skittles', 'tic tac'] },
  { emoji: '🥛', keywords: ['danone', 'danonino', 'activia', 'napolact', 'zuzu', 'covalact', 'ladorna', 'la dorna', 'olympus', 'muller', 'milbona', 'pilos'] },
  { emoji: '🧀', keywords: ['hochland', 'almette', 'delaco'] },
  { emoji: '🥤', keywords: ['schweppes', 'mountain dew', 'mirinda', '7up', 'seven up'] },
  // No juice brands here on purpose. "Suc de Portocale · Santal" reads better as
  // 🍊 than as a carton, and the keyword table already gets that right — a brand
  // rule would take it away.
  { emoji: '💧', keywords: ['aqua carpatica', 'borsec', 'perla harghitei', 'izvorul minunilor'] },
  { emoji: '🍺', keywords: ['ursus', 'timisoreana', 'bergenbier', 'stella artois', 'heineken', 'tuborg', 'staropramen'] },
  { emoji: '☕', keywords: ['jacobs', 'lavazza', 'doncafe', 'tchibo'] },
  { emoji: '🍦', keywords: ['algida', 'betty ice'] },
]

const FALLBACK = '🛍️'

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

// Reduce to single-spaced words with a space at each end, so a keyword can be
// found with a plain includes(" keyword ") — whole-word matching without a regex,
// and notably without lookbehind, which older mobile WebViews do not support.
function toWordBag(value: string) {
  return ` ${normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim()} `
}

// Flattened once at module load: every keyword paired with its emoji, longest
// first so the most specific match wins. sort() is stable, so equal-length
// keywords keep the rule order above.
const flatten = (rules: { emoji: string; keywords: string[] }[]) =>
  rules
    .flatMap(({ emoji, keywords }) => keywords.map((keyword) => ({ emoji, needle: toWordBag(keyword) })))
    .sort((a, b) => b.needle.length - a.needle.length)

// Brands first, so a brand beats any product word regardless of length. Within
// each tier the longest keyword still wins.
const MATCHERS = [...flatten(BRAND_RULES), ...flatten(EMOJI_RULES)]

// The list re-renders on every mutation and the set of distinct products a
// family sees is small, so memoizing turns a few hundred string scans per row
// into one. Keyed by the word bag: two products that reduce to the same words
// must resolve to the same emoji anyway.
const cache = new Map<string, string>()

export function getProductEmoji(productName: string, brand = '') {
  const haystack = toWordBag(`${productName} ${brand}`)

  const cached = cache.get(haystack)
  if (cached) return cached

  let emoji = FALLBACK
  for (const matcher of MATCHERS) {
    if (haystack.includes(matcher.needle)) {
      emoji = matcher.emoji
      break
    }
  }

  cache.set(haystack, emoji)
  return emoji
}
