// The ~50 product domains shown in the left rail and on domain hub pages.
// The list below is the seed; if reviewers have curated domains via
// /admin/domains, initDomains() replaces it at boot (and setDomains() applies
// edits live). Renames only affect display — nodes reference domain slugs.
export interface Domain {
  slug: string;
  name: string;
}

export function initDomains(curated: Domain[] | null): void {
  if (curated?.length) setDomains(curated);
}

export function setDomains(next: Domain[]): void {
  DOMAINS.length = 0;
  DOMAINS.push(...next);
}

export const DOMAINS: { slug: string; name: string }[] = [
  { slug: 'automobiles', name: 'Automobiles' },
  { slug: 'two-wheelers', name: 'Two-Wheelers & Mobility' },
  { slug: 'aerospace', name: 'Aerospace & Drones' },
  { slug: 'marine', name: 'Marine' },
  { slug: 'machinery', name: 'Machinery & Industrial' },
  { slug: 'robotics', name: 'Robotics & Automation' },
  { slug: 'energy', name: 'Power & Energy' },
  { slug: 'appliances', name: 'Home Appliances' },
  { slug: 'electronics', name: 'Consumer Electronics' },
  { slug: 'tools', name: 'Power & Hand Tools' },
  { slug: 'hvac', name: 'HVAC & Plumbing' },
  { slug: 'medical', name: 'Medical Devices' },
  { slug: 'agri-construction', name: 'Agriculture & Construction' },
  { slug: 'material-handling', name: 'Material Handling' },
  { slug: 'furniture', name: 'Furniture & Durables' },
  { slug: 'rail-transit', name: 'Rail & Transit' },
  { slug: 'space-systems', name: 'Space Systems' },
  { slug: 'defense-security', name: 'Defense & Security' },
  { slug: 'construction-equipment', name: 'Construction & Earthmoving' },
  { slug: 'mining-equipment', name: 'Mining & Quarrying' },
  { slug: 'machine-tools', name: 'Machine Tools & Metalworking' },
  { slug: 'renewable-energy', name: 'Renewable Energy' },
  { slug: 'oil-gas', name: 'Oil, Gas & Process' },
  { slug: 'fluid-handling', name: 'Pumps, Valves & Fluid' },
  { slug: 'building-products', name: 'Building & Construction Products' },
  { slug: 'plumbing', name: 'Plumbing & Sanitary' },
  { slug: 'lighting', name: 'Lighting & Electrical' },
  { slug: 'kitchen-appliances', name: 'Small Kitchen Appliances' },
  { slug: 'personal-care', name: 'Personal Care & Grooming' },
  { slug: 'floorcare', name: 'Cleaning & Floorcare' },
  { slug: 'computing', name: 'Computing & Peripherals' },
  { slug: 'networking', name: 'Networking & Telecom' },
  { slug: 'audio-video', name: 'Audio & Video' },
  { slug: 'imaging-optics', name: 'Imaging & Optics' },
  { slug: 'lab-instruments', name: 'Lab & Scientific Instruments' },
  { slug: 'dental-veterinary', name: 'Dental & Veterinary' },
  { slug: 'garden-power', name: 'Garden & Outdoor Power' },
  { slug: 'fitness-equipment', name: 'Sports & Fitness' },
  { slug: 'cycling', name: 'Bicycles & Cycling' },
  { slug: 'outdoor-gear', name: 'Outdoor & Camping Gear' },
  { slug: 'musical-instruments', name: 'Musical Instruments' },
  { slug: 'toys-games', name: 'Toys, Games & Hobby' },
  { slug: 'office-equipment', name: 'Office & Retail Equipment' },
  { slug: 'vending-kiosks', name: 'Vending, Kiosks & ATMs' },
  { slug: 'elevators', name: 'Elevators & Escalators' },
  { slug: 'textile-machinery', name: 'Textiles & Apparel Machinery' },
  { slug: 'printing-packaging', name: 'Printing & Packaging Machinery' },
  { slug: 'food-processing', name: 'Food & Beverage Processing' },
  { slug: 'timepieces', name: 'Watches & Timepieces' },
  { slug: 'emergency-equipment', name: 'Firefighting & Emergency' },
  { slug: 'raw-materials', name: 'Raw Materials & Commodities' },
];
