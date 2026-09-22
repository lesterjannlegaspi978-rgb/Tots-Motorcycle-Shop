const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const router = express.Router();
const db = require("./db");

router.post("/register", async (req, res) => {

    const {
        fullname,
        username,
        email,
        contact,
        password
    } = req.body;

    if (
        !fullname ||
        !username ||
        !email ||
        !contact ||
        !password
    ) {
        return res.send({
            success: false,
            message: "Please complete all fields"
        });
    }

    try {

        const hashedPassword =
            await bcrypt.hash(password, 10);

        const sql = `
            INSERT INTO admins
            (fullname, username, email, contact, password)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(
            sql,
            [
                fullname,
                username,
                email,
                contact,
                hashedPassword
            ],
            (err, result) => {

                if (err) {

                    console.log(err);

                    return res.send({
                        success: false,
                        message: "Registration Failed"
                    });

                }

                res.send({
                    success: true,
                    message: "Registration Successful"
                });

            }
        );

    } catch (error) {

        console.log(error);

        res.send({
            success: false,
            message: "Server Error"
        });

    }

});

router.post("/login", (req, res) => {

    const {
        username,
        password
    } = req.body;

    if (
        !username ||
        !password
    ) {
        return res.send({
            success: false,
            message: "Please enter your username and password."
        });
    }

    const sql =
        "SELECT * FROM admins WHERE username = ?";

    db.query(
        sql,
        [username],
        async (err, result) => {

            if (err) {

                console.log(err);

                return res.send({
                    success: false,
                    message: "Server Error"
                });

            }

            if (result.length === 0) {

                return res.send({
                    success: false,
                    message: "Wrong Username or Password"
                });

            }

            try {

                const passwordMatch =
                    await bcrypt.compare(
                        password,
                        result[0].password
                    );

                if (!passwordMatch) {

                    return res.send({
                        success: false,
                        message: "Wrong Username or Password"
                    });

                }

                const token = jwt.sign(
                    {
                        id: result[0].id,
                        username: result[0].username
                    },
                    process.env.JWT_SECRET,
                    {
                        expiresIn: "2h"
                    }
                );

                return res.send({
                    success: true,
                    message: "Login Successful",
                    token: token
                });

            } catch (error) {

                console.log(error);

                return res.send({
                    success: false,
                    message: "Server Error"
                });

            }

        }
    );

});


module.exports = router;