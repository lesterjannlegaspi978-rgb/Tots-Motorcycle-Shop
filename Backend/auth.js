const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const router = express.Router();
const db = require("./db");

function isValidFullname(fullname) {
    if (!fullname) return false;

    const value = fullname.trim();

    if (!/^[A-Za-zÀ-ÿ' -]+$/.test(value)) {
        return false;
    }

    const letters = value.replace(/[^A-Za-zÀ-ÿ]/g, "");

    if (letters.length < 2) {
        return false;
    }

    return true;
}

function isValidUsername(username) {
    if (!username) return false;

    const value = username.trim();

    if (!/^[A-Za-z0-9_]+$/.test(value)) {
        return false;
    }

    if (value.length < 4) {
        return false;
    }

    if (value.length > 20) {
        return false;
    }

    return true;
}

function isValidGmail(email) {
    if (!email) return false;

    const value = email.trim().toLowerCase();

    if (!/^[a-z0-9._%+-]+@gmail\.com$/.test(value)) {
        return false;
    }

    if (/(.)\1/.test(value)) {
        return false;
    }

    if (value.includes("..")) {
        return false;
    }

    const localPart = value.split("@")[0];

    if (
        localPart.startsWith(".") ||
        localPart.endsWith(".")
    ) {
        return false;
    }

    return true;
}

function isValidContact(contact) {
    if (!contact) return false;

    const value = contact.trim();

    if (!/^09\d{9}$/.test(value)) {
        return false;
    }

    return true;
}

function isStrongPassword(password) {
    if (!password) return false;

    if (password.length < 8) {
        return false;
    }

    if (!/[A-Z]/.test(password)) {
        return false;
    }

    if (!/[a-z]/.test(password)) {
        return false;
    }

    if (!/[0-9]/.test(password)) {
        return false;
    }

    if (!/[^A-Za-z0-9]/.test(password)) {
        return false;
    }

    return true;
}

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
        return res.status(400).json({
            success: false,
            message: "Please complete all fields."
        });
    }

    const cleanFullname = fullname.trim();
    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanContact = contact.trim();

    if (!isValidFullname(cleanFullname)) {

        return res.status(400).json({
            success: false,
            message:
                "Invalid full name. Use letters, spaces, hyphens, or apostrophes only."
        });

    }

    if (!isValidUsername(cleanUsername)) {

        return res.status(400).json({
            success: false,
            message:
                "Username must be 4-20 characters and may contain only letters, numbers, and underscore."
        });

    }

    if (!isValidGmail(cleanEmail)) {

        return res.status(400).json({
            success: false,
            message:
                "Please enter a valid Gmail address. Consecutive repeated characters are not allowed."
        });

    }

    if (!isValidContact(cleanContact)) {

        return res.status(400).json({
            success: false,
            message:
                "Contact number must be a valid Philippine mobile number starting with 09 and containing 11 digits."
        });

    }

    if (!isStrongPassword(password)) {

        return res.status(400).json({
            success: false,
            message:
                "Password must contain at least 8 characters, uppercase, lowercase, number, and special character."
        });

    }


    try {

        const fullnameSql = `
            SELECT id
            FROM admins
            WHERE LOWER(fullname) = LOWER(?)
            LIMIT 1
        `;

        const fullnameResult = await new Promise(
            (resolve, reject) => {

                db.query(
                    fullnameSql,
                    [cleanFullname],
                    (err, result) => {

                        if (err) {
                            reject(err);
                        } else {
                            resolve(result);
                        }

                    }
                );

            }
        );


        if (fullnameResult.length > 0) {

            return res.status(409).json({
                success: false,
                message:
                    "This full name is already registered."
            });

        }

        const usernameSql = `
            SELECT id
            FROM admins
            WHERE LOWER(username) = LOWER(?)
            LIMIT 1
        `;

        const usernameResult = await new Promise(
            (resolve, reject) => {

                db.query(
                    usernameSql,
                    [cleanUsername],
                    (err, result) => {

                        if (err) {
                            reject(err);
                        } else {
                            resolve(result);
                        }

                    }
                );

            }
        );


        if (usernameResult.length > 0) {

            return res.status(409).json({
                success: false,
                message:
                    "This username is already registered."
            });

        }

        const emailSql = `
            SELECT id
            FROM admins
            WHERE LOWER(email) = LOWER(?)
            LIMIT 1
        `;

        const emailResult = await new Promise(
            (resolve, reject) => {

                db.query(
                    emailSql,
                    [cleanEmail],
                    (err, result) => {

                        if (err) {
                            reject(err);
                        } else {
                            resolve(result);
                        }

                    }
                );

            }
        );


        if (emailResult.length > 0) {

            return res.status(409).json({
                success: false,
                message:
                    "This Gmail address is already registered."
            });

        }

        const contactSql = `
            SELECT id
            FROM admins
            WHERE contact = ?
            LIMIT 1
        `;

        const contactResult = await new Promise(
            (resolve, reject) => {

                db.query(
                    contactSql,
                    [cleanContact],
                    (err, result) => {

                        if (err) {
                            reject(err);
                        } else {
                            resolve(result);
                        }

                    }
                );

            }
        );


        if (contactResult.length > 0) {

            return res.status(409).json({
                success: false,
                message:
                    "This contact number is already registered."
            });

        }

        const existingPasswordSql = `
            SELECT password
            FROM admins
        `;

        const existingPasswords = await new Promise(
            (resolve, reject) => {

                db.query(
                    existingPasswordSql,
                    (err, result) => {

                        if (err) {
                            reject(err);
                        } else {
                            resolve(result);
                        }

                    }
                );

            }
        );


        for (const account of existingPasswords) {

            const samePassword =
                await bcrypt.compare(
                    password,
                    account.password
                );

            if (samePassword) {

                return res.status(409).json({
                    success: false,
                    message:
                        "This password is already being used by another account. Please choose a different password."
                });

            }

        }

        const hashedPassword =
            await bcrypt.hash(password, 10);

        const insertSql = `
            INSERT INTO admins
            (
                fullname,
                username,
                email,
                contact,
                password
            )
            VALUES (?, ?, ?, ?, ?)
        `;


        db.query(
            insertSql,
            [
                cleanFullname,
                cleanUsername,
                cleanEmail,
                cleanContact,
                hashedPassword
            ],
            (err, result) => {

                if (err) {

                    console.log(
                        "REGISTRATION DATABASE ERROR:"
                    );

                    console.log(err);

                    if (err.code === "ER_DUP_ENTRY") {

                        return res.status(409).json({
                            success: false,
                            message:
                                "An account with the same information already exists."
                        });

                    }

                    return res.status(500).json({
                        success: false,
                        message:
                            "Registration Failed"
                    });

                }


                console.log(
                    "Admin registered successfully. ID:",
                    result.insertId
                );


                return res.status(201).json({
                    success: true,
                    message:
                        "Registration Successful"
                });

            }
        );


    } catch (error) {

        console.log(
            "REGISTRATION SERVER ERROR:"
        );

        console.log(error);

        return res.status(500).json({
            success: false,
            message:
                "Server Error"
        });

    }

});

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Please provide username and password' });
  }

  // Gamitin ang pool query
  db.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, username], async (err, results) => {
    if (err) {
      console.error('LOGIN DB ERROR:', err);
      return res.status(500).json({ success: false, message: 'Server Error' });
    }

    if (results.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    const user = results[0];

    // Kung plain text ang password
    if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    // Success response
    return res.json({
      success: true,
      token: 'sample-auth-token',
      user: { id: user.id, username: user.username, role: user.role }
    });
  });
});


function runQuery(sql, params) {

    return new Promise((resolve, reject) => {

        db.query(sql, params, (err, result) => {

            if (err) {
                reject(err);
            } else {
                resolve(result);
            }

        });

    });

}

router.post("/verify-user", async (req, res) => {

    const { username, email } = req.body;

    if (!username || !email) {

        return res.status(400).json({
            success: false,
            message: "Please enter your username and email."
        });

    }

    try {

        const result = await runQuery(
            `
            SELECT id
            FROM admins
            WHERE LOWER(username) = LOWER(?)
            AND LOWER(email) = LOWER(?)
            LIMIT 1
            `,
            [username.trim(), email.trim()]
        );

        if (result.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Username and email do not match any account."
            });

        }

        return res.json({
            success: true,
            message: "Account verified."
        });

    } catch (error) {

        console.log("VERIFY USER ERROR:");
        console.log(error);

        return res.status(500).json({
            success: false,
            message: "Server Error"
        });

    }

});

router.post("/reset-password", async (req, res) => {

    const { username, email, newPassword } = req.body;

    if (!username || !email || !newPassword) {

        return res.status(400).json({
            success: false,
            message: "Please complete all fields."
        });

    }

    if (!isStrongPassword(newPassword)) {

        return res.status(400).json({
            success: false,
            message:
                "Password must contain at least 8 characters, uppercase, lowercase, number, and special character."
        });

    }

    try {

        const accounts = await runQuery(
            `
            SELECT id, password
            FROM admins
            WHERE LOWER(username) = LOWER(?)
            AND LOWER(email) = LOWER(?)
            LIMIT 1
            `,
            [username.trim(), email.trim()]
        );

        if (accounts.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Account not found."
            });

        }

        const account = accounts[0];

        const sameAsOld = await bcrypt.compare(
            newPassword,
            account.password
        );

        if (sameAsOld) {

            return res.status(400).json({
                success: false,
                message: "New password must be different from your old password."
            });

        }

        const otherAccounts = await runQuery(
            `
            SELECT password
            FROM admins
            WHERE id <> ?
            `,
            [account.id]
        );

        for (const other of otherAccounts) {

            const used = await bcrypt.compare(
                newPassword,
                other.password
            );

            if (used) {

                return res.status(409).json({
                    success: false,
                    message:
                        "This password is already being used by another account. Please choose a different password."
                });

            }

        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await runQuery(
            `
            UPDATE admins
            SET password = ?
            WHERE id = ?
            `,
            [hashedPassword, account.id]
        );

        return res.json({
            success: true,
            message: "Password reset successful."
        });

    } catch (error) {

        console.log("RESET PASSWORD ERROR:");
        console.log(error);

        return res.status(500).json({
            success: false,
            message: "Server Error"
        });

    }

});


module.exports = router;
