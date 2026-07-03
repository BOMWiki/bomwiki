// Icons for BOM graph nodes. We don't have a drawing per node, so we infer a
// glyph from keywords in the node name (a "motor" looks like a motor, a
// "battery" like a battery), falling back to a per-kind glyph. Inline SVG,
// 96×96, grayscale line-art — same visual language as the parts catalog.


const LINE = '#5f6772';
const M1 = '#edf0f3';
const M2 = '#d2d8df';
const M3 = '#b4bcc6';
const HOLE = '#f7f8fa';
const ACC = '#cfe0fb';
const S = `fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"`;

const G: Record<string, () => string> = {
  battery: () => `<rect x="22" y="30" width="48" height="36" rx="5" fill="${M1}" ${S}/><rect x="70" y="40" width="6" height="16" rx="2" fill="${M2}" ${S}/><path d="M44 38 l-8 14 h10 l-8 14" ${S} stroke="${LINE}"/>`,
  motor: () => `<rect x="24" y="34" width="40" height="28" rx="4" fill="${M1}" ${S}/><rect x="64" y="44" width="14" height="8" fill="${M2}" ${S}/><path d="M28 34 V62 M34 34 V62 M40 34 V62 M46 34 V62 M52 34 V62" stroke="${M3}" stroke-width="1"/><circle cx="20" cy="48" r="4" fill="${M2}" ${S}/>`,
  chip: () => `<rect x="28" y="28" width="40" height="40" rx="4" fill="${M1}" ${S}/><rect x="38" y="38" width="20" height="20" rx="2" fill="${M2}" ${S}/><path d="M28 36h-7 M28 48h-7 M28 60h-7 M75 36h-7 M75 48h-7 M75 60h-7 M36 28v-7 M48 28v-7 M60 28v-7 M36 75v-7 M48 75v-7 M60 75v-7" ${S} stroke-width="1.4"/>`,
  bearing: () => `<circle cx="48" cy="48" r="28" fill="${M2}" ${S}/><circle cx="48" cy="48" r="24" fill="${M1}" stroke="${M3}" stroke-width="1"/>${[0,60,120,180,240,300].map(a=>`<circle cx="${(48+18*Math.cos(a*Math.PI/180)).toFixed(1)}" cy="${(48+18*Math.sin(a*Math.PI/180)).toFixed(1)}" r="4" fill="${M1}" ${S} stroke-width="1.2"/>`).join('')}<circle cx="48" cy="48" r="11" fill="${HOLE}" ${S}/>`,
  wheel: () => `<circle cx="48" cy="48" r="30" fill="${M2}" ${S}/><circle cx="48" cy="48" r="20" fill="${M1}" ${S}/><circle cx="48" cy="48" r="6" fill="${M3}" ${S}/>${[0,72,144,216,288].map(a=>`<line x1="48" y1="48" x2="${(48+18*Math.cos(a*Math.PI/180)).toFixed(1)}" y2="${(48+18*Math.sin(a*Math.PI/180)).toFixed(1)}" stroke="${M3}" stroke-width="2"/>`).join('')}`,
  gear: () => `${Array.from({length:12},(_,i)=>{const a=i*30*Math.PI/180,x=48+30*Math.cos(a),y=48+30*Math.sin(a);return `<rect x="${(x-3).toFixed(1)}" y="${(y-3).toFixed(1)}" width="6" height="6" fill="${M2}" stroke="${LINE}" stroke-width="1" transform="rotate(${(i*30).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`}).join('')}<circle cx="48" cy="48" r="22" fill="${M1}" ${S}/><circle cx="48" cy="48" r="9" fill="${HOLE}" ${S}/>`,
  fastener: () => `<polygon points="48,20 62,28 62,44 48,52 34,44 34,28" fill="${M2}" ${S}/><rect x="42" y="50" width="12" height="28" fill="${M1}" ${S}/><path d="M42 56 l12 2 M42 62 l12 2 M42 68 l12 2" stroke="${M3}" stroke-width="1"/>`,
  cable: () => `<path d="M20 64 q14 -34 28 0 t28 0" ${S} stroke-width="2.4"/><rect x="14" y="60" width="10" height="10" rx="2" fill="${M2}" ${S}/><rect x="72" y="60" width="10" height="10" rx="2" fill="${M2}" ${S}/>`,
  pump: () => `<circle cx="44" cy="50" r="22" fill="${M1}" ${S}/><circle cx="44" cy="50" r="8" fill="${M2}" ${S}/><rect x="40" y="20" width="20" height="12" rx="2" fill="${M2}" ${S}/><rect x="62" y="44" width="14" height="12" fill="${M2}" ${S}/>`,
  valve: () => `<rect x="18" y="44" width="60" height="12" rx="3" fill="${M1}" ${S}/><circle cx="48" cy="50" r="12" fill="${M2}" ${S}/><circle cx="48" cy="50" r="4" fill="${HOLE}" ${S}/><rect x="45" y="20" width="6" height="22" fill="${M3}" ${S}/><rect x="36" y="16" width="24" height="7" rx="3" fill="${M2}" ${S}/>`,
  box: () => `<path d="M24 36 L48 24 L72 36 L48 48 Z" fill="${M1}" ${S}/><path d="M24 36 V60 L48 72 V48 Z" fill="${M2}" ${S}/><path d="M72 36 V60 L48 72 V48 Z" fill="${M3}" ${S}/>`,
  seat: () => `<path d="M34 30 q-4 0 -4 6 v22 h6 V40 h22 q4 0 4 -4 v-2 q0 -4 -4 -4 z" fill="${M2}" ${S}/><rect x="30" y="58" width="34" height="8" rx="3" fill="${M1}" ${S}/><rect x="58" y="62" width="6" height="14" fill="${M3}" ${S}/>`,
  camera: () => `<rect x="22" y="32" width="52" height="34" rx="5" fill="${M1}" ${S}/><circle cx="48" cy="49" r="11" fill="${M2}" ${S}/><circle cx="48" cy="49" r="5" fill="${HOLE}" ${S}/><rect x="30" y="26" width="14" height="8" rx="2" fill="${M2}" ${S}/>`,
  spring: () => `${[20,30,40,50,60,70].map(y=>`<ellipse cx="48" cy="${y}" rx="16" ry="5" ${S}/>`).join('')}`,
  engine: () => `<rect x="26" y="40" width="44" height="30" rx="3" fill="${M1}" ${S}/><rect x="32" y="24" width="8" height="16" fill="${M2}" ${S}/><rect x="44" y="24" width="8" height="16" fill="${M2}" ${S}/><rect x="56" y="24" width="8" height="16" fill="${M2}" ${S}/><path d="M26 58 h44" stroke="${M3}" stroke-width="1"/>`,
  screen: () => `<rect x="20" y="26" width="56" height="38" rx="4" fill="${M1}" ${S}/><rect x="26" y="32" width="44" height="26" rx="2" fill="${ACC}" stroke="${M3}" stroke-width="1"/><rect x="38" y="64" width="20" height="6" fill="${M2}" ${S}/>`,
  light: () => `<circle cx="48" cy="42" r="18" fill="${ACC}" ${S}/><rect x="40" y="58" width="16" height="10" rx="2" fill="${M2}" ${S}/><path d="M48 24 v-6 M30 42 h-6 M66 42 h6 M35 29 l-4 -4 M61 29 l4 -4" ${S} stroke-width="1.4"/>`,
  tank: () => `<ellipse cx="48" cy="26" rx="16" ry="5" fill="${M2}" ${S}/><path d="M32 26 V70 a16 5 0 0 0 32 0 V26" fill="${M1}" ${S}/><line x1="40" y1="30" x2="40" y2="66" stroke="${HOLE}" stroke-width="3"/>`,
  prop: () => `<circle cx="48" cy="48" r="5" fill="${M3}" ${S}/>${[0,120,240].map(a=>`<ellipse cx="${(48+22*Math.cos(a*Math.PI/180)).toFixed(1)}" cy="${(48+22*Math.sin(a*Math.PI/180)).toFixed(1)}" rx="6" ry="20" fill="${M1}" ${S} transform="rotate(${a} ${(48+22*Math.cos(a*Math.PI/180)).toFixed(1)} ${(48+22*Math.sin(a*Math.PI/180)).toFixed(1)})"/>`).join('')}`,
  disc: () => `<circle cx="48" cy="48" r="28" fill="${M1}" ${S}/><circle cx="48" cy="48" r="12" fill="${HOLE}" ${S}/>${[0,45,90,135,180,225,270,315].map(a=>`<circle cx="${(48+20*Math.cos(a*Math.PI/180)).toFixed(1)}" cy="${(48+20*Math.sin(a*Math.PI/180)).toFixed(1)}" r="2.2" fill="${M3}"/>`).join('')}`,
  panel: () => `<rect x="26" y="22" width="44" height="52" rx="3" fill="${M1}" ${S}/><rect x="32" y="28" width="32" height="22" rx="2" fill="${ACC}" stroke="${M3}" stroke-width="1"/>`,
  hose: () => `<path d="M26 28 q40 8 0 30 q-40 14 44 10" ${S} stroke-width="4"/>`,
  vehicle: () => `<path d="M18 56 q4 -16 14 -16 h8 l8 -10 h16 q8 0 12 12 l8 2 q6 2 6 8 v2 H18 z" fill="${M1}" ${S}/><circle cx="34" cy="60" r="7" fill="${M2}" ${S}/><circle cx="68" cy="60" r="7" fill="${M2}" ${S}/>`,
  machine: () => `<rect x="24" y="34" width="40" height="32" rx="3" fill="${M1}" ${S}/><path d="M34 34 v-8 h20 v8" fill="${M2}" ${S}/><rect x="64" y="46" width="14" height="10" fill="${M2}" ${S}/><rect x="28" y="66" width="6" height="10" fill="${M3}" ${S}/><rect x="54" y="66" width="6" height="10" fill="${M3}" ${S}/><rect x="29" y="40" width="13" height="9" rx="1.5" fill="${ACC}" stroke="${M3}" stroke-width="1"/><circle cx="52" cy="54" r="6" fill="${M2}" ${S}/>`,
};

const RULES: [RegExp, string][] = [
  [/vehicle|car|truck|bus|kart|scooter|motorcycle|moped|wheelchair|bike|airliner|helicopter|drone|uav/, 'vehicle'],
  [/batter|\bcell\b|lipo|li-ion/, 'battery'],
  [/motor|stator|rotor|alternator|generator|spindle|servo|actuator|winding/, 'motor'],
  [/board|pcb|bms|ecu|controller|inverter|computer|esc|fadec|avionic|electronic|driver|sensor board/, 'chip'],
  [/bearing/, 'bearing'],
  [/brake|caliper|\bdisc\b|rotor\b/, 'disc'],
  [/wheel|tire|tyre|caster/, 'wheel'],
  [/gear|gearbox|transmission|differential|reduction|sprocket|pulley|cvt/, 'gear'],
  [/screw|bolt|\bnut\b|washer|fastener|rivet|stud|\bpin\b|lug/, 'fastener'],
  [/wire|harness|cable|connector|busbar|antenna/, 'cable'],
  [/pump|compressor|impeller/, 'pump'],
  [/valve|injector|throttle|carburet/, 'valve'],
  [/spring|damper|shock|suspension|strut|fork/, 'spring'],
  [/engine|cylinder|piston|crank|\bcam|combust|turbine|turbo/, 'engine'],
  [/display|screen|lcd|cluster|infotainment|monitor|hmi|touch/, 'screen'],
  [/light|lamp|headlight|taillight|\bled\b|bulb|beacon|siren/, 'light'],
  [/tank|reservoir|bottle|cylinder|canister|accumulator/, 'tank'],
  [/propeller|\bprop\b|\bblade|\bfan\b|\brotor blade|airscrew/, 'prop'],
  [/camera|lens|optic|radar|imag|telescope|scanner/, 'camera'],
  [/seat|cushion|saddle/, 'seat'],
  [/door|window|glass|mirror|windshield|windscreen/, 'panel'],
  [/hose|\bpipe|tube|duct|manifold|exhaust|muffler|coolant/, 'hose'],
  [/housing|enclosure|\bcase\b|frame|chassis|body|cabinet|tray|panel|shell|bracket|deck|structure|fuselage|wing|mast|boom|base|cabin/, 'box'],
];

export function nodeIcon(node: { name: string; kind: string }): string {
  const name = node.name.toLowerCase();
  for (const [re, key] of RULES) if (re.test(name)) return G[key]();
  // Fallbacks by kind. Most unmatched products are machines of some sort;
  // a generic machine reads as "no drawing yet", a car reads as a mistake.
  if (node.kind === 'product') return G.machine();
  if (node.kind === 'assembly') return G.box();
  return G.fastener();
}
