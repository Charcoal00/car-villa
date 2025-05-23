const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const TempAdmin = require("../models/TempAdmin");
const Admin = require("../models/Admin");
const { sendOTP } = require("../utils/nodemailer");
const User = require("../models/User");
const User2 = require("../models/RenewalUser");
const adminToken = require("../middleware/adminAuth");

const { single, array } = require("../middleware/upload");

const router = express.Router();

router.post("/register", async (req, res) => {
    // console.log("Received request:", req.body); // Debugging log

    const { firstName, lastName, email, password, whatsapp, country, state } =
        req.body;

    if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ msg: "All fields are required" });
    }
    console.log(req.body);
    const existingAdmin = await Admin.findOne({ email });
    const existingAdmin2 = await TempAdmin.findOne({ email });

    if (existingAdmin || existingAdmin2) {
        return res.status(400).json({ msg: "Admin already exists." });
    }

    try {
        const otp = crypto.randomInt(100000, 999999).toString();
        const otpExpires = new Date(Date.now() + 5 * 60 * 1000);
        console.log(otp);
        const hashedPassword = await bcrypt.hash(password, 10);
        const newAdmin = new TempAdmin({
            firstName,
            lastName,
            email,
            password: hashedPassword,
            whatsapp,
            country,
            state,
            otp,
            otpExpires,
        });

        await newAdmin.save();
        // console.log(`Created new admin: ${newAdmin}`

        await sendOTP(email, otp);
        res.json({ msg: "OTP sent, verify to complete registration" });
    } catch (error) {
        console.error("Error in registration:", error);
        res.status(500).json({ msg: "Internal server error" });
    }
});

router.post("/verify-otp", async (req, res) => {
    const { email, otp } = req.body;
    try {
        const tempAdmin = await TempAdmin.findOne({
            email,
            otp,
            otpExpires: { $gt: new Date() },
        });
        if (!tempAdmin) {
            console.log("OTP not found or expired");
            return res.status(400).json({ msg: "Invalid or expired OTP" });
        }

        // Move verified admin to `Admin` collection
        const newAdmin = new Admin({
            firstName: tempAdmin.firstName,
            lastName: tempAdmin.lastName,
            email: tempAdmin.email,
            password: tempAdmin.password,
            whatsapp: tempAdmin.whatsapp,
            country: tempAdmin.country,
            state: tempAdmin.state,
        });

        await newAdmin.save();

        // Delete admin from `TempAdmin` after verification
        await TempAdmin.deleteOne({ email });

        res.json({ msg: "Account verified successfully!" });
    } catch (error) {
        console.error("Error verifying OTP:", error);
        res.status(500).json({ msg: "Internal server error" });
    }
});

router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email });
    if (!admin)
        return res.status(400).json({ msg: "Admin not found or not verified" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, {
        expiresIn: "1h",
    });

    res.json({ msg: "Login successful", token });
});

router.get("/profile", adminToken, async (req, res) => {
    try {
        const admin = await Admin.findById(req.admin.id).select(
            "-password"
        );

        if (!admin) return res.status(404).json({ msg: "Admin not found" });

        res.json(admin);
    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: "Internal server error" });
    }
});


router.put("/edit", adminToken, single("profilePicture"), async (req, res) => {
    try {
        // Changed from req.user.userId to req.admin.id
        const admin = await Admin.findById(req.admin.id);
        if (!admin) return res.status(404).json({ error: "Admin not found" });

        // Update profile picture if uploaded
        if (req.file) {
            admin.profilePicture = req.file.path;
        }

        // Update other fields
        Object.assign(admin, req.body);
        await admin.save();

        res.json({ message: "Profile updated successfully", admin });
    } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).json({ error: "Server error" });
    }
});

router.get("/users", adminToken, async (req, res) => {
    try {
        const { search } = req.query;
        let query = {};

        if (search) {
            // Check if search term is a valid ObjectId
            const isObjectId = /^[0-9a-fA-F]{24}$/.test(search);
            
            query = {
                $or: [
                    // Only include _id search if it's a valid ObjectId
                    ...(isObjectId ? [{ _id: search }] : []),
                    { email: { $regex: search, $options: "i" } },
                    // Add other searchable fields as needed
                    { firstName: { $regex: search, $options: "i" } },
                    { lastName: { $regex: search, $options: "i" } },
                    { whatsapp: { $regex: search, $options: "i" } }
                ]
            };
        }

        const users = await User.find(query, "-password");
        res.json(users);
    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            msg: "Internal server error",
            error: error.message 
        });
    }
});

router.get("/users/:id", adminToken, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: "User not found" });

        res.json(user);
    } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({ error: "Error fetching user details" });
    }
});
router.delete("/users/:id", adminToken, async (req, res) => {
    try {
        const deleted = await User.findByIdAndDelete(req.params.id);
        if (!deleted)
            return res.status(404).json({ message: "User not found" });
        res.status(200).json({ message: "User deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Error deleting user", error });
    }
});
module.exports = router;
