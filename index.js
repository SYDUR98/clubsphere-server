const express = require("express");
const { MongoClient, ServerApiVersion } = require("mongodb");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;

// mongodb
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.chduhq7.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Middleware
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send("club sphere sarver working!");
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db("club-sphere-db");
    const userCollection = db.collection("users");
    const clubsCollection = db.collection("clubs");

    //=============================================================================
    //                  user related APIs
    //=============================================================================
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "member";
      user.createAt = new Date();
      const exists = await userCollection.findOne({ email: user.email });
      if (exists) return res.send({ message: "user exists" });
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    //================================================================================
    //               club related apis
    //================================================================================

    app.post("/clubs", async (req, res) => {
      try {
        const {
          clubName,
          description,
          category,
          location,
          bannerImage,
          membershipFee,
          managerEmail,
          status,
          createdAt,
        } = req.body;

        // validation
        if (
          !clubName ||
          !description ||
          !category ||
          !location ||
          !bannerImage ||
          membershipFee == null ||
          !managerEmail
        ) {
          return res.status(400).json({ message: "All fields are required" });
        }

        const newClub = {
          clubName,
          description,
          category,
          location,
          bannerImage,
          membershipFee,
          managerEmail,
          status: status || "pending",
          createdAt: createdAt || new Date(),
        };

        const result = await clubsCollection.insertOne(newClub);

        res.status(201).json({
          message: "Club created successfully",
          clubId: result.insertedId,
          club: newClub,
        });
      } catch (error) {
        console.error("Error creating club:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
