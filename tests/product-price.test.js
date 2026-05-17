const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const productsHtml = fs.readFileSync(path.join(root, "public", "legacy", "products.html"), "utf8");
const productsSql = fs.readFileSync(path.join(root, "sql", "04_products.sql"), "utf8");
const migrationSql = fs.readFileSync(path.join(root, "sql", "10_fix_products_edit_delete.sql"), "utf8");

function parseProductPrice(value) {
  const text = String(value ?? "").trim();
  if (!text) return { ok: true, price: null };

  const price = Number(text);
  if (!Number.isFinite(price)) {
    return { ok: false, message: "กรุณากรอกราคาเป็นตัวเลข" };
  }

  if (price < 0) {
    return { ok: false, message: "ราคาต้องไม่ติดลบ" };
  }

  return { ok: true, price: Math.round(price * 100) / 100 };
}

function buildProductPayload({ productCode, barcode = "", productName, categoryId = null, unit = "", priceValue = "", description = "" }) {
  const priceResult = parseProductPrice(priceValue);
  if (!priceResult.ok) throw new Error(priceResult.message);

  const cleanProductCode = productCode.trim();
  const cleanBarcode = barcode.trim() || cleanProductCode;

  return {
    product_code: cleanProductCode,
    barcode: cleanBarcode,
    product_name: productName.trim(),
    category_id: categoryId,
    unit: unit.trim() || null,
    price: priceResult.price,
    description: description.trim() || null
  };
}

assert.deepStrictEqual(parseProductPrice("19.99"), { ok: true, price: 19.99 });
assert.deepStrictEqual(parseProductPrice("0"), { ok: true, price: 0 });
assert.deepStrictEqual(parseProductPrice(""), { ok: true, price: null });
assert.strictEqual(parseProductPrice("-1").ok, false);
assert.strictEqual(parseProductPrice("abc").ok, false);

const payload = buildProductPayload({
  productCode: "SKU-PRICE-1",
  barcode: "8850000000011",
  productName: "Price Test Product",
  unit: "box",
  priceValue: "19.99",
  description: "with price"
});

assert.strictEqual(payload.price, 19.99);
assert.strictEqual(payload.product_code, "SKU-PRICE-1");
assert.strictEqual(payload.barcode, "8850000000011");

const fallbackPayload = buildProductPayload({
  productCode: "SKU-FALLBACK-1",
  productName: "Fallback Barcode Product"
});
assert.strictEqual(fallbackPayload.barcode, "SKU-FALLBACK-1");

assert.match(productsHtml, /id="price"/, "product form should include a price input");
assert.match(productsHtml, /id="barcode"/, "product form should include a separate barcode input");
assert.match(productsHtml, /parseProductPrice\(\$\("price"\)\.value\)/, "submit handler should validate price");
assert.match(productsHtml, /price:\s*priceResult\.price/, "payload should include price");
assert.match(productsHtml, /const barcode = \$\("barcode"\)\.value\.trim\(\) \|\| productCode/, "submit handler should read barcode separately");
assert.match(productsHtml, /product_code:\s*productCode,\s*barcode,/s, "payload should save barcode separately");
assert.match(productsHtml, /select\("id, product_code, barcode, product_name, category_id, unit, price, description"\)/, "insert/update should return barcode and price");
assert.match(productsHtml, /formatCurrency\(item\.price\)/, "product table should display formatted price");

assert.match(productsSql, /price numeric\(12,\s*2\) null/, "products schema should define numeric price");
assert.match(productsSql, /products_price_nonnegative check \(price is null or price >= 0\)/, "products schema should prevent negative price");
assert.match(migrationSql, /add column if not exists price numeric\(12,\s*2\)/, "migration should add price column");
assert.match(migrationSql, /products_price_nonnegative/, "migration should add price check");

console.log("product price tests passed");
