import Stripe from "stripe";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

async function main() {
  const products = [
    { name: "DIY Starter", amount: 3700, key: "STRIPE_PRICE_T1_DIY_STARTER" },
    { name: "DIY Pro", amount: 6900, key: "STRIPE_PRICE_T2_DIY_PRO" },
    { name: "Done-For-You", amount: 9700, key: "STRIPE_PRICE_T3_DFY" },
  ];

  const results: Record<string, string> = {};

  for (const p of products) {
    const product = await stripe.products.create({ name: p.name });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: p.amount,
      currency: "usd",
    });
    results[p.key] = price.id;
    console.log(`${p.key}=${price.id}`);
  }

  // Append to .env.local
  const envPath = path.join(process.cwd(), ".env.local");
  const additions = Object.entries(results)
    .map(([k, v]) => `${k}="${v}"`)
    .join("\n");
  fs.appendFileSync(envPath, "\n# Billing overhaul tiers\n" + additions + "\n");
  console.log("Done. Price IDs saved to .env.local");
}

main().catch(console.error);
