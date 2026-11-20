const express = require("express");
const router = express.Router();
const db = require("./db");

const LOW_STOCK_LIMIT = 10;
const FAST_LIMIT = 10;
const SLOW_LIMIT = 50;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

function num(value) {
    return Number(value) || 0;
}

function round(value, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round(num(value) * factor) / factor;
}

function dayToDate(key) {
    const parts = key.split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}


function dateToDay(date) {
    return date.toISOString().slice(0, 10);
}

function weekStart(date) {
    const result = new Date(date.getTime());
    const weekday = (result.getUTCDay() + 6) % 7;
    result.setUTCDate(result.getUTCDate() - weekday);
    return result;
}

function bucketKey(dayKey, mode) {
    if (mode === "daily") return dayKey;
    if (mode === "weekly") return dateToDay(weekStart(dayToDate(dayKey)));
    return dayKey.slice(0, 7);
}

function bucketLabel(key, mode) {
    if (mode === "monthly") {
        const parts = key.split("-");
        return MONTHS[Number(parts[1]) - 1] + " " + parts[0];
    }

    const parts = key.split("-");
    const text = MONTHS[Number(parts[1]) - 1] + " " + parts[2];

    return mode === "weekly" ? "Week of " + text : text;
}

function buildBuckets(from, to, mode) {
    const keys = [];
    const cursor = dayToDate(from);

    const last = dayToDate(to);

    while (cursor <= last) {
        const key = bucketKey(dateToDay(cursor), mode);

        if (keys[keys.length - 1] !== key) {
            keys.push(key);
        }

        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return keys;
}

function pickMode(days) {
    if (days <= 31) return "daily";
    if (days <= 92) return "weekly";
    return "monthly";
}

router.get("/summary", (req, res) => {
    const sql = `
    SELECT
        (SELECT COUNT(*) FROM products) AS totalProducts,
        (SELECT COUNT(*) FROM products WHERE quantity >= 1 AND quantity <= 10) AS lowStocks,
        (SELECT IFNULL(SUM(total),0) FROM sales) AS grossSales,
        (
            SELECT IFNULL(SUM(refund_amount),0)
            FROM sales_returns
            WHERE status = 'Refunded'
        ) AS totalRefunds

    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log(err);
            return res.send({});
        }

        const row = result[0];
        const grossSales = Number(row.grossSales) || 0;
        const totalRefunds = Number(row.totalRefunds) || 0;
        const netSales = Math.max(grossSales - totalRefunds, 0);

        res.send({
            totalProducts: row.totalProducts,
            lowStocks: row.lowStocks,
            totalSales: netSales.toFixed(2),
            grossSales: grossSales.toFixed(2),
            totalRefunds: totalRefunds.toFixed(2)
        });
    });
});

router.get("/overview", async (req, res) => {
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    if (!datePattern.test(from) || !datePattern.test(to)) {
        return res.status(400).json({
            success: false,
            message: "Please select a valid From Date and To Date."

        });
    }

    if (from > to) {
        return res.status(400).json({
            success: false,
            message: "From Date cannot be later than To Date."
        });
    }

    const start = from + " 00:00:00";
    const end = to + " 23:59:59";
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    const mode = pickMode(days);

    try {
        const salesRows = await runQuery(`
            SELECT
                s.id,
                s.product_id,
                COALESCE(p.product_name, 'Deleted product') AS product_name,
                COALESCE(p.category, 'Uncategorized') AS category,
                s.quantity,
                s.total,
                DATE_FORMAT(s.sale_date, '%Y-%m-%d') AS day_key,
                DATE_FORMAT(s.sale_date, '%b %d, %Y %h:%i %p') AS sale_date
            FROM sales s
            LEFT JOIN products p ON p.id = s.product_id
            WHERE s.sale_date BETWEEN ? AND ?
            ORDER BY s.sale_date DESC, s.id DESC
        `, [start, end]);


        const returnRows = await runQuery(`
            SELECT
                product_id,
                COALESCE(SUM(quantity_returned), 0) AS returned_quantity,
                COALESCE(SUM(CASE WHEN item_condition = 'Bad Order' THEN quantity_returned ELSE 0 END), 0) AS bad_quantity
            FROM sales_returns
            WHERE status IN ('Completed', 'Refunded')
              AND return_date BETWEEN ? AND ?
            GROUP BY product_id
        `, [start, end]);

        const stockInRows = await runQuery(`
            SELECT
                sii.product_id,
                COALESCE(SUM(sii.quantity_received), 0) AS received_quantity
            FROM stock_in_items sii
            JOIN stock_ins si ON si.id = sii.stock_in_id
            WHERE si.stock_in_date BETWEEN ? AND ?
            GROUP BY sii.product_id
        `, [start, end]);

        const refundRows = await runQuery(`
            SELECT
                sr.product_id,
                COALESCE(SUM(sr.refund_amount), 0) AS refunded_amount
            FROM sales_returns sr
            LEFT JOIN (
                SELECT return_id, MAX(refund_date) AS refund_date
                FROM refunds
                WHERE status = 'Refunded'
                GROUP BY return_id
            ) r ON r.return_id = sr.id

            WHERE sr.status = 'Refunded'
              AND COALESCE(r.refund_date, sr.return_date) BETWEEN ? AND ?
            GROUP BY sr.product_id
        `, [start, end]);

        const productRows = await runQuery(`
            SELECT id, product_name, category, quantity, price
            FROM products
            ORDER BY id ASC
        `);

        const soldMap = new Map();
        const grossMap = new Map();
        const returnMap = new Map();
        const badMap = new Map();
        const stockInMap = new Map();
        const refundMap = new Map();

        let grossSales = 0;

        const bucketKeys = buildBuckets(from, to, mode);
        const flowMap = new Map();

        bucketKeys.forEach(key => {
            flowMap.set(key, {
                key,
                label: bucketLabel(key, mode),
                total: 0,
                quantity: 0,
                transactions: 0
            });
        });


        salesRows.forEach(row => {
            const id = Number(row.product_id);
            const quantity = num(row.quantity);
            const total = num(row.total);

            soldMap.set(id, (soldMap.get(id) || 0) + quantity);
            grossMap.set(id, (grossMap.get(id) || 0) + total);
            grossSales += total;

            const bucket = flowMap.get(bucketKey(row.day_key, mode));

            if (bucket) {
                bucket.total += total;
                bucket.quantity += quantity;
                bucket.transactions += 1;
            }
        });

        returnRows.forEach(row => {
            returnMap.set(Number(row.product_id), num(row.returned_quantity));
            badMap.set(Number(row.product_id), num(row.bad_quantity));
        });

        stockInRows.forEach(row => {
            stockInMap.set(Number(row.product_id), num(row.received_quantity));
        });

        let totalRefunds = 0;

        refundRows.forEach(row => {
            refundMap.set(Number(row.product_id), num(row.refunded_amount));

            totalRefunds += num(row.refunded_amount);
        });

        let totalStock = 0;
        let stockValue = 0;
        let lowStock = 0;
        let outOfStock = 0;
        let totalStockIn = 0;
        let totalReturned = 0;
        let totalBad = 0;
        let netQuantity = 0;

        const items = productRows.map(product => {
            const id = Number(product.id);
            const stock = num(product.quantity);
            const price = num(product.price);
            const sold = soldMap.get(id) || 0;
            const returned = returnMap.get(id) || 0;
            const bad = badMap.get(id) || 0;
            const stockIn = stockInMap.get(id) || 0;
            const net = Math.max(sold - returned, 0);
            const gross = grossMap.get(id) || 0;
            const refunded = refundMap.get(id) || 0;

            let status = "In Stock";

            if (stock <= 0) {
                status = "Out of Stock";
                outOfStock += 1;
            } else if (stock <= LOW_STOCK_LIMIT) {
                status = "Low Stock";
                lowStock += 1;

            }

            totalStock += stock;
            stockValue += stock * price;
            totalStockIn += stockIn;
            totalReturned += returned;
            totalBad += bad;
            netQuantity += net;

            return {
                id,
                product_name: product.product_name,
                category: product.category || "Uncategorized",
                stock,
                price: round(price, 2),
                stock_in: stockIn,
                sold,
                returned,
                bad_order: bad,
                net_quantity: net,
                net_sales: round(gross - refunded, 2),
                status
            };
        });

        const fastAll = items
            .filter(item => item.net_quantity > 0)
            .sort((a, b) =>
                b.net_quantity - a.net_quantity ||
                a.product_name.localeCompare(b.product_name)
            );


        const slowAll = items
            .filter(item => item.net_quantity <= 0)
            .sort((a, b) =>
                b.stock - a.stock ||
                a.product_name.localeCompare(b.product_name)
            );

        const netSales = grossSales - totalRefunds;
        const topProduct = fastAll[0] || null;

        return res.json({
            success: true,

            period: {
                from,
                to,
                days,
                mode,
                label: from + " to " + to
            },

            summary: {
                grossSales: round(grossSales, 2),
                totalRefunds: round(totalRefunds, 2),
                netSales: round(netSales, 2),
                transactions: salesRows.length,
                netQuantity,
                topProduct: topProduct ? topProduct.product_name : null,
                topQuantity: topProduct ? topProduct.net_quantity : 0,
                fastCount: fastAll.length,
                slowCount: slowAll.length,
                totalProducts: items.length,

                totalStock,
                stockValue: round(stockValue, 2),
                lowStock,
                outOfStock,
                totalStockIn,
                totalReturned,
                totalBad
            },

            sales: salesRows.map(row => ({
                id: row.id,
                product_name: row.product_name,
                category: row.category,
                quantity: num(row.quantity),
                total: round(row.total, 2),
                sale_date: row.sale_date
            })),

            flow: Array.from(flowMap.values()).map(bucket => ({
                ...bucket,
                total: round(bucket.total, 2)
            })),

            fastMoving: fastAll.slice(0, FAST_LIMIT).map((item, index) => ({
                rank: index + 1,
                product_name: item.product_name,
                category: item.category,
                net_quantity: item.net_quantity,
                net_sales: item.net_sales
            })),

            slowMoving: slowAll.slice(0, SLOW_LIMIT).map(item => ({

                product_name: item.product_name,
                category: item.category,
                stock: item.stock,
                net_quantity: item.net_quantity
            })),

            inventory: items
        });
    } catch (error) {
        console.error("Reports Overview Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to generate the report."
        });
    }
});

async function askGemini(prompt) {
    if (!process.env.GEMINI_API_KEY) return null;

    const models = ["gemini-flash-lite-latest", "gemini-flash-latest"];

    for (const model of models) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        try {
            const response = await fetch(
                "https://generativelanguage.googleapis.com/v1beta/models/" +
                model + ":generateContent",
                {

                    method: "POST",
                    signal: controller.signal,
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": process.env.GEMINI_API_KEY
                    },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            maxOutputTokens: 400,
                            temperature: 0.2
                        }
                    })
                }
            );

            if (response.ok) {
                const data = await response.json();
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

                if (text && text.trim()) return text.trim();
            }
        } catch (error) {
            console.log("Reports AI error:", error.message);
        } finally {
            clearTimeout(timeout);
        }
    }

    return null;
}


router.post("/insight", async (req, res) => {
    const body = req.body || {};

    const facts = {
        report_period: String(body.periodLabel || "").slice(0, 40),
        total_products: num(body.totalProducts),
        total_stock_pcs: num(body.totalStock),
        stock_value: round(body.stockValue, 2),
        low_stock_products: num(body.lowStock),
        out_of_stock_products: num(body.outOfStock),
        net_quantity_sold_in_period: num(body.netSold),
        products_needing_attention: Array.isArray(body.needAttention)
            ? body.needAttention.slice(0, 5).map(name => String(name).slice(0, 60))
            : [],
        top_sold: Array.isArray(body.topSold)
            ? body.topSold.slice(0, 3).map(item => ({
                name: String(item.name || "").slice(0, 60),
                qty: num(item.qty)
            }))
            : []
    };

    const attention = facts.products_needing_attention.join(", ");

    const fallback =
        "You have " + facts.total_products + " products with " +
        facts.total_stock_pcs.toLocaleString("en-PH") + " pieces in stock worth ₱" +
        facts.stock_value.toLocaleString("en-PH", { minimumFractionDigits: 2 }) +
        ". " + facts.low_stock_products + " product(s) are low on stock and " +
        facts.out_of_stock_products + " are out of stock" +
        (attention ? ", including " + attention + "." : ".");


    const prompt =
        "You are advising the owner of a motorcycle parts shop in the Philippines. " +
        "Write 2 short sentences in simple English that explain this inventory report " +
        "and suggest one practical action. Use 'you' and 'your'. " +
        "All money amounts are in Philippine pesos, so write them with the ₱ sign and never use the $ sign. " +
        "This is a physical shop, so do not mention online listings, websites, or online sales. " +
        "Use ONLY the numbers given and do not invent numbers.\n\n" +
        JSON.stringify(facts);

    const text = await askGemini(prompt);

    return res.json({
        success: true,
        aiUsed: Boolean(text),
        insight: text || fallback
    });
});

module.exports = router;