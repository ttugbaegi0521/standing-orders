// The sandbox store's catalog. Prices here are authoritative: checkout never trusts a client price.

export interface StoreProduct {
  id: string;
  title: string;
  price_cents: number;
  /** Inline SVG data URI, so the store needs no image hosting. */
  image: string;
  description: string;
}

function svg(label: string, color: string): string {
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">` +
    `<rect width="320" height="200" rx="16" fill="${color}"/>` +
    `<text x="160" y="112" font-family="system-ui, sans-serif" font-size="28" font-weight="600" ` +
    `fill="#fff" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`;
}

export const STORE_PRODUCTS: StoreProduct[] = [
  {
    id: "sbx-mon-lumen27q",
    title: 'Lumen 27Q 27" IPS 1440p USB-C Monitor',
    price_cents: 24900,
    image: svg("Lumen 27Q", "#1d4ed8"),
    description: "27-inch IPS panel at 1440p with 65 W USB-C power delivery. Sharp text for long coding sessions.",
  },
  {
    id: "sbx-dock-portline",
    title: "Portline 9-in-1 USB-C Dock",
    price_cents: 12900,
    image: svg("Portline Dock", "#047857"),
    description: "Two HDMI, gigabit Ethernet, SD reader and 100 W pass-through charging on one cable.",
  },
  {
    id: "sbx-kb-quietkey",
    title: "QuietKey Low-Profile Mechanical Keyboard",
    price_cents: 8900,
    image: svg("QuietKey", "#7c3aed"),
    description: "Tenkeyless, quiet tactile switches, Bluetooth and USB-C. Pairs with three devices.",
  },
];

export function findStoreProduct(id: string): StoreProduct | undefined {
  return STORE_PRODUCTS.find((p) => p.id === id);
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
