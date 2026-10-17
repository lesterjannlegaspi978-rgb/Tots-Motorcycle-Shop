require("dotenv").config();

const express = require('express');

const sales = require("./sales");
const products = require('./products');
const cors = require('cors');
const db = require('./db');
const auth = require('./auth');
const dashboard = require('./dashboard');
const reports = require("./reports");
const suppliers = require("./supplier");
const purchaseOrders = require("./purchase_order");
const stockIn = require("./stock_in");
const salesReturn = require("./sales_return");
const refund = require("./refund");
const ai = require("./ai_recommendation");
const analytics = require("./analytics");   // BAGO

console.log("auth =", auth);
console.log("dashboard =", dashboard);
console.log("products =", products);
console.log("sales =", sales);

const app = express();

app.use(cors());
app.use(express.json());

app.use("/auth", auth);
app.use("/dashboard", dashboard);
app.use("/products", products);

app.use("/sales", sales);
app.use("/reports", reports);
app.use("/suppliers", suppliers);
app.use("/purchase-orders", purchaseOrders);
app.use("/stock-in", stockIn);
app.use("/sales-returns", salesReturn);
app.use("/refunds", refund);
app.use("/ai", ai);
app.use("/analytics", analytics);  

const path = require('path');

// I-serve ang Frontend folder para sa HTML, CSS, at JS files
app.use(express.static(path.join(__dirname, '../Frontend')));

// Kapag binuksan ang main URL (/), ilabas ang login.html o index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../Frontend/index.html')); 
  // Note: Kung login.html ang main page mo, gawin mong '../Frontend/login.html'
});

app.listen(5000, () => {
    console.log("Server running on port 5000");
});