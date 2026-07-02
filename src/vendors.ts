// Vendor sourcing, ported from src/lib/vendors.ts. Field renames from the old
// site's Node (n/k/d) to the engine's NodeData (name/kind/domain); the data
// tables are identical, with EXTRA_DB/PRODUCT_VENDORS in vendors-data.ts.
//
// Likely vendors per item, a proper sourcing table, not a chip strip.
//
// A registry of REAL suppliers (India 🇮🇳 / Singapore 🇸🇬 / China 🇨🇳) with their
// website, HQ, and specialty, mapped to each component category by keyword. For a
// given item we return the category's vendors with an estimated unit price (a
// per-atomic-part category cost × the item's total part count, varied per vendor)
// plus typical MOQ and lead time. Real names and URLs; prices/MOQ/lead are
// indicative estimates.

import type { NodeData } from './nodes.ts';
import { totalParts } from './nodes.ts';
import { EXTRA_DB, PRODUCT_VENDORS } from './vendors-data.ts';

export type CC =
  | 'IN' | 'SG' | 'CN' | 'US' | 'JP' | 'KR' | 'DE' | 'TW' | 'IT' | 'FR' | 'GB'
  | 'SE' | 'CH' | 'NL' | 'CA' | 'ES' | 'AT' | 'DK' | 'FI' | 'AU' | 'BR' | 'MX' | 'BE';
const FLAG: Record<CC, string> = {
  IN: '🇮🇳', SG: '🇸🇬', CN: '🇨🇳', US: '🇺🇸', JP: '🇯🇵', KR: '🇰🇷', DE: '🇩🇪', TW: '🇹🇼',
  IT: '🇮🇹', FR: '🇫🇷', GB: '🇬🇧', SE: '🇸🇪', CH: '🇨🇭', NL: '🇳🇱', CA: '🇨🇦', ES: '🇪🇸',
  AT: '🇦🇹', DK: '🇩🇰', FI: '🇫🇮', AU: '🇦🇺', BR: '🇧🇷', MX: '🇲🇽', BE: '🇧🇪',
};

export interface VendorInfo { cc: CC; url: string; hq: string; type: string }

// Real companies → details. URLs are the vendors' primary sites.
const DB: Record<string, VendorInfo> = {
  BYD: { cc: 'CN', url: 'byd.com', hq: 'Shenzhen, CN', type: 'EV & battery manufacturer' },
  'Tata Motors': { cc: 'IN', url: 'tatamotors.com', hq: 'Mumbai, IN', type: 'Automaker' },
  'SAIC Motor': { cc: 'CN', url: 'saicmotor.com', hq: 'Shanghai, CN', type: 'Automaker' },
  Mahindra: { cc: 'IN', url: 'mahindra.com', hq: 'Mumbai, IN', type: 'Automaker' },
  Geely: { cc: 'CN', url: 'global.geely.com', hq: 'Hangzhou, CN', type: 'Automaker' },
  CATL: { cc: 'CN', url: 'catl.com', hq: 'Ningde, CN', type: 'Li-ion cell & pack maker' },
  'EVE Energy': { cc: 'CN', url: 'evebattery.com', hq: 'Huizhou, CN', type: 'Li-ion cell maker' },
  'Amara Raja': { cc: 'IN', url: 'amararaja.com', hq: 'Tirupati, IN', type: 'Batteries & energy' },
  Durapower: { cc: 'SG', url: 'durapowergroup.com', hq: 'Singapore', type: 'Li-ion battery systems' },
  Inovance: { cc: 'CN', url: 'inovance.com', hq: 'Shenzhen, CN', type: 'Drives & motion control' },
  'Sona Comstar': { cc: 'IN', url: 'sonacomstar.com', hq: 'Gurugram, IN', type: 'EV driveline & motors' },
  'Broad-Ocean': { cc: 'CN', url: 'broad-ocean.com', hq: 'Zhongshan, CN', type: 'Electric motors' },
  'Nidec (Singapore)': { cc: 'SG', url: 'nidec.com', hq: 'Singapore', type: 'Motors, regional ops' },
  'Bosch India': { cc: 'IN', url: 'bosch.in', hq: 'Bengaluru, IN', type: 'Automotive components' },
  'ZWZ Bearing': { cc: 'CN', url: 'zwz.com.cn', hq: 'Wafangdian, CN', type: 'Bearings' },
  'NBC Bearings': { cc: 'IN', url: 'nbcbearings.com', hq: 'Jaipur, IN', type: 'Bearings (NEI)' },
  'HRB Bearing': { cc: 'CN', url: 'hrbbearing.com', hq: 'Harbin, CN', type: 'Bearings' },
  'NRB Bearings': { cc: 'IN', url: 'nrbbearings.com', hq: 'Mumbai, IN', type: 'Needle & auto bearings' },
  'LYC Bearing': { cc: 'CN', url: 'lyc.com.cn', hq: 'Luoyang, CN', type: 'Bearings' },
  JLCPCB: { cc: 'CN', url: 'jlcpcb.com', hq: 'Shenzhen, CN', type: 'PCB fabrication' },
  PCBWay: { cc: 'CN', url: 'pcbway.com', hq: 'Shenzhen, CN', type: 'PCB fab & assembly' },
  'Shennan Circuits': { cc: 'CN', url: 'scc.com.cn', hq: 'Shenzhen, CN', type: 'PCB manufacturer' },
  'Shogini Technoarts': { cc: 'IN', url: 'shogini.com', hq: 'Mumbai, IN', type: 'PCB manufacturer' },
  'Venture Corp': { cc: 'SG', url: 'venture.com.sg', hq: 'Singapore', type: 'Electronics contract mfg' },
  StarPower: { cc: 'CN', url: 'powersemi.cc', hq: 'Jiaxing, CN', type: 'Power semiconductors (IGBT)' },
  UTAC: { cc: 'SG', url: 'utacgroup.com', hq: 'Singapore', type: 'Semiconductor assembly & test' },
  'ASE (Singapore)': { cc: 'SG', url: 'aseglobal.com', hq: 'Singapore', type: 'Semiconductor packaging' },
  SMIC: { cc: 'CN', url: 'smics.com', hq: 'Shanghai, CN', type: 'Semiconductor foundry' },
  'SPEL Semiconductor': { cc: 'IN', url: 'spel.com', hq: 'Chennai, IN', type: 'Semiconductor assembly' },
  'JL MAG': { cc: 'CN', url: 'jlmag.com.cn', hq: 'Ganzhou, CN', type: 'Rare-earth magnets' },
  'Yantai Zhenghai': { cc: 'CN', url: 'zhmag.com', hq: 'Yantai, CN', type: 'NdFeB magnets' },
  'Ningbo Yunsheng': { cc: 'CN', url: 'china-ys.com', hq: 'Ningbo, CN', type: 'NdFeB magnets' },
  'Zhong Ke San Huan': { cc: 'CN', url: 'sanhuanmagnetics.com', hq: 'Beijing, CN', type: 'Rare-earth magnets' },
  'Earth-Panda': { cc: 'CN', url: 'earth-panda.com', hq: 'Hefei, CN', type: 'NdFeB magnets' },
  'Zhejiang Shuanghuan': { cc: 'CN', url: 'shdrive.cn', hq: 'Yuhuan, CN', type: 'Gears & driveline' },
  'Bharat Gears': { cc: 'IN', url: 'bharatgears.com', hq: 'Mumbai, IN', type: 'Automotive gears' },
  'ZF India': { cc: 'IN', url: 'zf.com', hq: 'Pune, IN', type: 'Driveline & chassis' },
  'Hangzhou Advance': { cc: 'CN', url: 'advancegroup.cn', hq: 'Hangzhou, CN', type: 'Gearboxes' },
  MRF: { cc: 'IN', url: 'mrftyres.com', hq: 'Chennai, IN', type: 'Tyres' },
  'Apollo Tyres': { cc: 'IN', url: 'apollotyres.com', hq: 'Gurugram, IN', type: 'Tyres' },
  'Linglong Tire': { cc: 'CN', url: 'linglong.cn', hq: 'Zhaoyuan, CN', type: 'Tyres' },
  CEAT: { cc: 'IN', url: 'ceat.com', hq: 'Mumbai, IN', type: 'Tyres' },
  Sailun: { cc: 'CN', url: 'sailungroup.com', hq: 'Qingdao, CN', type: 'Tyres' },
  BOE: { cc: 'CN', url: 'boe.com', hq: 'Beijing, CN', type: 'Display panels' },
  Tianma: { cc: 'CN', url: 'tianma.com', hq: 'Shenzhen, CN', type: 'Display panels' },
  'TCL CSOT': { cc: 'CN', url: 'szcsot.com', hq: 'Shenzhen, CN', type: 'Display panels' },
  'Truly Opto': { cc: 'CN', url: 'truly.net', hq: 'Shanwei, CN', type: 'Displays & camera modules' },
  'Sunny Optical': { cc: 'CN', url: 'sunnyoptical.com', hq: 'Ningbo, CN', type: 'Optics & camera modules' },
  OFILM: { cc: 'CN', url: 'ofilm.com', hq: 'Shenzhen, CN', type: 'Camera modules' },
  'VVDN Technologies': { cc: 'IN', url: 'vvdntech.com', hq: 'Gurugram, IN', type: 'Electronics & camera modules' },
  'AAC Technologies': { cc: 'SG', url: 'aactechnologies.com', hq: 'Singapore', type: 'Acoustics & optics' },
  Motherson: { cc: 'IN', url: 'motherson.com', hq: 'Noida, IN', type: 'Wiring harness & modules' },
  Polycab: { cc: 'IN', url: 'polycab.com', hq: 'Mumbai, IN', type: 'Wires & cables' },
  Luxshare: { cc: 'CN', url: 'luxshare-ict.com', hq: 'Dongguan, CN', type: 'Connectors & cables' },
  Hengtong: { cc: 'CN', url: 'hengtonggroup.com', hq: 'Suzhou, CN', type: 'Cables' },
  Finolex: { cc: 'IN', url: 'finolex.com', hq: 'Pune, IN', type: 'Wires & cables' },
  'Sundram Fasteners': { cc: 'IN', url: 'sundram.com', hq: 'Chennai, IN', type: 'Fasteners' },
  'Lakshmi Precision Screws': { cc: 'IN', url: 'lpsindia.com', hq: 'Rohtak, IN', type: 'Fasteners' },
  'Suzhou Escort': { cc: 'CN', url: 'escort-fastener.com', hq: 'Suzhou, CN', type: 'Fasteners' },
  'Shanghai Tianbao': { cc: 'CN', url: 'tbfastener.com', hq: 'Shanghai, CN', type: 'Fasteners' },
  'Sterling Tools': { cc: 'IN', url: 'sterlingtools.in', hq: 'Faridabad, IN', type: 'Fasteners' },
  Kirloskar: { cc: 'IN', url: 'kbl.co.in', hq: 'Pune, IN', type: 'Pumps & fluid systems' },
  'Leo Group': { cc: 'CN', url: 'leo.com.cn', hq: 'Taizhou, CN', type: 'Pumps' },
  'Shakti Pumps': { cc: 'IN', url: 'shaktipumps.com', hq: 'Pithampur, IN', type: 'Pumps' },
  'CNP Pumps': { cc: 'CN', url: 'cnppumps.com', hq: 'Hangzhou, CN', type: 'Pumps' },
  'Roto Pumps': { cc: 'IN', url: 'rotopumps.com', hq: 'Noida, IN', type: 'Pumps' },
  'Bharat Forge': { cc: 'IN', url: 'bharatforge.com', hq: 'Pune, IN', type: 'Forgings & metal parts' },
  'CITIC Dicastal': { cc: 'CN', url: 'dicastal.com', hq: 'Qinhuangdao, CN', type: 'Aluminium castings & wheels' },
  'Tata AutoComp': { cc: 'IN', url: 'tataautocomp.com', hq: 'Pune, IN', type: 'Auto components' },
  Beyonics: { cc: 'SG', url: 'beyonics.com', hq: 'Singapore', type: 'Precision metal & mfg' },
  'Sundaram Clayton': { cc: 'IN', url: 'sundaram-clayton.com', hq: 'Chennai, IN', type: 'Die castings' },
  'Bharat Seats': { cc: 'IN', url: 'bharatseats.com', hq: 'Gurugram, IN', type: 'Seating systems' },
  Yanfeng: { cc: 'CN', url: 'yanfeng.com', hq: 'Shanghai, CN', type: 'Interiors & seating' },
  'Harita Seating': { cc: 'IN', url: 'haritaseating.com', hq: 'Chennai, IN', type: 'Seating systems' },
  'Gabriel India': { cc: 'IN', url: 'gabrielindia.com', hq: 'Pune, IN', type: 'Shock absorbers & dampers' },
  'Jamna Auto': { cc: 'IN', url: 'jaiparabolic.com', hq: 'Yamunanagar, IN', type: 'Leaf & parabolic springs' },
  'Munjal Showa': { cc: 'IN', url: 'munjalshowa.net', hq: 'Gurugram, IN', type: 'Shock absorbers & struts' },
  'Chongqing Sokon': { cc: 'CN', url: 'sokonindustry.com', hq: 'Chongqing, CN', type: 'Springs & auto parts' },
  'Weichai Power': { cc: 'CN', url: 'weichai.com', hq: 'Weifang, CN', type: 'Diesel & power engines' },
  'Cummins India': { cc: 'IN', url: 'cumminsindia.com', hq: 'Pune, IN', type: 'Diesel engines' },
  Yuchai: { cc: 'CN', url: 'yuchai.com', hq: 'Yulin, CN', type: 'Diesel engines' },
  'Kirloskar Oil Engines': { cc: 'IN', url: 'koel.co.in', hq: 'Pune, IN', type: 'Diesel & gas engines' },
  'Ashok Leyland': { cc: 'IN', url: 'ashokleyland.com', hq: 'Chennai, IN', type: 'Engines & commercial vehicles' },
  Foxconn: { cc: 'CN', url: 'foxconn.com', hq: 'Shenzhen, CN', type: 'Electronics contract mfg' },
  'Flex (Singapore)': { cc: 'SG', url: 'flex.com', hq: 'Singapore', type: 'Electronics contract mfg' },
  'Dixon Technologies': { cc: 'IN', url: 'dixoninfo.com', hq: 'Noida, IN', type: 'Electronics contract mfg' },
  'BYD Electronics': { cc: 'CN', url: 'bydelectronic.com', hq: 'Shenzhen, CN', type: 'Electronics contract mfg' },
};

// Second registry, real companies that head up specific product DOMAINS (used by
// DOMAIN_VENDORS below). Same shape as DB; merged into ALLDB. Primary websites.
const DB2: Record<string, VendorInfo> = {
  // automobiles / two-wheelers / mobility
  'Hero MotoCorp': { cc: 'IN', url: 'heromotocorp.com', hq: 'New Delhi, IN', type: 'Motorcycle & scooter maker' },
  'Bajaj Auto': { cc: 'IN', url: 'bajajauto.com', hq: 'Pune, IN', type: 'Two- & three-wheeler maker' },
  'TVS Motor': { cc: 'IN', url: 'tvsmotor.com', hq: 'Chennai, IN', type: 'Two-wheeler maker' },
  Yadea: { cc: 'CN', url: 'yadea.com', hq: 'Wuxi, CN', type: 'Electric two-wheeler maker' },
  'Niu Technologies': { cc: 'CN', url: 'niu.com', hq: 'Beijing, CN', type: 'Electric scooter maker' },
  // aerospace
  'Hindustan Aeronautics': { cc: 'IN', url: 'hal-india.co.in', hq: 'Bengaluru, IN', type: 'Aircraft & aerospace mfg' },
  'Tata Advanced Systems': { cc: 'IN', url: 'tataadvancedsystems.com', hq: 'Hyderabad, IN', type: 'Aerospace & defense systems' },
  'ST Engineering': { cc: 'SG', url: 'stengg.com', hq: 'Singapore', type: 'Aerospace, defense & tech' },
  COMAC: { cc: 'CN', url: 'comac.cc', hq: 'Shanghai, CN', type: 'Commercial aircraft maker' },
  AVIC: { cc: 'CN', url: 'avic.com', hq: 'Beijing, CN', type: 'Aviation industry conglomerate' },
  // marine
  'Cochin Shipyard': { cc: 'IN', url: 'cochinshipyard.in', hq: 'Kochi, IN', type: 'Shipbuilding & repair' },
  'Mazagon Dock': { cc: 'IN', url: 'mazagondock.in', hq: 'Mumbai, IN', type: 'Warship & submarine builder' },
  'Keppel Offshore Marine': { cc: 'SG', url: 'keppelom.com', hq: 'Singapore', type: 'Offshore & marine engineering' },
  Seatrium: { cc: 'SG', url: 'seatrium.com', hq: 'Singapore', type: 'Offshore & marine engineering' },
  CSSC: { cc: 'CN', url: 'cssc.net.cn', hq: 'Shanghai, CN', type: 'Shipbuilding conglomerate' },
  // rail-transit
  CRRC: { cc: 'CN', url: 'crrcgc.cc', hq: 'Beijing, CN', type: 'Rolling stock & rail systems' },
  BEML: { cc: 'IN', url: 'bemlindia.in', hq: 'Bengaluru, IN', type: 'Rail, mining & defense equipment' },
  'Titagarh Rail Systems': { cc: 'IN', url: 'titagarh.in', hq: 'Kolkata, IN', type: 'Rail wagons & metro coaches' },
  'Alstom India': { cc: 'IN', url: 'alstom.com', hq: 'Bengaluru, IN', type: 'Rail rolling stock & signalling' },
  'Siemens Mobility India': { cc: 'IN', url: 'mobility.siemens.com', hq: 'Mumbai, IN', type: 'Rail systems & signalling' },
  // space-systems
  'NewSpace India': { cc: 'IN', url: 'nsilindia.co.in', hq: 'Bengaluru, IN', type: 'Launch vehicles & satellites' },
  CASC: { cc: 'CN', url: 'spacechina.com', hq: 'Beijing, CN', type: 'Launch vehicles & spacecraft' },
  'Skyroot Aerospace': { cc: 'IN', url: 'skyroot.in', hq: 'Hyderabad, IN', type: 'Private launch vehicles' },
  'Galaxy Space': { cc: 'CN', url: 'yinhe.com', hq: 'Beijing, CN', type: 'Satellite manufacturer' },
  // defense-security
  'Bharat Electronics': { cc: 'IN', url: 'bel-india.in', hq: 'Bengaluru, IN', type: 'Defense electronics' },
  'Bharat Dynamics': { cc: 'IN', url: 'bdl-india.in', hq: 'Hyderabad, IN', type: 'Missiles & defense systems' },
  NORINCO: { cc: 'CN', url: 'norincogroup.com.cn', hq: 'Beijing, CN', type: 'Defense & ordnance' },
  Hikvision: { cc: 'CN', url: 'hikvision.com', hq: 'Hangzhou, CN', type: 'Surveillance & security' },
  // construction / agri / mining / heavy
  Sany: { cc: 'CN', url: 'sany.com.cn', hq: 'Changsha, CN', type: 'Construction machinery' },
  XCMG: { cc: 'CN', url: 'xcmg.com', hq: 'Xuzhou, CN', type: 'Construction machinery' },
  Zoomlion: { cc: 'CN', url: 'zoomlion.com', hq: 'Changsha, CN', type: 'Construction machinery' },
  'JCB India': { cc: 'IN', url: 'jcb.com', hq: 'New Delhi, IN', type: 'Earthmoving equipment' },
  'Escorts Kubota': { cc: 'IN', url: 'escortskubota.com', hq: 'Faridabad, IN', type: 'Tractors & farm equipment' },
  // machinery
  'Lakshmi Machine Works': { cc: 'IN', url: 'lakshmimach.com', hq: 'Coimbatore, IN', type: 'Textile & machine tools' },
  'Hans Laser': { cc: 'CN', url: 'hanslaser.com', hq: 'Shenzhen, CN', type: 'Laser & industrial equipment' },
  // machine-tools
  'Jyoti CNC': { cc: 'IN', url: 'jyoti.co.in', hq: 'Rajkot, IN', type: 'CNC machine tools' },
  'HMT Machine Tools': { cc: 'IN', url: 'hmtmachinetools.com', hq: 'Bengaluru, IN', type: 'Machine tools' },
  BFW: { cc: 'IN', url: 'bfw.co.in', hq: 'Bengaluru, IN', type: 'CNC machine tools' },
  'Shenyang Machine Tool': { cc: 'CN', url: 'smtcl.com', hq: 'Shenyang, CN', type: 'Machine tools' },
  // robotics
  Estun: { cc: 'CN', url: 'estun.com', hq: 'Nanjing, CN', type: 'Industrial robots & automation' },
  Siasun: { cc: 'CN', url: 'siasun.com', hq: 'Shenyang, CN', type: 'Industrial & service robots' },
  'Hans Robot': { cc: 'CN', url: 'hans-robot.com', hq: 'Shenzhen, CN', type: 'Collaborative robots' },
  GreyOrange: { cc: 'IN', url: 'greyorange.com', hq: 'Gurugram, IN', type: 'Warehouse robotics' },
  // material-handling
  Hangcha: { cc: 'CN', url: 'hcforklift.com', hq: 'Hangzhou, CN', type: 'Forklifts & material handling' },
  Heli: { cc: 'CN', url: 'helichina.com', hq: 'Hefei, CN', type: 'Forklifts & material handling' },
  'BYD Forklift': { cc: 'CN', url: 'bydforklift.com', hq: 'Shenzhen, CN', type: 'Electric forklifts' },
  'Godrej Material Handling': { cc: 'IN', url: 'godrejmhe.com', hq: 'Mumbai, IN', type: 'Forklifts & handling equipment' },
  // energy
  BHEL: { cc: 'IN', url: 'bhel.com', hq: 'New Delhi, IN', type: 'Power generation equipment' },
  'Shanghai Electric': { cc: 'CN', url: 'shanghai-electric.com', hq: 'Shanghai, CN', type: 'Power & industrial equipment' },
  'Dongfang Electric': { cc: 'CN', url: 'dongfang.com', hq: 'Chengdu, CN', type: 'Power generation equipment' },
  Sungrow: { cc: 'CN', url: 'sungrowpower.com', hq: 'Hefei, CN', type: 'Solar inverters & storage' },
  'Sterling and Wilson': { cc: 'IN', url: 'sterlingandwilson.com', hq: 'Mumbai, IN', type: 'Solar EPC & power' },
  // renewable-energy
  LONGi: { cc: 'CN', url: 'longi.com', hq: "Xi'an, CN", type: 'Solar wafers & modules' },
  'Waaree Energies': { cc: 'IN', url: 'waaree.com', hq: 'Mumbai, IN', type: 'Solar PV modules' },
  'Adani Solar': { cc: 'IN', url: 'adanisolar.com', hq: 'Ahmedabad, IN', type: 'Solar PV modules' },
  Goldwind: { cc: 'CN', url: 'goldwind.com', hq: 'Beijing, CN', type: 'Wind turbines' },
  // oil-gas
  'LT Energy Hydrocarbon': { cc: 'IN', url: 'larsentoubro.com', hq: 'Mumbai, IN', type: 'Oil & gas EPC' },
  Jereh: { cc: 'CN', url: 'jereh.com', hq: 'Yantai, CN', type: 'Oilfield equipment' },
  'Honghua Group': { cc: 'CN', url: 'honghuagroup.com', hq: 'Chengdu, CN', type: 'Drilling rigs & equipment' },
  'Sinopec Oilfield Equipment': { cc: 'CN', url: 'sinopecgroup.com', hq: 'Wuhan, CN', type: 'Oilfield equipment' },
  // fluid-handling
  'Kirloskar Brothers': { cc: 'IN', url: 'kirloskarpumps.com', hq: 'Pune, IN', type: 'Pumps & fluid systems' },
  'KSB India': { cc: 'IN', url: 'ksb.com', hq: 'Pune, IN', type: 'Pumps & valves' },
  // appliances
  Haier: { cc: 'CN', url: 'haier.com', hq: 'Qingdao, CN', type: 'Home appliances' },
  Midea: { cc: 'CN', url: 'midea.com', hq: 'Foshan, CN', type: 'Home appliances' },
  Voltas: { cc: 'IN', url: 'voltas.com', hq: 'Mumbai, IN', type: 'Cooling & appliances' },
  'Godrej Appliances': { cc: 'IN', url: 'godrejappliances.com', hq: 'Mumbai, IN', type: 'Home appliances' },
  'Gree Electric': { cc: 'CN', url: 'gree.com', hq: 'Zhuhai, CN', type: 'Air conditioners & appliances' },
  // kitchen-appliances
  Stovekraft: { cc: 'IN', url: 'stovekraft.com', hq: 'Bengaluru, IN', type: 'Kitchen appliances' },
  'Bajaj Electricals': { cc: 'IN', url: 'bajajelectricals.com', hq: 'Mumbai, IN', type: 'Kitchen & home appliances' },
  Joyoung: { cc: 'CN', url: 'joyoung.com', hq: 'Jinan, CN', type: 'Kitchen appliances' },
  Supor: { cc: 'CN', url: 'supor.com', hq: 'Hangzhou, CN', type: 'Cookware & kitchen appliances' },
  // hvac
  'Daikin India': { cc: 'IN', url: 'daikinindia.com', hq: 'New Delhi, IN', type: 'Air conditioning systems' },
  'Blue Star': { cc: 'IN', url: 'bluestarindia.com', hq: 'Mumbai, IN', type: 'HVAC & cooling' },
  // networking
  Huawei: { cc: 'CN', url: 'huawei.com', hq: 'Shenzhen, CN', type: 'Networking & telecom' },
  ZTE: { cc: 'CN', url: 'zte.com.cn', hq: 'Shenzhen, CN', type: 'Networking & telecom' },
  'Tejas Networks': { cc: 'IN', url: 'tejasnetworks.com', hq: 'Bengaluru, IN', type: 'Optical & networking gear' },
  HFCL: { cc: 'IN', url: 'hfcl.com', hq: 'New Delhi, IN', type: 'Telecom & optical fiber' },
  'TP-Link': { cc: 'CN', url: 'tp-link.com', hq: 'Shenzhen, CN', type: 'Networking equipment' },
  // audio-video
  Hisense: { cc: 'CN', url: 'hisense.com', hq: 'Qingdao, CN', type: 'TVs & consumer electronics' },
  TCL: { cc: 'CN', url: 'tcl.com', hq: 'Huizhou, CN', type: 'TVs & consumer electronics' },
  Skyworth: { cc: 'CN', url: 'skyworth.com', hq: 'Shenzhen, CN', type: 'TVs & consumer electronics' },
  boAt: { cc: 'IN', url: 'boat-lifestyle.com', hq: 'New Delhi, IN', type: 'Audio & wearables' },
  'Creative Technology': { cc: 'SG', url: 'creative.com', hq: 'Singapore', type: 'Audio products' },
  // imaging-optics
  DJI: { cc: 'CN', url: 'dji.com', hq: 'Shenzhen, CN', type: 'Drones & imaging' },
  // medical
  Mindray: { cc: 'CN', url: 'mindray.com', hq: 'Shenzhen, CN', type: 'Medical devices' },
  'United Imaging': { cc: 'CN', url: 'united-imaging.com', hq: 'Shanghai, CN', type: 'Medical imaging systems' },
  Trivitron: { cc: 'IN', url: 'trivitron.com', hq: 'Chennai, IN', type: 'Medical devices' },
  'BPL Medical Technologies': { cc: 'IN', url: 'bplmedicaltechnologies.com', hq: 'Bengaluru, IN', type: 'Medical devices' },
  Skanray: { cc: 'IN', url: 'skanray.com', hq: 'Mysuru, IN', type: 'Medical devices' },
  // lab-instruments
  Drawell: { cc: 'CN', url: 'drawell.com.cn', hq: 'Chongqing, CN', type: 'Lab instruments' },
  Borosil: { cc: 'IN', url: 'borosil.com', hq: 'Mumbai, IN', type: 'Lab glassware & instruments' },
  'Avantor India': { cc: 'IN', url: 'avantorsciences.com', hq: 'Pune, IN', type: 'Lab chemicals & instruments' },
  // dental-veterinary
  'Woodpecker Medical': { cc: 'CN', url: 'glodental.com', hq: 'Guilin, CN', type: 'Dental equipment' },
  COXO: { cc: 'CN', url: 'coxo.com.cn', hq: 'Foshan, CN', type: 'Dental equipment' },
  Runyes: { cc: 'CN', url: 'runyesmedical.com', hq: 'Ningbo, CN', type: 'Dental equipment' },
  'Confident Dental': { cc: 'IN', url: 'confidentindia.com', hq: 'Bengaluru, IN', type: 'Dental equipment' },
  'Foshan Vimel': { cc: 'CN', url: 'vimeldental.com', hq: 'Foshan, CN', type: 'Dental equipment' },
  // tools
  Chervon: { cc: 'CN', url: 'chervongroup.com', hq: 'Nanjing, CN', type: 'Power tools' },
  Positec: { cc: 'CN', url: 'positecgroup.com', hq: 'Suzhou, CN', type: 'Power tools' },
  Dongcheng: { cc: 'CN', url: 'dongcheng-global.com', hq: 'Nantong, CN', type: 'Power tools' },
  'Stanley India': { cc: 'IN', url: 'stanleyblackanddecker.com', hq: 'Bengaluru, IN', type: 'Hand & power tools' },
  // garden-power
  Greenworks: { cc: 'CN', url: 'greenworkstools.com', hq: 'Changzhou, CN', type: 'Battery garden tools' },
  'Honda India Power': { cc: 'IN', url: 'hondaindiapower.com', hq: 'Greater Noida, IN', type: 'Garden & power products' },
  'Falcon Garden Tools': { cc: 'IN', url: 'falconindia.in', hq: 'Ludhiana, IN', type: 'Garden tools' },
  'Yongkang Lebon': { cc: 'CN', url: 'chinalebon.com', hq: 'Yongkang, CN', type: 'Garden power tools' },
  // lighting
  'Signify India': { cc: 'IN', url: 'signify.com', hq: 'Gurugram, IN', type: 'Lighting systems' },
  Havells: { cc: 'IN', url: 'havells.com', hq: 'Noida, IN', type: 'Lighting & electricals' },
  'Syska LED': { cc: 'IN', url: 'syska.co.in', hq: 'Pune, IN', type: 'LED lighting' },
  'Opple Lighting': { cc: 'CN', url: 'opple.com', hq: 'Shanghai, CN', type: 'Lighting systems' },
  'NVC Lighting': { cc: 'CN', url: 'nvc-global.com', hq: 'Huizhou, CN', type: 'Lighting systems' },
  // building-products
  'Godrej Locks': { cc: 'IN', url: 'godrejlocks.com', hq: 'Mumbai, IN', type: 'Locks & security hardware' },
  'Dahua Technology': { cc: 'CN', url: 'dahuatech.com', hq: 'Hangzhou, CN', type: 'Surveillance & security' },
  Aqara: { cc: 'CN', url: 'aqara.com', hq: 'Shenzhen, CN', type: 'Smart home devices' },
  'ASSA ABLOY India': { cc: 'IN', url: 'assaabloy.com', hq: 'New Delhi, IN', type: 'Locks & access control' },
  // plumbing
  Jaquar: { cc: 'IN', url: 'jaquar.com', hq: 'Gurugram, IN', type: 'Bath & sanitaryware' },
  'Cera Sanitaryware': { cc: 'IN', url: 'cera-india.com', hq: 'Ahmedabad, IN', type: 'Sanitaryware & faucets' },
  Hindware: { cc: 'IN', url: 'hindware.com', hq: 'Gurugram, IN', type: 'Sanitaryware & faucets' },
  JOMOO: { cc: 'CN', url: 'jomoo.com.cn', hq: 'Xiamen, CN', type: 'Sanitaryware & faucets' },
  HUIDA: { cc: 'CN', url: 'huida.com.cn', hq: 'Tangshan, CN', type: 'Sanitaryware' },
  // personal-care
  'Havells India': { cc: 'IN', url: 'havells.com', hq: 'Noida, IN', type: 'Personal care & appliances' },
  'Vega Industries': { cc: 'IN', url: 'vegaindustries.com', hq: 'Mumbai, IN', type: 'Grooming products' },
  Xiaomi: { cc: 'CN', url: 'mi.com', hq: 'Beijing, CN', type: 'Consumer electronics & care' },
  Kemei: { cc: 'CN', url: 'kemei.cc', hq: 'Wenzhou, CN', type: 'Grooming appliances' },
  'SID Technology': { cc: 'CN', url: 'sidbeauty.com', hq: 'Shenzhen, CN', type: 'Personal care appliances' },
  // floorcare
  'Eureka Forbes': { cc: 'IN', url: 'eurekaforbes.com', hq: 'Mumbai, IN', type: 'Vacuum & water purifiers' },
  Ecovacs: { cc: 'CN', url: 'ecovacs.com', hq: 'Suzhou, CN', type: 'Robot vacuums' },
  Roborock: { cc: 'CN', url: 'roborock.com', hq: 'Beijing, CN', type: 'Robot vacuums' },
  'Kent RO Systems': { cc: 'IN', url: 'kent.co.in', hq: 'Noida, IN', type: 'Water purifiers & cleaners' },
  Roidmi: { cc: 'CN', url: 'roidmi.com', hq: 'Wuxi, CN', type: 'Vacuum cleaners' },
  // furniture
  'Godrej Interio': { cc: 'IN', url: 'godrejinterio.com', hq: 'Mumbai, IN', type: 'Furniture' },
  Nilkamal: { cc: 'IN', url: 'nilkamal.com', hq: 'Mumbai, IN', type: 'Furniture' },
  Featherlite: { cc: 'IN', url: 'featherlitefurniture.com', hq: 'Bengaluru, IN', type: 'Office furniture' },
  Sunon: { cc: 'CN', url: 'sunon.com', hq: 'Hangzhou, CN', type: 'Office furniture' },
  'UE Furniture': { cc: 'CN', url: 'uefurniture.com', hq: 'Huzhou, CN', type: 'Furniture' },
  // fitness-equipment
  'Cosco India': { cc: 'IN', url: 'coscoindia.com', hq: 'New Delhi, IN', type: 'Sports & fitness equipment' },
  'Shuhua Sports': { cc: 'CN', url: 'shuhua.com', hq: 'Quanzhou, CN', type: 'Fitness equipment' },
  'Impulse Health Tech': { cc: 'CN', url: 'impulsefitness.com', hq: 'Qingdao, CN', type: 'Fitness equipment' },
  'Welcare India': { cc: 'IN', url: 'welcarefitness.com', hq: 'Chennai, IN', type: 'Fitness equipment' },
  'Energie Fitness': { cc: 'IN', url: 'energie.in', hq: 'Mumbai, IN', type: 'Fitness equipment' },
  // cycling
  'Hero Cycles': { cc: 'IN', url: 'herocycles.com', hq: 'Ludhiana, IN', type: 'Bicycles' },
  'Avon Cycles': { cc: 'IN', url: 'avoncycles.com', hq: 'Ludhiana, IN', type: 'Bicycles' },
  'TI Cycles of India': { cc: 'IN', url: 'ticycles.com', hq: 'Chennai, IN', type: 'Bicycles' },
  'Shanghai Phoenix': { cc: 'CN', url: 'phoenix-bike.com', hq: 'Shanghai, CN', type: 'Bicycles' },
  'Forever Bicycle': { cc: 'CN', url: 'forever1940.com', hq: 'Shanghai, CN', type: 'Bicycles' },
  // outdoor-gear
  Wildcraft: { cc: 'IN', url: 'wildcraft.com', hq: 'Bengaluru, IN', type: 'Outdoor gear & backpacks' },
  Naturehike: { cc: 'CN', url: 'naturehike.com', hq: 'Ningbo, CN', type: 'Outdoor & camping gear' },
  'Mobi Garden': { cc: 'CN', url: 'mobigarden.com', hq: 'Ningbo, CN', type: 'Camping gear' },
  KingCamp: { cc: 'CN', url: 'kingcamp.com', hq: 'Beijing, CN', type: 'Camping & outdoor gear' },
  'Adventure Worx': { cc: 'IN', url: 'adventureworx.in', hq: 'Bengaluru, IN', type: 'Backpacks & outdoor gear' },
  // musical-instruments
  Givson: { cc: 'IN', url: 'givson.in', hq: 'New Delhi, IN', type: 'Guitars & instruments' },
  'Pearl River Piano': { cc: 'CN', url: 'pearlriver.com', hq: 'Guangzhou, CN', type: 'Pianos & instruments' },
  'Jinbao Musical': { cc: 'CN', url: 'jinbao.com', hq: 'Tianjin, CN', type: 'Musical instruments' },
  'Furtados Music': { cc: 'IN', url: 'furtadosonline.com', hq: 'Mumbai, IN', type: 'Musical instruments' },
  Sinomusik: { cc: 'CN', url: 'sinomusik.com', hq: 'Guangzhou, CN', type: 'Musical instruments' },
  // toys-games
  Funskool: { cc: 'IN', url: 'funskoolindia.com', hq: 'Chennai, IN', type: 'Toys & games' },
  'Alpha Group': { cc: 'CN', url: 'auldey.com', hq: 'Shantou, CN', type: 'Toys & animation' },
  Rastar: { cc: 'CN', url: 'rastar.com', hq: 'Shantou, CN', type: 'RC toys & models' },
  Smartivity: { cc: 'IN', url: 'smartivity.in', hq: 'New Delhi, IN', type: 'STEM toys' },
  // office-equipment
  'Canon India': { cc: 'IN', url: 'canon.co.in', hq: 'Gurugram, IN', type: 'Printers & imaging' },
  'TVS Electronics': { cc: 'IN', url: 'tvs-e.in', hq: 'Chennai, IN', type: 'Office & retail equipment' },
  'Comix Group': { cc: 'CN', url: 'comix.com.cn', hq: 'Guangzhou, CN', type: 'Office supplies & equipment' },
  'Deli Group': { cc: 'CN', url: 'nbdeli.com', hq: 'Ningbo, CN', type: 'Office supplies & equipment' },
  'Aurora Office': { cc: 'CN', url: 'aurora.com.cn', hq: 'Shanghai, CN', type: 'Office equipment' },
  // vending-kiosks
  'TCN Vending': { cc: 'CN', url: 'tcnvend.com', hq: 'Changsha, CN', type: 'Vending machines' },
  'Easy Touch': { cc: 'CN', url: 'easyvending.com', hq: 'Guangzhou, CN', type: 'Vending machines' },
  Posiflex: { cc: 'CN', url: 'posiflex.com', hq: 'Taipei, CN', type: 'POS & kiosk systems' },
  'Wep Solutions': { cc: 'IN', url: 'wepsolutions.co.in', hq: 'Bengaluru, IN', type: 'Kiosks & retail tech' },
  Hivendr: { cc: 'IN', url: 'hivendr.com', hq: 'Mumbai, IN', type: 'Smart vending solutions' },
  // elevators
  'Johnson Lifts': { cc: 'IN', url: 'johnsonliftsltd.com', hq: 'Chennai, IN', type: 'Elevators & escalators' },
  'Canny Elevator': { cc: 'CN', url: 'cannyelevator.com', hq: 'Suzhou, CN', type: 'Elevators & escalators' },
  SJEC: { cc: 'CN', url: 'sjec.com', hq: 'Suzhou, CN', type: 'Elevators & escalators' },
  'Omega Elevators': { cc: 'IN', url: 'omegaelevators.net', hq: 'Ahmedabad, IN', type: 'Elevators' },
  'IFE Elevators': { cc: 'CN', url: 'ife.com.cn', hq: 'Hangzhou, CN', type: 'Elevators & escalators' },
  // textile-machinery
  'Jingwei Textile': { cc: 'CN', url: 'chinatexmach.com.cn', hq: 'Beijing, CN', type: 'Textile machinery' },
  'Rieter India': { cc: 'IN', url: 'rieter.com', hq: 'Pune, IN', type: 'Spinning machinery' },
  'Truetzschler India': { cc: 'IN', url: 'truetzschler.com', hq: 'Ahmedabad, IN', type: 'Textile machinery' },
  Trumac: { cc: 'IN', url: 'trumac.com', hq: 'Ahmedabad, IN', type: 'Textile machinery' },
  // printing-packaging
  'Manugraph India': { cc: 'IN', url: 'manugraph.com', hq: 'Mumbai, IN', type: 'Printing presses' },
  'Masterwork Group': { cc: 'CN', url: 'masterworkgroup.com', hq: 'Tianjin, CN', type: 'Packaging machinery' },
  'Beijing Founder': { cc: 'CN', url: 'foundertech.com', hq: 'Beijing, CN', type: 'Printing & imaging systems' },
  TCY: { cc: 'CN', url: 'tcy.com.tw', hq: 'Taichung, CN', type: 'Printing & packaging machinery' },
  'Bobst India': { cc: 'IN', url: 'bobst.com', hq: 'Pune, IN', type: 'Packaging machinery' },
  // food-processing
  'Buhler India': { cc: 'IN', url: 'buhlergroup.com', hq: 'Bengaluru, IN', type: 'Food processing machinery' },
  'Nichrome India': { cc: 'IN', url: 'nichrome.com', hq: 'Pune, IN', type: 'Packaging machinery' },
  SaintyCo: { cc: 'CN', url: 'saintytec.com', hq: 'Shanghai, CN', type: 'Processing & packaging machinery' },
  Hommy: { cc: 'CN', url: 'hommy.com', hq: 'Jinan, CN', type: 'Food processing machinery' },
  'Bajaj Processpack': { cc: 'IN', url: 'bajajprocesspack.com', hq: 'Noida, IN', type: 'Food processing & packaging' },
  // timepieces
  'Titan Company': { cc: 'IN', url: 'titancompany.in', hq: 'Bengaluru, IN', type: 'Watches & timepieces' },
  'Sea-Gull': { cc: 'CN', url: 'seagull-watch.com', hq: 'Tianjin, CN', type: 'Watches & movements' },
  Fiyta: { cc: 'CN', url: 'fiyta.com.cn', hq: 'Shenzhen, CN', type: 'Watches' },
  'Ajanta Quartz': { cc: 'IN', url: 'ajantaworld.com', hq: 'Morbi, IN', type: 'Clocks & watches' },
  Sonata: { cc: 'IN', url: 'sonatawatches.in', hq: 'Bengaluru, IN', type: 'Watches' },
  // emergency-equipment
  'Ceasefire Industries': { cc: 'IN', url: 'ceasefire.in', hq: 'Noida, IN', type: 'Fire safety equipment' },
  'Newage Fire': { cc: 'IN', url: 'newagefire.com', hq: 'Mumbai, IN', type: 'Fire protection systems' },
  'Minimax India': { cc: 'IN', url: 'minimax.com', hq: 'Mumbai, IN', type: 'Fire protection systems' },
  'Tianguang Fire': { cc: 'CN', url: 'tgfire.com', hq: 'Nanjing, CN', type: 'Fire fighting equipment' },
  Sanon: { cc: 'CN', url: 'sanon.com.cn', hq: 'Nanjing, CN', type: 'Fire safety equipment' },
};

// Global majors for the per-domain fallback lists: the five most credible
// makers of each product class worldwide (US/EU/JP/KR alongside CN/IN), so a
// de-icing truck shows Oshkosh and Vestergaard rather than generic automakers.
const GLOBAL_DB: Record<string, VendorInfo> = {
  Toyota: { cc: 'JP', url: 'global.toyota', hq: 'Toyota City, JP', type: 'Automaker' },
  'Volkswagen Group': { cc: 'DE', url: 'volkswagen-group.com', hq: 'Wolfsburg, DE', type: 'Automaker' },
  'General Motors': { cc: 'US', url: 'gm.com', hq: 'Detroit, US', type: 'Automaker' },
  'Hyundai Motor': { cc: 'KR', url: 'hyundai.com', hq: 'Seoul, KR', type: 'Automaker' },
  'Honda Motorcycle': { cc: 'JP', url: 'global.honda', hq: 'Tokyo, JP', type: 'Motorcycles & power products' },
  'Yamaha Motor': { cc: 'JP', url: 'yamaha-motor.com', hq: 'Iwata, JP', type: 'Motorcycles & marine' },
  'Harley-Davidson': { cc: 'US', url: 'harley-davidson.com', hq: 'Milwaukee, US', type: 'Motorcycles' },
  Boeing: { cc: 'US', url: 'boeing.com', hq: 'Arlington, US', type: 'Aerospace OEM' },
  Airbus: { cc: 'FR', url: 'airbus.com', hq: 'Toulouse, FR', type: 'Aerospace OEM' },
  'Lockheed Martin': { cc: 'US', url: 'lockheedmartin.com', hq: 'Bethesda, US', type: 'Aerospace & defense' },
  Embraer: { cc: 'BR', url: 'embraer.com', hq: 'São José dos Campos, BR', type: 'Aircraft OEM' },
  'Textron Aviation': { cc: 'US', url: 'txtav.com', hq: 'Wichita, US', type: 'Aircraft OEM' },
  'Oshkosh AeroTech': { cc: 'US', url: 'oshkoshaerotech.com', hq: 'Orlando, US', type: 'Airport ground support' },
  'TLD Group': { cc: 'FR', url: 'tld-group.com', hq: 'Paris, FR', type: 'Ground support equipment' },
  'Textron GSE': { cc: 'US', url: 'textrongse.txtsv.com', hq: 'Augusta, US', type: 'Ground support equipment' },
  Vestergaard: { cc: 'DK', url: 'vestergaardcompany.com', hq: 'Skanderborg, DK', type: 'De-icers & GSE' },
  Mallaghan: { cc: 'GB', url: 'mallaghangse.com', hq: 'Dungannon, GB', type: 'Ground support equipment' },
  'HD Hyundai': { cc: 'KR', url: 'hd.com', hq: 'Ulsan, KR', type: 'Shipbuilder' },
  Fincantieri: { cc: 'IT', url: 'fincantieri.com', hq: 'Trieste, IT', type: 'Shipbuilder' },
  'Damen Shipyards': { cc: 'NL', url: 'damen.com', hq: 'Gorinchem, NL', type: 'Shipbuilder' },
  Brunswick: { cc: 'US', url: 'brunswick.com', hq: 'Mettawa, US', type: 'Marine & boats' },
  Alstom: { cc: 'FR', url: 'alstom.com', hq: 'Saint-Ouen, FR', type: 'Rail rolling stock' },
  'Siemens Mobility': { cc: 'DE', url: 'mobility.siemens.com', hq: 'Munich, DE', type: 'Rail systems' },
  'Stadler Rail': { cc: 'CH', url: 'stadlerrail.com', hq: 'Bussnang, CH', type: 'Rail rolling stock' },
  Wabtec: { cc: 'US', url: 'wabteccorp.com', hq: 'Pittsburgh, US', type: 'Rail equipment' },
  'Plasser & Theurer': { cc: 'AT', url: 'plassertheurer.com', hq: 'Linz, AT', type: 'Track maintenance machines' },
  Loram: { cc: 'US', url: 'loram.com', hq: 'Hamel, US', type: 'Rail maintenance' },
  'Harsco Rail': { cc: 'US', url: 'harscorail.com', hq: 'Columbia, US', type: 'Track maintenance' },
  Geismar: { cc: 'FR', url: 'geismar.com', hq: 'Colmar, FR', type: 'Track equipment' },
  MATISA: { cc: 'CH', url: 'matisa.ch', hq: 'Crissier, CH', type: 'Track machines' },
  SpaceX: { cc: 'US', url: 'spacex.com', hq: 'Hawthorne, US', type: 'Launch & spacecraft' },
  'Northrop Grumman': { cc: 'US', url: 'northropgrumman.com', hq: 'Falls Church, US', type: 'Space & defense' },
  'Rocket Lab': { cc: 'US', url: 'rocketlabusa.com', hq: 'Long Beach, US', type: 'Launch & spacecraft' },
  'Thales Alenia Space': { cc: 'FR', url: 'thalesaleniaspace.com', hq: 'Cannes, FR', type: 'Satellites' },
  'Smiths Detection': { cc: 'GB', url: 'smithsdetection.com', hq: 'London, GB', type: 'Security screening' },
  Leidos: { cc: 'US', url: 'leidos.com', hq: 'Reston, US', type: 'Security & screening' },
  Rapiscan: { cc: 'US', url: 'rapiscansystems.com', hq: 'Torrance, US', type: 'X-ray screening' },
  Thales: { cc: 'FR', url: 'thalesgroup.com', hq: 'Paris, FR', type: 'Defense electronics' },
  'BAE Systems': { cc: 'GB', url: 'baesystems.com', hq: 'London, GB', type: 'Defense' },
  Caterpillar: { cc: 'US', url: 'caterpillar.com', hq: 'Irving, US', type: 'Construction & mining equipment' },
  Komatsu: { cc: 'JP', url: 'komatsu.com', hq: 'Tokyo, JP', type: 'Construction & mining equipment' },
  'Volvo CE': { cc: 'SE', url: 'volvoce.com', hq: 'Gothenburg, SE', type: 'Construction equipment' },
  Liebherr: { cc: 'CH', url: 'liebherr.com', hq: 'Bulle, CH', type: 'Cranes & heavy equipment' },
  'John Deere': { cc: 'US', url: 'deere.com', hq: 'Moline, US', type: 'Agriculture & turf' },
  'CNH Industrial': { cc: 'GB', url: 'cnh.com', hq: 'Basildon, GB', type: 'Agriculture (Case IH, New Holland)' },
  AGCO: { cc: 'US', url: 'agcocorp.com', hq: 'Duluth, US', type: 'Agriculture (Fendt, Massey Ferguson)' },
  Claas: { cc: 'DE', url: 'claas.com', hq: 'Harsewinkel, DE', type: 'Harvesters & tractors' },
  Kubota: { cc: 'JP', url: 'kubota.com', hq: 'Osaka, JP', type: 'Compact tractors & equipment' },
  Sandvik: { cc: 'SE', url: 'rocktechnology.sandvik', hq: 'Stockholm, SE', type: 'Mining & rock technology' },
  Epiroc: { cc: 'SE', url: 'epiroc.com', hq: 'Stockholm, SE', type: 'Mining & drilling equipment' },
  Metso: { cc: 'FI', url: 'metso.com', hq: 'Helsinki, FI', type: 'Crushing & minerals processing' },
  'Atlas Copco': { cc: 'SE', url: 'atlascopco.com', hq: 'Stockholm, SE', type: 'Compressors & industrial' },
  Andritz: { cc: 'AT', url: 'andritz.com', hq: 'Graz, AT', type: 'Process plants & machinery' },
  'Bühler Group': { cc: 'CH', url: 'buhlergroup.com', hq: 'Uzwil, CH', type: 'Food & materials processing' },
  'GEA Group': { cc: 'DE', url: 'gea.com', hq: 'Düsseldorf, DE', type: 'Process technology' },
  'Mitsubishi Heavy Industries': { cc: 'JP', url: 'mhi.com', hq: 'Tokyo, JP', type: 'Heavy machinery' },
  'DMG MORI': { cc: 'DE', url: 'dmgmori.com', hq: 'Bielefeld, DE', type: 'Machine tools' },
  Mazak: { cc: 'JP', url: 'mazak.com', hq: 'Oguchi, JP', type: 'Machine tools' },
  'Haas Automation': { cc: 'US', url: 'haascnc.com', hq: 'Oxnard, US', type: 'CNC machine tools' },
  Okuma: { cc: 'JP', url: 'okuma.com', hq: 'Niwa, JP', type: 'Machine tools' },
  Trumpf: { cc: 'DE', url: 'trumpf.com', hq: 'Ditzingen, DE', type: 'Laser & sheet-metal machines' },
  Fanuc: { cc: 'JP', url: 'fanuc.com', hq: 'Oshino, JP', type: 'Industrial robots & CNC' },
  'ABB Robotics': { cc: 'CH', url: 'abb.com', hq: 'Zurich, CH', type: 'Industrial robots' },
  Yaskawa: { cc: 'JP', url: 'yaskawa.com', hq: 'Kitakyushu, JP', type: 'Robots & motion' },
  KUKA: { cc: 'DE', url: 'kuka.com', hq: 'Augsburg, DE', type: 'Industrial robots' },
  'Universal Robots': { cc: 'DK', url: 'universal-robots.com', hq: 'Odense, DK', type: 'Collaborative robots' },
  'Toyota Material Handling': { cc: 'JP', url: 'toyota-industries.com', hq: 'Kariya, JP', type: 'Forklifts & logistics' },
  'KION Group': { cc: 'DE', url: 'kiongroup.com', hq: 'Frankfurt, DE', type: 'Forklifts (Linde, STILL)' },
  Jungheinrich: { cc: 'DE', url: 'jungheinrich.com', hq: 'Hamburg, DE', type: 'Warehouse trucks' },
  'Crown Equipment': { cc: 'US', url: 'crown.com', hq: 'New Bremen, US', type: 'Forklifts' },
  'GE Vernova': { cc: 'US', url: 'gevernova.com', hq: 'Cambridge, US', type: 'Power generation' },
  'Siemens Energy': { cc: 'DE', url: 'siemens-energy.com', hq: 'Munich, DE', type: 'Power & grid' },
  'Hitachi Energy': { cc: 'CH', url: 'hitachienergy.com', hq: 'Zurich, CH', type: 'Grid & transformers' },
  ABB: { cc: 'CH', url: 'abb.com', hq: 'Zurich, CH', type: 'Electrification & automation' },
  'Schneider Electric': { cc: 'FR', url: 'se.com', hq: 'Rueil-Malmaison, FR', type: 'Electrical & automation' },
  Vestas: { cc: 'DK', url: 'vestas.com', hq: 'Aarhus, DK', type: 'Wind turbines' },
  'First Solar': { cc: 'US', url: 'firstsolar.com', hq: 'Tempe, US', type: 'PV modules' },
  'Enphase Energy': { cc: 'US', url: 'enphase.com', hq: 'Fremont, US', type: 'Microinverters & storage' },
  SLB: { cc: 'US', url: 'slb.com', hq: 'Houston, US', type: 'Oilfield services & equipment' },
  Halliburton: { cc: 'US', url: 'halliburton.com', hq: 'Houston, US', type: 'Oilfield services' },
  'Baker Hughes': { cc: 'US', url: 'bakerhughes.com', hq: 'Houston, US', type: 'Energy technology' },
  NOV: { cc: 'US', url: 'nov.com', hq: 'Houston, US', type: 'Drilling equipment' },
  TechnipFMC: { cc: 'GB', url: 'technipfmc.com', hq: 'London, GB', type: 'Subsea & surface systems' },
  Grundfos: { cc: 'DK', url: 'grundfos.com', hq: 'Bjerringbro, DK', type: 'Pumps' },
  Xylem: { cc: 'US', url: 'xylem.com', hq: 'Washington, US', type: 'Water technology' },
  Flowserve: { cc: 'US', url: 'flowserve.com', hq: 'Irving, US', type: 'Pumps & valves' },
  KSB: { cc: 'DE', url: 'ksb.com', hq: 'Frankenthal, DE', type: 'Pumps & valves' },
  'Parker Hannifin': { cc: 'US', url: 'parker.com', hq: 'Cleveland, US', type: 'Motion & fluid control' },
  Whirlpool: { cc: 'US', url: 'whirlpoolcorp.com', hq: 'Benton Harbor, US', type: 'Home appliances' },
  'BSH Home Appliances': { cc: 'DE', url: 'bsh-group.com', hq: 'Munich, DE', type: 'Appliances (Bosch, Siemens)' },
  Electrolux: { cc: 'SE', url: 'electroluxgroup.com', hq: 'Stockholm, SE', type: 'Home appliances' },
  'LG Electronics': { cc: 'KR', url: 'lg.com', hq: 'Seoul, KR', type: 'Appliances & electronics' },
  Breville: { cc: 'AU', url: 'breville.com', hq: 'Sydney, AU', type: 'Kitchen appliances' },
  'Groupe SEB': { cc: 'FR', url: 'groupeseb.com', hq: 'Écully, FR', type: 'Cookware & small appliances' },
  'Hamilton Beach': { cc: 'US', url: 'hamiltonbeach.com', hq: 'Glen Allen, US', type: 'Small appliances' },
  Panasonic: { cc: 'JP', url: 'panasonic.com', hq: 'Osaka, JP', type: 'Electronics & appliances' },
  Carrier: { cc: 'US', url: 'carrier.com', hq: 'Palm Beach Gardens, US', type: 'HVAC' },
  'Trane Technologies': { cc: 'US', url: 'tranetechnologies.com', hq: 'Davidson, US', type: 'HVAC' },
  Daikin: { cc: 'JP', url: 'daikin.com', hq: 'Osaka, JP', type: 'HVAC' },
  Lennox: { cc: 'US', url: 'lennox.com', hq: 'Richardson, US', type: 'HVAC' },
  'Johnson Controls': { cc: 'US', url: 'johnsoncontrols.com', hq: 'Milwaukee, US', type: 'Building systems' },
  Jabil: { cc: 'US', url: 'jabil.com', hq: 'St. Petersburg, US', type: 'Electronics manufacturing' },
  Flex: { cc: 'US', url: 'flex.com', hq: 'Austin, US', type: 'Electronics manufacturing' },
  Celestica: { cc: 'CA', url: 'celestica.com', hq: 'Toronto, CA', type: 'Electronics manufacturing' },
  Sanmina: { cc: 'US', url: 'sanmina.com', hq: 'San Jose, US', type: 'Electronics manufacturing' },
  'Dell Technologies': { cc: 'US', url: 'dell.com', hq: 'Round Rock, US', type: 'Computers & infrastructure' },
  HP: { cc: 'US', url: 'hp.com', hq: 'Palo Alto, US', type: 'Computers & printers' },
  Lenovo: { cc: 'CN', url: 'lenovo.com', hq: 'Beijing, CN', type: 'Computers' },
  ASUS: { cc: 'TW', url: 'asus.com', hq: 'Taipei, TW', type: 'Computers & components' },
  Cisco: { cc: 'US', url: 'cisco.com', hq: 'San Jose, US', type: 'Networking' },
  Juniper: { cc: 'US', url: 'juniper.net', hq: 'Sunnyvale, US', type: 'Networking' },
  'Arista Networks': { cc: 'US', url: 'arista.com', hq: 'Santa Clara, US', type: 'Networking' },
  Nokia: { cc: 'FI', url: 'nokia.com', hq: 'Espoo, FI', type: 'Telecom equipment' },
  Sony: { cc: 'JP', url: 'sony.com', hq: 'Tokyo, JP', type: 'Consumer electronics' },
  'Samsung Electronics': { cc: 'KR', url: 'samsung.com', hq: 'Suwon, KR', type: 'Electronics & displays' },
  Harman: { cc: 'US', url: 'harman.com', hq: 'Stamford, US', type: 'Audio (JBL, AKG)' },
  Bose: { cc: 'US', url: 'bose.com', hq: 'Framingham, US', type: 'Audio' },
  'Yamaha Corporation': { cc: 'JP', url: 'yamaha.com', hq: 'Hamamatsu, JP', type: 'Audio & instruments' },
  Canon: { cc: 'JP', url: 'canon.com', hq: 'Tokyo, JP', type: 'Imaging & optics' },
  Nikon: { cc: 'JP', url: 'nikon.com', hq: 'Tokyo, JP', type: 'Imaging & optics' },
  ZEISS: { cc: 'DE', url: 'zeiss.com', hq: 'Oberkochen, DE', type: 'Optics & optoelectronics' },
  'Leica Camera': { cc: 'DE', url: 'leica-camera.com', hq: 'Wetzlar, DE', type: 'Cameras & optics' },
  'Teledyne FLIR': { cc: 'US', url: 'flir.com', hq: 'Wilsonville, US', type: 'Thermal imaging' },
  'GE HealthCare': { cc: 'US', url: 'gehealthcare.com', hq: 'Chicago, US', type: 'Medical imaging & devices' },
  'Siemens Healthineers': { cc: 'DE', url: 'siemens-healthineers.com', hq: 'Erlangen, DE', type: 'Medical systems' },
  Philips: { cc: 'NL', url: 'philips.com', hq: 'Amsterdam, NL', type: 'Health technology' },
  Medtronic: { cc: 'US', url: 'medtronic.com', hq: 'Minneapolis, US', type: 'Medical devices' },
  'Thermo Fisher Scientific': { cc: 'US', url: 'thermofisher.com', hq: 'Waltham, US', type: 'Lab instruments' },
  Agilent: { cc: 'US', url: 'agilent.com', hq: 'Santa Clara, US', type: 'Analytical instruments' },
  Bruker: { cc: 'US', url: 'bruker.com', hq: 'Billerica, US', type: 'Scientific instruments' },
  Shimadzu: { cc: 'JP', url: 'shimadzu.com', hq: 'Kyoto, JP', type: 'Analytical instruments' },
  Waters: { cc: 'US', url: 'waters.com', hq: 'Milford, US', type: 'Chromatography & MS' },
  'Dentsply Sirona': { cc: 'US', url: 'dentsplysirona.com', hq: 'Charlotte, US', type: 'Dental equipment' },
  Envista: { cc: 'US', url: 'envistaco.com', hq: 'Brea, US', type: 'Dental (KaVo, Nobel)' },
  Planmeca: { cc: 'FI', url: 'planmeca.com', hq: 'Helsinki, FI', type: 'Dental units & imaging' },
  'A-dec': { cc: 'US', url: 'a-dec.com', hq: 'Newberg, US', type: 'Dental chairs & delivery' },
  Midmark: { cc: 'US', url: 'midmark.com', hq: 'Versailles, US', type: 'Medical & veterinary equipment' },
  'Stanley Black & Decker': { cc: 'US', url: 'stanleyblackanddecker.com', hq: 'New Britain, US', type: 'Tools (DeWalt, Craftsman)' },
  'Bosch Power Tools': { cc: 'DE', url: 'bosch-professional.com', hq: 'Leinfelden, DE', type: 'Power tools' },
  Techtronic: { cc: 'CN', url: 'ttigroup.com', hq: 'Hong Kong, CN', type: 'Tools (Milwaukee, Ryobi)' },
  Makita: { cc: 'JP', url: 'makita.com', hq: 'Anjo, JP', type: 'Power tools' },
  Hilti: { cc: 'CH', url: 'hilti.com', hq: 'Schaan, CH', type: 'Construction tools' },
  Husqvarna: { cc: 'SE', url: 'husqvarna.com', hq: 'Stockholm, SE', type: 'Outdoor power products' },
  STIHL: { cc: 'DE', url: 'stihl.com', hq: 'Waiblingen, DE', type: 'Chainsaws & outdoor power' },
  Toro: { cc: 'US', url: 'thetorocompany.com', hq: 'Bloomington, US', type: 'Turf & outdoor equipment' },
  'Honda Power Equipment': { cc: 'JP', url: 'powerequipment.honda.com', hq: 'Tokyo, JP', type: 'Engines & outdoor power' },
  Chervon: { cc: 'CN', url: 'chervongroup.com', hq: 'Nanjing, CN', type: 'Power tools (EGO, SKIL)' },
  Signify: { cc: 'NL', url: 'signify.com', hq: 'Eindhoven, NL', type: 'Lighting (Philips Hue)' },
  'Acuity Brands': { cc: 'US', url: 'acuitybrands.com', hq: 'Atlanta, US', type: 'Lighting & controls' },
  Zumtobel: { cc: 'AT', url: 'zumtobelgroup.com', hq: 'Dornbirn, AT', type: 'Lighting' },
  'Cree Lighting': { cc: 'US', url: 'creelighting.com', hq: 'Racine, US', type: 'LED lighting' },
  Havells: { cc: 'IN', url: 'havells.com', hq: 'Noida, IN', type: 'Electrical & lighting' },
  'ASSA ABLOY': { cc: 'SE', url: 'assaabloy.com', hq: 'Stockholm, SE', type: 'Locks & access' },
  Allegion: { cc: 'US', url: 'allegion.com', hq: 'Dublin, US', type: 'Security products (Schlage)' },
  dormakaba: { cc: 'CH', url: 'dormakaba.com', hq: 'Rümlang, CH', type: 'Access & door systems' },
  Honeywell: { cc: 'US', url: 'honeywell.com', hq: 'Charlotte, US', type: 'Building & safety tech' },
  Kohler: { cc: 'US', url: 'kohler.com', hq: 'Kohler, US', type: 'Plumbing fixtures' },
  TOTO: { cc: 'JP', url: 'toto.com', hq: 'Kitakyushu, JP', type: 'Sanitaryware' },
  LIXIL: { cc: 'JP', url: 'lixil.com', hq: 'Tokyo, JP', type: 'Plumbing (Grohe, American Std)' },
  Moen: { cc: 'US', url: 'moen.com', hq: 'North Olmsted, US', type: 'Faucets & fixtures' },
  Geberit: { cc: 'CH', url: 'geberit.com', hq: 'Rapperswil, CH', type: 'Sanitary systems' },
  'Philips Personal Health': { cc: 'NL', url: 'philips.com', hq: 'Amsterdam, NL', type: 'Grooming & care' },
  Braun: { cc: 'DE', url: 'braun.com', hq: 'Kronberg, DE', type: 'Grooming (P&G)' },
  Conair: { cc: 'US', url: 'conair.com', hq: 'Stamford, US', type: 'Personal care appliances' },
  Dyson: { cc: 'GB', url: 'dyson.com', hq: 'Malmesbury, GB', type: 'Vacuums & hair care' },
  SharkNinja: { cc: 'US', url: 'sharkninja.com', hq: 'Needham, US', type: 'Floorcare & kitchen' },
  Bissell: { cc: 'US', url: 'bissell.com', hq: 'Grand Rapids, US', type: 'Floorcare' },
  iRobot: { cc: 'US', url: 'irobot.com', hq: 'Bedford, US', type: 'Robot vacuums' },
  Kärcher: { cc: 'DE', url: 'karcher.com', hq: 'Winnenden, DE', type: 'Cleaning equipment' },
  Steelcase: { cc: 'US', url: 'steelcase.com', hq: 'Grand Rapids, US', type: 'Office furniture' },
  MillerKnoll: { cc: 'US', url: 'millerknoll.com', hq: 'Zeeland, US', type: 'Furniture (Herman Miller)' },
  Haworth: { cc: 'US', url: 'haworth.com', hq: 'Holland, US', type: 'Office furniture' },
  HNI: { cc: 'US', url: 'hnicorp.com', hq: 'Muscatine, US', type: 'Furniture & hearth' },
  'IKEA Industry': { cc: 'SE', url: 'ikea.com', hq: 'Älmhult, SE', type: 'Furniture manufacturing' },
  'Life Fitness': { cc: 'US', url: 'lifefitness.com', hq: 'Rosemont, US', type: 'Fitness equipment' },
  Technogym: { cc: 'IT', url: 'technogym.com', hq: 'Cesena, IT', type: 'Fitness equipment' },
  Peloton: { cc: 'US', url: 'onepeloton.com', hq: 'New York, US', type: 'Connected fitness' },
  'Johnson Health Tech': { cc: 'TW', url: 'johnsonhealthtech.com', hq: 'Taichung, TW', type: 'Fitness (Matrix)' },
  Precor: { cc: 'US', url: 'precor.com', hq: 'Woodinville, US', type: 'Fitness equipment' },
  Giant: { cc: 'TW', url: 'giant-bicycles.com', hq: 'Taichung, TW', type: 'Bicycles' },
  Trek: { cc: 'US', url: 'trekbikes.com', hq: 'Waterloo, US', type: 'Bicycles' },
  Specialized: { cc: 'US', url: 'specialized.com', hq: 'Morgan Hill, US', type: 'Bicycles' },
  Merida: { cc: 'TW', url: 'merida-bikes.com', hq: 'Yuanlin, TW', type: 'Bicycles' },
  Cannondale: { cc: 'US', url: 'cannondale.com', hq: 'Wilton, US', type: 'Bicycles' },
  Coleman: { cc: 'US', url: 'coleman.com', hq: 'Chicago, US', type: 'Camping gear' },
  'The North Face': { cc: 'US', url: 'thenorthface.com', hq: 'Denver, US', type: 'Outdoor apparel & gear' },
  YETI: { cc: 'US', url: 'yeti.com', hq: 'Austin, US', type: 'Coolers & drinkware' },
  Decathlon: { cc: 'FR', url: 'decathlon.com', hq: 'Villeneuve-d\'Ascq, FR', type: 'Sporting goods' },
  Garmin: { cc: 'US', url: 'garmin.com', hq: 'Olathe, US', type: 'GPS & wearables' },
  Fender: { cc: 'US', url: 'fender.com', hq: 'Los Angeles, US', type: 'Guitars & amps' },
  Gibson: { cc: 'US', url: 'gibson.com', hq: 'Nashville, US', type: 'Guitars' },
  Roland: { cc: 'JP', url: 'roland.com', hq: 'Hamamatsu, JP', type: 'Electronic instruments' },
  'Steinway & Sons': { cc: 'US', url: 'steinway.com', hq: 'New York, US', type: 'Pianos' },
  LEGO: { cc: 'DK', url: 'lego.com', hq: 'Billund, DK', type: 'Construction toys' },
  Mattel: { cc: 'US', url: 'mattel.com', hq: 'El Segundo, US', type: 'Toys' },
  Hasbro: { cc: 'US', url: 'hasbro.com', hq: 'Pawtucket, US', type: 'Toys & games' },
  'Bandai Namco': { cc: 'JP', url: 'bandainamco.co.jp', hq: 'Tokyo, JP', type: 'Toys & amusement' },
  'Spin Master': { cc: 'CA', url: 'spinmaster.com', hq: 'Toronto, CA', type: 'Toys' },
  Ricoh: { cc: 'JP', url: 'ricoh.com', hq: 'Tokyo, JP', type: 'Office imaging' },
  Xerox: { cc: 'US', url: 'xerox.com', hq: 'Norwalk, US', type: 'Printers & copiers' },
  Epson: { cc: 'JP', url: 'epson.com', hq: 'Suwa, JP', type: 'Printers & projectors' },
  Brother: { cc: 'JP', url: 'brother.com', hq: 'Nagoya, JP', type: 'Printers & sewing' },
  'Crane Merchandising': { cc: 'US', url: 'cranems.com', hq: 'Williston, US', type: 'Vending machines' },
  Azkoyen: { cc: 'ES', url: 'azkoyen.com', hq: 'Peralta, ES', type: 'Vending & payment' },
  'Fuji Electric': { cc: 'JP', url: 'fujielectric.com', hq: 'Tokyo, JP', type: 'Vending & power electronics' },
  'Sanden Retail': { cc: 'JP', url: 'sanden-rs.com', hq: 'Isesaki, JP', type: 'Vending & retail systems' },
  Otis: { cc: 'US', url: 'otis.com', hq: 'Farmington, US', type: 'Elevators & escalators' },
  Schindler: { cc: 'CH', url: 'schindler.com', hq: 'Ebikon, CH', type: 'Elevators & escalators' },
  KONE: { cc: 'FI', url: 'kone.com', hq: 'Espoo, FI', type: 'Elevators & escalators' },
  'TK Elevator': { cc: 'DE', url: 'tkelevator.com', hq: 'Düsseldorf, DE', type: 'Elevators' },
  'Mitsubishi Electric': { cc: 'JP', url: 'mitsubishielectric.com', hq: 'Tokyo, JP', type: 'Elevators & electronics' },
  Rieter: { cc: 'CH', url: 'rieter.com', hq: 'Winterthur, CH', type: 'Spinning machinery' },
  Trützschler: { cc: 'DE', url: 'truetzschler.com', hq: 'Mönchengladbach, DE', type: 'Textile machinery' },
  Picanol: { cc: 'BE', url: 'picanol.be', hq: 'Ypres, BE', type: 'Weaving machines' },
  'Karl Mayer': { cc: 'DE', url: 'karlmayer.com', hq: 'Obertshausen, DE', type: 'Warp knitting machines' },
  Saurer: { cc: 'CH', url: 'saurer.com', hq: 'Arbon, CH', type: 'Spinning & embroidery' },
  Heidelberg: { cc: 'DE', url: 'heidelberg.com', hq: 'Heidelberg, DE', type: 'Printing presses' },
  Bobst: { cc: 'CH', url: 'bobst.com', hq: 'Lausanne, CH', type: 'Packaging machinery' },
  'Koenig & Bauer': { cc: 'DE', url: 'koenig-bauer.com', hq: 'Würzburg, DE', type: 'Printing presses' },
  'Windmöller & Hölscher': { cc: 'DE', url: 'wuh-group.com', hq: 'Lengerich, DE', type: 'Flexible packaging machines' },
  'Mark Andy': { cc: 'US', url: 'markandy.com', hq: 'Chesterfield, US', type: 'Label presses' },
  'Tetra Pak': { cc: 'CH', url: 'tetrapak.com', hq: 'Pully, CH', type: 'Food packaging & processing' },
  'JBT Marel': { cc: 'US', url: 'jbtc.com', hq: 'Chicago, US', type: 'Food processing equipment' },
  'Alfa Laval': { cc: 'SE', url: 'alfalaval.com', hq: 'Lund, SE', type: 'Heat transfer & separation' },
  Seiko: { cc: 'JP', url: 'seikowatches.com', hq: 'Tokyo, JP', type: 'Watches' },
  Citizen: { cc: 'JP', url: 'citizenwatch-global.com', hq: 'Tokyo, JP', type: 'Watches' },
  Casio: { cc: 'JP', url: 'casio.com', hq: 'Tokyo, JP', type: 'Watches & electronics' },
  'Swatch Group': { cc: 'CH', url: 'swatchgroup.com', hq: 'Biel, CH', type: 'Watches (Omega, Tissot)' },
  Rosenbauer: { cc: 'AT', url: 'rosenbauer.com', hq: 'Leonding, AT', type: 'Fire apparatus' },
  Oshkosh: { cc: 'US', url: 'oshkoshcorp.com', hq: 'Oshkosh, US', type: 'Specialty trucks (Pierce)' },
  'MSA Safety': { cc: 'US', url: 'msasafety.com', hq: 'Cranberry Township, US', type: 'Safety equipment' },
  Dräger: { cc: 'DE', url: 'draeger.com', hq: 'Lübeck, DE', type: 'Safety & medical tech' },
  'Korea Zinc': { cc: 'KR', url: 'koreazinc.co.kr', hq: 'Seoul, KR', type: 'Zinc smelting & indium' },
  Teck: { cc: 'CA', url: 'teck.com', hq: 'Vancouver, CA', type: 'Mining & zinc/indium refining' },
  Dowa: { cc: 'JP', url: 'dowa.co.jp', hq: 'Tokyo, JP', type: 'Nonferrous smelting & recycling' },
  Nyrstar: { cc: 'NL', url: 'nyrstar.com', hq: 'Budel, NL', type: 'Zinc smelting & indium' },
  Umicore: { cc: 'BE', url: 'umicore.com', hq: 'Brussels, BE', type: 'Materials & recycling' },
};

const ALLDB: Record<string, VendorInfo> = { ...DB, ...DB2, ...(EXTRA_DB as Record<string, VendorInfo>), ...GLOBAL_DB };

interface VSet { base: number; moq: string; lead: string; names: string[] }

const SETS: Record<string, VSet> = {
  vehicle: { base: 8, moq: 'made to order', lead: '·', names: ['BYD', 'Tata Motors', 'SAIC Motor', 'Mahindra', 'Geely'] },
  battery: { base: 3.2, moq: '5,000 cells', lead: '8–12 wks', names: ['CATL', 'EVE Energy', 'Amara Raja', 'Durapower', 'BYD'] },
  motor: { base: 4, moq: '500 units', lead: '10–14 wks', names: ['Inovance', 'Sona Comstar', 'Broad-Ocean', 'Nidec (Singapore)', 'Bosch India'] },
  bearing: { base: 2, moq: '2,000 pcs', lead: '6–10 wks', names: ['ZWZ Bearing', 'NBC Bearings', 'HRB Bearing', 'NRB Bearings', 'LYC Bearing'] },
  board: { base: 1.2, moq: '100 pcs', lead: '2–4 wks', names: ['JLCPCB', 'PCBWay', 'Shennan Circuits', 'Shogini Technoarts', 'Venture Corp'] },
  semi: { base: 3, moq: '1,000 pcs', lead: '12–20 wks', names: ['StarPower', 'UTAC', 'ASE (Singapore)', 'SMIC', 'SPEL Semiconductor'] },
  magnet: { base: 1.6, moq: '5,000 pcs', lead: '6–10 wks', names: ['JL MAG', 'Yantai Zhenghai', 'Ningbo Yunsheng', 'Zhong Ke San Huan', 'Earth-Panda'] },
  gear: { base: 3, moq: '1,000 pcs', lead: '8–12 wks', names: ['Sona Comstar', 'Zhejiang Shuanghuan', 'Bharat Gears', 'ZF India', 'Hangzhou Advance'] },
  tire: { base: 6, moq: '500 pcs', lead: '4–8 wks', names: ['MRF', 'Apollo Tyres', 'Linglong Tire', 'CEAT', 'Sailun'] },
  display: { base: 5, moq: '1,000 pcs', lead: '6–10 wks', names: ['BOE', 'Tianma', 'TCL CSOT', 'Truly Opto', 'Venture Corp'] },
  camera: { base: 4, moq: '1,000 pcs', lead: '8–12 wks', names: ['Sunny Optical', 'OFILM', 'VVDN Technologies', 'Truly Opto', 'AAC Technologies'] },
  wire: { base: 0.8, moq: '1,000 sets', lead: '4–6 wks', names: ['Motherson', 'Polycab', 'Luxshare', 'Hengtong', 'Finolex'] },
  fastener: { base: 0.15, moq: '10,000 pcs', lead: '3–5 wks', names: ['Sundram Fasteners', 'Lakshmi Precision Screws', 'Suzhou Escort', 'Shanghai Tianbao', 'Sterling Tools'] },
  fluid: { base: 4, moq: '200 units', lead: '6–10 wks', names: ['Kirloskar', 'Leo Group', 'Shakti Pumps', 'CNP Pumps', 'Roto Pumps'] },
  metal: { base: 2.2, moq: '500 pcs', lead: '6–10 wks', names: ['Bharat Forge', 'CITIC Dicastal', 'Tata AutoComp', 'Beyonics', 'Sundaram Clayton'] },
  seat: { base: 5, moq: '500 sets', lead: '8–12 wks', names: ['Bharat Seats', 'Yanfeng', 'Harita Seating', 'Tata AutoComp', 'Foxconn'] },
  spring: { base: 2, moq: '2,000 pcs', lead: '5–8 wks', names: ['Gabriel India', 'Jamna Auto', 'Munjal Showa', 'Chongqing Sokon', 'NRB Bearings'] },
  engine: { base: 180, moq: '50 units', lead: '12–16 wks', names: ['Weichai Power', 'Cummins India', 'Yuchai', 'Kirloskar Oil Engines', 'Ashok Leyland'] },
  generic: { base: 1.2, moq: '1,000 pcs', lead: '6–10 wks', names: ['Foxconn', 'Flex (Singapore)', 'Dixon Technologies', 'BYD Electronics', 'Venture Corp'] },
};

// Per-DOMAIN sourcing, the real OEMs that build finished products in each
// industry. Used for product nodes so a violin isn't "sourced from Foxconn".
// base is a rough per-part USD figure; final price = base × total parts × spread.
const DOMAIN_VENDORS: Record<string, VSet> = {
  automobiles: { base: 14, moq: 'made to order', lead: '16–28 wks', names: ['Toyota', 'Volkswagen Group', 'General Motors', 'Hyundai Motor', 'BYD'] },
  'two-wheelers': { base: 9, moq: 'made to order', lead: '10–16 wks', names: ['Honda Motorcycle', 'Yamaha Motor', 'Hero MotoCorp', 'Bajaj Auto', 'Harley-Davidson'] },
  aerospace: { base: 120, moq: 'made to order', lead: '40–80 wks', names: ['Boeing', 'Airbus', 'Lockheed Martin', 'Embraer', 'Textron Aviation'] },
  marine: { base: 90, moq: 'made to order', lead: '52–104 wks', names: ['HD Hyundai', 'Fincantieri', 'Damen Shipyards', 'Brunswick', 'CSSC'] },
  'rail-transit': { base: 60, moq: 'made to order', lead: '40–72 wks', names: ['CRRC', 'Alstom', 'Siemens Mobility', 'Stadler Rail', 'Wabtec'] },
  'rail-transport': { base: 60, moq: 'made to order', lead: '30–60 wks', names: ['Plasser & Theurer', 'Loram', 'Harsco Rail', 'Geismar', 'MATISA'] },
  'aerospace-ground': { base: 25, moq: 'made to order', lead: '16–30 wks', names: ['Oshkosh AeroTech', 'TLD Group', 'Textron GSE', 'Vestergaard', 'Mallaghan'] },
  'space-systems': { base: 200, moq: 'made to order', lead: '52–104 wks', names: ['SpaceX', 'Northrop Grumman', 'Airbus', 'Rocket Lab', 'Thales Alenia Space'] },
  'defense-security': { base: 40, moq: 'made to order', lead: '24–52 wks', names: ['Smiths Detection', 'Leidos', 'Rapiscan', 'Thales', 'BAE Systems'] },
  'construction-equipment': { base: 30, moq: 'made to order', lead: '16–28 wks', names: ['Caterpillar', 'Komatsu', 'Volvo CE', 'Liebherr', 'XCMG'] },
  'agri-construction': { base: 22, moq: 'made to order', lead: '14–24 wks', names: ['John Deere', 'CNH Industrial', 'AGCO', 'Claas', 'Kubota'] },
  'mining-equipment': { base: 45, moq: 'made to order', lead: '20–36 wks', names: ['Caterpillar', 'Komatsu', 'Sandvik', 'Epiroc', 'Metso'] },
  machinery: { base: 18, moq: '10 units', lead: '12–20 wks', names: ['Atlas Copco', 'Andritz', 'Bühler Group', 'GEA Group', 'Mitsubishi Heavy Industries'] },
  'machine-tools': { base: 16, moq: '5 units', lead: '12–20 wks', names: ['DMG MORI', 'Mazak', 'Haas Automation', 'Okuma', 'Trumpf'] },
  robotics: { base: 14, moq: '20 units', lead: '10–18 wks', names: ['Fanuc', 'ABB Robotics', 'Yaskawa', 'KUKA', 'Universal Robots'] },
  'material-handling': { base: 12, moq: '20 units', lead: '10–16 wks', names: ['Toyota Material Handling', 'KION Group', 'Jungheinrich', 'Crown Equipment', 'Hangcha'] },
  energy: { base: 35, moq: 'made to order', lead: '20–40 wks', names: ['GE Vernova', 'Siemens Energy', 'Hitachi Energy', 'ABB', 'Schneider Electric'] },
  'renewable-energy': { base: 8, moq: '500 units', lead: '12–24 wks', names: ['Vestas', 'First Solar', 'LONGi', 'Enphase Energy', 'Sungrow'] },
  'oil-gas': { base: 50, moq: 'made to order', lead: '24–48 wks', names: ['SLB', 'Halliburton', 'Baker Hughes', 'NOV', 'TechnipFMC'] },
  'fluid-handling': { base: 4, moq: '200 units', lead: '6–12 wks', names: ['Grundfos', 'Xylem', 'Flowserve', 'KSB', 'Parker Hannifin'] },
  appliances: { base: 2.5, moq: '1,000 units', lead: '8–14 wks', names: ['Whirlpool', 'BSH Home Appliances', 'Electrolux', 'LG Electronics', 'Haier'] },
  'kitchen-appliances': { base: 1.5, moq: '2,000 units', lead: '6–10 wks', names: ['Breville', 'Groupe SEB', 'Hamilton Beach', 'Panasonic', 'Midea'] },
  hvac: { base: 4, moq: '500 units', lead: '8–14 wks', names: ['Carrier', 'Trane Technologies', 'Daikin', 'Lennox', 'Johnson Controls'] },
  electronics: { base: 2, moq: '1,000 units', lead: '8–14 wks', names: ['Foxconn', 'Jabil', 'Flex', 'Celestica', 'Sanmina'] },
  computing: { base: 2.5, moq: '1,000 units', lead: '8–14 wks', names: ['Dell Technologies', 'HP', 'Lenovo', 'ASUS', 'Foxconn'] },
  networking: { base: 3, moq: '500 units', lead: '8–14 wks', names: ['Cisco', 'Juniper', 'Arista Networks', 'Nokia', 'Huawei'] },
  'audio-video': { base: 2, moq: '1,000 units', lead: '8–12 wks', names: ['Sony', 'Samsung Electronics', 'Harman', 'Bose', 'Yamaha Corporation'] },
  'imaging-optics': { base: 4, moq: '500 units', lead: '10–16 wks', names: ['Canon', 'Nikon', 'ZEISS', 'Leica Camera', 'Teledyne FLIR'] },
  medical: { base: 6, moq: '100 units', lead: '12–20 wks', names: ['GE HealthCare', 'Siemens Healthineers', 'Philips', 'Medtronic', 'Mindray'] },
  'lab-instruments': { base: 5, moq: '100 units', lead: '10–18 wks', names: ['Thermo Fisher Scientific', 'Agilent', 'Bruker', 'Shimadzu', 'Waters'] },
  'dental-veterinary': { base: 4, moq: '100 units', lead: '10–16 wks', names: ['Dentsply Sirona', 'Envista', 'Planmeca', 'A-dec', 'Midmark'] },
  tools: { base: 2, moq: '500 units', lead: '6–12 wks', names: ['Stanley Black & Decker', 'Bosch Power Tools', 'Techtronic', 'Makita', 'Hilti'] },
  'garden-power': { base: 3, moq: '500 units', lead: '8–14 wks', names: ['Husqvarna', 'STIHL', 'Toro', 'Honda Power Equipment', 'Chervon'] },
  lighting: { base: 1.5, moq: '2,000 units', lead: '6–10 wks', names: ['Signify', 'Acuity Brands', 'Zumtobel', 'Cree Lighting', 'Havells'] },
  'building-products': { base: 2, moq: '1,000 units', lead: '8–12 wks', names: ['ASSA ABLOY', 'Allegion', 'dormakaba', 'Honeywell', 'Hikvision'] },
  plumbing: { base: 2, moq: '1,000 units', lead: '6–12 wks', names: ['Kohler', 'TOTO', 'LIXIL', 'Moen', 'Geberit'] },
  'personal-care': { base: 1.4, moq: '2,000 units', lead: '6–10 wks', names: ['Philips Personal Health', 'Braun', 'Conair', 'Dyson', 'Panasonic'] },
  floorcare: { base: 2.5, moq: '1,000 units', lead: '8–12 wks', names: ['SharkNinja', 'Dyson', 'Bissell', 'iRobot', 'Kärcher'] },
  furniture: { base: 1.6, moq: '200 units', lead: '6–12 wks', names: ['Steelcase', 'MillerKnoll', 'Haworth', 'HNI', 'IKEA Industry'] },
  'fitness-equipment': { base: 3, moq: '200 units', lead: '8–14 wks', names: ['Life Fitness', 'Technogym', 'Peloton', 'Johnson Health Tech', 'Precor'] },
  cycling: { base: 2.5, moq: '500 units', lead: '6–12 wks', names: ['Giant', 'Trek', 'Specialized', 'Merida', 'Cannondale'] },
  'outdoor-gear': { base: 1.2, moq: '1,000 units', lead: '6–10 wks', names: ['Coleman', 'The North Face', 'YETI', 'Decathlon', 'Garmin'] },
  'musical-instruments': { base: 2.5, moq: '200 units', lead: '8–14 wks', names: ['Yamaha Corporation', 'Fender', 'Gibson', 'Roland', 'Steinway & Sons'] },
  'toys-games': { base: 1, moq: '2,000 units', lead: '6–10 wks', names: ['LEGO', 'Mattel', 'Hasbro', 'Bandai Namco', 'Spin Master'] },
  'office-equipment': { base: 2.5, moq: '500 units', lead: '8–12 wks', names: ['Canon', 'Ricoh', 'Xerox', 'Epson', 'Brother'] },
  'vending-kiosks': { base: 6, moq: '50 units', lead: '10–16 wks', names: ['Crane Merchandising', 'Azkoyen', 'Fuji Electric', 'Sanden Retail', 'TCN Vending'] },
  elevators: { base: 12, moq: '20 units', lead: '14–24 wks', names: ['Otis', 'Schindler', 'KONE', 'TK Elevator', 'Mitsubishi Electric'] },
  'textile-machinery': { base: 14, moq: '10 units', lead: '14–24 wks', names: ['Rieter', 'Trützschler', 'Picanol', 'Karl Mayer', 'Saurer'] },
  'printing-packaging': { base: 12, moq: '10 units', lead: '12–22 wks', names: ['Heidelberg', 'Bobst', 'Koenig & Bauer', 'Windmöller & Hölscher', 'Mark Andy'] },
  'food-processing': { base: 10, moq: '20 units', lead: '12–20 wks', names: ['GEA Group', 'Bühler Group', 'Tetra Pak', 'JBT Marel', 'Alfa Laval'] },
  timepieces: { base: 3, moq: '500 units', lead: '8–14 wks', names: ['Seiko', 'Citizen', 'Casio', 'Swatch Group', 'Titan Company'] },
  'emergency-equipment': { base: 3, moq: '200 units', lead: '8–14 wks', names: ['Rosenbauer', 'Oshkosh', 'MSA Safety', 'Dräger', 'Honeywell'] },
  'raw-materials': { base: 1, moq: 'lot / contract', lead: '4–12 wks', names: ['Korea Zinc', 'Teck', 'Dowa', 'Nyrstar', 'Umicore'] },
};

const RULES: [RegExp, string][] = [
  [/car|truck|bus|kart|scooter|motorcycle|moped|wheelchair|bike|airliner|helicopter|drone|uav|vehicle/, 'vehicle'],
  [/\bengine\b|diesel|powertrain|combustion|crankcase|crankshaft|camshaft|turbocharger|cylinder head|cylinder block|connecting rod|valvetrain|fuel injector/, 'engine'],
  [/batter|\bcell\b|pack\b|lipo|li-ion|bms/, 'battery'],
  [/motor|stator|rotor|alternator|generator|winding|servo|actuator/, 'motor'],
  [/bearing/, 'bearing'],
  [/igbt|mosfet|\bic\b|transistor|diode|transceiver|semiconduct|\bsoc\b|\bmcu\b/, 'semi'],
  [/board|pcb|inverter|\becu\b|controller|esc/, 'board'],
  [/magnet/, 'magnet'],
  [/gear|gearbox|transmission|differential|reduction|sprocket|pulley/, 'gear'],
  [/tire|tyre|wheel/, 'tire'],
  [/display|screen|lcd|cluster|infotainment|monitor|hmi|touch/, 'display'],
  [/camera|lens|sensor|radar|optic|imag/, 'camera'],
  [/wire|harness|cable|connector|busbar|antenna/, 'wire'],
  [/screw|bolt|\bnut\b|washer|fastener|rivet|stud|\bpin\b|lug/, 'fastener'],
  [/pump|valve|injector|compressor|hose|pipe|coolant|hydraulic/, 'fluid'],
  [/seat|cushion|saddle/, 'seat'],
  [/spring|damper|shock|suspension|strut|fork/, 'spring'],
  [/housing|enclosure|case|frame|chassis|body|cabinet|tray|panel|shell|bracket|subframe|casting|fuselage|wing|mast|structure|forging/, 'metal'],
];

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const unit = (s: string) => (hash(s) % 100000) / 100000;
const comma = (n: number) => n.toLocaleString('en-US');

function fmtPrice(p: number): string {
  if (p >= 1000) return '$' + comma(Math.round(p / 50) * 50);
  if (p >= 100) return '$' + Math.round(p);
  if (p >= 10) return '$' + p.toFixed(0);
  return '$' + p.toFixed(2);
}

export interface VendorQuote {
  name: string; cc: CC; flag: string; url: string; hq: string; type: string;
  price: string; moq: string; lead: string;
}

export function categoryFor(node: NodeData): string {
  const name = node.name.toLowerCase();
  for (const [re, k] of RULES) if (re.test(name)) return k;
  return 'generic';
}

export function vendorsFor(node: NodeData): VendorQuote[] {
  const parts = Math.max(1, totalParts(node.id));

  // Finished products: prefer a CURATED per-product list of the real companies
  // that actually make THAT product (any length, 2 is fine if only 2 are known;
  // no padding with vendors that don't make it). Fall back to the domain OEM set
  // only where no curated list exists yet.
  if (node.kind === 'product') {
    const base = DOMAIN_VENDORS[node.domain ?? ''];
    const curated = PRODUCT_VENDORS[node.id];
    const names = (curated ?? base?.names ?? []).filter((nm) => ALLDB[nm]);
    const moq = base?.moq ?? 'made to order';
    const lead = base?.lead ?? '·';
    const b = base?.base ?? 4;
    return names.map((nm) => {
      const info = ALLDB[nm];
      const m = 0.78 + 0.55 * unit(nm + node.id);
      const price = fmtPrice(b * parts * m);
      return { name: nm, ...info, flag: FLAG[info.cc], price, moq, lead };
    });
  }

  const set = SETS[categoryFor(node)];
  return set.names.map((nm) => {
    const info = ALLDB[nm];
    const m = 0.78 + 0.55 * unit(nm + node.id);
    const price = fmtPrice(set.base * parts * m);
    return { name: nm, ...info, flag: FLAG[info.cc], price, moq: set.moq, lead: set.lead };
  });
}

// Indicative price BAND per domain (and per component category for parts). Shown
// instead of a fabricated per-unit number: an order-of-magnitude range that's
// honest for "a typical product of this kind", not a precise claim.
const DOMAIN_BAND: Record<string, string> = {
  'aerospace-ground': '$30k–$1.5M', 'raw-materials': '$10–$5k per kg', 'rail-transport': '$500k–$10M', automobiles: '$8k–$90k', 'two-wheelers': '$300–$15k', aerospace: '$50k–$300M', marine: '$2k–$500M',
  'rail-transit': '$500k–$60M', 'space-systems': '$50k–$500M', 'defense-security': '$200–$100M',
  'construction-equipment': '$15k–$2M', 'agri-construction': '$5k–$800k', 'mining-equipment': '$200k–$5M',
  machinery: '$5k–$2M', 'machine-tools': '$10k–$1M', robotics: '$3k–$500k', 'material-handling': '$2k–$300k',
  energy: '$5k–$50M', 'renewable-energy': '$100–$20M', 'oil-gas': '$10k–$50M', 'fluid-handling': '$50–$50k',
  appliances: '$150–$3k', 'kitchen-appliances': '$20–$600', hvac: '$100–$20k', electronics: '$50–$2k',
  computing: '$20–$3k', networking: '$30–$50k', 'audio-video': '$50–$3k', 'imaging-optics': '$100–$8k',
  medical: '$500–$3M', 'lab-instruments': '$1k–$500k', 'dental-veterinary': '$200–$200k', tools: '$30–$800',
  'garden-power': '$80–$5k', lighting: '$3–$2k', 'building-products': '$50–$10k', plumbing: '$20–$3k',
  'personal-care': '$15–$500', floorcare: '$50–$1.5k', furniture: '$50–$3k', 'fitness-equipment': '$100–$10k',
  cycling: '$200–$12k', 'outdoor-gear': '$20–$2k', 'musical-instruments': '$50–$5k', 'toys-games': '$20–$3k',
  'office-equipment': '$50–$15k', 'vending-kiosks': '$1k–$30k', elevators: '$10k–$200k',
  'textile-machinery': '$10k–$1M', 'printing-packaging': '$10k–$3M', 'food-processing': '$1k–$500k',
  timepieces: '$20–$50k', 'emergency-equipment': '$30–$1M',
};
const CAT_BAND: Record<string, string> = {
  vehicle: '$300–$90k', engine: '$500–$50k', battery: '$1–$500', motor: '$2–$500', bearing: '$0.50–$80',
  semi: '$0.20–$50', board: '$1–$200', magnet: '$0.10–$20', gear: '$1–$300', tire: '$10–$400',
  display: '$3–$400', camera: '$1–$80', wire: '$0.10–$30', fastener: '$0.01–$2', fluid: '$5–$2k',
  seat: '$20–$800', spring: '$0.10–$20', metal: '$0.50–$200', generic: '$0.50–$100',
};

export function priceBand(node: NodeData): string {
  if (node.kind === 'product' && DOMAIN_BAND[node.domain ?? '']) return DOMAIN_BAND[node.domain as string];
  return CAT_BAND[categoryFor(node)] ?? CAT_BAND.generic;
}

// Register the classifier with the image resolver so category-fallback hero
// images (`cat:<category>` keys in images.json) resolve. Done here rather than
// in images.ts because images.ts importing vendors.ts would be a cycle.
import { setCategoryResolver } from './images.ts';
setCategoryResolver(categoryFor);
