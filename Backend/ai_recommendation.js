const express = require("express");
const router = express.Router();
const db = require("./db");

const LEAD_TIME_DAYS = 7;
const COVER_DAYS = 14;
const URGENT_DAYS = 3;
const TREND_CHANGE = 0.2;
const RETURN_RATE_LIMIT = 0.3;

const MAX_RESTOCK_ROWS = 12;
const MAX_REVIEW_ROWS = 5;
const MAX_FAST_ROWS = 10;
const MAX_DECLINING_ROWS = 5;
const MAX_SLOW_ROWS = 8;

function query(sql) {
    return new Promise((resolve, reject) => {
        db.query(sql, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

function money(value) {
    return (Number(value) || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function getTrend(recent, previous, totalNet) {
    if (recent === 0 && previous === 0) {
        return {
            label: totalNet > 0 ? "No Recent Sales" : "No Sales",
            change: null
        };
    }

    if (recent === 0 && previous > 0) {
        return {
            label: "No Recent Sales",
            change: null
        };
    }

    if (previous === 0) {
        return {
            label: "Rising",
            change: null
        };
    }

    const change = (recent - previous) / previous;

    if (change >= TREND_CHANGE) {
        return {
            label: "Rising",
            change: change
        };
    }

    if (change <= -TREND_CHANGE) {
        return {
            label: "Declining",
            change: change
        };
    }

    return {
        label: "Stable",
        change: change
    };
}

function trendText(item, windowDays) {
    if (item.trend.label === "No Sales") {
        return "No sales recorded yet";
    }

    if (item.trend.label === "No Recent Sales") {
        return "No sales in the last " + windowDays + " days";
    }

    return (
        "Sales are " + item.trend.label.toLowerCase() +
        " (" + item.recentQty + " pcs in the last " + windowDays +
        " days vs " + item.previousQty + " pcs in the " +
        windowDays + " days before)"
    );
}

async function callGemini(prompt) {
    const models = [
        "gemini-flash-lite-latest",
        "gemini-flash-latest"
    ];

    let lastResponse = null;

    for (const model of models) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 9000);

            let response;

            try {
                response = await fetch(
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
                            contents: [
                                { parts: [{ text: prompt }] }
                            ],
                            generationConfig: {
                                responseMimeType: "application/json",
                                maxOutputTokens: 4000,
                                temperature: 0.2
                            }
                        })
                    }
                );
            } finally {
                clearTimeout(timeout);
            }

            if (response.ok) return response;

            lastResponse = response;

            console.log(
                "Gemini " + model + " failed:",
                response.status
            );

            if (
                response.status !== 429 &&
                response.status !== 503
            ) {
                return response;
            }
        } catch (error) {
            lastResponse = null;
            console.log(
                "Gemini " + model +
                " request failed or timed out:",
                error.message
            );
        }
    }

    return lastResponse;
}

router.post("/recommendations", async (req, res) => {
    try {
        const [
            products,
            sales,
            suppliers,
            returns,
            refunds,
            purchaseOrders
        ] = await Promise.all([
            query("SELECT * FROM products"),
            query("SELECT * FROM sales"),
            query("SELECT * FROM suppliers"),
            query("SELECT * FROM sales_returns"),
            query("SELECT * FROM refunds"),
            query("SELECT * FROM purchase_orders").catch(error => {
                console.log(
                    "AI Recommendation - Purchase Orders not loaded:",
                    error.message
                );
                return [];
            })
        ]);

        if (products.length === 0 || sales.length === 0) {
            return res.send({
                success: false,
                message:
                    "Not enough data to generate recommendations. Please add products and record sales first."
            });
        }

        const now = new Date();
        let firstSale = null;

        sales.forEach(sale => {
            const date = new Date(sale.sale_date);

            if (
                !isNaN(date.getTime()) &&
                (!firstSale || date < firstSale)
            ) {
                firstSale = date;
            }
        });

        const totalDays = firstSale
            ? Math.max(
                1,
                Math.ceil(
                    (now.getTime() - firstSale.getTime()) / 86400000
                )
            )
            : 1;

        const windowDays = Math.max(
            1,
            Math.min(14, Math.floor(totalDays / 2))
        );

        const recentStart = new Date(
            now.getTime() - windowDays * 86400000
        );

        const previousStart = new Date(
            now.getTime() - 2 * windowDays * 86400000
        );

        const returnedBySale = {};
        const refundedAmountBySale = {};
        const refundAmountByReturn = {};

        refunds.forEach(row => {
            const status = String(row.status || "")
                .trim()
                .toLowerCase();

            if (
                status &&
                ![
                    "refunded",
                    "completed",
                    "processed",
                    "approved"
                ].includes(status)
            ) {
                return;
            }

            const returnId = row.return_id;

            if (returnId === undefined || returnId === null) {
                return;
            }

            const amount = Number(
                row.refund_amount ??
                row.amount_refunded ??
                row.refund_total ??
                row.amount ??
                row.total
            ) || 0;

            refundAmountByReturn[returnId] =
                (refundAmountByReturn[returnId] || 0) +
                Math.max(0, amount);
        });

        returns.forEach(row => {
            const status = String(row.status || "")
                .trim()
                .toLowerCase();

            if (!["completed", "refunded"].includes(status)) {
                return;
            }

            const saleId = row.sale_id ?? row.sales_id;

            if (saleId === undefined || saleId === null) {
                return;
            }

            const returnId = row.id;

            const returnedQty = Number(
                row.quantity_returned ??
                row.returned_quantity ??
                row.quantity
            ) || 0;

            returnedBySale[saleId] =
                (returnedBySale[saleId] || 0) +
                Math.max(0, returnedQty);

            const linkedRefund =
                Number(refundAmountByReturn[returnId]) || 0;

            const fallbackRefund =
                status === "refunded"
                    ? Math.max(0, Number(row.refund_amount) || 0)
                    : 0;

            const refundAmount =
                linkedRefund > 0
                    ? linkedRefund
                    : fallbackRefund;

            if (refundAmount > 0) {
                refundedAmountBySale[saleId] =
                    (refundedAmountBySale[saleId] || 0) +
                    refundAmount;
            }
        });

        const supplierById = new Map();

        suppliers.forEach(supplier => {
            const supplierId = supplier.id ?? supplier.supplier_id;

            if (supplierId !== undefined && supplierId !== null) {
                supplierById.set(String(supplierId), supplier);
            }
        });

        function getSupplierName(product) {
            const directName =
                product.supplier_name ||
                product.supplier ||
                product.supplierName;

            if (directName && String(directName).trim()) {
                return String(directName).trim();
            }

            const supplierId =
                product.supplier_id ?? product.supplierId;

            const supplier =
                supplierId !== undefined && supplierId !== null
                    ? supplierById.get(String(supplierId))
                    : null;

            if (supplier) {
                return String(
                    supplier.supplier_name ||
                    supplier.name ||
                    supplier.company_name ||
                    supplier.business_name ||
                    "Unknown supplier"
                );
            }

            return "supplier not assigned";
        }

        const stats = {};

        products.forEach(product => {
            stats[product.id] = {
                soldQty: 0,
                returnedQty: 0,
                netQty: 0,
                netAmount: 0,
                recentQty: 0,
                previousQty: 0
            };
        });

        let overallRecent = 0;
        let overallPrevious = 0;

        sales.forEach(sale => {
            const st = stats[sale.product_id];

            if (!st) return;

            const qty = Math.max(0, Number(sale.quantity) || 0);
            const total = Math.max(0, Number(sale.total) || 0);
            const saleId = sale.id ?? sale.sale_id;

            const returned = Math.min(
                Math.max(0, returnedBySale[saleId] || 0),
                qty
            );

            const netQty = Math.max(0, qty - returned);
            const unitPrice = qty > 0 ? total / qty : 0;
            const estimatedAfterReturns = unitPrice * netQty;

            const hasRecordedRefund =
                Object.prototype.hasOwnProperty.call(
                    refundedAmountBySale,
                    saleId
                );

            const netAmount = hasRecordedRefund
                ? Math.max(
                    0,
                    total - refundedAmountBySale[saleId]
                )
                : Math.max(0, estimatedAfterReturns);

            st.soldQty += qty;
            st.returnedQty += returned;
            st.netQty += netQty;
            st.netAmount += netAmount;

            const date = new Date(sale.sale_date);

            if (date >= recentStart) {
                st.recentQty += netQty;
                overallRecent += netAmount;
            } else if (date >= previousStart) {
                st.previousQty += netQty;
                overallPrevious += netAmount;
            }
        });

                const items = products.map(product => {
            const st = stats[product.id];
            const stock = Number(product.quantity) || 0;
            const price = Number(product.price) || 0;
            const avgDaily = st.netQty / totalDays;

            const daysLeft = avgDaily > 0
                ? stock / avgDaily
                : null;

            return {
                id: product.id,
                image: product.image || "",
                product_name: product.product_name,
                category: product.category,
                supplier: getSupplierName(product),
                stock,
                stockValue: stock * price,
                soldQty: st.soldQty,
                returnedQty: st.returnedQty,
                netQty: st.netQty,
                netAmount: st.netAmount,
                recentQty: st.recentQty,
                previousQty: st.previousQty,
                avgDaily,
                daysLeft,
                trend: getTrend(
                    st.recentQty,
                    st.previousQty,
                    st.netQty
                )
            };
        });

        const selling = items
            .filter(item => item.netQty > 0)
            .sort((a, b) =>
                b.netQty - a.netQty ||
                a.product_name.localeCompare(b.product_name)
            );

               const fastIds = new Set(
            selling.map(item => item.id)
        );

        const slowIds = new Set(
            items
                .filter(item => item.netQty <= 0)
                .map(item => item.id)
        );

        const used = new Set();
        const rows = [];

        function addRow(
            item,
            type,
            priority,
            recommendation,
            description,
            extra
        ) {
            rows.push({
                id: item.id,
                image: item.image,
                product_name: item.product_name,
                category: item.category,
                type,
                priority,
                stock: item.stock,
                recommendation,
                description,
                trend: {
                    label: item.trend.label,
                    recent: item.recentQty,
                    previous: item.previousQty,
                    windowDays,
                    change:
                        item.trend.change === null
                            ? null
                            : round1(item.trend.change * 100)
                },
                _facts: {
                    supplier: item.supplier,
                    stock_value: round1(item.stockValue),
                    net_qty_sold: item.netQty,
                    sold_qty: item.soldQty,
                    returned_qty: item.returnedQty,
                    avg_per_day: round1(item.avgDaily),
                    days_left:
                        item.daysLeft === null
                            ? null
                            : round1(item.daysLeft),
                    suggested_order:
                        extra && extra.suggested
                            ? extra.suggested
                            : null
                }
            });
        }

               const restockAll = items
            .filter(item =>
                item.stock <= 0 ||
                (
                    item.daysLeft !== null &&
                    item.daysLeft <= LEAD_TIME_DAYS
                )
            )
            .sort((a, b) => {
                const aDays = a.stock <= 0 ? 0 : a.daysLeft;
                const bDays = b.stock <= 0 ? 0 : b.daysLeft;

                return (
                    aDays - bDays ||
                    a.product_name.localeCompare(b.product_name)
                );
            });

        restockAll.forEach(item => used.add(item.id));

        restockAll
            .slice(0, MAX_RESTOCK_ROWS)
            .forEach(item => {
                 const suggested = Math.max(
                    Math.ceil(item.avgDaily * COVER_DAYS) - item.stock,
                    1
                );

                const urgent =
                    item.stock === 0 ||
                    item.daysLeft <= URGENT_DAYS;

                const stockText = item.stock === 0
                    ? "Out of stock."
                    : "Only " + item.stock +
                      " pcs left, about " +
                      round1(item.daysLeft) +
                      " day(s) of stock at " +
                      round1(item.avgDaily) +
                      " pcs per day.";

                addRow(
                    item,
                    "Restock",
                    urgent ? "High" : "Medium",
                    (item.stock === 0
                        ? "Restock Now: order "
                        : "Restock: order ") +
                        suggested + " pcs",
                    stockText + " " +
                    trendText(item, windowDays) +
                    ". Order " + suggested +
                    " pcs from " + item.supplier + ".",
                    { suggested }
                );
            });

        const reviewAll = items
            .filter(item =>
                !used.has(item.id) &&
                item.soldQty > 0 &&
                item.returnedQty / item.soldQty >= RETURN_RATE_LIMIT
            )
            .sort((a, b) =>
                (b.returnedQty / b.soldQty) -
                (a.returnedQty / a.soldQty) ||
                b.returnedQty - a.returnedQty
            );

        reviewAll.forEach(item => used.add(item.id));

        reviewAll
            .slice(0, MAX_REVIEW_ROWS)
            .forEach(item => {
                const rate = Math.round(
                    item.returnedQty / item.soldQty * 100
                );

                addRow(
                    item,
                    "Review",
                    rate >= 50 ? "High" : "Medium",
                    "Review Quality / Supplier",
                    item.returnedQty + " of " +
                    item.soldQty + " pcs sold were returned (" +
                    rate + "%). Check the product quality or talk to " +
                    item.supplier + " before ordering again."
                );
            });

        items
            .filter(item =>
                fastIds.has(item.id) && !used.has(item.id)
            )
            .sort((a, b) => b.netQty - a.netQty)
            .slice(0, MAX_FAST_ROWS)
            .forEach(item => {
                used.add(item.id);

                 const slowing =
                    item.trend.label === "Declining" ||
                    item.trend.label === "No Recent Sales";

                const daysText = item.daysLeft !== null
                    ? ", about " + round1(item.daysLeft) +
                      " day(s) of stock"
                    : "";

                let recommendation = "Keep Stocked";

                if (slowing) {
                    recommendation =
                        "Keep Stocked: sales are slowing";
                } else if (
                    item.daysLeft !== null &&
                    item.daysLeft <= 14
                ) {
                    recommendation =
                        "Keep Stocked: plan the next order";
                }

                addRow(
                    item,
                    "Fast-Moving",
                    slowing ? "Medium" : "Low",
                    recommendation,
                    "Best seller: " + item.netQty +
                    " pcs sold (₱" + money(item.netAmount) +
                    "). " + trendText(item, windowDays) + ". " +
                    item.stock + " pcs in stock" + daysText + "."
                );
            });

        items
            .filter(item =>
                !used.has(item.id) &&
                item.trend.label === "Declining" &&
                item.stock > 0
            )
            .sort((a, b) =>
                (b.previousQty - b.recentQty) -
                (a.previousQty - a.recentQty)
            )
            .slice(0, MAX_DECLINING_ROWS)
            .forEach(item => {
                used.add(item.id);

                addRow(
                    item,
                    "Declining",
                    "Medium",
                    "Reduce Next Order",
                    trendText(item, windowDays) + ". " +
                    item.stock +
                    " pcs are still in stock, so reduce the next order " +
                    "and watch the sales."
                );
            });

        items
            .filter(item =>
                slowIds.has(item.id) &&
                !used.has(item.id) &&
                item.stock > 0
            )
            .sort((a, b) => b.stock - a.stock)
            .slice(0, MAX_SLOW_ROWS)
            .forEach(item => {
                used.add(item.id);

                const priority =
                    item.stock >= 100
                        ? "High"
                        : item.stock >= 40
                            ? "Medium"
                            : "Low";

                const soldText = item.netQty > 0
                    ? "Only " + item.netQty + " pcs sold."
                    : "No sales recorded.";

                addRow(
                    item,
                    "Slow-Moving",
                    priority,
                    "Hold Restocking / Run Promo",
                    soldText + " " + item.stock +
                    " pcs (worth ₱" + money(item.stockValue) +
                    ") are sitting in stock. Hold restocking and try a " +
                    "promo or bundle it with a fast-moving item."
                );
            });

                    const typeOrder = {
            "Restock": 0,
            "Review": 1,
            "Fast-Moving": 2,
            "Declining": 3,
            "Slow-Moving": 4
        };

        const priorityOrder = {
            "High": 0,
            "Medium": 1,
            "Low": 2
        };

        rows.forEach((row, index) => {
            row._index = index;
        });

        rows.sort((a, b) =>
            priorityOrder[a.priority] - priorityOrder[b.priority] ||
            typeOrder[a.type] - typeOrder[b.type] ||
            a._index - b._index
        );

        const overallTrend = getTrend(
            overallRecent,
            overallPrevious,
            overallRecent + overallPrevious
        );

        const overall = {
            label: overallTrend.label,
            change:
                overallTrend.change === null
                    ? null
                    : round1(overallTrend.change * 100),
            recentSales: round1(overallRecent),
            previousSales: round1(overallPrevious),
            windowDays
        };

        const pendingOrders = purchaseOrders.filter(order =>
            order.status === "Pending" ||
            order.status === "Partial"
        ).length;

        const dataCheck = {
            inventory: products.length,
            sales: sales.length,
            suppliers: suppliers.length,
            returns: returns.length,
            refunds: refunds.length,
            pendingOrders
        };

         const summaryStats = {
            restock: restockAll.length,
            review: reviewAll.length,
            fast: selling.length,
            slow: items.filter(item => item.netQty <= 0).length
        };

        const summary =
            "Overall sales are " + overall.label.toLowerCase() +
            " (₱" + money(overall.recentSales) +
            " in the last " + windowDays +
            " days vs ₱" + money(overall.previousSales) +
            " in the " + windowDays +
            " days before). " + summaryStats.restock +
            " product(s) need restocking and " +
            summaryStats.slow +
            " product(s) are slow-moving.";

        let aiUsed = false;
        let aiNote = null;

        if (!process.env.GEMINI_API_KEY) {
            aiNote =
                "AI is not configured (GEMINI_API_KEY is missing), so the " +
                "descriptions were generated from the recorded data only.";
        } else {
            try {
                const aiItems = rows.map(row => ({
                    id: row.id,
                    product: row.product_name,
                    category: row.category,
                    type: row.type,
                    recommended_action: row.recommendation,
                    sales_trend: row.trend.label,
                    sold_last_days: row.trend.recent,
                    sold_before_that: row.trend.previous,
                    days_per_period: windowDays,
                    stock: row.stock,
                    supplier: row._facts.supplier,
                    stock_value: row._facts.stock_value,
                    total_net_qty_sold: row._facts.net_qty_sold,
                    total_qty_sold: row._facts.sold_qty,
                    total_qty_returned: row._facts.returned_qty,
                    avg_sold_per_day: row._facts.avg_per_day,
                    days_of_stock_left: row._facts.days_left,
                    suggested_order_qty: row._facts.suggested_order
                }));

                const prompt = `
Rules:
- For each item, write a description of 1 short sentence in simple, natural English, as if you are advising the shop owner directly (use "you" and "your").
- Explain the sales trend, the stock situation, and why the recommended action makes sense, but do not just list numbers.
- Do not start the sentence with "With", "Showing", or "Based on".
- Use ONLY the numbers given. Do not invent numbers.
- Mention the supplier name only for Restock and Review items.
- If sold_last_days is 0 and sold_before_that is more than 0, say that sales stopped recently.
- Do not change the recommended action.
- Also write a summary of 1 to 2 sentences about the overall sales trend, the products to restock, and the slow-moving products.

OVERALL SALES TREND:
${JSON.stringify(overall)}

COUNTS:
${JSON.stringify(summaryStats)}

Respond with ONLY valid JSON in this exact shape:
{
  "summary": "Short overview",
  "items": [
    { "id": 1, "description": "Short explanation" }
  ]
}

ITEMS:
${JSON.stringify(aiItems)}
`;

                const aiResponse = await callGemini(prompt);

                if (aiResponse && aiResponse.ok) {
                    const data = await aiResponse.json();

                    const rawText =
                        data.candidates &&
                        data.candidates[0] &&
                        data.candidates[0].content &&
                        data.candidates[0].content.parts &&
                        data.candidates[0].content.parts[0]
                            ? data.candidates[0].content.parts[0].text
                            : "";

                    const start = rawText.indexOf("{");
                    const end = rawText.lastIndexOf("}");

                    if (start !== -1 && end !== -1) {
                        const parsed = JSON.parse(
                            rawText.slice(start, end + 1)
                        );

                        const byId = {};

                        (parsed.items || []).forEach(entry => {
                            if (entry && entry.description) {
                                byId[String(entry.id)] =
                                    String(entry.description);
                            }
                        });

                        rows.forEach(row => {
                            if (byId[String(row.id)]) {
                                row.description =
                                    byId[String(row.id)];
                            }
                        });

                        aiUsed = Object.keys(byId).length > 0;
                    }
                } else {
                    const status = aiResponse
                        ? aiResponse.status
                        : "no response";

                    console.log("Gemini Error:", status);

                    aiNote = status === 429
                        ? "The AI limit was reached, so the descriptions were generated from the recorded data only. Please try again in a minute."
                        : "The AI is not available right now, so the descriptions were generated from the recorded data only.";
                }
            } catch (aiError) {
                console.log("AI Analysis Error:", aiError);

                aiNote =
                    "The AI is not available right now, so the descriptions were generated from the recorded data only.";
            }

            if (!aiUsed && !aiNote) {
                aiNote =
                    "The AI returned an unexpected response, so the descriptions were generated from the recorded data only.";
            }
        }

        res.send({
            success: true,
            aiUsed,
            aiNote,
            summary,
            dataCheck,
            overall,
            stats: summaryStats,
            recommendations: rows.map(row => {
                const copy = Object.assign({}, row);
                delete copy._facts;
                delete copy._index;
                return copy;
            })
        });
    } catch (error) {
        console.log("AI Recommendation Error:", error);

        res.send({
            success: false,
            message: "Failed to generate AI recommendations."
        });
    }
});

module.exports = router;