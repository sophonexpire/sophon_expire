import { formatShortDate } from "@/lib/format";

export const NEAR_EXPIRY_WARNING_DAYS = 60;

export function calculateDaysLeft(expiryDate) {
  if (!expiryDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const exp = new Date(expiryDate);
  if (Number.isNaN(exp.getTime())) return null;
  exp.setHours(0, 0, 0, 0);

  return Math.floor((exp - today) / (1000 * 60 * 60 * 24));
}

export function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

export function normalizeDamageStatus(status) {
  const value = normalizeStatus(status);
  if (value === "contacted" || value === "แจ้ง supplier แล้ว".toLowerCase()) return "contacted";
  if (value === "returned" || value === "ส่งคืน supplier แล้ว".toLowerCase()) return "returned";
  if (value === "disposed" || value === "ทิ้งแล้ว".toLowerCase()) return "disposed";
  return "pending";
}

export function getFinalHandlingStatus(item) {
  const handlingStatus = normalizeStatus(item.handling_status);
  const status = normalizeStatus(item.status);

  if (["returned", "return", "returned_to_supplier", "return_to_supplier", "sent_back"].includes(handlingStatus)) {
    return "returned";
  }

  if (["disposed", "destroyed"].includes(handlingStatus)) return "disposed";
  if (["returned", "return", "returned_to_supplier", "return_to_supplier", "sent_back"].includes(status)) return "returned";
  if (["disposed", "destroyed"].includes(status)) return "disposed";

  return "";
}

export function getCalculatedStatus(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return "safe";
  if (daysLeft < 0) return "expired";
  if (daysLeft <= NEAR_EXPIRY_WARNING_DAYS) return "warning";
  return "safe";
}

export function toDateKey(dateValue) {
  if (!dateValue) return "";
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function parseSalesQty(value) {
  if (value === null || value === undefined || value === "") return 0;
  const num = Number(String(value).replace(/,/g, "").trim());
  return Number.isNaN(num) ? 0 : num;
}

export function buildUrgentProductGroups(items) {
  const grouped = new Map();

  items.forEach((item) => {
    const key = `${item.product_id || ""}|${item.product_display_name || ""}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        productName: item.product_display_name || "ไม่ระบุสินค้า",
        urgentLots: 0,
        urgentQty: 0,
        earliestDaysLeft: Number.POSITIVE_INFINITY
      });
    }

    const current = grouped.get(key);
    current.urgentLots += 1;
    current.urgentQty += Number(item.quantity_num || 0);
    current.earliestDaysLeft = Math.min(current.earliestDaysLeft, Number.isFinite(item.daysLeft) ? item.daysLeft : Number.POSITIVE_INFINITY);
  });

  return Array.from(grouped.values()).sort((a, b) => {
    if (a.earliestDaysLeft !== b.earliestDaysLeft) return a.earliestDaysLeft - b.earliestDaysLeft;
    if (b.urgentLots !== a.urgentLots) return b.urgentLots - a.urgentLots;
    return b.urgentQty - a.urgentQty;
  });
}

export function buildIssueRanking(urgentItems, damageItems) {
  const grouped = new Map();

  urgentItems.forEach((item) => {
    const key = `${item.product_id || ""}|${item.product_display_name || ""}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        productName: item.product_display_name || "ไม่ระบุสินค้า",
        score: 0,
        urgentLots: 0,
        damageLots: 0,
        earliestDaysLeft: Number.POSITIVE_INFINITY
      });
    }

    const row = grouped.get(key);
    row.urgentLots += 1;
    row.score += item.displayStatus === "expired" ? 3 : 2;
    row.earliestDaysLeft = Math.min(row.earliestDaysLeft, Number.isFinite(item.daysLeft) ? item.daysLeft : Number.POSITIVE_INFINITY);
  });

  damageItems.forEach((item) => {
    const key = `${item.product_id || ""}|${item.product_display_name || ""}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        productName: item.product_display_name || "ไม่ระบุสินค้า",
        score: 0,
        urgentLots: 0,
        damageLots: 0,
        earliestDaysLeft: Number.POSITIVE_INFINITY
      });
    }

    const row = grouped.get(key);
    row.damageLots += 1;
    row.score += 2;
  });

  return Array.from(grouped.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.earliestDaysLeft !== b.earliestDaysLeft) return a.earliestDaysLeft - b.earliestDaysLeft;
    return b.damageLots - a.damageLots;
  });
}

export function buildExpiryTrend(urgentItems) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const keys = [];
  const expiredMap = new Map();
  const warningMap = new Map();

  for (let offset = -7; offset <= NEAR_EXPIRY_WARNING_DAYS; offset += 1) {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    const key = toDateKey(d);
    keys.push(key);
    expiredMap.set(key, 0);
    warningMap.set(key, 0);
  }

  urgentItems.forEach((item) => {
    const key = toDateKey(item.expiry_date);
    if (!expiredMap.has(key)) return;
    if (item.displayStatus === "expired") expiredMap.set(key, (expiredMap.get(key) || 0) + 1);
    else warningMap.set(key, (warningMap.get(key) || 0) + 1);
  });

  return {
    labels: keys.map(formatShortDate),
    expiredData: keys.map((key) => expiredMap.get(key) || 0),
    warningData: keys.map((key) => warningMap.get(key) || 0)
  };
}

export function buildSalesTrendData(salesUploads, salesLines) {
  const uploadsById = new Map((salesUploads || []).map((item) => [Number(item.id), item]));
  const grouped = new Map();

  (salesLines || []).forEach((line) => {
    const upload = uploadsById.get(Number(line.sales_upload_id));
    if (!upload) return;
    const key = toDateKey(upload.sales_date || upload.uploaded_at || line.created_at);
    if (!key) return;
    grouped.set(key, (grouped.get(key) || 0) + parseSalesQty(line.sold_qty));
  });

  const labels = Array.from(grouped.keys()).sort();
  return {
    labels: labels.map(formatShortDate),
    values: labels.map((key) => grouped.get(key) || 0)
  };
}

export function buildTopSalesProducts(products, salesUploads, salesLines) {
  const uploadsById = new Map((salesUploads || []).map((item) => [Number(item.id), item]));
  const productMeta = new Map((products || []).map((item) => [
    Number(item.id),
    {
      product_name: item.product_name || "ไม่ระบุสินค้า",
      product_code: item.product_code || item.barcode || "-"
    }
  ]));

  const grouped = new Map();

  (salesLines || []).forEach((line) => {
    const upload = uploadsById.get(Number(line.sales_upload_id));
    if (!upload) return;
    const productId = Number(line.product_id || 0);
    const key = productId || `${line.product_barcode || ""}|${line.product_name || ""}`;
    if (!grouped.has(key)) {
      const meta = productMeta.get(productId);
      grouped.set(key, {
        name: meta?.product_name || line.product_name || "ไม่ระบุสินค้า",
        code: meta?.product_code || line.product_barcode || "-",
        qty: 0
      });
    }

    grouped.get(key).qty += parseSalesQty(line.sold_qty);
  });

  return Array.from(grouped.values())
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 8);
}

export function buildSalesMetrics(products, batches, salesUploads, salesLines) {
  const uploadsById = new Map((salesUploads || []).map((item) => [Number(item.id), item]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const productMetaMap = new Map((products || []).map((item) => [
    Number(item.id),
    {
      product_id: Number(item.id),
      product_code: item.product_code || item.barcode || "-",
      product_name: item.product_name || "ไม่ระบุสินค้า",
      product_unit: item.unit || "-"
    }
  ]));

  const stockMap = new Map();
  (batches || []).forEach((batch) => {
    const productId = Number(batch.product_id || 0);
    if (!stockMap.has(productId)) {
      stockMap.set(productId, {
        currentStock: 0,
        product_id: productId,
        product_code: batch.products?.product_code || batch.products?.barcode || "-",
        product_name: batch.product_display_name || batch.products?.product_name || "ไม่ระบุสินค้า",
        product_unit: batch.products?.unit || "-"
      });
    }
    stockMap.get(productId).currentStock += Number(batch.quantity_num ?? batch.quantity_remaining ?? 0);
  });

  const salesMap = new Map();
  (salesLines || []).forEach((line) => {
    const upload = uploadsById.get(Number(line.sales_upload_id));
    if (!upload) return;
    const salesDate = upload.sales_date || upload.uploaded_at || line.created_at;
    const dateKey = toDateKey(salesDate);
    if (!dateKey) return;

    const productId = Number(line.product_id || 0);
    const fallbackKey = String(line.product_barcode || line.product_name || "").trim().toLowerCase();
    const mapKey = productId ? `id:${productId}` : `fallback:${fallbackKey}`;
    if (!salesMap.has(mapKey)) {
      const meta = productId ? productMetaMap.get(productId) : null;
      salesMap.set(mapKey, {
        product_id: productId || null,
        product_code: meta?.product_code || line.product_barcode || "-",
        product_name: meta?.product_name || line.product_name || "ไม่ระบุสินค้า",
        product_unit: meta?.product_unit || "-",
        sales14: 0,
        sales30: 0,
        soldDates: new Set()
      });
    }

    const target = salesMap.get(mapKey);
    const qty = parseSalesQty(line.sold_qty);
    const saleDate = new Date(dateKey);
    const diffDays = Math.floor((today - saleDate) / (1000 * 60 * 60 * 24));

    if (diffDays <= 14) target.sales14 += qty;
    if (diffDays <= 30) target.sales30 += qty;
    if (diffDays <= 30) target.soldDates.add(dateKey);
  });

  return Array.from(salesMap.values()).map((item) => {
    const currentStock = Number(stockMap.get(Number(item.product_id))?.currentStock || 0);
    return {
      ...item,
      currentStock,
      recentSalesAmount: item.sales14,
      avgDailySales: item.sales30 / 30,
      hasEnoughHistory: item.soldDates.size >= 3
    };
  });
}

export function buildReorderRows(products, batches, salesUploads, salesLines, coverageDays = 14) {
  return buildSalesMetrics(products, batches, salesUploads, salesLines)
    .filter((item) => Number(item.currentStock || 0) <= 0 && (item.sales30 > 0 || item.sales14 > 0))
    .map((item) => {
      const recommendedQty = Math.ceil(Number(item.avgDailySales || 0) * coverageDays);
      let badgeClass = "watch";
      let badgeText = "รอติดตาม";

      if (!item.hasEnoughHistory) {
        badgeClass = "estimated";
        badgeText = "ข้อมูลน้อย";
      } else if (recommendedQty >= 10 || item.recentSalesAmount >= 10) {
        badgeClass = "critical";
        badgeText = "ต้องสั่งด่วน";
      } else if (recommendedQty > 0) {
        badgeClass = "warning";
        badgeText = "ควรสั่งซื้อ";
      }

      return {
        ...item,
        recommendedQty,
        badgeClass,
        badgeText
      };
    })
    .sort((a, b) => b.recommendedQty - a.recommendedQty);
}
