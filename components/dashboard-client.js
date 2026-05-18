"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip
} from "chart.js";
import { formatDate, formatQtyCompact } from "@/lib/format";
import { getStoredUser, clearUserSession } from "@/lib/session";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  buildExpiryTrend,
  buildIssueRanking,
  buildReorderRows,
  buildSalesMetrics,
  buildSalesTrendData,
  buildTopSalesProducts,
  buildUrgentProductGroups,
  calculateDaysLeft,
  getCalculatedStatus,
  getFinalHandlingStatus,
  NEAR_EXPIRY_WARNING_DAYS,
  normalizeDamageStatus,
  parseSalesQty
} from "@/lib/dashboard-utils";

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip
);

const navItems = [
  { href: "/dashboard", label: "แดชบอร์ด" },
  { href: "/suppliers", label: "ผู้จำหน่าย" },
  { href: "/products", label: "สินค้า" },
  { href: "/stock-in", label: "Stock In" },
  { href: "/stock-out", label: "Stock Out" },
  { href: "/expire-returns", label: "ของหมดอายุ / ชำรุด" },
  { href: "/expired-history", label: "ประวัติคืน / ตัดออก" },
  { href: "/damaged-manage", label: "แจ้งสินค้าชำรุด" }
];

const initialState = {
  loading: true,
  error: "",
  user: null,
  coverageDays: 14,
  stats: {
    totalStockQty: 0,
    totalBatches: 0,
    urgentCount: 0,
    expiredCount: 0,
    damagedCount: 0,
    focusUrgentTotal: 0,
    focusDamageTotal: 0,
    focusHandledTotal: 0,
    alertExpiredCount: 0,
    alertWarningCount: 0,
    alertReorderCount: 0,
    sales14Value: 0,
    salesAvgDailyValue: 0,
    salesDocsValue: 0,
    totalStockValue: 0,
    warningStockValue: 0,
    expiredStockValue: 0,
    handledStockValue: 0,
    damageStockValue: 0,
    stockSystemQty: 0,
    soldSystemQty: 0,
    damageSystemQty: 0,
    stockInMonthQty: 0,
    soldMonthQty: 0,
    damageMonthQty: 0,
    lastUpdatedTime: "",
    safeCount: 0
  },
  urgentItems: [],
  damageItems: [],
  urgentProductGroups: [],
  issueRanking: [],
  reorderRows: [],
  expiryTrend: { labels: [], expiredData: [], warningData: [] },
  salesTrend: { labels: [], values: [] },
  topSalesProducts: [],
  fefoBuckets: { expired: 0, next60: 0, over60: 0 }
};

function chipForUrgent(item) {
  if (item.displayStatus === "expired") {
    return { className: "chip expired", text: `หมดอายุแล้ว ${Math.abs(item.daysLeft || 0)} วัน` };
  }

  return { className: "chip warning", text: `เหลือ ${item.daysLeft ?? 0} วัน` };
}

function chipForDamage(status) {
  if (status === "contacted") return { className: "chip contacted", text: "แจ้ง supplier แล้ว" };
  if (status === "returned") return { className: "chip returned", text: "คืนแล้ว" };
  if (status === "disposed") return { className: "chip disposed", text: "ทำลายแล้ว" };
  return { className: "chip pending", text: "รอตรวจสอบ" };
}

function applyCoverage(rows, coverageDays) {
  return rows.map((item) => {
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

    return { ...item, recommendedQty, badgeClass, badgeText };
  });
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/images/logo.png" alt="Sophon" />
      </div>
      <div className="sidebar-title">เมนู</div>
      {navItems.map((item) => (
        <a key={item.label} href={item.href} className={`sidebar-link${item.href === "/dashboard" ? " active" : ""}`}>
          {item.label}
        </a>
      ))}
    </aside>
  );
}

function formatCurrencyCompact(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "฿0";

  if (Math.abs(num) >= 1000000) {
    return `฿${new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 }).format(num / 1000000)} ล้าน`;
  }

  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 0
  }).format(num);
}

function getBatchPrice(item) {
  return Number(item?.products?.price || item?.product_price || 0);
}

function getBatchValue(item, qty = item?.quantity_num) {
  return Number(qty || 0) * getBatchPrice(item);
}

function StatCard({ tone, label, value, valueLine, badge, help, valueClassName }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-card-head">
        <span className="stat-icon" aria-hidden="true" />
        <div className="stat-label">{label}</div>
      </div>
      <div className={`stat-value ${valueClassName}`}>{value}</div>
      {valueLine ? <div className="stat-money">มูลค่ารวม {valueLine}</div> : null}
      {badge ? <div className="stat-badge"><span aria-hidden="true" />{badge}</div> : null}
      <div className="stat-help">{help}</div>
      <div className="stat-spark" aria-hidden="true" />
    </div>
  );
}

function FlowMetric({ tone, label, value, help }) {
  return (
    <div className={`flow-metric ${tone}`}>
      <span className="flow-dot" aria-hidden="true" />
      <div>
        <div className="flow-label">{label}</div>
        <div className="flow-value">{value}</div>
        <div className="flow-help">{help}</div>
      </div>
    </div>
  );
}

function getCurrentMonthRange() {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  return { start, end };
}

function isInDateRange(value, start, end) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date >= start && date < end;
}

export default function DashboardClient() {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const expiryRef = useRef(null);
  const statusRef = useRef(null);
  const fefoRef = useRef(null);
  const salesTrendRef = useRef(null);
  const topSalesRef = useRef(null);
  const issueRef = useRef(null);
  const chartsRef = useRef({});

  useEffect(() => {
    const user = getStoredUser();
    if (!user) {
      router.replace("/login");
      return;
    }

    setState((current) => ({ ...current, user }));
    void loadDashboard(user, 14);

    return () => {
      Object.values(chartsRef.current).forEach((chart) => chart?.destroy());
      chartsRef.current = {};
    };
  }, [router]);

  useEffect(() => {
    if (!state.expiryTrend.labels.length) return;

    renderChart("expiry", expiryRef.current, "line", {
      labels: state.expiryTrend.labels,
      datasets: [
        {
          label: "หมดอายุ",
          data: state.expiryTrend.expiredData,
          borderColor: "#ef4444",
          backgroundColor: "rgba(239,68,68,0.12)",
          tension: 0.35
        },
        {
          label: "ใกล้หมดอายุ",
          data: state.expiryTrend.warningData,
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245,158,11,0.12)",
          tension: 0.35
        }
      ]
    });

    renderChart("status", statusRef.current, "doughnut", {
      labels: ["หมดอายุ", "ใกล้หมดอายุ", "ชำรุด", "จัดการแล้ว", "ปกติ"],
      datasets: [
        {
          data: [
            state.stats.expiredCount,
            state.stats.urgentCount,
            state.stats.damagedCount,
            state.stats.focusHandledTotal,
            state.stats.safeCount
          ],
          backgroundColor: ["#ef4444", "#f59e0b", "#8b5cf6", "#22c55e", "#3b82f6"]
        }
      ]
    });

    renderChart("fefo", fefoRef.current, "bar", {
      labels: ["หมดอายุ", "0-60 วัน", "มากกว่า 60 วัน"],
      datasets: [
        {
          data: [
            state.fefoBuckets.expired,
            state.fefoBuckets.next60,
            state.fefoBuckets.over60
          ],
          backgroundColor: ["#ef4444", "#f59e0b", "#22c55e"]
        }
      ]
    });

    renderChart("salesTrend", salesTrendRef.current, "line", {
      labels: state.salesTrend.labels,
      datasets: [
        {
          label: "ยอดขาย",
          data: state.salesTrend.values,
          borderColor: "#0891b2",
          backgroundColor: "rgba(8,145,178,0.15)",
          tension: 0.3
        }
      ]
    });

    renderChart(
      "topSales",
      topSalesRef.current,
      "bar",
      {
        labels: state.topSalesProducts.map((item) => item.name),
        datasets: [{ data: state.topSalesProducts.map((item) => item.qty), backgroundColor: "#3b82f6" }]
      },
      { indexAxis: "y" }
    );

    renderChart(
      "issues",
      issueRef.current,
      "bar",
      {
        labels: state.issueRanking.slice(0, 8).map((item) => item.productName),
        datasets: [
          {
            data: state.issueRanking.slice(0, 8).map((item) => item.score),
            backgroundColor: ["#ef4444", "#f97316", "#f59e0b", "#8b5cf6", "#3b82f6", "#14b8a6", "#22c55e", "#6366f1"]
          }
        ]
      },
      { indexAxis: "y" }
    );
  }, [state]);

  function renderChart(key, canvas, type, data, extraOptions = {}) {
    if (!canvas) return;
    chartsRef.current[key]?.destroy();

    chartsRef.current[key] = new Chart(canvas, {
      type,
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: type !== "bar" },
          tooltip: { enabled: true }
        },
        scales: type === "doughnut" ? {} : {
          x: { grid: { color: "rgba(148,163,184,0.15)" } },
          y: { grid: { color: "rgba(148,163,184,0.15)" } }
        },
        ...extraOptions
      }
    });
  }

  async function loadDashboard(user, coverageDays = state.coverageDays) {
    setState((current) => ({ ...current, loading: true, error: "", user }));

    try {
      const supabase = getSupabaseBrowserClient();
      const recentSalesStart = new Date();
      recentSalesStart.setDate(recentSalesStart.getDate() - 45);

      const [productsResult, batchesResult, damagesResult, uploadsResult] = await Promise.all([
        supabase.from("products").select("id, product_code, barcode, product_name, unit, price").order("product_name", { ascending: true }),
        supabase.from("batches").select(`
          id,
          product_id,
          supplier_id,
          batch_no,
          received_date,
          expiry_date,
          quantity_received,
          quantity_remaining,
          created_at,
          status,
          handling_status,
          products:product_id ( id, product_code, barcode, product_name, unit, price ),
          suppliers:supplier_id ( id, name )
        `).order("expiry_date", { ascending: true }),
        supabase.from("damage_reports").select(`
          id,
          batch_id,
          product_id,
          product_name,
          batch_no,
          supplier,
          damage_qty,
          damage_reason,
          damage_status,
          note,
          reported_at,
          updated_at,
          products:product_id ( id, price )
        `).order("reported_at", { ascending: false }),
        supabase
          .from("sales_uploads")
          .select("id, sales_date, uploaded_at, status")
          .order("sales_date", { ascending: false })
      ]);

      if (productsResult.error) throw productsResult.error;
      if (batchesResult.error) throw batchesResult.error;
      if (damagesResult.error) throw damagesResult.error;
      if (uploadsResult.error) throw uploadsResult.error;

      const uploadIds = (uploadsResult.data || []).map((item) => Number(item.id)).filter(Boolean);
      let salesLines = [];

      if (uploadIds.length) {
        const salesLinesResult = await supabase
          .from("sales_lines")
          .select("sales_upload_id, product_id, product_barcode, product_name, sold_qty, created_at")
          .in("sales_upload_id", uploadIds);

        if (salesLinesResult.error) throw salesLinesResult.error;
        salesLines = salesLinesResult.data || [];
      }

      const batches = (batchesResult.data || []).map((item) => {
        const daysLeft = calculateDaysLeft(item.expiry_date);
        const calculatedStatus = getCalculatedStatus(daysLeft);
        const finalHandlingStatus = getFinalHandlingStatus(item);
        const displayStatus = finalHandlingStatus || calculatedStatus;

        return {
          ...item,
          product_display_name: item.products?.product_name || "ไม่ระบุสินค้า",
          supplier_display_name: item.suppliers?.name || "-",
          daysLeft,
          displayStatus,
          quantity_num: Number(item.quantity_remaining ?? 0),
          quantity_received_num: Number(item.quantity_received ?? 0)
        };
      });

      const damageReports = (damagesResult.data || []).map((item) => {
        const normalizedStatus = normalizeDamageStatus(item.damage_status);
        return {
          ...item,
          product_display_name: item.product_name || "ไม่ระบุสินค้า",
          quantity_num: Number(item.damage_qty ?? 0),
          product_price: Number(item.products?.price || 0),
          normalized_status: normalizedStatus,
          displayStatus: normalizedStatus
        };
      });

      const returnedBatchItems = batches.filter((item) => item.displayStatus === "returned" || item.displayStatus === "disposed");
      const returnedDamageItems = damageReports.filter((item) => item.normalized_status === "returned" || item.normalized_status === "disposed");
      const urgentItems = batches
        .filter((item) => !["returned", "disposed"].includes(item.displayStatus) && item.quantity_num > 0 && ["expired", "warning"].includes(item.displayStatus))
        .sort((a, b) => (a.daysLeft ?? 999999) - (b.daysLeft ?? 999999));
      const activeDamageItems = damageReports.filter((item) => !["returned", "disposed"].includes(item.normalized_status) && item.quantity_num > 0);
      const expiredItems = urgentItems.filter((item) => item.displayStatus === "expired");
      const warningItems = urgentItems.filter((item) => item.displayStatus === "warning");
      const handledCount = returnedBatchItems.length + returnedDamageItems.length;
      const activeStockItems = batches.filter((item) => !["returned", "disposed"].includes(item.displayStatus));
      const totalStockQty = activeStockItems.reduce((sum, item) => sum + Number(item.quantity_num || 0), 0);
      const totalStockValue = activeStockItems.reduce((sum, item) => sum + getBatchValue(item), 0);
      const warningStockValue = warningItems.reduce((sum, item) => sum + getBatchValue(item), 0);
      const expiredStockValue = expiredItems.reduce((sum, item) => sum + getBatchValue(item), 0);
      const handledStockValue = returnedBatchItems.reduce((sum, item) => {
        const handledQty = Number(item.quantity_received_num || item.quantity_num || 0);
        return sum + getBatchValue(item, handledQty);
      }, 0) + returnedDamageItems.reduce((sum, item) => sum + (Number(item.quantity_num || 0) * Number(item.product_price || 0)), 0);
      const damageStockValue = activeDamageItems.reduce((sum, item) => sum + (Number(item.quantity_num || 0) * Number(item.product_price || 0)), 0);
      const safeCount = batches.filter((item) => item.displayStatus === "safe" && item.quantity_num > 0).length;
      const fefoBuckets = batches.reduce((acc, item) => {
        if (item.quantity_num <= 0 || ["returned", "disposed"].includes(item.displayStatus)) return acc;
        if (!Number.isFinite(item.daysLeft)) acc.over60 += 1;
        else if (item.daysLeft < 0) acc.expired += 1;
        else if (item.daysLeft <= NEAR_EXPIRY_WARNING_DAYS) acc.next60 += 1;
        else acc.over60 += 1;
        return acc;
      }, { expired: 0, next60: 0, over60: 0 });

      const allUploads = uploadsResult.data || [];
      const recentUploads = allUploads.filter((item) => {
        const dateValue = item.sales_date || item.uploaded_at;
        if (!dateValue) return false;
        return new Date(dateValue) >= recentSalesStart;
      });
      const recentUploadIds = new Set(recentUploads.map((item) => Number(item.id)));
      const recentSalesLines = salesLines.filter((line) => recentUploadIds.has(Number(line.sales_upload_id)));
      const uploadsById = new Map(allUploads.map((item) => [Number(item.id), item]));
      const monthRange = getCurrentMonthRange();
      const soldSystemQty = salesLines.reduce((sum, line) => sum + parseSalesQty(line.sold_qty), 0);
      const soldMonthQty = salesLines.reduce((sum, line) => {
        const upload = uploadsById.get(Number(line.sales_upload_id));
        const lineDate = upload?.sales_date || upload?.uploaded_at || line.created_at;
        return isInDateRange(lineDate, monthRange.start, monthRange.end) ? sum + parseSalesQty(line.sold_qty) : sum;
      }, 0);
      const damageSystemQty = damageReports.reduce((sum, item) => sum + Number(item.quantity_num || 0), 0);
      const damageMonthQty = damageReports.reduce((sum, item) => (
        isInDateRange(item.reported_at || item.updated_at, monthRange.start, monthRange.end)
          ? sum + Number(item.quantity_num || 0)
          : sum
      ), 0);
      const stockInMonthQty = activeStockItems.reduce((sum, item) => (
        isInDateRange(item.received_date || item.created_at, monthRange.start, monthRange.end)
          ? sum + Number(item.quantity_received_num || 0)
          : sum
      ), 0);

      const urgentProductGroups = buildUrgentProductGroups(urgentItems);
      const issueRanking = buildIssueRanking(urgentItems, activeDamageItems);
      const expiryTrend = buildExpiryTrend(urgentItems);
      const rawReorderRows = buildReorderRows(productsResult.data || [], batches, recentUploads, recentSalesLines, coverageDays);
      const reorderRows = applyCoverage(rawReorderRows, coverageDays);
      const salesTrend = buildSalesTrendData(recentUploads, recentSalesLines);
      const topSalesProducts = buildTopSalesProducts(productsResult.data || [], recentUploads, recentSalesLines);
      const sales14Total = topSalesProducts.reduce((sum, item) => sum + Number(item.qty || 0), 0);
      const sales30Metrics = buildSalesMetrics(productsResult.data || [], batches, recentUploads, recentSalesLines);
      const avgDailySalesAll = sales30Metrics.reduce((sum, item) => sum + Number(item.avgDailySales || 0), 0);

      setState((current) => ({
        ...current,
        loading: false,
        coverageDays,
        user,
        urgentItems,
        damageItems: activeDamageItems,
        urgentProductGroups,
        issueRanking,
        reorderRows,
        expiryTrend,
        salesTrend,
        topSalesProducts,
        fefoBuckets,
        stats: {
          totalStockQty,
          totalBatches: batches.length,
          urgentCount: warningItems.length,
          expiredCount: expiredItems.length,
          damagedCount: activeDamageItems.length,
          focusUrgentTotal: urgentItems.length,
          focusDamageTotal: activeDamageItems.length,
          focusHandledTotal: handledCount,
          alertExpiredCount: expiredItems.length,
          alertWarningCount: warningItems.length,
          alertReorderCount: reorderRows.length,
          sales14Value: sales14Total,
          salesAvgDailyValue: avgDailySalesAll,
          salesDocsValue: recentUploads.length,
          totalStockValue,
          warningStockValue,
          expiredStockValue,
          handledStockValue,
          damageStockValue,
          stockSystemQty: totalStockQty,
          soldSystemQty,
          damageSystemQty,
          stockInMonthQty,
          soldMonthQty,
          damageMonthQty,
          lastUpdatedTime: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
          safeCount
        }
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: `โหลดข้อมูลแดชบอร์ดไม่สำเร็จ: ${error.message}`
      }));
    }
  }

  function handleCoverageChange(event) {
    const coverageDays = Number(event.target.value || 14);
    setState((current) => ({
      ...current,
      coverageDays,
      reorderRows: applyCoverage(current.reorderRows, coverageDays)
    }));
  }

  function handleLogout() {
    clearUserSession();
    router.push("/login");
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="page-shell">
        <div className="page-stack">
          <div className="page-topbar">
            <div className="page-title">
              <h1>แดชบอร์ด</h1>
              <p>ดูงานสำคัญวันนี้ในหน้าเดียว เริ่มจากงานด่วน แล้วค่อยดูข้อมูลสรุปและแผนสต๊อก</p>
            </div>
            <div className="dashboard-actions">
              <div className="summary-box">
                <div className="summary-box-label">ผู้ใช้งานปัจจุบัน</div>
                <div className="summary-box-value">{state.user ? `${state.user.username} (${state.user.role || "user"})` : "-"}</div>
              </div>
              <button className="secondary-button print-button" type="button" onClick={handlePrint} aria-label="พิมพ์รายงานแดชบอร์ด">พิมพ์รายงาน</button>
              <button className="secondary-button" type="button" onClick={() => loadDashboard(state.user, state.coverageDays)}>รีเฟรชข้อมูล</button>
              <button className="sidebar-logout" type="button" onClick={handleLogout}>ออกจากระบบ</button>
            </div>
          </div>

          <section className="hero">
            <div>
              <div className="hero-kicker">workflow</div>
              <h2>ขั้นตอนจัดการของหมดอายุ และของเสียหาย</h2>
              <p>ทำตามลำดับนี้เพื่อให้ “แจ้งรายการ, ตัดสต็อก, ติดตามสถานะ, ตรวจประวัติ” ครบในระบบ</p>
              <div className="hero-points">
                <div className="hero-point">
                  <strong>หมดอายุ</strong>
                  บันทึกรายการของหมดอายุ/ใกล้หมดอายุ แล้วเลือกการจัดการ (คืน supplier หรือทำลาย) เพื่อให้ระบบตัดออกและเก็บประวัติ
                  <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <a className="secondary-button" href="/expire-returns">ไปหน้า “หมดอายุ / ชำรุด”</a>
                    <a className="secondary-button" href="/expired-history">ดูประวัติคืน/ตัดออก</a>
                  </div>
                </div>
                <div className="hero-point">
                  <strong>เสียหาย</strong>
                  แจ้งสินค้าเสียหายเพื่อให้ทีมติดตามสถานะ (รอตรวจ, แจ้ง supplier, คืนแล้ว, ทำลายแล้ว) และปิดงานให้ถูกต้อง
                  <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <a className="secondary-button" href="/damaged-manage">ไปหน้า “แจ้งสินค้าเสียหาย”</a>
                  </div>
                </div>
                <div className="hero-point">
                  <strong>ยืนยันผล</strong>
                  ตรวจสอบว่ารายการถูกตัดออกแล้ว และดูแนวโน้ม/สาเหตุเพื่อลดของเสียในรอบถัดไป
                  <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <a className="secondary-button" href="/analysis-expire-damage">ดูวิเคราะห์</a>
                  </div>
                </div>
              </div>
            </div>
            <div className="panel">
              <h3>Workflow แบบ Step-by-step</h3>
              <div className="panel-steps">
                <div className="panel-step">
                  <div className="panel-step-badge">1</div>
                  <div>
                    <strong>ตรวจจับรายการเร่งด่วน</strong>
                    <div className="card-help">ดูรายการ “ใกล้หมดอายุ/หมดอายุ” ที่ระบบสรุปไว้บน Dashboard แล้วเลือกสินค้าที่ต้องจัดการก่อน</div>
                  </div>
                </div>
                <div className="panel-step">
                  <div className="panel-step-badge">2</div>
                  <div>
                    <strong>เปิดหน้า “หมดอายุ / ชำรุด”</strong>
                    <div className="card-help">
                      ไปที่ <a className="inline-link" href="/expire-returns">หมดอายุ / ชำรุด</a> เพื่อบันทึกรายการ และกำหนดแนวทางจัดการ
                    </div>
                  </div>
                </div>
                <div className="panel-step">
                  <div className="panel-step-badge">3</div>
                  <div>
                    <strong>เลือกการจัดการ</strong>
                    <div className="card-help">เลือก “คืน supplier” หรือ “ทำลาย” ให้ตรงกับหน้างาน (ระบบจะเก็บสถานะไว้เพื่ออ้างอิง)</div>
                  </div>
                </div>
                <div className="panel-step">
                  <div className="panel-step-badge">4</div>
                  <div>
                    <strong>แจ้งสินค้าเสียหาย (ถ้ามี)</strong>
                    <div className="card-help">
                      ไปที่ <a className="inline-link" href="/damaged-manage">แจ้งสินค้าเสียหาย</a> แล้วอัปเดตสถานะจนปิดงาน
                    </div>
                  </div>
                </div>
                <div className="panel-step">
                  <div className="panel-step-badge">5</div>
                  <div>
                    <strong>ตรวจสอบประวัติ</strong>
                    <div className="card-help">
                      เช็กผลที่ <a className="inline-link" href="/expired-history">ประวัติคืน/ตัดออก</a> ว่ารายการถูกบันทึกและตัดออกเรียบร้อย
                    </div>
                  </div>
                </div>
                <div className="panel-step">
                  <div className="panel-step-badge">6</div>
                  <div>
                    <strong>สรุปและวิเคราะห์</strong>
                    <div className="card-help">
                      เปิด <a className="inline-link" href="/analysis-expire-damage">วิเคราะห์หมดอายุ/เสียหาย</a> เพื่อดูแนวโน้มและวางแผนลดของเสีย
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="hero old-hero">
            <div>
              <div className="hero-kicker">ภาพรวมวันนี้</div>
              <h2>ดูง่าย รู้ทัน ทำงานได้เร็ว</h2>
              <p>หน้านี้รวมตัวเลขสำคัญ งานค้าง ของชำรุด และข้อมูลขายไว้ในที่เดียว โดยเรียงจากสิ่งที่ควรดูก่อน</p>
              <div className="hero-points">
                <div className="hero-point"><strong>เริ่มจากตรงนี้</strong>ดูตัวเลขด้านบนก่อน เพื่อรู้ว่าวันนี้มีงานด่วนแค่ไหน</div>
                <div className="hero-point"><strong>งานที่ต้องทำ</strong>ดูสรุปเตือนและรายการค้างก่อน เพื่อไปทำงานต่อได้ทันที</div>
                <div className="hero-point"><strong>ใช้ตัดสินใจ</strong>ข้อมูลขายและคำแนะนำสั่งซื้ออยู่ท้ายหน้า ดูต่อได้ง่าย</div>
              </div>
            </div>
            <div className="panel">
              <h3>แนะนำให้ดูตามนี้</h3>
              <div className="panel-steps">
                <div className="panel-step"><div className="panel-step-badge">1</div><div><strong>ดูตัวเลขเตือน</strong><div className="card-help">เช็กก่อนว่ามีของหมดอายุ ใกล้หมดอายุ หรือชำรุดกี่รายการ</div></div></div>
                <div className="panel-step"><div className="panel-step-badge">2</div><div><strong>ดูรายการค้าง</strong><div className="card-help">เปิดดูรายการเร่งด่วนและของชำรุด เพื่อทำงานต่อทันที</div></div></div>
                <div className="panel-step"><div className="panel-step-badge">3</div><div><strong>ดูข้อมูลขาย</strong><div className="card-help">ใช้ยอดขายและตารางสั่งซื้อ เมื่อต้องวางแผนเติมสต๊อก</div></div></div>
              </div>
            </div>
          </section>

          {state.error ? <div className="empty-state">{state.error}</div> : null}

          <section className="inventory-status-card">
            <div>
              <div className="inventory-status-head">
                <div>
                  <div className="inventory-title-row">
                    <h2>ภาพรวมสินค้าทั้งหมด</h2>
                    <span>สรุปสถานะสำคัญ</span>
                  </div>
                  <p>ติดตามสถานะสินค้าในทุกมิติแบบเรียลไทม์ โดยนับสินค้าใกล้หมดอายุภายใน 2 เดือน</p>
                </div>
                <a className="inventory-detail-link" href="/batches" aria-label="ดูรายละเอียดสินค้าทั้งหมด">ดูรายละเอียดทั้งหมด</a>
              </div>
              <div className="stats-grid inventory-status-grid">
                <StatCard tone="tone-blue" label="ปริมาณสินค้าคงเหลือทั้งหมด" value={formatQtyCompact(state.stats.totalStockQty)} valueLine={formatCurrencyCompact(state.stats.totalStockValue)} badge={`อัปเดตล่าสุด ${state.stats.lastUpdatedTime || "-"}`} help="รวมสินค้าคงเหลือจากล็อตที่ยังอยู่ในระบบ" valueClassName="text-blue" />
                <StatCard tone="tone-orange" label="ปริมาณสินค้าใกล้หมดอายุ" value={state.stats.urgentCount} valueLine={formatCurrencyCompact(state.stats.warningStockValue)} badge="ภายใน 2 เดือน" help="นับเฉพาะล็อตที่ยังไม่หมดอายุและเหลือไม่เกิน 60 วัน" valueClassName="text-orange" />
                <StatCard tone="tone-red" label="ปริมาณสินค้าหมดอายุ" value={state.stats.expiredCount} valueLine={formatCurrencyCompact(state.stats.expiredStockValue)} badge="หมดอายุแล้ว" help="ล็อตที่เลยวันหมดอายุและยังไม่ได้ปิดงาน" valueClassName="text-red" />
                <StatCard tone="tone-green" label="ปริมาณสินค้าทำเรื่องคืนแล้ว" value={state.stats.focusHandledTotal} valueLine={formatCurrencyCompact(state.stats.handledStockValue)} badge="ดำเนินการคืนแล้ว" help="รวมรายการที่คืน supplier หรือทำลายแล้ว" valueClassName="text-green" />
                <StatCard tone="tone-purple" label="ปริมาณสินค้าชำรุด" value={state.stats.damagedCount} valueLine={formatCurrencyCompact(state.stats.damageStockValue)} badge="รอดำเนินการจัดการ" help="ของชำรุดที่ยังค้างอยู่ในระบบ" valueClassName="text-purple" />
              </div>
              <div className="inventory-flow-grid" aria-label="สรุปการเคลื่อนไหวสินค้า">
                <div className="flow-panel">
                  <div className="flow-panel-head">
                    <div>
                      <div className="section-kicker">สถานะปัจจุบัน</div>
                      <h3>สินค้าในระบบตอนนี้</h3>
                    </div>
                    <span className="flow-period">รวมทั้งหมด</span>
                  </div>
                  <div className="flow-metric-grid">
                    <FlowMetric tone="tone-green" label="คงเหลือในระบบ" value={formatQtyCompact(state.stats.stockSystemQty)} help="รวมจำนวนคงเหลือจากล็อตที่ยังอยู่ในระบบ" />
                    <FlowMetric tone="tone-blue" label="ขายออกแล้ว" value={formatQtyCompact(state.stats.soldSystemQty)} help="รวมจำนวนขายจากเอกสารขายทั้งหมด" />
                    <FlowMetric tone="tone-red" label="ชำรุด/เสียหาย" value={formatQtyCompact(state.stats.damageSystemQty)} help="รวมจำนวนที่ถูกบันทึกเป็นสินค้าเสียหาย" />
                  </div>
                </div>
                <div className="flow-panel">
                  <div className="flow-panel-head">
                    <div>
                      <div className="section-kicker">เดือนนี้</div>
                      <h3>การเคลื่อนไหวเดือนนี้</h3>
                    </div>
                    <span className="flow-period">{new Date().toLocaleDateString("th-TH", { month: "short", year: "numeric" })}</span>
                  </div>
                  <div className="flow-metric-grid">
                    <FlowMetric tone="tone-green" label="รับเข้าเดือนนี้" value={formatQtyCompact(state.stats.stockInMonthQty)} help="รวมจำนวนรับเข้าจากล็อตที่รับในเดือนนี้" />
                    <FlowMetric tone="tone-blue" label="ขายเดือนนี้" value={formatQtyCompact(state.stats.soldMonthQty)} help="รวมยอดขายจากเอกสารขายเดือนนี้" />
                    <FlowMetric tone="tone-red" label="เสียหายเดือนนี้" value={formatQtyCompact(state.stats.damageMonthQty)} help="รวมรายการเสียหายที่รายงานในเดือนนี้" />
                  </div>
                </div>
              </div>
              <div className="inventory-report-strip">
                <div className="report-info-icon" aria-hidden="true">i</div>
                <div>
                  <strong>อัปเดตข้อมูลล่าสุดเมื่อ {state.stats.lastUpdatedTime || "-"}</strong>
                  <span>ข้อมูลอาจเปลี่ยนแปลงได้ตลอดเวลา จากระบบ Expire Program</span>
                </div>
                <button className="secondary-button print-button" type="button" onClick={handlePrint}>พิมพ์รายงาน</button>
              </div>
            </div>
            <div>
              <div className="section-head"><div><div className="section-kicker">ทางลัดงาน</div><h2>เมนูที่ใช้บ่อย</h2><p>รวมหน้าที่ใช้บ่อย เพื่อเปิดทำงานต่อได้ทันที</p></div></div>
              <div className="actions-grid">
                <a className="action-card" href="/expire-returns"><div className="action-tag">เร่งด่วน</div><div className="action-title">จัดการของหมดอายุ / ชำรุด</div><div className="action-help">ดูรายการที่ต้องตาม ส่งคืน หรือสรุปผล</div></a>
                <a className="action-card" href="/damaged-manage"><div className="action-tag">ติดตาม</div><div className="action-title">แจ้งสินค้าชำรุด</div><div className="action-help">ดูของชำรุดที่ค้างและอัปเดตสถานะ</div></a>
                <a className="action-card" href="/products"><div className="action-tag">ตรวจสอบ</div><div className="action-title">ตรวจสอบสินค้า</div><div className="action-help">ดูข้อมูลสินค้าและรายละเอียดที่เกี่ยวข้อง</div></a>
              </div>
            </div>
          </section>

          <section>
            <div className="section-head"><div><div className="section-kicker">เริ่มตรงนี้ก่อน</div><h2>งานที่ต้องดูวันนี้</h2><p>รวมงานด่วน งานค้าง และของที่อาจต้องสั่งเพิ่ม</p></div></div>
            <div className="alerts-grid">
              <div className="card">
                <h3>สรุปเตือนวันนี้</h3>
                <div className="card-help">ดูจำนวนรายการที่ควรรีบเช็ก</div>
                <div className="alerts-list" style={{ marginTop: 16 }}>
                  <div className="alert-card alert-critical"><div><div className="alert-title">ล็อตหมดอายุที่ยังไม่ปิดงาน</div><div className="card-help">ควรตรวจสอบและปิดงานให้ครบ</div></div><div className="alert-value text-red">{state.stats.alertExpiredCount}</div></div>
                  <div className="alert-card alert-warning"><div><div className="alert-title">ล็อตใกล้หมดอายุภายใน 2 เดือน</div><div className="card-help">ควรเร่งขายหรือหยิบใช้ก่อน</div></div><div className="alert-value text-orange">{state.stats.alertWarningCount}</div></div>
                  <div className="alert-card alert-info"><div><div className="alert-title">สินค้าหมดสต๊อก / ควรสั่งซื้อ</div><div className="card-help">อ้างอิงจากยอดขายล่าสุด</div></div><div className="alert-value text-blue">{state.stats.alertReorderCount}</div></div>
                </div>
              </div>
              <div className="card">
                <h3>สรุปงานที่ต้องติดตาม</h3>
                <div className="card-help">สรุปตัวเลขที่ช่วยบอกว่างานค้างอยู่ตรงไหน</div>
                <div className="focus-list" style={{ marginTop: 16 }}>
                  <div className="focus-row"><div><div className="alert-title">รายการเร่งด่วนทั้งหมด</div><div className="card-help">รวมใกล้หมดอายุและหมดอายุแล้ว</div></div><div className="focus-value text-red">{state.stats.focusUrgentTotal}</div></div>
                  <div className="focus-row"><div><div className="alert-title">สินค้าชำรุดค้างจัดการ</div><div className="card-help">รายการที่ยังไม่ปิดงาน</div></div><div className="focus-value text-purple">{state.stats.focusDamageTotal}</div></div>
                  <div className="focus-row"><div><div className="alert-title">รายการที่จัดการแล้ว</div><div className="card-help">รวมทั้งคืน supplier และทำลายแล้ว</div></div><div className="focus-value text-green">{state.stats.focusHandledTotal}</div></div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <div className="section-head"><div><div className="section-kicker">มุมมองเชิงวิเคราะห์</div><h2>กราฟภาพรวมสต๊อก</h2><p>ใช้กราฟดูว่ามีความเสี่ยงตรงไหน และสินค้าใดควรดูเป็นพิเศษ</p></div></div>
            <div className="charts-grid">
              <div className="chart-card"><h3>แนวโน้มสินค้าหมดอายุ / ใกล้หมดอายุ</h3><div className="chart-help">ดูจำนวนล็อตตามวันหมดอายุ เพื่อเห็นช่วงที่มีงานด่วนมาก</div><div className="chart-canvas short"><canvas ref={expiryRef} /></div></div>
              <div className="chart-card">
                <h3>ภาพรวมสถานะสต๊อก</h3>
                <div className="chart-help">ดูสัดส่วนล็อตที่ต้องรีบจัดการ เทียบกับล็อตปกติและงานที่ปิดแล้ว</div>
                <div className="chart-canvas short"><canvas ref={statusRef} /></div>
                <div className="legend-row">
                  {[
                    ["#ef4444", "หมดอายุ"],
                    ["#f59e0b", "ใกล้หมดอายุ"],
                    ["#8b5cf6", "ชำรุด"],
                    ["#22c55e", "จัดการแล้ว"],
                    ["#3b82f6", "ปกติ"]
                  ].map(([color, label]) => (
                    <span key={label} className="legend-pill"><span className="legend-dot" style={{ background: color }} />{label}</span>
                  ))}
                </div>
              </div>
              <div className="chart-card"><h3>ภาพรวม FEFO</h3><div className="chart-help">ช่วยจัดลำดับการหยิบใช้ตามวันหมดอายุ</div><div className="chart-canvas short"><canvas ref={fefoRef} /></div></div>
            </div>
            <div className="charts-grid" style={{ marginTop: 18 }}>
              <div className="chart-card"><h3>อันดับปัญหาตามสินค้า</h3><div className="chart-help">ดูว่าสินค้าตัวไหนมีปัญหามากที่สุด</div><div className="chart-canvas"><canvas ref={issueRef} /></div></div>
              <div className="card">
                <h3>อันดับงานเร่งด่วน</h3>
                <div className="card-help">ดูว่าสินค้าตัวไหนควรตรวจสอบก่อน</div>
                <div className="rank-list" style={{ marginTop: 16 }}>
                  {state.urgentProductGroups.length ? state.urgentProductGroups.slice(0, 6).map((item, index) => (
                    <div className="rank-row" key={`${item.productName}-${index}`}>
                      <div className="rank-badge">{index + 1}</div>
                      <div><div className="rank-title">{item.productName}</div><div className="rank-sub">เร่งด่วน {item.urgentLots} ล็อต</div></div>
                      <div className="rank-value">{item.earliestDaysLeft < 0 ? `${Math.abs(item.earliestDaysLeft)} วัน` : `${item.earliestDaysLeft} วัน`}<span className="sub-label">{item.earliestDaysLeft < 0 ? "เลยวันหมดอายุ" : "เหลือก่อนหมดอายุ"}</span></div>
                    </div>
                  )) : <div className="empty-state">ยังไม่มีสินค้าที่ใกล้หมดอายุหรือหมดอายุ</div>}
                </div>
              </div>
            </div>
          </section>

          <section>
            <div className="section-head"><div><div className="section-kicker">วางแผนสต๊อก</div><h2>ยอดขายและการสั่งซื้อ</h2><p>ใช้ข้อมูลขายช่วยตัดสินใจเติมสต๊อก</p></div></div>
            <div className="sales-grid">
              <div className="sales-card"><div className="sales-label">ยอดขายย้อนหลัง 14 วัน</div><div className="sales-value">{formatQtyCompact(state.stats.sales14Value)}</div><div className="sales-help">รวมยอดขายล่าสุด</div></div>
              <div className="sales-card"><div className="sales-label">ค่าเฉลี่ยขายต่อวัน</div><div className="sales-value">{formatQtyCompact(state.stats.salesAvgDailyValue)}</div><div className="sales-help">คำนวณจากยอดขายย้อนหลัง 30 วัน</div></div>
              <div className="sales-card"><div className="sales-label">จำนวนเอกสารขายที่ใช้วิเคราะห์</div><div className="sales-value">{formatQtyCompact(state.stats.salesDocsValue)}</div><div className="sales-help">เอกสารที่ใช้ในการคำนวณ</div></div>
            </div>
            <div className="charts-grid" style={{ marginTop: 18 }}>
              <div className="chart-card"><h3>แนวโน้มยอดขาย</h3><div className="chart-help">ดูยอดขายรายวัน เพื่อช่วยวางแผนเติมสต๊อก</div><div className="chart-canvas short"><canvas ref={salesTrendRef} /></div></div>
              <div className="chart-card"><h3>สินค้าขายดีล่าสุด</h3><div className="chart-help">เรียงตามยอดขายล่าสุด เพื่อดูสินค้าขายดี</div><div className="chart-canvas"><canvas ref={topSalesRef} /></div></div>
            </div>
          </section>

          <section>
            <div className="section-head"><div><div className="section-kicker">รายการปฏิบัติการ</div><h2>รายการที่ต้องทำต่อ</h2><p>เปิดดูรายการจริงได้ทันที</p></div></div>
            <div className="content-grid">
              <div className="card">
                <h3>รายการเร่งด่วน</h3>
                <div className="card-help">รายการใกล้หมดอายุหรือหมดอายุแล้ว ที่ยังไม่ได้จัดการ</div>
                <div className="mini-list" style={{ marginTop: 16 }}>
                  {state.urgentItems.length ? state.urgentItems.slice(0, 6).map((item) => {
                    const chip = chipForUrgent(item);
                    return (
                      <div className="mini-card" key={item.id}>
                        <div className="mini-top"><div /><div><div className="mini-title">{item.product_display_name}</div><div className="mini-sub">ล็อต: {item.batch_no || "-"}</div></div><div><span className={chip.className}>{chip.text}</span></div></div>
                        <div className="chips-row"><span className="chip">คงเหลือ {formatQtyCompact(item.quantity_num)}</span><span className="chip">หมดอายุ {formatDate(item.expiry_date)}</span></div>
                      </div>
                    );
                  }) : <div className="empty-state">ไม่มีรายการเร่งด่วน</div>}
                </div>
              </div>
              <div className="card">
                <h3>สินค้าชำรุดล่าสุด</h3>
                <div className="card-help">แสดงเฉพาะรายการที่ยังค้างอยู่</div>
                <div className="mini-list" style={{ marginTop: 16 }}>
                  {state.damageItems.length ? state.damageItems.slice(0, 6).map((item) => {
                    const chip = chipForDamage(item.displayStatus);
                    return (
                      <div className="mini-card" key={item.id}>
                        <div className="mini-top"><div /><div><div className="mini-title">{item.product_display_name}</div><div className="mini-sub">ล็อต: {item.batch_no || "-"}</div></div><div><span className={chip.className}>{chip.text}</span></div></div>
                        <div className="chips-row"><span className="chip">จำนวน {formatQtyCompact(item.quantity_num)}</span><span className="chip">สาเหตุ {item.damage_reason || item.note || "-"}</span></div>
                      </div>
                    );
                  }) : <div className="empty-state">ไม่มีรายการสินค้าชำรุดที่ค้างอยู่</div>}
                </div>
              </div>
            </div>
            <div className="card" style={{ marginTop: 18 }}>
              <div className="section-head">
                <div><h3>คำแนะนำการสั่งซื้อ</h3><p>ใช้ยอดขายล่าสุดคำนวณ และแนะนำจำนวนที่ควรสั่งซื้อ</p></div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <label htmlFor="coverageDays">จำนวนวันครอบคลุม</label>
                  <select id="coverageDays" value={state.coverageDays} onChange={handleCoverageChange}>
                    <option value="7">7 วัน</option>
                    <option value="14">14 วัน</option>
                    <option value="30">30 วัน</option>
                  </select>
                </div>
              </div>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="data-table">
                  <thead><tr><th>สินค้า</th><th>รหัสสินค้า</th><th>สต๊อก</th><th>ยอดขายล่าสุด</th><th>เฉลี่ยต่อวัน</th><th>แนะนำให้สั่ง</th><th>สถานะ</th></tr></thead>
                  <tbody>
                    {state.reorderRows.length ? state.reorderRows.map((item) => (
                      <tr key={`${item.product_code}-${item.product_name}`}>
                        <td><div className="metric-strong">{item.product_name}</div><span className="metric-sub">หน่วย: {item.product_unit || "-"}</span></td>
                        <td><span className="metric-strong">{item.product_code || "-"}</span></td>
                        <td><span className="metric-strong">{formatQtyCompact(item.currentStock)}</span><span className="metric-sub">หมดสต๊อก</span></td>
                        <td><span className="metric-strong">{formatQtyCompact(item.recentSalesAmount)}</span><span className="metric-sub">ย้อนหลัง 14 วัน</span></td>
                        <td><span className="metric-strong">{formatQtyCompact(item.avgDailySales)}</span><span className="metric-sub">เฉลี่ยต่อวัน</span></td>
                        <td><span className="metric-strong">{formatQtyCompact(item.recommendedQty)}</span><span className="metric-sub">ครอบคลุม {state.coverageDays} วัน</span></td>
                        <td><span className={`decision-badge ${item.badgeClass}`}>{item.badgeText}</span><span className="metric-sub">{item.hasEnoughHistory ? "คำนวณจากยอดขายจริงล่าสุด" : "ข้อมูลยังน้อย ควรตรวจสอบเพิ่ม"}</span></td>
                      </tr>
                    )) : (
                      <tr><td colSpan="7"><div className="empty-state">{state.loading ? "กำลังโหลดข้อมูล..." : "ยังไม่มีสินค้าที่หมดสต๊อกให้แนะนำการสั่งซื้อ"}</div></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
