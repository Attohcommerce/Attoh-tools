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
  // "On" (On Running / Cloud) — sluipt binnen als "on shoes for women"
  "on shoes", "on running", "on cloud", "oncloud", "on clouds",
  // Auto-modellen die als "mode" ogen maar het niet zijn
  "trail blazer", "trailblazer", "range rover", "town and country",
  "bathing ape", "a bathing ape", "doc marten", "doc martens", "docs martens",
  "miss me", "ae jeans", "ag jeans", "sp5der", "spider hoodie", "spider hoodies",
  "muck boot", "muck boots", "golden goose", "common projects", "axel arigato", "new balance",
  "canada goose", "moose knuckles", "dr scholls", "joes jeans",
  "lucky brand", "silver jeans", "judy blue", "citizens of humanity",
];

// Extra merk-tokens (US-zwaar). Blijft een vangnet — de échte dekking komt
// van de onbekend-woord-detectie hieronder.
const BRAND_TOKENS_2 = new Set(
  `timbs timb timberland timberlands bape sp5der spyder nikelab ariat ariats skims skim muck jordans yeezy yeezys
veja vejas allbirds rothys sorel blundstone blundstones keds superga autry
tretorn seavees toms sperry teva chaco merrell brooks saucony arcteryx mackage
sezane rouje doen faithfull staud ganni nanushka toteme khaite frame agolde
kancan vervet risen paige hudson wrangler roxy billabong volcom quiksilver
lululemons alo aloyoga vuori outdoorvoices beyondyoga varley psycho princesspolly
edikted zaful romwe cupshe lightinthebox modlily noracora justfashionnow
berrylook rosegal milanoo dresslily floryday chicwish shewin lulus windsor
altard tobi papaya charlotte russe rue21 maurices dillards belk boscov
jcpenney sears bloomingdales saks neiman barneys century21 rossstores burlington`
    .split(/\s+/)
    .filter((w) => w.length > 1)
);

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

/* Afkortingen waar geen enkele winkel een product naar vernoemt. Google telt
   ze als echte vraag, maar de scraper kan ze nergens vinden en gaat dan
   gokken: "lbd dress" leverde vijf willekeurige jurken op, waarvan er geen
   één zwart was. De uitgeschreven vorm ("little black dress") staat gewoon in
   de dataset en pakt dezelfde vraag wél goed op. */
const ABBREVIATIONS = new Set(["lbd", "otk", "ootd", "nwt", "nwot", "bnwt", "dupe", "dupes"]);

/* Merk-afkortingen. Shoppers typen "dm boots" voor Dr. Martens en "af1" voor
   Air Force 1 — te kort voor de onbekend-woord-zeef (die kijkt vanaf drie
   letters) en niet als merknaam te herkennen. Ze staan hier los, want ze
   mogen alleen als eigen woord tellen, niet als deel van een ander woord. */
const BRAND_ABBREV = new Set([
  "dm", "dms", "af1", "af1s", "tns", "jd", "tk", "ck", "ysl", "lv", "yzy",
  "nb", "ua", "tnf", "aeo", "ae", "bbc", "vs", "hm",
]);

// Merknamen als woordverzameling, voor de volgorde-onafhankelijke check.
const BRAND_PHRASE_WORDS = BRAND_PHRASES
  .map((p) => p.split(" ").filter(Boolean))
  .filter((w) => w.length >= 2 && w.every((x) => x.length >= 4));

export function isJunkKeyword(kw) {
  const k = " " + String(kw).toLowerCase().replace(/[^a-z0-9&+' ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  const ks = k.trim();
  if (!ks) return false;
  if (GENERIC_EXACT.has(ks)) return true;
  for (const t of ks.split(" ")) if (ABBREVIATIONS.has(t) || BRAND_ABBREV.has(t)) return true;
  for (const e of EXCEPTIONS) if (k.includes(` ${e} `) || ks === e) return false;
  for (const ph of BRAND_PHRASES) if (k.includes(` ${ph} `) || ks === ph) return true;
  // Woordvolgorde-onafhankelijk: Keyword Planner draait merknamen om
  // ("face north jacket" i.p.v. "north face jacket", "jeans purple" i.p.v.
  // "purple jeans"). Een merk blijft een merk in welke volgorde dan ook.
  // Alleen voor merken waarvan élk woord minstens 4 letters heeft, anders
  // zou "shoes on sale" op "on shoes" matchen.
  const kwWords = new Set(ks.split(" "));
  for (const ph of BRAND_PHRASE_WORDS) {
    let all = true;
    for (const w of ph) if (!kwWords.has(w)) { all = false; break; }
    if (all) return true;
  }
  for (const pat of NAV_PATTERNS) if (k.includes(pat)) return true;
  for (const t of ks.split(" ")) if (BRAND_TOKENS.has(t) || BRAND_TOKENS_2.has(t)) return true;
  return false;
}

/* ============================================================
   OMGEKEERDE ZEEF — het mode-woordenboek.
   Een merkenlijst is per definitie incompleet (er komen elke maand
   nieuwe merken bij). Daarom draaien we het om: we kennen wél de
   volledige woordenschat van mode-zoekopdrachten. Elk woord dat
   NIET in dit woordenboek staat is verdacht (merk, eigennaam,
   ruis) en wordt door de AI apart beoordeeld voordat het budget
   krijgt. "veja", "frye", "vejas" → onbekend → check.
============================================================ */
const VOCAB = new Set(
  `
women womens woman ladies lady female girls girl juniors misses petite plus tall
maternity nursing men mens man male gents unisex teen teens kids adult
dress dresses gown gowns sundress jumpsuit jumpsuits romper rompers playsuit
top tops tshirt tshirts tee tees shirt shirts blouse blouses tank tanks cami
camisole bodysuit bodysuits corset bustier tube crop cropped
sweater sweaters jumper jumpers cardigan cardigans pullover pullovers hoodie
hoodies sweatshirt sweatshirts crewneck turtleneck turtlenecks knit knits
knitwear jacket jackets coat coats blazer blazers parka parkas puffer puffers
trench overcoat overcoats raincoat windbreaker bomber anorak gilet vest vests
shacket poncho cape capes
jeans denim pants trousers chinos joggers sweatpants leggings jeggings culottes
shorts skirt skirts skort suit suits set sets outfit outfits twopiece
boot boots bootie booties shoe shoes sneaker sneakers trainers heel heels pump
pumps stiletto stilettos flat flats loafer loafers mule mules sandal sandals
slides clogs espadrilles moccasins oxfords brogues wedges wedge slipper slippers
sock socks tights hosiery
swimsuit swimsuits bikini bikinis swimwear tankini coverup pajamas pyjamas
loungewear robe nightgown lingerie bra bras underwear briefs activewear sportsbra
maxi midi mini knee ankle floor length long short sleeve sleeves sleeveless
sleeved strapless halter neck neckline vneck scoop square boat cowl shoulder
shoulders one two three piece wrap bodycon aline line shift sheath fit flare
flared skater empire tiered ruched ruffle ruffled pleated smocked slit split
backless open back tie button buttoned zip zipper up down snap belted belt
oversized relaxed slim skinny straight bootcut wide leg baggy barrel boyfriend
mom dad cargo utility high low mid rise waist waisted longline tunic peplum
asymmetric quilted padded lined hooded hood collared collar lapel double single
breasted chunky block kitten platform pointed pointy round toe almond laceup
slipon pull buckle strap strapped strappy thigh over calf chelsea combat cowboy
western snow rain hiking riding chukka moto biker duck lug
cotton linen silk satin velvet leather faux suede corduroy cord wool cashmere
merino fleece sherpa teddy tweed chiffon lace mesh sequin sequined sequins
glitter metallic knitted ribbed cable waffle jersey ponte twill canvas nylon
polyester spandex stretch shearling fur down sateen crochet eyelet gauze poplin
flannel plaid gingham houndstooth herringbone argyle striped stripe stripes
polka dot dots floral florals animal leopard zebra snake cheetah camo dye print
printed patterned pattern embroidered embellished beaded rhinestone studded
distressed ripped washed acid raw hem hemmed
black white ivory cream beige tan camel brown chocolate taupe grey gray charcoal
silver gold rose blush pink fuchsia magenta red burgundy wine maroon rust orange
coral peach apricot yellow mustard olive green emerald sage mint teal turquoise
blue navy cobalt sky lavender lilac purple plum violet multicolor multicolour
neutral nude pastel neon bright dark light colored coloured colorful
casual formal occasion party cocktail evening night date wedding guest guests
bridesmaid bridal prom homecoming graduation holiday christmas xmas halloween
thanksgiving newyear nye birthday vacation resort beach travel work office
business professional interview church brunch weekend everyday lounge sleep gym
workout running yoga athleisure festival concert club funeral cruise
summer spring fall autumn winter seasonal warm cold cozy comfy comfortable
lightweight breathable waterproof water resistant insulated thermal windproof
size sizes xs xl xxl xxxl cheap affordable quality new trendy trending cute chic
elegant stylish classic vintage retro modern minimalist boho bohemian preppy
edgy sexy modest popular soft warmest comfiest cutest under above between
outfit outfits look looks style styles wear clothes clothing fashion apparel
womenswear menswear ladieswear footwear
the off with without from her his all day daytime nighttime pocket pockets
drawstring elastic adjustable matching curve curvy inch inches
ballet ballerina penny mary jane janes derby monk slingback thong gladiator
jelly wellington wellies galoshes moon apres
henley polo raglan dolman batwing bishop puff balloon bell flutter cap kimono
surplice keyhole mock funnel boatneck sweetheart plunge plunging illusion
halterneck racerback cutout cut out twist knot knotted
palazzo paperbag cigarette tapered harem capri bermuda cycling bootleg bottom
bottoms carpenter painter parachute
slip shirtdress smock babydoll trapeze kaftan caftan tea swing wiggle mermaid
trumpet ballgown tulle organza taffeta brocade jacquard damask crepe georgette
voile seersucker terry terrycloth boucle scuba neoprene
peacoat duffle duster cocoon puffa quilt varsity letterman harrington softshell
packable reversible shrug bolero ruana
quiet luxury coastal grandma cottagecore balletcore gorpcore academia
`
    .split(/\s+/)
    .filter(Boolean)
);

/**
 * Woorden in een keyword die NIET in de mode-woordenschat staan.
 * Getallen en heel korte woordjes tellen niet mee.
 * Leeg = het keyword bestaat volledig uit bekende mode-taal.
 */
export function unknownFashionTokens(kw) {
  const out = [];
  for (const raw of String(kw).toLowerCase().split(/[^a-z0-9']+/)) {
    const t = raw.replace(/'s$/, "");
    if (!t || t.length < 3 || /^\d+$/.test(t)) continue;
    if (VOCAB.has(t)) continue;
    // enkelvoud/meervoud tolerant
    if (t.endsWith("s") && VOCAB.has(t.slice(0, -1))) continue;
    if (VOCAB.has(t + "s")) continue;
    if (t.endsWith("es") && VOCAB.has(t.slice(0, -2))) continue;
    out.push(t);
  }
  return [...new Set(out)];
}
