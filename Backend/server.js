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

app.use(express.static(path.join(__dirname, '../Frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../Frontend/index.html')); 
  
});

const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});