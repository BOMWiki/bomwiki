// Vendor registry data, ported verbatim from src/data/vendors/* (the per-domain
// files merged by src/data/vendors/index.ts, which is auto-generated upstream
// by scripts/reindex-vendors.mjs). EXTRA_DB extends the vendor company registry;
// PRODUCT_VENDORS maps product node ids to curated maker lists.
import type { VendorInfo } from './vendors.ts';

const audioVideoVendors = {
  db: {
    'Denon': { cc: 'JP', url: 'denon.com', hq: 'Kawasaki, JP', type: 'AV electronics' },
    'Yamaha': { cc: 'JP', url: 'yamaha.com', hq: 'Hamamatsu, JP', type: 'Audio & musical instruments' },
    'Onkyo': { cc: 'JP', url: 'onkyo.com', hq: 'Osaka, JP', type: 'AV electronics' },
    'Marantz': { cc: 'JP', url: 'marantz.com', hq: 'Kawasaki, JP', type: 'AV electronics' },
    'Sony': { cc: 'JP', url: 'sony.com', hq: 'Tokyo, JP', type: 'Consumer electronics' },
    'Fender': { cc: 'US', url: 'fender.com', hq: 'Los Angeles, US', type: 'Musical instruments & amps' },
    'Marshall': { cc: 'GB', url: 'marshall.com', hq: 'Bletchley, GB', type: 'Guitar amplifiers' },
    'Boss': { cc: 'JP', url: 'boss.info', hq: 'Hamamatsu, JP', type: 'Guitar effects & amps' },
    'Line 6': { cc: 'US', url: 'line6.com', hq: 'Calabasas, US', type: 'Guitar amps & modeling' },
    'Orange': { cc: 'GB', url: 'orangeamps.com', hq: 'London, GB', type: 'Guitar amplifiers' },
    'Epson': { cc: 'JP', url: 'epson.com', hq: 'Suwa, JP', type: 'Projectors & printers' },
    'BenQ': { cc: 'TW', url: 'benq.com', hq: 'Taipei, TW', type: 'Displays & projectors' },
    'Optoma': { cc: 'TW', url: 'optoma.com', hq: 'New Taipei, TW', type: 'Projectors' },
    'ViewSonic': { cc: 'US', url: 'viewsonic.com', hq: 'Brea, US', type: 'Displays & projectors' },
    'Sonos': { cc: 'US', url: 'sonos.com', hq: 'Santa Barbara, US', type: 'Wireless audio' },
    'Samsung': { cc: 'KR', url: 'samsung.com', hq: 'Suwon, KR', type: 'Consumer electronics' },
    'Bose': { cc: 'US', url: 'bose.com', hq: 'Framingham, US', type: 'Audio systems' },
    'JBL': { cc: 'US', url: 'jbl.com', hq: 'Los Angeles, US', type: 'Loudspeakers' },
    'Sennheiser': { cc: 'DE', url: 'sennheiser.com', hq: 'Wedemark, DE', type: 'Headphones & microphones' },
    'Audio-Technica': { cc: 'JP', url: 'audio-technica.com', hq: 'Tokyo, JP', type: 'Audio equipment' },
    'Beyerdynamic': { cc: 'DE', url: 'beyerdynamic.com', hq: 'Heilbronn, DE', type: 'Headphones & microphones' },
    'AKG': { cc: 'AT', url: 'akg.com', hq: 'Vienna, AT', type: 'Headphones & microphones' },
    'Pro-Ject': { cc: 'AT', url: 'project-audio.com', hq: 'Vienna, AT', type: 'Turntables' },
    'Rega': { cc: 'GB', url: 'rega.co.uk', hq: 'Southend-on-Sea, GB', type: 'Turntables & hi-fi' },
    'Technics': { cc: 'JP', url: 'technics.com', hq: 'Osaka, JP', type: 'Hi-fi audio' },
    'Shure': { cc: 'US', url: 'shure.com', hq: 'Niles, US', type: 'Microphones & audio' },
    'Rode': { cc: 'AU', url: 'rode.com', hq: 'Sydney, AU', type: 'Microphones' },
  },
  products: {
    'av-receiver': ['Denon', 'Yamaha', 'Onkyo', 'Marantz', 'Sony'],
    'guitar-amplifier': ['Fender', 'Marshall', 'Boss', 'Line 6', 'Orange'],
    'projector': ['Epson', 'BenQ', 'Optoma', 'Sony', 'ViewSonic'],
    'soundbar': ['Sonos', 'Samsung', 'Bose', 'Sony', 'JBL'],
    'studio-headphones': ['Sennheiser', 'Audio-Technica', 'Beyerdynamic', 'Sony', 'AKG'],
    'turntable': ['Audio-Technica', 'Pro-Ject', 'Rega', 'Technics'],
    'wireless-microphone': ['Shure', 'Sennheiser', 'Audio-Technica', 'Rode'],
  },
};

// Curated, accurate consumer-brand vendor lists for BOMwiki electronics products.
// db: real companies → details (cc = HQ country, url = primary site, hq, type).
// products: product-id → the real consumer brands that actually make that product.

const electronicsVendors = {
  db: {
    // Audio
    JBL: { cc: 'US', url: 'jbl.com', hq: 'Los Angeles, US', type: 'Consumer audio (Harman)' },
    Bose: { cc: 'US', url: 'bose.com', hq: 'Framingham, US', type: 'Consumer audio' },
    Sony: { cc: 'JP', url: 'sony.com', hq: 'Tokyo, JP', type: 'Consumer electronics' },
    Anker: { cc: 'CN', url: 'anker.com', hq: 'Shenzhen, CN', type: 'Consumer electronics & charging' },
    'Ultimate Ears': { cc: 'CH', url: 'ultimateears.com', hq: 'Lausanne, CH', type: 'Portable speakers (Logitech)' },
    Sonos: { cc: 'US', url: 'sonos.com', hq: 'Santa Barbara, US', type: 'Wireless speaker systems' },

    // Dashcams
    Garmin: { cc: 'US', url: 'garmin.com', hq: 'Olathe, US', type: 'GPS, wearables & dashcams' },
    Nextbase: { cc: 'GB', url: 'nextbase.com', hq: 'Caerphilly, GB', type: 'Dashcams' },
    Viofo: { cc: 'CN', url: 'viofo.com', hq: 'Shenzhen, CN', type: 'Dashcams' },
    '70mai': { cc: 'CN', url: '70mai.com', hq: 'Shanghai, CN', type: 'Dashcams & car electronics' },

    // PCs / laptops / tablets
    Dell: { cc: 'US', url: 'dell.com', hq: 'Round Rock, US', type: 'PCs & laptops' },
    HP: { cc: 'US', url: 'hp.com', hq: 'Palo Alto, US', type: 'PCs & printers' },
    Lenovo: { cc: 'CN', url: 'lenovo.com', hq: 'Beijing, CN', type: 'PCs, laptops & tablets' },
    ASUS: { cc: 'TW', url: 'asus.com', hq: 'Taipei, TW', type: 'PCs, laptops & components' },
    Apple: { cc: 'US', url: 'apple.com', hq: 'Cupertino, US', type: 'Consumer electronics' },
    Amazon: { cc: 'US', url: 'amazon.com', hq: 'Seattle, US', type: 'Devices & cloud (Echo, Fire, Kindle)' },

    // Photo frames
    Aura: { cc: 'US', url: 'auraframes.com', hq: 'New York, US', type: 'Digital photo frames' },
    Nixplay: { cc: 'US', url: 'nixplay.com', hq: 'Atlanta, US', type: 'Digital photo frames' },
    Skylight: { cc: 'US', url: 'skylightframe.com', hq: 'San Francisco, US', type: 'Digital photo frames' },

    // Game consoles
    Microsoft: { cc: 'US', url: 'microsoft.com', hq: 'Redmond, US', type: 'Software & Xbox consoles' },
    Nintendo: { cc: 'JP', url: 'nintendo.com', hq: 'Kyoto, JP', type: 'Game consoles & software' },

    // TVs
    Samsung: { cc: 'KR', url: 'samsung.com', hq: 'Suwon, KR', type: 'Consumer electronics' },
    LG: { cc: 'KR', url: 'lg.com', hq: 'Seoul, KR', type: 'Consumer electronics' },
    TCL: { cc: 'CN', url: 'tcl.com', hq: 'Huizhou, CN', type: 'TVs & display electronics' },
    Hisense: { cc: 'CN', url: 'hisense.com', hq: 'Qingdao, CN', type: 'TVs & home appliances' },

    // Cameras
    Canon: { cc: 'JP', url: 'canon.com', hq: 'Tokyo, JP', type: 'Cameras & imaging' },
    Nikon: { cc: 'JP', url: 'nikon.com', hq: 'Tokyo, JP', type: 'Cameras & optics' },
    Fujifilm: { cc: 'JP', url: 'fujifilm.com', hq: 'Tokyo, JP', type: 'Cameras & imaging' },
    Panasonic: { cc: 'JP', url: 'panasonic.com', hq: 'Osaka, JP', type: 'Consumer electronics & cameras' },

    // Smart speakers
    Google: { cc: 'US', url: 'google.com', hq: 'Mountain View, US', type: 'Software & Nest devices' },

    // Smartphones
    Xiaomi: { cc: 'CN', url: 'mi.com', hq: 'Beijing, CN', type: 'Smartphones & consumer electronics' },

    // Wearables
    Fitbit: { cc: 'US', url: 'fitbit.com', hq: 'San Francisco, US', type: 'Fitness wearables (Google)' },
  },

  products: {
    'bluetooth-speaker': ['JBL', 'Bose', 'Sony', 'Anker', 'Ultimate Ears'],
    dashcam: ['Garmin', 'Nextbase', 'Viofo', '70mai'],
    'desktop-pc': ['Dell', 'HP', 'Lenovo', 'ASUS'],
    'digital-photo-frame': ['Aura', 'Nixplay', 'Skylight'],
    'game-console': ['Sony', 'Microsoft', 'Nintendo'],
    laptop: ['Dell', 'HP', 'Lenovo', 'Apple', 'ASUS'],
    'led-television': ['Samsung', 'LG', 'Sony', 'TCL', 'Hisense'],
    'mirrorless-camera': ['Sony', 'Canon', 'Nikon', 'Fujifilm', 'Panasonic'],
    'smart-speaker': ['Amazon', 'Google', 'Apple', 'Sonos'],
    smartphone: ['Apple', 'Samsung', 'Xiaomi', 'Google'],
    smartwatch: ['Apple', 'Samsung', 'Garmin', 'Fitbit'],
    tablet: ['Apple', 'Samsung', 'Lenovo', 'Amazon'],
    'wireless-earbuds': ['Apple', 'Sony', 'Samsung', 'Bose', 'Anker'],
  },
};


// Curated, accurate. Each product lists real companies that actually make it.
const fitnessEquipmentVendors: {
  db: Record<string, VendorInfo>;
  products: Record<string, string[]>;
} = {
  db: {
    'Life Fitness': { cc: 'US', url: 'lifefitness.com', hq: 'Rosemont, IL, US', type: 'Commercial & home fitness equipment' },
    'Hammer Strength': { cc: 'US', url: 'lifefitness.com/hammer-strength', hq: 'Rosemont, IL, US', type: 'Strength training equipment (Life Fitness brand)' },
    'Rogue Fitness': { cc: 'US', url: 'roguefitness.com', hq: 'Columbus, OH, US', type: 'Strength & functional fitness equipment' },
    Technogym: { cc: 'IT', url: 'technogym.com', hq: 'Cesena, IT', type: 'Fitness & wellness equipment' },
    Precor: { cc: 'US', url: 'precor.com', hq: 'Woodinville, WA, US', type: 'Cardio & strength fitness equipment' },
    NordicTrack: { cc: 'US', url: 'nordictrack.com', hq: 'Logan, UT, US', type: 'Connected cardio equipment (iFIT)' },
    Sole: { cc: 'US', url: 'solefitness.com', hq: 'Salt Lake City, UT, US', type: 'Treadmills & cardio equipment' },
    Peloton: { cc: 'US', url: 'onepeloton.com', hq: 'New York, NY, US', type: 'Connected fitness bikes & treadmills' },
    Schwinn: { cc: 'US', url: 'schwinnfitness.com', hq: 'Vancouver, WA, US', type: 'Exercise bikes (Nautilus brand)' },
    Keiser: { cc: 'US', url: 'keiser.com', hq: 'Fresno, CA, US', type: 'Pneumatic indoor cycles & strength' },
    Bowflex: { cc: 'US', url: 'bowflex.com', hq: 'Vancouver, WA, US', type: 'Home gyms & cardio (BowFlex Inc.)' },
    'Body-Solid': { cc: 'US', url: 'bodysolid.com', hq: 'Forest Park, IL, US', type: 'Strength training & home gyms' },
    Marcy: { cc: 'US', url: 'marcypro.com', hq: 'Pomona, CA, US', type: 'Home gyms & strength (Impex Fitness)' },
    'Rep Fitness': { cc: 'US', url: 'repfitness.com', hq: 'Denver, CO, US', type: 'Power racks & strength equipment' },
    'Titan Fitness': { cc: 'US', url: 'titan.fitness', hq: 'Memphis, TN, US', type: 'Strength & rack equipment' },
    Concept2: { cc: 'US', url: 'concept2.com', hq: 'Morrisville, VT, US', type: 'Rowing machines, SkiErg, BikeErg' },
    WaterRower: { cc: 'US', url: 'waterrower.com', hq: 'Warren, RI, US', type: 'Water-resistance rowing machines' },
    Hydrow: { cc: 'US', url: 'hydrow.com', hq: 'Boston, MA, US', type: 'Connected rowing machines' },
    'Lululemon Studio': { cc: 'US', url: 'shop.lululemon.com/c/lululemon-studio', hq: 'New York, NY, US', type: 'Smart fitness mirror (formerly Mirror)' },
    Tonal: { cc: 'US', url: 'tonal.com', hq: 'San Francisco, CA, US', type: 'Smart strength wall trainer' },
    Tempo: { cc: 'US', url: 'tempo.fit', hq: 'San Francisco, CA, US', type: 'Smart home gym mirror' },
    StairMaster: { cc: 'US', url: 'stairmaster.com', hq: 'Vancouver, WA, US', type: 'Stair climbers (Core Health & Fitness)' },
    Matrix: { cc: 'US', url: 'matrixfitness.com', hq: 'Cottage Grove, WI, US', type: 'Commercial cardio & strength (Johnson Health Tech)' },
    'Power Plate': { cc: 'US', url: 'powerplate.com', hq: 'Las Vegas, NV, US', type: 'Whole-body vibration plates' },
    Hypervibe: { cc: 'AU', url: 'hypervibe.com', hq: 'Brisbane, AU', type: 'Whole-body vibration plates' },
    Lifepro: { cc: 'US', url: 'lifeprofitness.com', hq: 'Brooklyn, NY, US', type: 'Vibration plates & recovery fitness' },
  },
  products: {
    'cable-crossover': ['Life Fitness', 'Hammer Strength', 'Rogue Fitness', 'Technogym'],
    'elliptical-trainer': ['Precor', 'Life Fitness', 'NordicTrack', 'Sole'],
    'exercise-bike': ['Peloton', 'NordicTrack', 'Schwinn', 'Keiser'],
    'home-gym-multi': ['Bowflex', 'Body-Solid', 'Marcy'],
    'leg-press-machine': ['Life Fitness', 'Hammer Strength', 'Rogue Fitness', 'Body-Solid'],
    'power-rack': ['Rogue Fitness', 'Rep Fitness', 'Titan Fitness'],
    'rowing-machine': ['Concept2', 'WaterRower', 'Hydrow'],
    'smart-mirror-trainer': ['Lululemon Studio', 'Tonal', 'Tempo', 'NordicTrack'],
    'stair-climber': ['StairMaster', 'Matrix', 'Life Fitness'],
    treadmill: ['NordicTrack', 'Peloton', 'Life Fitness', 'Sole', 'Technogym'],
    'vibration-plate': ['Power Plate', 'Hypervibe', 'Lifepro'],
  },
};

// Curated, accurate per-product vendor lists for kitchen-appliances products.
// Each company listed actually makes the product in question. db holds the real
// company details; products maps each product slug to those makers.
// Shape consumed by scripts/reindex-vendors.mjs: { db, products }.

const kitchenAppliancesVendors = {
  db: {
    // US brands
    Ninja: { cc: 'US', url: 'ninjakitchen.com', hq: 'Needham, MA, US', type: 'Kitchen appliances (SharkNinja)' },
    Cosori: { cc: 'US', url: 'cosori.com', hq: 'Anaheim, CA, US', type: 'Air fryers & kitchen appliances' },
    'Instant Brands': { cc: 'US', url: 'instantbrands.com', hq: 'Downers Grove, IL, US', type: 'Instant Pot & kitchen appliances' },
    Vitamix: { cc: 'US', url: 'vitamix.com', hq: 'Olmsted Township, OH, US', type: 'High-performance blenders' },
    Blendtec: { cc: 'US', url: 'blendtec.com', hq: 'Orem, UT, US', type: 'High-performance blenders' },
    KitchenAid: { cc: 'US', url: 'kitchenaid.com', hq: 'Benton Harbor, MI, US', type: 'Stand mixers & kitchen appliances' },
    Cuisinart: { cc: 'US', url: 'cuisinart.com', hq: 'Stamford, CT, US', type: 'Kitchen appliances (Conair)' },
    'Mr. Coffee': { cc: 'US', url: 'mrcoffee.com', hq: 'Boca Raton, FL, US', type: 'Coffee makers (Newell)' },
    'George Foreman': { cc: 'US', url: 'georgeforemancooking.com', hq: 'Miramar, FL, US', type: 'Indoor grills (Spectrum Brands)' },
    Weber: { cc: 'US', url: 'weber.com', hq: 'Palatine, IL, US', type: 'Grills & outdoor cooking' },
    'Hamilton Beach': { cc: 'US', url: 'hamiltonbeach.com', hq: 'Glen Allen, VA, US', type: 'Kitchen appliances' },
    'Crock-Pot': { cc: 'US', url: 'crock-pot.com', hq: 'Boca Raton, FL, US', type: 'Slow cookers (Newell)' },
    Excalibur: { cc: 'US', url: 'excaliburdehydrator.com', hq: 'Sacramento, CA, US', type: 'Food dehydrators' },
    Nesco: { cc: 'US', url: 'nesco.com', hq: 'Two Rivers, WI, US', type: 'Food dehydrators & appliances' },
    GE: { cc: 'US', url: 'geappliances.com', hq: 'Louisville, KY, US', type: 'Home & kitchen appliances' },
    Frigidaire: { cc: 'US', url: 'frigidaire.com', hq: 'Charlotte, NC, US', type: 'Home appliances (Electrolux)' },
    NewAir: { cc: 'US', url: 'newair.com', hq: 'Cypress, CA, US', type: 'Ice makers & cooling appliances' },
    Omega: { cc: 'US', url: 'omegajuicers.com', hq: 'Harrisburg, PA, US', type: 'Juicers' },
    Nutribullet: { cc: 'US', url: 'nutribullet.com', hq: 'Los Angeles, CA, US', type: 'Blenders & juicers' },
    Secura: { cc: 'US', url: 'secura.us', hq: 'City of Industry, CA, US', type: 'Kitchen appliances' },
    Presto: { cc: 'US', url: 'gopresto.com', hq: 'Eau Claire, WI, US', type: 'Kitchen appliances' },
    'West Bend': { cc: 'US', url: 'westbend.com', hq: 'West Bend, WI, US', type: 'Kitchen appliances' },
    Aroma: { cc: 'US', url: 'aromaco.com', hq: 'Chino, CA, US', type: 'Rice cookers & appliances' },
    Bosch: { cc: 'DE', url: 'bosch-home.com', hq: 'Gerlingen, DE', type: 'Home & kitchen appliances' },

    // Other regions
    Philips: { cc: 'NL', url: 'philips.com', hq: 'Amsterdam, NL', type: 'Home & kitchen appliances' },
    Breville: { cc: 'AU', url: 'breville.com', hq: 'Sydney, AU', type: 'Kitchen appliances' },
    Zojirushi: { cc: 'JP', url: 'zojirushi.com', hq: 'Osaka, JP', type: 'Rice cookers & kitchen appliances' },
    Panasonic: { cc: 'JP', url: 'panasonic.com', hq: 'Kadoma, JP', type: 'Home & kitchen appliances' },
    Tiger: { cc: 'JP', url: 'tiger-corporation.com', hq: 'Kadoma, JP', type: 'Rice cookers & kitchen appliances' },
    Technivorm: { cc: 'NL', url: 'moccamaster.com', hq: 'Amerongen, NL', type: 'Drip coffee makers (Moccamaster)' },
    'Russell Hobbs': { cc: 'GB', url: 'russellhobbs.com', hq: 'Manchester, GB', type: 'Kitchen appliances' },
    Magimix: { cc: 'FR', url: 'magimix.com', hq: 'Montargis, FR', type: 'Food processors' },
    Braun: { cc: 'DE', url: 'braunhousehold.com', hq: 'Kronberg, DE', type: 'Kitchen & household appliances' },
    Hurom: { cc: 'KR', url: 'hurom.com', hq: 'Gimhae, KR', type: 'Slow juicers' },
    Cuckoo: { cc: 'KR', url: 'cuckoo.com', hq: 'Yangsan, KR', type: 'Rice cookers & appliances' },
    Nespresso: { cc: 'CH', url: 'nespresso.com', hq: 'Lausanne, CH', type: 'Coffee & milk frother systems' },
    Kenwood: { cc: 'GB', url: 'kenwoodworld.com', hq: 'Havant, GB', type: 'Kitchen machines & mixers' },
    Smeg: { cc: 'IT', url: 'smeg.com', hq: 'Guastalla, IT', type: 'Kitchen appliances' },
  },
  products: {
    'air-fryer': ['Philips', 'Ninja', 'Cosori', 'Instant Brands'],
    blender: ['Vitamix', 'Blendtec', 'Ninja', 'KitchenAid'],
    'bread-maker': ['Zojirushi', 'Panasonic', 'Cuisinart', 'Breville'],
    'drip-coffee-maker': ['Cuisinart', 'Mr. Coffee', 'Technivorm', 'Breville'],
    'electric-grill': ['George Foreman', 'Cuisinart', 'Weber', 'Ninja'],
    'electric-kettle': ['Breville', 'Cuisinart', 'Hamilton Beach', 'Russell Hobbs'],
    'electric-pressure-cooker': ['Instant Brands', 'Ninja', 'Crock-Pot'],
    'food-dehydrator': ['Excalibur', 'Nesco', 'Cosori'],
    'food-processor': ['Cuisinart', 'KitchenAid', 'Breville', 'Magimix'],
    'ice-maker': ['GE', 'Frigidaire', 'NewAir'],
    'immersion-blender': ['Braun', 'KitchenAid', 'Breville', 'Cuisinart'],
    juicer: ['Breville', 'Omega', 'Hurom', 'Nutribullet'],
    'milk-frother': ['Nespresso', 'Breville', 'Secura'],
    'popcorn-maker': ['Presto', 'Cuisinart', 'West Bend'],
    'rice-cooker': ['Zojirushi', 'Tiger', 'Aroma', 'Cuckoo'],
    'sandwich-maker': ['Hamilton Beach', 'Breville', 'Cuisinart'],
    'slow-cooker': ['Crock-Pot', 'Hamilton Beach', 'Ninja'],
    'stand-mixer': ['KitchenAid', 'Bosch', 'Kenwood', 'Smeg'],
    toaster: ['Breville', 'Cuisinart', 'Smeg', 'Hamilton Beach'],
    'waffle-maker': ['Cuisinart', 'Breville', 'Hamilton Beach'],
  },
};

const outdoorGearVendors = {
  db: {
    // backpacking stoves
    MSR: { cc: 'US', url: 'msrgear.com', hq: 'Seattle, US', type: 'Backcountry stoves & cookware' },
    Jetboil: { cc: 'US', url: 'jetboil.com', hq: 'Manchester, US', type: 'Integrated canister stoves' },
    'Snow Peak': { cc: 'JP', url: 'snowpeak.com', hq: 'Sanjo, JP', type: 'Camping & outdoor gear' },
    Soto: { cc: 'JP', url: 'sotooutdoors.com', hq: 'Toyokawa, JP', type: 'Outdoor stoves & burners' },

    // camping tents
    'REI Co-op': { cc: 'US', url: 'rei.com', hq: 'Kent, US', type: 'Outdoor gear co-op brand' },
    'Big Agnes': { cc: 'US', url: 'bigagnes.com', hq: 'Steamboat Springs, US', type: 'Tents & sleep systems' },
    Coleman: { cc: 'US', url: 'coleman.com', hq: 'Chicago, US', type: 'Camping gear & tents' },
    'The North Face': { cc: 'US', url: 'thenorthface.com', hq: 'Denver, US', type: 'Outdoor apparel & tents' },

    // headlamps
    'Black Diamond': { cc: 'US', url: 'blackdiamondequipment.com', hq: 'Salt Lake City, US', type: 'Climbing gear & headlamps' },
    Petzl: { cc: 'FR', url: 'petzl.com', hq: 'Crolles, FR', type: 'Headlamps & climbing gear' },
    Fenix: { cc: 'CN', url: 'fenixlighting.com', hq: 'Shenzhen, CN', type: 'Flashlights & headlamps' },
    Nitecore: { cc: 'CN', url: 'nitecore.com', hq: 'Guangzhou, CN', type: 'Flashlights & headlamps' },

    // inflatable kayaks
    'Advanced Elements': { cc: 'US', url: 'advancedelements.com', hq: 'Benicia, US', type: 'Inflatable kayaks' },
    'Sea Eagle': { cc: 'US', url: 'seaeagle.com', hq: 'Port Jefferson, US', type: 'Inflatable boats & kayaks' },
    Intex: { cc: 'US', url: 'intexcorp.com', hq: 'Long Beach, US', type: 'Inflatable boats & pools' },
    Aquaglide: { cc: 'US', url: 'aquaglide.com', hq: 'Bend, US', type: 'Inflatable kayaks & paddleboards' },

    // portable power stations
    Jackery: { cc: 'US', url: 'jackery.com', hq: 'Fremont, US', type: 'Portable power stations & solar' },
    EcoFlow: { cc: 'CN', url: 'ecoflow.com', hq: 'Shenzhen, CN', type: 'Portable power stations' },
    'Goal Zero': { cc: 'US', url: 'goalzero.com', hq: 'Bluffdale, US', type: 'Portable power & solar' },
    Anker: { cc: 'CN', url: 'anker.com', hq: 'Shenzhen, CN', type: 'Charging & portable power' },
    Bluetti: { cc: 'CN', url: 'bluettipower.com', hq: 'Shenzhen, CN', type: 'Portable power stations' },

    // portable water filters
    Sawyer: { cc: 'US', url: 'sawyer.com', hq: 'Safety Harbor, US', type: 'Water filtration' },
    Katadyn: { cc: 'CH', url: 'katadyn.com', hq: 'Kemptthal, CH', type: 'Water filters & purifiers' },
    LifeStraw: { cc: 'CH', url: 'lifestraw.com', hq: 'Lausanne, CH', type: 'Water filters & purifiers' },
  },
  products: {
    'backpacking-stove': ['MSR', 'Jetboil', 'Snow Peak', 'Soto'],
    'camping-tent': ['REI Co-op', 'Big Agnes', 'MSR', 'Coleman', 'The North Face'],
    headlamp: ['Black Diamond', 'Petzl', 'Fenix', 'Nitecore'],
    'inflatable-kayak': ['Advanced Elements', 'Sea Eagle', 'Intex', 'Aquaglide'],
    'portable-power-station': ['Jackery', 'EcoFlow', 'Goal Zero', 'Anker', 'Bluetti'],
    'portable-water-filter': ['Sawyer', 'Katadyn', 'LifeStraw', 'MSR'],
  },
};

// Personal-care appliances — real makers per product. Names → {cc,url,hq,type}.
// All companies referenced in `products` have a `db` entry. Curated for accuracy.
const personalCareVendors = {
  db: {
    Philips: { cc: 'NL', url: 'philips.com', hq: 'Amsterdam, NL', type: 'Personal care & health tech' },
    Braun: { cc: 'DE', url: 'braun.com', hq: 'Kronberg, DE', type: 'Grooming & personal care (P&G)' },
    Wahl: { cc: 'US', url: 'wahl.com', hq: 'Sterling, Illinois, US', type: 'Clippers & trimmers' },
    Panasonic: { cc: 'JP', url: 'panasonic.com', hq: 'Kadoma, Osaka, JP', type: 'Personal care appliances' },
    Andis: { cc: 'US', url: 'andis.com', hq: 'Sturtevant, Wisconsin, US', type: 'Clippers & trimmers' },
    Dyson: { cc: 'SG', url: 'dyson.com', hq: 'Singapore', type: 'Hair-care & home appliances' },
    BaByliss: { cc: 'FR', url: 'babyliss.com', hq: 'Paris, FR', type: 'Hair styling appliances' },
    T3: { cc: 'US', url: 't3micro.com', hq: 'Los Angeles, California, US', type: 'Hair styling tools' },
    Conair: { cc: 'US', url: 'conair.com', hq: 'Stamford, Connecticut, US', type: 'Personal care appliances' },
    'Hot Tools': { cc: 'US', url: 'hottools.com', hq: 'Boca Raton, Florida, US', type: 'Salon hair styling tools' },
    'Oral-B': { cc: 'DE', url: 'oralb.com', hq: 'Kronberg, DE', type: 'Oral care (P&G/Braun)' },
    Colgate: { cc: 'US', url: 'colgate.com', hq: 'New York, US', type: 'Oral care' },
    'Dr. Dennis Gross': { cc: 'US', url: 'drdennisgross.com', hq: 'New York, US', type: 'Skincare & devices' },
    'Vanity Planet': { cc: 'US', url: 'vanityplanet.com', hq: 'Irvine, California, US', type: 'Beauty devices' },
    GHD: { cc: 'GB', url: 'ghdhair.com', hq: 'Leeds, GB', type: 'Hair styling tools' },
    Revlon: { cc: 'US', url: 'revlon.com', hq: 'New York, US', type: 'Beauty & hair appliances' },
    Makartt: { cc: 'CN', url: 'makartt.com', hq: 'Shenzhen, CN', type: 'Nail tools & drills' },
    MelodySusie: { cc: 'CN', url: 'melodysusie.com', hq: 'Shenzhen, CN', type: 'Nail drills & lamps' },
    Kupa: { cc: 'US', url: 'kupainc.com', hq: 'Anaheim, California, US', type: 'Professional nail drills' },
  },
  products: {
    'beard-trimmer': ['Philips', 'Braun', 'Wahl', 'Panasonic'],
    'curling-iron': ['Dyson', 'BaByliss', 'T3', 'Conair', 'Hot Tools'],
    'electric-shaver': ['Philips', 'Braun', 'Panasonic'],
    'electric-toothbrush': ['Oral-B', 'Philips', 'Colgate'],
    epilator: ['Braun', 'Philips'],
    'facial-steamer': ['Panasonic', 'Dr. Dennis Gross', 'Vanity Planet'],
    'flat-iron-straightener': ['Dyson', 'GHD', 'BaByliss', 'T3'],
    'hair-clipper': ['Wahl', 'Andis', 'Philips', 'Panasonic'],
    'hair-dryer': ['Dyson', 'Panasonic', 'BaByliss', 'Revlon'],
    'nail-drill': ['Makartt', 'MelodySusie', 'Kupa'],
  },
};

const spaceSystemsVendors = {
  db: {
    'Blue Origin': { cc: 'US', url: 'blueorigin.com', hq: 'Kent, US', type: 'launch & spacecraft' },
  },
  products: {
    // Orbital-class vehicles with propulsive booster recovery actually flying:
    // Falcon 9/Heavy (SpaceX) and New Glenn (Blue Origin). No padding.
    'reusable-launch-vehicle': ['SpaceX', 'Blue Origin'],
  },
};


// Curated, accurate makers for toys-games products. Real companies, real HQs, real URLs.
const toysGamesVendors = {
  db: {
    // animatronic-toy
    WowWee: { cc: 'CA', url: 'wowwee.com', hq: 'Montreal, CA', type: 'Robotic & animatronic toys' },
    Hasbro: { cc: 'US', url: 'hasbro.com', hq: 'Pawtucket, US', type: 'Toy & game maker' },
    'Spin Master': { cc: 'CA', url: 'spinmaster.com', hq: 'Toronto, CA', type: 'Toy & entertainment company' },

    // arcade-cabinet
    Arcade1Up: { cc: 'US', url: 'arcade1up.com', hq: 'Atlanta, US', type: 'Home arcade cabinets' },
    'Raw Thrills': { cc: 'US', url: 'rawthrills.com', hq: 'Skokie, US', type: 'Arcade game manufacturer' },
    'Sega Amusements': { cc: 'GB', url: 'segaarcade.com', hq: 'Chessington, GB', type: 'Arcade machine maker' },
    'Bandai Namco Amusement': { cc: 'JP', url: 'bandainamco-am.co.jp', hq: 'Tokyo, JP', type: 'Arcade game maker' },

    // fpv-racing-drone
    DJI: { cc: 'CN', url: 'dji.com', hq: 'Shenzhen, CN', type: 'Drones & aerial imaging' },
    iFlight: { cc: 'CN', url: 'iflight.com', hq: 'Nanchang, CN', type: 'FPV racing drones & gear' },
    BetaFPV: { cc: 'CN', url: 'betafpv.com', hq: 'Shenzhen, CN', type: 'Micro & FPV racing drones' },
    Walkera: { cc: 'CN', url: 'walkera.com', hq: 'Guangzhou, CN', type: 'RC drones & helicopters' },

    // nerf-blaster
    Worker: { cc: 'CN', url: 'workergun.com', hq: 'Shenzhen, CN', type: 'Foam blasters & dart mods' },

    // pinball-machine
    'Stern Pinball': { cc: 'US', url: 'sternpinball.com', hq: 'Elk Grove Village, US', type: 'Pinball machine maker' },
    'Jersey Jack Pinball': { cc: 'US', url: 'jerseyjackpinball.com', hq: 'Lakewood, US', type: 'Pinball machine maker' },
    'Chicago Gaming': { cc: 'US', url: 'chicago-gaming.com', hq: 'Cicero, US', type: 'Pinball & arcade maker' },

    // rc-airplane
    'Horizon Hobby': { cc: 'US', url: 'horizonhobby.com', hq: 'Champaign, US', type: 'RC models & distribution' },
    'E-flite': { cc: 'US', url: 'e-fliterc.com', hq: 'Champaign, US', type: 'RC airplanes (Horizon brand)' },
    FMS: { cc: 'CN', url: 'fmsmodel.com', hq: 'Dongguan, CN', type: 'RC airplanes & models' },
    HobbyZone: { cc: 'US', url: 'hobbyzone.com', hq: 'Champaign, US', type: 'RC trainer aircraft (Horizon brand)' },

    // rc-boat
    Traxxas: { cc: 'US', url: 'traxxas.com', hq: 'McKinney, US', type: 'RC cars, trucks & boats' },
    'Pro Boat': { cc: 'US', url: 'proboat.com', hq: 'Champaign, US', type: 'RC boats (Horizon brand)' },
    Aquacraft: { cc: 'US', url: 'aquacraftmodels.com', hq: 'Champaign, US', type: 'RC boats' },

    // rc-car
    Arrma: { cc: 'US', url: 'arrma-rc.com', hq: 'Champaign, US', type: 'RC bash & race cars (Horizon brand)' },
    Tamiya: { cc: 'JP', url: 'tamiya.com', hq: 'Shizuoka, JP', type: 'Model kits & RC cars' },
    'Team Associated': { cc: 'US', url: 'associatedelectrics.com', hq: 'Lake Forest, US', type: 'RC race cars' },
    HPI: { cc: 'JP', url: 'hpiracing.com', hq: 'Tokyo, JP', type: 'RC cars (HPI Racing)' },

    // ride-on-car
    'Power Wheels': { cc: 'US', url: 'fisher-price.com', hq: 'East Aurora, US', type: 'Ride-on cars (Fisher-Price/Mattel)' },
    'Peg Perego': { cc: 'IT', url: 'pegperego.com', hq: 'Arcore, IT', type: 'Ride-on vehicles & strollers' },
    'Kid Trax': { cc: 'US', url: 'kidtrax.com', hq: 'Chatsworth, US', type: 'Ride-on cars' },
    'Best Choice Products': { cc: 'US', url: 'bestchoiceproducts.com', hq: 'Santa Ana, US', type: 'Ride-on cars & home goods' },

    // slot-car-set
    Scalextric: { cc: 'GB', url: 'scalextric.com', hq: 'Margate, GB', type: 'Slot car racing sets (Hornby)' },
    Carrera: { cc: 'AT', url: 'carrera-toys.com', hq: 'Salzburg, AT', type: 'Slot car racing sets' },
    AFX: { cc: 'US', url: 'afxracing.com', hq: 'Mira Loma, US', type: 'HO-scale slot cars' },
  } as Record<string, VendorInfo>,
  products: {
    'animatronic-toy': ['WowWee', 'Hasbro', 'Spin Master'],
    'arcade-cabinet': ['Arcade1Up', 'Raw Thrills', 'Sega Amusements', 'Bandai Namco Amusement'],
    'fpv-racing-drone': ['DJI', 'iFlight', 'BetaFPV', 'Walkera'],
    'nerf-blaster': ['Hasbro', 'Worker'],
    'pinball-machine': ['Stern Pinball', 'Jersey Jack Pinball', 'Chicago Gaming'],
    'rc-airplane': ['Horizon Hobby', 'E-flite', 'FMS', 'HobbyZone'],
    'rc-boat': ['Traxxas', 'Pro Boat', 'Aquacraft'],
    'rc-car': ['Traxxas', 'Arrma', 'Tamiya', 'Team Associated', 'HPI'],
    'ride-on-car': ['Power Wheels', 'Peg Perego', 'Kid Trax', 'Best Choice Products'],
    'slot-car-set': ['Scalextric', 'Carrera', 'AFX'],
  } as Record<string, string[]>,
};

const twoWheelersVendors = {
  db: {
    'Segway-Ninebot': { cc: 'CN', url: 'segway.com', hq: 'Beijing, CN', type: 'micromobility' },
    'Xiaomi': { cc: 'CN', url: 'mi.com', hq: 'Beijing, CN', type: 'electronics & scooters' },
    'Gotrax': { cc: 'US', url: 'gotrax.com', hq: 'Carrollton, US', type: 'e-scooters & rideables' },
    'Razor': { cc: 'US', url: 'razor.com', hq: 'Cerritos, US', type: 'scooters & rideables' },
    'Apollo Scooters': { cc: 'CA', url: 'apolloscooters.co', hq: 'Montreal, CA', type: 'e-scooters' },
    'Giant': { cc: 'TW', url: 'giant-bicycles.com', hq: 'Taichung, TW', type: 'bicycles' },
    'Trek': { cc: 'US', url: 'trekbikes.com', hq: 'Waterloo, US', type: 'bicycles & e-bikes' },
    'Specialized': { cc: 'US', url: 'specialized.com', hq: 'Morgan Hill, US', type: 'bicycles & e-bikes' },
    'Cannondale': { cc: 'US', url: 'cannondale.com', hq: 'Wilton, US', type: 'bicycles' },
    'Hero Cycles': { cc: 'IN', url: 'herocycles.com', hq: 'Ludhiana, IN', type: 'bicycles' },
    'Merida': { cc: 'TW', url: 'merida-bikes.com', hq: 'Yuanlin, TW', type: 'bicycles' },
    'Rad Power Bikes': { cc: 'US', url: 'radpowerbikes.com', hq: 'Seattle, US', type: 'e-bikes' },
    'Aventon': { cc: 'US', url: 'aventon.com', hq: 'Brea, US', type: 'e-bikes' },
    'Zero Motorcycles': { cc: 'US', url: 'zeromotorcycles.com', hq: 'Scotts Valley, US', type: 'electric motorcycles' },
    'Energica': { cc: 'IT', url: 'energicamotor.com', hq: 'Modena, IT', type: 'electric motorcycles' },
    'LiveWire': { cc: 'US', url: 'livewire.com', hq: 'Milwaukee, US', type: 'electric motorcycles' },
    'Ultraviolette': { cc: 'IN', url: 'ultraviolette.com', hq: 'Bengaluru, IN', type: 'electric motorcycles' },
    'Ola Electric': { cc: 'IN', url: 'olaelectric.com', hq: 'Bengaluru, IN', type: 'electric two-wheelers' },
    'Boosted': { cc: 'US', url: 'boostedusa.com', hq: 'Mountain View, US', type: 'electric skateboards' },
    'Meepo': { cc: 'CN', url: 'meepoboard.com', hq: 'Shenzhen, CN', type: 'electric skateboards' },
    'Backfire': { cc: 'CN', url: 'backfireboards.com', hq: 'Shenzhen, CN', type: 'electric skateboards' },
    'Exway': { cc: 'CN', url: 'exwayboard.com', hq: 'Shenzhen, CN', type: 'electric skateboards' },
    'Evolve': { cc: 'AU', url: 'evolveskateboards.com', hq: 'Gold Coast, AU', type: 'electric skateboards' },
    'InMotion': { cc: 'CN', url: 'inmotionworld.com', hq: 'Shenzhen, CN', type: 'electric unicycles' },
    'King Song': { cc: 'CN', url: 'kingsong.com', hq: 'Shenzhen, CN', type: 'electric unicycles' },
    'Begode': { cc: 'CN', url: 'begode.com', hq: 'Beijing, CN', type: 'electric unicycles' },
    'Veteran': { cc: 'CN', url: 'veteran-sheng.com', hq: 'Shenzhen, CN', type: 'electric unicycles' },
    'Honda': { cc: 'JP', url: 'honda.com', hq: 'Tokyo, JP', type: 'motorcycles & mopeds' },
    'Yamaha': { cc: 'JP', url: 'yamaha-motor.com', hq: 'Iwata, JP', type: 'motorcycles & mopeds' },
    'Royal Enfield': { cc: 'IN', url: 'royalenfield.com', hq: 'Chennai, IN', type: 'motorcycles' },
    'Harley-Davidson': { cc: 'US', url: 'harley-davidson.com', hq: 'Milwaukee, US', type: 'motorcycles' },
    'Kawasaki': { cc: 'JP', url: 'kawasaki.com', hq: 'Akashi, JP', type: 'motorcycles' },
    'Piaggio': { cc: 'IT', url: 'piaggio.com', hq: 'Pontedera, IT', type: 'scooters & mopeds' },
    'Vespa': { cc: 'IT', url: 'vespa.com', hq: 'Pontedera, IT', type: 'mopeds & scooters' },
    'Permobil': { cc: 'SE', url: 'permobil.com', hq: 'Timra, SE', type: 'powered wheelchairs' },
    'Invacare': { cc: 'US', url: 'invacare.com', hq: 'Elyria, US', type: 'mobility & wheelchairs' },
    'Pride Mobility': { cc: 'US', url: 'pridemobility.com', hq: 'Exeter, US', type: 'powered wheelchairs' },
    'Sunrise Medical': { cc: 'US', url: 'sunrisemedical.com', hq: 'Fresno, US', type: 'powered wheelchairs' },
    'Drive DeVilbiss': { cc: 'US', url: 'drivemedical.com', hq: 'Port Washington, US', type: 'mobility & wheelchairs' },
  },
  products: {
    'e-scooter': ['Segway-Ninebot', 'Xiaomi', 'Gotrax', 'Apollo Scooters'],
    'bicycle': ['Giant', 'Trek', 'Specialized', 'Cannondale', 'Hero Cycles'],
    'e-bike': ['Rad Power Bikes', 'Specialized', 'Trek', 'Giant', 'Aventon'],
    'electric-motorcycle': ['Zero Motorcycles', 'Energica', 'LiveWire', 'Ultraviolette'],
    'electric-skateboard': ['Meepo', 'Backfire', 'Exway', 'Evolve'],
    'electric-unicycle': ['InMotion', 'King Song', 'Begode', 'Veteran'],
    'hoverboard': ['Segway-Ninebot', 'Razor', 'Gotrax'],
    'moped': ['Honda', 'Piaggio', 'Vespa', 'Yamaha'],
    'motorcycle': ['Honda', 'Yamaha', 'Royal Enfield', 'Harley-Davidson', 'Kawasaki'],
    'powered-wheelchair': ['Permobil', 'Invacare', 'Pride Mobility', 'Sunrise Medical'],
  },
};

export const EXTRA_DB: Record<string, VendorInfo> = {
  ...(audioVideoVendors.db as Record<string, VendorInfo>),
  ...(electronicsVendors.db as Record<string, VendorInfo>),
  ...(fitnessEquipmentVendors.db as Record<string, VendorInfo>),
  ...(kitchenAppliancesVendors.db as Record<string, VendorInfo>),
  ...(outdoorGearVendors.db as Record<string, VendorInfo>),
  ...(personalCareVendors.db as Record<string, VendorInfo>),
  ...(spaceSystemsVendors.db as Record<string, VendorInfo>),
  ...(toysGamesVendors.db as Record<string, VendorInfo>),
  ...(twoWheelersVendors.db as Record<string, VendorInfo>),
};
export const PRODUCT_VENDORS: Record<string, string[]> = {
  ...audioVideoVendors.products,
  ...electronicsVendors.products,
  ...fitnessEquipmentVendors.products,
  ...kitchenAppliancesVendors.products,
  ...outdoorGearVendors.products,
  ...personalCareVendors.products,
  ...spaceSystemsVendors.products,
  ...toysGamesVendors.products,
  ...twoWheelersVendors.products,
};
