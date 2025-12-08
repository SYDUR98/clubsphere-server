const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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
    const eventsCollection = db.collection("events");

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
    //                    Admin apis
    //================================================================================
    // Admin Stats API
    app.get("/admin/stats", async (req, res) => {
      try {
        const totalUsers = await userCollection.countDocuments();
        const totalClubs = await clubsCollection.countDocuments();
        const pendingClubs = await clubsCollection.countDocuments({
          status: "pending",
        });
        const approvedClubs = await clubsCollection.countDocuments({
          status: "approved",
        });
        const rejectedClubs = await clubsCollection.countDocuments({
          status: "rejected",
        });
        const totalEvents = await eventsCollection.countDocuments();

        //  payments collection later
        const totalPayments = 0;

        res.send({
          totalUsers,
          totalClubs,
          pendingClubs,
          approvedClubs,
          rejectedClubs,
          totalEvents,
          totalPayments,
        });
      } catch (err) {
        res.status(500).send({ message: "Stats loading failed" });
      }
    });

    //================================================================================
    //              Manager apis
    //================================================================================
    //club related apis
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

    // Get My Clubs
    app.get("/clubs/manager/:email", async (req, res) => {
      const email = req.params.email;
      const result = await clubsCollection
        .find({ managerEmail: email })
        .toArray();
      res.send(result);
    });

    // Edit Club
    app.patch("/clubs/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const data = { ...req.body };

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid club ID" });
        }

        // Remove _id if it exists, keep createdAt as it is
        delete data._id;

        // Convert membershipFee to number if it exists
        if (data.membershipFee) {
          data.membershipFee = Number(data.membershipFee);
        }

        const result = await clubsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...data,
              updatedAt: new Date(), // Only update updatedAt
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Club not found" });
        }

        res.status(200).json({ message: "Club updated successfully" });
      } catch (err) {
        console.error("PATCH ERROR:", err);
        res.status(500).json({ message: "Update failed", error: err.message });
      }
    });
    // delete pais
    app.delete("/clubs/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await clubsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Delete failed" });
      }
    });

    // event apis

    // Create Event
    app.post("/events", async (req, res) => {
      try {
        const {
          title,
          description,
          eventDate,
          location,
          isPaid,
          eventFee,
          clubId,
          maxAttendees,
        } = req.body;

        if (!title || !description || !eventDate || !location || !clubId) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        const data = {
          title,
          description,
          eventDate: new Date(eventDate),
          location,
          isPaid: !!isPaid,
          maxAttendees: maxAttendees ? Number(maxAttendees) : null,
          createdAt: new Date(),
          clubId: new ObjectId(clubId),
        };

        if (isPaid) {
          if (!eventFee || isNaN(eventFee)) {
            return res
              .status(400)
              .json({ message: "Event fee is required for paid events" });
          }
          data.eventFee = Number(eventFee);
        }

        const result = await eventsCollection.insertOne(data);
        res
          .status(201)
          .json({ message: "Event created", eventId: result.insertedId });
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .json({ message: "Failed to create event", error: err.message });
      }
    });

    // Get Events
    app.get("/events", async (req, res) => {
      try {
        // const clubId = req.params.clubId;
        const events = await eventsCollection.find().toArray();
        res.json(events);
      } catch (err) {
        res.status(500).json({ message: "Failed to fetch events" });
      }
    });
    // delete events
    app.delete("/events/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await eventsCollection.deleteOne(query);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Delete failed" });
      }
    });

    // Update Event
    app.patch("/events/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const data = { ...req.body };

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid event ID" });
        }

        // Remove _id if accidentally sent
        delete data._id;

        // Type conversion
        if (data.eventDate) data.eventDate = new Date(data.eventDate);
        if (data.isPaid !== undefined) data.isPaid = !!data.isPaid;
        if (data.eventFee) data.eventFee = Number(data.eventFee);
        if (data.maxAttendees) data.maxAttendees = Number(data.maxAttendees);

        const result = await eventsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { ...data, updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Event not found" });
        }

        res.status(200).json({ message: "Event updated successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Update failed", error: err.message });
      }
    });

    //******************************************************************************** */
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
