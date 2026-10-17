
const express = require("express");
const router = express.Router();
const db = require("./db");

const LOW_STOCK_LIMIT = 10;
const LEAD_TIME_DAYS = 7;
const COVER_DAYS = 14;
const URGENT_DAYS = 3;

const FAST_TABLE_LIMIT = 10;
const SLOW_TABLE_LIMIT = 30;
const RESTOCK_TABLE_LIMIT = 30;
const LOW_STOCK_TABLE_LIMIT = 50;

const PERIODS = {
    "7": { days: 7, label: "Last 7 Days" },
    "30": { days: 30, label: "Last 30 Days" },
    "90": { days: 90, label: "Last 90 Days" },
    all: { days: null, label: "All Recorded Sales" }
};

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

function toSqlDate(date) {
    const pad = n => String(n).padStart(2, "0");

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function numberOrZero(value) {
    return Number(value) || 0;
}

function round(value, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round(numberOrZero(value) * factor) / factor;
}

router.get("/overview", async (req, res) => {
    try {
        const requestedPeriod = String(req.query.period || "all");

        const periodKey = Object.prototype.hasOwnProperty.call(
            PERIODS,
            requestedPeriod
        ) ? requestedPeriod : "all";

        const period = PERIODS[periodKey];
        const now = new Date();

        const startDate = period.days === null
            ? "1000-01-01 00:00:00"
            : toSqlDate(
                new Date(now.getTime() - period.days * 86400000)
            );

        const firstSaleRows = await runQuery(`
            SELECT MIN(sale_date) AS first_sale
            FROM sales
        `);

        let daysSinceFirstSale = 1;

        if (firstSaleRows[0] && firstSaleRows[0].first_sale) {
            const firstSaleDate = new Date(firstSaleRows[0].first_sale);

            daysSinceFirstSale = Math.max(
                1,
                Math.ceil(
                    (now.getTime() - firstSaleDate.getTime()) / 86400000
                )
            );
        }

        const periodDays = period.days === null
            ? daysSinceFirstSale
            : Math.max(1, Math.min(period.days, daysSinceFirstSale));

        const totalsRows = await runQuery(`
            SELECT
                COUNT(*) AS transactions,
                COALESCE(SUM(total), 0) AS gross_sales
            FROM sales
            WHERE sale_date >= ?
        `, [startDate]);

        const refundRows = await runQuery(`
            SELECT COALESCE(SUM(sr.refund_amount), 0) AS total_refunds
            FROM sales_returns sr
            LEFT JOIN (
                SELECT
                    return_id,
                    MAX(refund_date) AS refund_date
                FROM refunds
                WHERE status = 'Refunded'
                GROUP BY return_id
            ) r ON r.return_id = sr.id
            WHERE sr.status = 'Refunded'
              AND COALESCE(r.refund_date, sr.return_date) >= ?
        `, [startDate]);

        const productSalesRows = await runQuery(`
            SELECT
                product_id,
                COALESCE(SUM(quantity), 0) AS sold_quantity,
                COALESCE(SUM(total), 0) AS gross_total
            FROM sales
            WHERE sale_date >= ?
            GROUP BY product_id
        `, [startDate]);

        const productReturnRows = await runQuery(`
            SELECT
                sr.product_id,
                COALESCE(SUM(sr.quantity_returned), 0) AS returned_quantity
            FROM sales_returns sr
            WHERE sr.status IN ('Completed', 'Refunded')
              AND sr.return_date >= ?
            GROUP BY sr.product_id
        `, [startDate]);

        const productRefundRows = await runQuery(`
            SELECT
                sr.product_id,
                COALESCE(SUM(sr.refund_amount), 0) AS refunded_amount
            FROM sales_returns sr
            LEFT JOIN (
                SELECT
                    return_id,
                    MAX(refund_date) AS refund_date
                FROM refunds
                WHERE status = 'Refunded'
                GROUP BY return_id
            ) r ON r.return_id = sr.id
            WHERE sr.status = 'Refunded'
              AND COALESCE(r.refund_date, sr.return_date) >= ?
            GROUP BY sr.product_id
        `, [startDate]);

        const inventoryRows = await runQuery(`
            SELECT
                id,
                product_name,
                category,
                quantity AS stock,
                price
            FROM products
        `);

        const salesByProduct = new Map();
        const returnsByProduct = new Map();
        const refundsByProduct = new Map();

        productSalesRows.forEach(row => {
            salesByProduct.set(Number(row.product_id), row);
        });

        productReturnRows.forEach(row => {
            returnsByProduct.set(Number(row.product_id), row);
        });

        productRefundRows.forEach(row => {
            refundsByProduct.set(Number(row.product_id), row);
        });

        const products = inventoryRows.map(row => {
            const id = Number(row.id);
            const sales = salesByProduct.get(id) || {};
            const returns = returnsByProduct.get(id) || {};
            const refunds = refundsByProduct.get(id) || {};

            const stock = numberOrZero(row.stock);
            const soldQuantity = numberOrZero(sales.sold_quantity);
            const returnedQuantity = numberOrZero(returns.returned_quantity);
            const grossTotal = numberOrZero(sales.gross_total);
            const refundedAmount = numberOrZero(refunds.refunded_amount);

            const netQuantity = Math.max(
                soldQuantity - returnedQuantity,
                0
            );

            return {
                id,
                product_name: row.product_name,
                category: row.category || "Uncategorized",
                stock,
                price: numberOrZero(row.price),
                sold_quantity: soldQuantity,
                returned_quantity: returnedQuantity,
                net_quantity: netQuantity,
                gross_sales: grossTotal,
                refunded_amount: refundedAmount,
                net_sales: grossTotal - refundedAmount
            };
        });

        const fastProducts = products
            .filter(product => product.net_quantity > 0)
            .sort((a, b) =>
                b.net_quantity - a.net_quantity ||
                a.product_name.localeCompare(b.product_name)
            );

        const slowProducts = products
            .filter(product => product.net_quantity <= 0)
            .sort((a, b) =>
                b.stock - a.stock ||
                a.product_name.localeCompare(b.product_name)
            );

        const lowStockAll = products
            .filter(product =>
                product.stock >= 1 &&
                product.stock <= LOW_STOCK_LIMIT
            )
            .sort((a, b) =>
                a.stock - b.stock ||
                a.product_name.localeCompare(b.product_name)
            );

        const outOfStockCount = products.filter(
            product => product.stock <= 0
        ).length;

        const restockAll = products
            .map(product => {
                const averageDaily = product.net_quantity / periodDays;

                const daysLeft = product.stock <= 0
                    ? 0
                    : averageDaily > 0
                        ? product.stock / averageDaily
                        : Infinity;

                const suggestedOrder = Math.max(
                    Math.ceil(averageDaily * COVER_DAYS) - product.stock,
                    1
                );

                let status = "Restock Soon";

                if (product.stock <= 0) {
                    status = "Out of Stock";
                } else if (daysLeft <= URGENT_DAYS) {
                    status = "Urgent";
                }

                return {
                    product_name: product.product_name,
                    category: product.category,
                    stock: product.stock,
                    average_daily: round(averageDaily, 1),
                    days_left: Number.isFinite(daysLeft)
                        ? round(daysLeft, 1)
                        : null,
                    suggested_order: suggestedOrder,
                    status
                };
            })
            .filter(item =>
                item.stock <= 0 ||
                (item.days_left !== null &&
                    item.days_left <= LEAD_TIME_DAYS)
            )
            .sort((a, b) => {
                const aDays = a.days_left === null
                    ? Infinity : a.days_left;
                const bDays = b.days_left === null
                    ? Infinity : b.days_left;

                return aDays - bDays;
            });

        const categoryMap = new Map();

        products.forEach(product => {
            if (!categoryMap.has(product.category)) {
                categoryMap.set(product.category, {
                    category: product.category,
                    products: 0,
                    total_stock: 0,
                    stock_value: 0,
                    net_sold: 0,
                    low_stock_items: 0
                });
            }

            const category = categoryMap.get(product.category);

            category.products += 1;
            category.total_stock += product.stock;
            category.stock_value += product.stock * product.price;
            category.net_sold += product.net_quantity;

            if (
                product.stock >= 1 &&
                product.stock <= LOW_STOCK_LIMIT
            ) {
                category.low_stock_items += 1;
            }
        });

        const categories = Array.from(categoryMap.values())
            .sort((a, b) => b.total_stock - a.total_stock)
            .map(item => ({
                ...item,
                stock_value: round(item.stock_value, 2)
            }));

        const grossSales = numberOrZero(totalsRows[0]?.gross_sales);
        const totalRefunds = numberOrZero(refundRows[0]?.total_refunds);
        const netSales = grossSales - totalRefunds;

        const netQuantity = products.reduce(
            (sum, product) => sum + product.net_quantity,
            0
        );

        const normalCount = products.filter(
            product => product.net_quantity > 0 &&
                !fastProducts.some(fast => fast.id === product.id)
        ).length;

        return res.json({
            success: true,

            period: {
                key: periodKey,
                label: period.label,
                days: periodDays
            },

            summary: {
                grossSales: round(grossSales, 2),
                totalRefunds: round(totalRefunds, 2),
                netSales: round(netSales, 2),
                transactions: numberOrZero(totalsRows[0]?.transactions),
                netQuantity,
                fastCount: fastProducts.length,
                slowCount: slowProducts.length,
                noSalesCount: slowProducts.length,
                normalCount,
                lowStockCount: lowStockAll.length,
                outOfStockCount,
                restockCount: restockAll.length
            },

            fastMoving: fastProducts
                .slice(0, FAST_TABLE_LIMIT)
                .map((product, index) => ({
                    rank: index + 1,
                    product_name: product.product_name,
                    category: product.category,
                    net_quantity: product.net_quantity,
                    net_sales: round(product.net_sales, 2)
                })),

            slowMoving: slowProducts
                .slice(0, SLOW_TABLE_LIMIT)
                .map(product => ({
                    product_name: product.product_name,
                    category: product.category,
                    stock: product.stock,
                    net_quantity: product.net_quantity
                })),

            lowStock: lowStockAll
                .slice(0, LOW_STOCK_TABLE_LIMIT)
                .map(product => ({
                    product_name: product.product_name,
                    category: product.category,
                    stock: product.stock
                })),

            restock: restockAll.slice(0, RESTOCK_TABLE_LIMIT),

            categories,

            rules: {
                lowStockLimit: LOW_STOCK_LIMIT,
                leadTimeDays: LEAD_TIME_DAYS,
                coverDays: COVER_DAYS,
                urgentDays: URGENT_DAYS
            }
        });
    } catch (error) {
        console.error("Analytics Overview Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to load analytics data."
        });
    }
});

module.exports = router;
