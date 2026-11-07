// Connectivity check: one live Channel3 search, prints the first five results.
// Usage: npm run channel3:smoke   (needs CHANNEL3_API_KEY)
import { searchProducts } from "@/lib/channel3";

async function main() {
  const results = await searchProducts({ query: "27 inch 4k monitor", max_results: 5 });
  console.log(`Channel3 returned ${results.length} product(s) for "27 inch 4k monitor"`);
  for (const p of results.slice(0, 5)) {
    console.log(`- ${p.title}\n    ${p.merchant}  $${(p.price_cents / 100).toFixed(2)} ${p.currency}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
