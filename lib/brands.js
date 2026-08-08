// Statische eerste zeef: bekende merken, winkels, platforms en
// navigatie-zoektermen. Gratis en direct — wat hier doorheen glipt
// vangt de AI-check daarna af.

const BRAND_TOKENS = new Set(
  `vinted tuclothing tu sainsbury sainsburys tesco asda george matalan primark next zara hm shein temu
boohoo asos very littlewoods newlook peacocks debenhams selfridges harrods zalando amazon ebay etsy depop
aliexpress wish argos johnlewis tkmaxx riverisland superdry jackwills hollister abercrombie gap uniqlo
mango bershka stradivarius pullandbear cos arket weekday monki roman romanoriginals roamans
bonmarche damart seasalt fatface whitestuff joules regatta trespass carhartt carhartts dickies levis levi
wrangler lee diesel tommy hilfiger lacoste reiss whistles hobbs coast oasis warehouse topshop missguided
prettylittlething plt nastygal quiz lipsy viviennewestwood burberry gucci prada dior chanel versace armani
moncler ugg uggs drmartens clarks schuh dune louboutin birkenstock birkenstocks crocs vans converse
timberland hunter fitflop skechers asics salomon hoka lululemon gymshark fabletics mainline flannels
sosandar boden hush jigsaw omnes ghost rixo meshki showpo cider halara bravissimo figleaves jdsports
sportsdirect nike adidas puma reebok patagonia columbia barbour belstaff bonprix landsend pepco
essentials trapstar corteiz montirex nicce siksilk ellesse kappa fila champion umbro mckenzie
berghaus craghoppers stoneisland stussy palace supreme balenciaga fendi givenchy loewe celine ysl
firetrap slazenger lonsdale halston klass gant loro schoffel musto barbours joma canterbury
shearers grenson loake cheaney barker tricker gabor rieker ecco geox hotter moshulu vionic
weird anthropologie freepeople oysho intimissimi tezenis calzedonia falke snag sheertex heist
spanx skims primani peacocks
frye nordstrom macys kohls walmart target oldnavy jcrew madewell aritzia revolve torrid
chicos talbots loft aerie pacsun lulus poshmark thredup tjmaxx marshalls shopbop ssense
farfetch zappos dsw famousfootwear shoedazzle justfab fabkids stitchfix nuuly quince
everlane reformation vuori athleta oldnavys carters oshkosh gymboree`.split(/\s+/).filter((w) => w.length > 1)
);

const BRAND_PHRASES = [
  "f&f", "f and f", "f & f", "& other stories", "other stories", "pull and bear",
  "marks and spencer", "marks & spencer", "m&s", "m and s", "jd sports", "sports direct",
  "north face", "canada goose", "dr martens", "doc martens", "kurt geiger",
  "russell bromley", "jimmy choo", "new balance", "sweaty betty", "harvey nichols",
  "jd williams", "simply be", "yours clothing", "mint velvet", "lk bennett",
  "house of cb", "oh polly", "white fox", "princess polly", "hello molly",
  "never fully dressed", "damson madder", "boux avenue", "ann summers",
  "victoria secret", "john lewis", "tk maxx", "river island", "new look",
  "jack wills", "fred perry", "ted baker", "karen millen", "phase eight",
  "vivienne westwood", "hugo boss", "calvin klein", "ralph lauren", "tommy hilfiger",
  "crew clothing", "cotton traders", "mountain warehouse", "fat face", "white stuff",
  "in the style", "chi chi", "club l", "nasty gal", "roman originals", "lands end",
  "weird fish", "mainline menswear", "pretty little thing", "essential hoodie",
  "essential hoodies", "essentials hoodie", "fear of god", "stone island",
  "cp company", "palm angels", "broken planet", "unknown london", "cole buxton",
  "maniere de voir", "lyle and scott", "lyle & scott", "peter storm", "gym king",
  "weekend offender", "under armour", "free people", "urban outfitters", "brandy melville",
  // US-merken en verbasteringen (gevonden in echte Planner-data 8-8-2026)
  "northern face", "the north face", "jeans purple", "purple brand", "true religion",
  "american eagle", "fashion nova", "forever 21", "old navy", "banana republic",
  "eddie bauer", "j crew", "ll bean", "l l bean", "steve madden", "sam edelman",
  "vince camuto", "michael kors", "kate spade", "tory burch", "hot topic",
  "dolls kill", "rock revival", "miss me jeans", "coach bag", "coach bags",
  "abercrombie and fitch", "hollister co",
];

const NAV_PATTERNS = [
  "near me", "nearby", "clothing store", "clothing stores", "clothes shop",
  "clothes shops", "clothes store", "shop online", "online shop", "outlet",
  "official site", "official website", "website", "discount code", "voucher",
  "promo code", "black friday", "cyber monday", "opening times", "opening hours",
  "returns", "login", "log in", "my account", "customer service", "head office",
  "charity shop", "second hand", "secondhand", "wholesale", "supplier", "vintage shop",
  "size guide", "size chart", "track order", "delivery", "menswear shop",
  "mens wear shop", "clothes shopping", "clothing shops",
];

const GENERIC_EXACT = new Set([
  "clothing", "clothes", "fashion", "apparel", "shopping", "clothing uk",
  "clothes uk", "fashion uk", "shop", "shops", "store", "stores", "sale", "sales",
  "clothing brand", "clothing brands", "fashion brands", "brands", "boutique",
  "mens wear", "menswear", "womens wear", "womenswear", "mainline mens wear",
]);

const EXCEPTIONS = [
  "office wear", "office dress", "office outfit", "office look", "office trousers",
  "roman sandals", "coach jacket", "coach jackets",
];

export function isJunkKeyword(kw) {
  const k = " " + String(kw).toLowerCase().replace(/[^a-z0-9&+' ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  const ks = k.trim();
  if (!ks) return false;
  if (GENERIC_EXACT.has(ks)) return true;
  for (const e of EXCEPTIONS) if (k.includes(` ${e} `) || ks === e) return false;
  for (const ph of BRAND_PHRASES) if (k.includes(` ${ph} `) || ks === ph) return true;
  for (const pat of NAV_PATTERNS) if (k.includes(pat)) return true;
  for (const t of ks.split(" ")) if (BRAND_TOKENS.has(t)) return true;
  return false;
}
