const express = require('express');
const router = express.Router();
const db = require('./db');

router.post('/add', (req, res) => {

    const {
        product_name,
        category,
        quantity,
        price
    } = req.body;

    if (
        !product_name ||
        !category ||
        quantity === undefined ||
        price === undefined
    ) {
        return res.send({
            success: false,
            message: "Please fill in all fields."
        });
    }

    const checkSql = `
        SELECT id
        FROM products
        WHERE product_name = ?
        LIMIT 1
    `;

    db.query(checkSql, [product_name], (err, result) => {

        if (err) {
            console.log("CHECK PRODUCT ERROR:");
            console.log(err);

            return res.send({
                success: false,
                message: "Database Error: " + err.sqlMessage
            });
        }

        if (result.length > 0) {
            return res.send({
                success: false,
                message: "Product already exists!"
            });
        }

        const sql = `
            INSERT INTO products
            (
                product_name,
                category,
                quantity,
                price
            )
            VALUES (?, ?, ?, ?)
        `;

        db.query(
            sql,
            [
                product_name,
                category,
                Number(quantity),
                Number(price)
            ],
            (err, result) => {

                if (err) {

                    console.log("==============================");
                    console.log("ADD PRODUCT DATABASE ERROR:");
                    console.log(err);
                    console.log("SQL MESSAGE:", err.sqlMessage);
                    console.log("==============================");

                    return res.send({
                        success: false,
                        message: "Database Error: " + err.sqlMessage
                    });
                }

                console.log(
                    "Product added successfully. ID:",
                    result.insertId
                );

                res.send({
                    success: true,
                    message: "Product Saved Successfully!"
                });

            }
        );

    });

});

router.get('/all', (req, res) => {

    const sql = "SELECT * FROM products";

    db.query(sql, (err, result) => {

        if(err){
            return res.send({
                success:false
            });
        }

        res.send(result);

    });

});

router.delete("/delete/:id", (req, res) => {

    const id = req.params.id;

    const sql =
    "DELETE FROM products WHERE id = ?";

    db.query(sql, [id], (err, result) => {

        if(err){

            return res.send({
                success:false,
                message:"Delete Failed"
            });

        }

        res.send({
            success:true,
            message:"Product Deleted Successfully"
        });

    });

});

router.put("/update/:id", (req, res) => {

    const id = req.params.id;

    const {
        product_name,
        category,
        quantity,
        price,
        image
    } = req.body;

    const sql = `
        UPDATE products
        SET
            product_name = ?,
            category = ?,
            quantity = ?,
            price = ?,
            image = ?
        WHERE id = ?
    `;

    db.query(
        sql,
        [
            product_name,
            category,
            quantity,
            price,
            image,
            id
        ],
        (err, result) => {

            if (err) {

                console.log("UPDATE ERROR:", err);

                return res.status(500).json({
                    success: false,
                    message: "Update Failed",
                    error: err.message
                });

            }

            res.json({
                success: true,
                message: "Product Updated Successfully"
            });

        }
    );

});

module.exports = router;